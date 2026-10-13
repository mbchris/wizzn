import { aliasedTable, and, desc, eq, gt, inArray, notExists, or, sql } from 'drizzle-orm'
import { IMPRESSION_COOLDOWN_DAYS, unitContentSchema, type FeedbackSignal, type FeedCandidate, type ImageCredit, type FeedUnitDto, type UnitContent, type UnitFormat } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { asset, completionEvent, feedImpression, field, savedUnit, unit, unitFeedback, userInterest, userProfile } from './db/schema/index.js'

export interface FeedPrefs {
  fieldIds: string[]
  themeIds: string[]
  /** Opted-in formats; with both, one variant per pair is picked at random */
  formats: UnitFormat[]
  timezone: string
}

export interface FeedRepo {
  getPrefs(userId: string): Promise<FeedPrefs>
  /**
   * Published, not completed (incl. the paired slides/audio sibling), not served within the cooldown; newest first.
   * Only the user's opted-in formats; of each written/audio pair only one variant is returned (random if both are opted in).
   */
  getCandidates(userId: string, themeIds: string[], formats: UnitFormat[]): Promise<FeedCandidate[]>
  /** With a userId, `saved` reflects that user's bookmarks */
  loadUnits(ids: string[], userId?: string): Promise<Map<string, Omit<FeedUnitDto, 'discovery'>>>
  /** Latest "mehr/weniger davon" votes (newest first, max 200) for ranking */
  getSignals(userId: string): Promise<FeedbackSignal[]>
  recordImpressions(userId: string, unitIds: string[]): Promise<void>
  getPublishedContent(unitId: string): Promise<UnitContent | null>
}

/** Attribution per asset id; only stock assets carry a credit. */
export function creditsFor(assets: { id: string; credit: ImageCredit | null }[]): Record<string, ImageCredit> {
  return Object.fromEntries(assets.flatMap((a) => (a.credit ? [[a.id, a.credit]] : [])))
}

/** Keeps one random variant (slides or audio) per pair, at the position of the first one; unpaired units pass through. */
export function pickOnePerPair<T extends { id: string; pairId: string | null }>(rows: T[], random: () => number): T[] {
  const byPair = new Map<string, T[]>()
  for (const r of rows) if (r.pairId) byPair.set(r.pairId, [...(byPair.get(r.pairId) ?? []), r])
  const chosen = new Map([...byPair].map(([pairId, vs]) => [pairId, vs[Math.floor(random() * vs.length)]!.id]))
  const out: T[] = []
  const placed = new Set<string>()
  for (const r of rows) {
    const pairId = r.pairId
    if (!pairId) out.push(r)
    else if (!placed.has(pairId)) {
      placed.add(pairId)
      out.push(byPair.get(pairId)!.find((v) => v.id === chosen.get(pairId))!)
    }
  }
  return out
}

/** Unit id → id of its published slides/audio sibling; units without one have no entry. */
export function counterpartIds<T extends { id: string; pairId: string | null }>(units: T[], published: T[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const u of units) {
    const other = u.pairId ? published.find((p) => p.pairId === u.pairId && p.id !== u.id) : undefined
    if (other) out.set(u.id, other.id)
  }
  return out
}

