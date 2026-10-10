import { and, desc, eq, gt, inArray, notExists, sql } from 'drizzle-orm'
import { IMPRESSION_COOLDOWN_DAYS, unitContentSchema, type FeedCandidate, type ImageCredit, type FeedUnitDto, type UnitContent, type UnitFormat } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { asset, completionEvent, feedImpression, field, unit, userInterest, userProfile } from './db/schema/index.js'

export interface FeedPrefs {
  fieldIds: string[]
  themeIds: string[]
  formats: UnitFormat[]
  timezone: string
}

export interface FeedRepo {
  getPrefs(userId: string): Promise<FeedPrefs>
  /** Published, matching formats, not completed, not served within the cooldown; newest first */
  getCandidates(userId: string, formats: UnitFormat[], themeIds: string[]): Promise<FeedCandidate[]>
  loadUnits(ids: string[]): Promise<Map<string, Omit<FeedUnitDto, 'discovery'>>>
  recordImpressions(userId: string, unitIds: string[]): Promise<void>
  getPublishedContent(unitId: string): Promise<UnitContent | null>
}

/** Attribution per asset id; only stock assets carry a credit. */
export function creditsFor(assets: { id: string; credit: ImageCredit | null }[]): Record<string, ImageCredit> {
  return Object.fromEntries(assets.flatMap((a) => (a.credit ? [[a.id, a.credit]] : [])))
}

export function createFeedRepo(db: Db, mediaUrl: (path: string) => string): FeedRepo {
  return {
    async getPrefs(userId) {
      const profile = await db.query.userProfile.findFirst({ where: eq(userProfile.userId, userId) })
      const interests = await db.select().from(userInterest).where(eq(userInterest.userId, userId))
      return {
        fieldIds: [...new Set(interests.map((i) => i.fieldId))],
        themeIds: interests.flatMap((i) => (i.themeId ? [i.themeId] : [])),
        formats: profile?.formats ?? ['audio', 'written'],
        timezone: profile?.timezone ?? 'Europe/Berlin',
      }
    },

    async getCandidates(userId, formats, themeIds) {
      const cutoff = new Date(Date.now() - IMPRESSION_COOLDOWN_DAYS * 86_400_000)
      const rows = await db
        .select({ id: unit.id, fieldId: unit.fieldId, themeId: unit.themeId })
        .from(unit)
        .where(
          and(
            eq(unit.status, 'published'),
            inArray(unit.format, formats),
            notExists(db.select({ one: sql`1` }).from(completionEvent).where(and(eq(completionEvent.unitId, unit.id), eq(completionEvent.userId, userId)))),
            notExists(
              db
                .select({ one: sql`1` })
                .from(feedImpression)
                .where(and(eq(feedImpression.unitId, unit.id), eq(feedImpression.userId, userId), gt(feedImpression.servedAt, cutoff))),
            ),
          ),
        )
        .orderBy(desc(unit.publishedAt))
        .limit(500)
      // Chosen themes first within each field; other themes of the field follow
      const preferred = new Set(themeIds)
      return [...rows]
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
