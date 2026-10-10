import { aliasedTable, and, desc, eq, gt, inArray, notExists, or, sql } from 'drizzle-orm'
import { IMPRESSION_COOLDOWN_DAYS, unitContentSchema, type FeedCandidate, type ImageCredit, type FeedUnitDto, type UnitContent, type UnitFormat } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { asset, completionEvent, feedImpression, field, unit, userInterest, userProfile } from './db/schema/index.js'

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
  loadUnits(ids: string[]): Promise<Map<string, Omit<FeedUnitDto, 'discovery'>>>
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
        .select({ id: unit.id, pairId: unit.pairId, fieldId: unit.fieldId, themeId: unit.themeId })
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
      // Chosen themes first within each field; other themes of the field follow
      const preferred = new Set(themeIds)
      return pickOnePerPair(rows, Math.random)
        .sort((a, b) => Number(preferred.has(b.themeId ?? '')) - Number(preferred.has(a.themeId ?? '')))
        .map(({ id, fieldId }) => ({ id, fieldId }))
    },

    async loadUnits(ids) {
      const out = new Map<string, Omit<FeedUnitDto, 'discovery'>>()
      if (!ids.length) return out
      const rows = await db
        .select({ id: unit.id, title: unit.title, format: unit.format, content: unit.contentJson, field })
        .from(unit)
        .innerJoin(field, eq(field.id, unit.fieldId))
        .where(inArray(unit.id, ids))
      const assets = await db.select().from(asset).where(inArray(asset.unitId, ids))
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
        })
      }
      return out
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
