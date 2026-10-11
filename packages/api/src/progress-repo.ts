import { and, between, eq, gt, sql } from 'drizzle-orm'
import {
  BADGE_KEYS,
  EMPTY_STREAK,
  WEEKLY_GOAL,
  completionEffects,
  dailyCap,
  levelFor,
  viewStreak,
  weekStart,
  type BadgeKey,
  type CompletionRewardsDto,
  type PremiumDto,
  type ProgressDto,
  type StreakState,
} from '@wizzn/shared'
import type { Db } from './db/client.js'
import { completionEvent, entitlement, field, savedUnit, streak, unit, unitFeedback, user, userBadge, userInterest, userProfile, xpLedger } from './db/schema/index.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Conn = Db | Tx

export interface ProgressRepo {
  getPremium(userId: string, now: Date): Promise<PremiumDto>
  countDoneOn(userId: string, localDate: string): Promise<number>
  /**
   * Inserts the completion and applies streak, XP and badges atomically; null when the unit — or its paired
   * slides/audio sibling — was completed before (one topic is rewarded once, whichever variant was consumed).
   */
  recordCompletion(userId: string, unitId: string, today: string, premium: boolean, cap: number): Promise<CompletionRewardsDto | null>
  getProgress(userId: string, today: string, premium: PremiumDto, cap: number): Promise<ProgressDto>
  /** Returns false when the user does not exist (e.g. a RevenueCat anonymous id) */
  setEntitlement(userId: string, productId: string, activeUntil: Date): Promise<boolean>
  /** RevenueCat TRANSFER: the subscription moved to another app user */
  transferEntitlement(fromUserIds: string[], toUserId: string): Promise<void>
  /** Anonymous → signed-in account: carries progress over unless the target account already has its own */
  transferUserData(fromUserId: string, toUserId: string): Promise<'moved' | 'kept_target'>
}

const isBadgeKey = (k: string): k is BadgeKey => (BADGE_KEYS as readonly string[]).includes(k)

async function readStreak(conn: Conn, userId: string, lock: boolean): Promise<StreakState> {
  const q = conn.select().from(streak).where(eq(streak.userId, userId))
  const row = (await (lock ? q.for('update') : q))[0]
  if (!row) return EMPTY_STREAK
  return { current: row.current, longest: row.longest, lastLocalDate: row.lastLocalDate, freezesLeft: row.freezesLeft, freezesMonth: row.freezesMonth }
}

async function countBetween(conn: Conn, userId: string, from: string, to: string): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(completionEvent)
    .where(and(eq(completionEvent.userId, userId), between(completionEvent.localDate, from, to)))
  return row?.n ?? 0
}