export function createFeedRepo(db: Db, mediaUrl: (path: string) => string): FeedRepo {
  return {
    async getPrefs(userId) {
      const profile = await db.query.userProfile.findFirst({ where: eq(userProfile.userId, userId) })
      const interests = await db.select().from(userInterest).where(eq(userInterest.userId, userId))
      return {
        fieldIds: [...new Set(interests.map((i) => i.fieldId))],
        themeIds: interests.flatMap((i) => (i.themeId ? [i.themeId] : [])),
        formats: profile?.formats?.length ? profile.formats : ['audio', 'written'],
        timezone: profile?.timezone ?? 'Europe/Berlin',
      }
    },

    async getCandidates(userId, themeIds, formats) {
      const cutoff = new Date(Date.now() - IMPRESSION_COOLDOWN_DAYS * 86_400_000)
      // The unit itself or its slides/audio sibling: consuming or seeing one counts for both
      const sibling = aliasedTable(unit, 'sibling')
      const sameTopic = or(eq(sibling.id, unit.id), and(sql`${unit.pairId} is not null`, eq(sibling.pairId, unit.pairId)))
      const rows = await db
        .select({ id: unit.id, pairId: unit.pairId, fieldId: unit.fieldId, themeId: unit.themeId, series: unit.series, level: unit.level })
        .from(unit)
        .where(
          and(
            eq(unit.status, 'published'),
            inArray(unit.format, formats),
            notExists(
              db
                .select({ one: sql`1` })
                .from(completionEvent)
                .innerJoin(sibling, eq(sibling.id, completionEvent.unitId))
                .where(and(eq(completionEvent.userId, userId), sameTopic)),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(feedImpression)
                .innerJoin(sibling, eq(sibling.id, feedImpression.unitId))
                .where(and(eq(feedImpression.userId, userId), gt(feedImpression.servedAt, cutoff), sameTopic)),
            ),
          ),
        )
        .orderBy(desc(unit.publishedAt))
        .limit(500)
      // Ranking (chosen themes, affinity, level gating) happens in rankCandidates
      void themeIds
      return pickOnePerPair(rows, Math.random).map(({ id, fieldId, themeId, series, level }) => ({ id, fieldId, themeId, series, level }))
    },

    async loadUnits(ids, userId) {
      const out = new Map<string, Omit<FeedUnitDto, 'discovery'>>()
      if (!ids.length) return out
      const saved = new Set(
        userId ? (await db.select({ id: savedUnit.unitId }).from(savedUnit).where(and(eq(savedUnit.userId, userId), inArray(savedUnit.unitId, ids)))).map((r) => r.id) : [],
      )
      const rows = await db
        .select({ id: unit.id, pairId: unit.pairId, title: unit.title, format: unit.format, content: unit.contentJson, level: unit.level, series: unit.series, field })
        .from(unit)
        .innerJoin(field, eq(field.id, unit.fieldId))
        .where(inArray(unit.id, ids))
      const assets = await db.select().from(asset).where(inArray(asset.unitId, ids))
      const pairIds = rows.flatMap((r) => (r.pairId ? [r.pairId] : []))
      const pairs = pairIds.length
        ? await db.select({ id: unit.id, pairId: unit.pairId }).from(unit).where(and(eq(unit.status, 'published'), inArray(unit.pairId, pairIds)))
        : []
      const counterparts = counterpartIds(rows, pairs)
      for (const r of rows) {
        const content = unitContentSchema.safeParse(r.content)
        if (!content.success) continue
        const own = assets.filter((a) => a.unitId === r.id)
        const media = Object.fromEntries(own.map((a) => [a.id, mediaUrl(a.path)]))
        out.set(r.id, {
          id: r.id,
          title: r.title ?? '',
          format: r.format,
          field: { id: r.field.id, slug: r.field.slug, nameDe: r.field.nameDe, adviceDisclaimer: r.field.adviceDisclaimer },
          content: content.data,
          media,
          credits: creditsFor(own),
          level: r.level,
          series: r.series,
          saved: saved.has(r.id),
          counterpartId: counterparts.get(r.id) ?? null,
        })
      }
      return out
    },

    async getSignals(userId) {
      const rows = await db
        .select({ vote: unitFeedback.vote, at: unitFeedback.createdAt, fieldId: unit.fieldId, themeId: unit.themeId, series: unit.series, level: unit.level })
        .from(unitFeedback)
        .innerJoin(unit, eq(unit.id, unitFeedback.unitId))
        .where(eq(unitFeedback.userId, userId))
        .orderBy(desc(unitFeedback.createdAt))
        .limit(200)
      return rows
    },

    async recordImpressions(userId, unitIds) {
      if (unitIds.length) await db.insert(feedImpression).values(unitIds.map((unitId) => ({ userId, unitId })))
    },

    async getPublishedContent(unitId) {
      const row = await db.query.unit.findFirst({ where: and(eq(unit.id, unitId), eq(unit.status, 'published')), columns: { contentJson: true } })
      const parsed = unitContentSchema.safeParse(row?.contentJson)
      return parsed.success ? parsed.data : null
    },
  }
}