async function totalXp(conn: Conn, userId: string): Promise<number> {
  const [row] = await conn.select({ xp: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int` }).from(xpLedger).where(eq(xpLedger.userId, userId))
  return row?.xp ?? 0
}

async function unitStats(conn: Conn, userId: string) {
  const [row] = await conn
    .select({
      total: sql<number>`count(*)::int`,
      audio: sql<number>`count(*) filter (where ${unit.format} = 'audio')::int`,
      written: sql<number>`count(*) filter (where ${unit.format} = 'written')::int`,
      fields: sql<number>`count(distinct ${unit.fieldId})::int`,
    })
    .from(completionEvent)
    .innerJoin(unit, eq(unit.id, completionEvent.unitId))
    .where(eq(completionEvent.userId, userId))
  const [fieldsRow] = await conn.select({ n: sql<number>`count(*)::int` }).from(field)
  return { totalUnits: row?.total ?? 0, audioUnits: row?.audio ?? 0, writtenUnits: row?.written ?? 0, fieldsTried: row?.fields ?? 0, fieldsTotal: fieldsRow?.n ?? 0 }
}

export function createProgressRepo(db: Db): ProgressRepo {
  return {
    async getPremium(userId, now) {
      const row = await db.query.entitlement.findFirst({ where: eq(entitlement.userId, userId) })
      const active = Boolean(row && row.activeUntil > now)
      return { active, until: row?.activeUntil.toISOString() ?? null, productId: row?.productId ?? null }
    },

    countDoneOn: (userId, localDate) => countBetween(db, userId, localDate, localDate),

    async recordCompletion(userId, unitId, today, premium, cap) {
      return db.transaction(async (tx) => {
        const [own] = await tx.select({ pairId: unit.pairId }).from(unit).where(eq(unit.id, unitId))
        if (own?.pairId) {
          const [sibling] = await tx
            .select({ id: completionEvent.id })
            .from(completionEvent)
            .innerJoin(unit, eq(unit.id, completionEvent.unitId))
            .where(and(eq(completionEvent.userId, userId), eq(unit.pairId, own.pairId)))
            .limit(1)
          if (sibling) return null
        }
        const inserted = await tx.insert(completionEvent).values({ userId, unitId, localDate: today }).onConflictDoNothing().returning({ id: completionEvent.id })
        if (inserted.length === 0) return null
        // Serialises concurrent completions of one user so day/week bonuses are paid once
        await tx.insert(streak).values({ userId }).onConflictDoNothing()
        const before = await readStreak(tx, userId, true)
        const doneToday = await countBetween(tx, userId, today, today)
        const doneWeek = await countBetween(tx, userId, weekStart(today), today)
        const xpBefore = await totalXp(tx, userId)
        const owned = await tx.select({ key: userBadge.badgeKey }).from(userBadge).where(eq(userBadge.userId, userId))
        const effects = completionEffects({
          today,
          premium,
          streak: before,
          doneTodayBefore: doneToday - 1,
          doneWeekBefore: doneWeek - 1,
          stats: await unitStats(tx, userId),
          ownedBadges: owned.map((o) => o.key),
        })

        await tx.update(streak).set(effects.streak).where(eq(streak.userId, userId))
        await tx.insert(xpLedger).values(effects.xp.map((x) => ({ userId, amount: x.amount, reason: x.reason })))
        if (effects.newBadges.length) {
          await tx.insert(userBadge).values(effects.newBadges.map((badgeKey) => ({ userId, badgeKey }))).onConflictDoNothing()
        }
        const xpGained = effects.xp.reduce((sum, x) => sum + x.amount, 0)
        const level = levelFor(xpBefore + xpGained)
        return {
          xpGained,
          xp: effects.xp,
          level,
          levelUp: level.level > levelFor(xpBefore).level,
          streak: effects.streak.current,
          streakExtended: effects.streak.current !== before.current || before.lastLocalDate !== today,
          freezesUsed: effects.freezesUsed,
          weeklyGoalReached: effects.weeklyGoalReached,
          week: { done: doneWeek, goal: WEEKLY_GOAL },
          newBadges: effects.newBadges,
          cap: dailyCap(doneToday, premium, cap),
        }
      })
    },

    async getProgress(userId, today, premium, cap) {
      const start = weekStart(today)
      const [s, doneToday, doneWeek, xp, badges, stats] = await Promise.all([
        readStreak(db, userId, false),
        countBetween(db, userId, today, today),
        countBetween(db, userId, start, today),
        totalXp(db, userId),
        db.select().from(userBadge).where(eq(userBadge.userId, userId)).orderBy(userBadge.earnedAt),
        unitStats(db, userId),
      ])
      return {
        today,
        streak: viewStreak(s, today, premium.active),
        level: levelFor(xp),
        week: { start, done: doneWeek, goal: WEEKLY_GOAL },
        cap: dailyCap(doneToday, premium.active, cap),
        badges: badges.flatMap((b) => (isBadgeKey(b.badgeKey) ? [{ key: b.badgeKey, earnedAt: b.earnedAt.toISOString() }] : [])),
        premium,
        stats: { totalUnits: stats.totalUnits, audioUnits: stats.audioUnits, writtenUnits: stats.writtenUnits },
      }
    },

    async setEntitlement(userId, productId, activeUntil) {
      const exists = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { id: true } })
      if (!exists) return false
      const values = { productId, activeUntil, source: 'revenuecat', updatedAt: new Date() }
      await db.insert(entitlement).values({ userId, ...values }).onConflictDoUpdate({ target: entitlement.userId, set: values })
      return true
    },

    async transferEntitlement(fromUserIds, toUserId) {
      await db.transaction(async (tx) => {
        for (const from of fromUserIds) {
          const [row] = await tx.delete(entitlement).where(eq(entitlement.userId, from)).returning()
          if (!row) continue
          const values = { productId: row.productId, activeUntil: row.activeUntil, source: row.source, updatedAt: new Date() }
          await tx.insert(entitlement).values({ userId: toUserId, ...values }).onConflictDoUpdate({ target: entitlement.userId, set: values })
        }
      })
    },

    async transferUserData(from, to) {
      return db.transaction(async (tx) => {
        // Bookmarks are merged in every case: nobody should lose what they saved before signing in
        await tx.execute(
          sql`insert into ${savedUnit} (user_id, unit_id, saved_at) select ${to}, unit_id, saved_at from ${savedUnit} where user_id = ${from} on conflict do nothing`,
        )
        const [targetHasProgress] = await tx.select({ id: completionEvent.id }).from(completionEvent).where(eq(completionEvent.userId, to)).limit(1)
        if (targetHasProgress) return 'kept_target'
        // Target is a fresh account: it takes over everything the anonymous user built up
        await tx.delete(userInterest).where(eq(userInterest.userId, to))
        await tx.delete(userProfile).where(eq(userProfile.userId, to))
        await tx.delete(streak).where(eq(streak.userId, to))
        await tx.delete(xpLedger).where(eq(xpLedger.userId, to))
        await tx.delete(userBadge).where(eq(userBadge.userId, to))
        await tx.update(userInterest).set({ userId: to }).where(eq(userInterest.userId, from))
        await tx.update(userProfile).set({ userId: to }).where(eq(userProfile.userId, from))
        await tx.update(streak).set({ userId: to }).where(eq(streak.userId, from))
        await tx.update(xpLedger).set({ userId: to }).where(eq(xpLedger.userId, from))
        await tx.update(userBadge).set({ userId: to }).where(eq(userBadge.userId, from))
        await tx.update(completionEvent).set({ userId: to }).where(eq(completionEvent.userId, from))
        await tx.delete(unitFeedback).where(eq(unitFeedback.userId, to))
        await tx.update(unitFeedback).set({ userId: to }).where(eq(unitFeedback.userId, from))
        // A purchase made while anonymous stays with the person
        const [target] = await tx.select().from(entitlement).where(eq(entitlement.userId, to))
        const [source] = await tx.select().from(entitlement).where(and(eq(entitlement.userId, from), gt(entitlement.activeUntil, target?.activeUntil ?? new Date(0))))
        if (source) {
          await tx.delete(entitlement).where(eq(entitlement.userId, to))
          await tx.update(entitlement).set({ userId: to }).where(eq(entitlement.userId, from))
        }
        return 'moved'
      })
    },
  }
}
