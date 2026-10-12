import { and, asc, desc, eq, gt, type SQL } from 'drizzle-orm'
import { canDelete, canTransition, draftAudioSchema, draftWrittenSchema, unitContentSchema, type BriefInput, type CheckReport, type UnitDetailDto, type UnitStatus, type UnitLogDto, type UnitSummaryDto } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { completionEvent, contentBrief, feedImpression, source, unit, unitLog } from './db/schema/index.js'
import { claimResume, isUnitStuck, stillStuck, stuckIds } from './pipeline/recover.js'
import type { AdminActionResult, AdminRepo } from './types.js'

type UnitRow = NonNullable<Awaited<ReturnType<typeof loadUnit>>>

function loadUnit(db: Db, id: string) {
  return db.query.unit.findFirst({
    where: eq(unit.id, id),
    with: {
      brief: true,
      field: true,
      checkReport: true,
      sources: { orderBy: (s, { asc }) => [asc(s.position)] },
      assets: { orderBy: (a, { asc }) => [asc(a.position)] },
    },
  })
}

function summary(row: Pick<UnitRow, 'id' | 'title' | 'format' | 'status' | 'failureReason' | 'updatedAt' | 'field' | 'brief' | 'checkReport'>, stuck: boolean): UnitSummaryDto {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    status: row.status,
    fieldSlug: row.field.slug,
    topic: row.brief.topic,
    checkPassed: row.checkReport?.passed ?? null,
    failureReason: row.failureReason,
    updatedAt: row.updatedAt.toISOString(),
    stuck,
  }
}

/** Units whose text may be re-drafted from their existing sources (issue: partial regeneration) */
const REDRAFTABLE: readonly UnitStatus[] = ['in_review', 'published', 'locked', 'failed', 'rejected']

/** onPublished: knowledge-graph linking; failures are logged and never undo the publish */
export function createAdminRepo(db: Db, mediaUrl: (path: string) => string, onPublished?: (unitId: string) => Promise<void>): AdminRepo {
  async function move(id: string, to: UnitStatus, extra: Partial<typeof unit.$inferInsert> = {}): Promise<AdminActionResult> {
    const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { id: true, status: true, updatedAt: true } })
    if (!row) return 'not_found'
    // A stuck unit lost its job, so admins may take it out of the pipeline (regenerate or reject)
    const takeOver = !canTransition(row.status, to) && (to === 'queued' || to === 'rejected') && (await isUnitStuck(db, row))
    if (!canTransition(row.status, to) && !takeOver) return 'invalid_state'
    const updated = await db
      .update(unit)
      .set({ status: to, updatedAt: new Date(), ...extra })
      .where(takeOver ? stillStuck(id, row.status) : and(eq(unit.id, id), eq(unit.status, row.status)))
      .returning({ id: unit.id })
    return updated.length ? 'ok' : 'invalid_state'
  }

  return {
    async createBrief(input, createdBy) {
      return db.transaction(async (tx) => {
        const [brief] = await tx.insert(contentBrief).values({ ...input, createdBy }).returning({ id: contentBrief.id })
        if (!brief) throw new Error('Brief insert failed')
        const units = await tx
          .insert(unit)
          .values(
            Array.from({ length: input.count }, () => {
              const base = { briefId: brief.id, fieldId: input.fieldId, themeId: input.themeId, level: input.level, series: input.series }
              if (input.format) return [{ ...base, format: input.format }]
              const pairId = crypto.randomUUID()
              return [{ ...base, format: 'written' as const, pairId }, { ...base, format: 'audio' as const, pairId }]
            }).flat(),
          )
          .returning({ id: unit.id })
        return { briefId: brief.id, unitIds: units.map((u) => u.id) }
      })
    },

    async listUnits(query) {
      const where: SQL[] = []
      if (query.status) where.push(eq(unit.status, query.status))
      if (query.fieldId) where.push(eq(unit.fieldId, query.fieldId))
      const rows = await db.query.unit.findMany({
        where: where.length ? and(...where) : undefined,
        with: { brief: true, field: true, checkReport: true },
        orderBy: [desc(unit.updatedAt)],
        limit: 200,
      })
      const stuck = await stuckIds(db, rows)
      return rows.map((r) => summary(r, stuck.has(r.id)))
    },

    async getUnit(id): Promise<UnitDetailDto | null> {
      const row = await loadUnit(db, id)
      if (!row) return null
      return {
        ...summary(row, await isUnitStuck(db, row)),
        contentJson: row.contentJson,
        promptVersion: row.promptVersion,
        model: row.model,
        sources: row.sources.map(({ url, title, publisher, tier, provider }) => ({ url, title, publisher, tier, provider })),
        assets: row.assets.map((a) => ({ id: a.id, kind: a.kind, url: mediaUrl(a.path), durationSec: a.durationSec, origin: a.origin, credit: a.credit ?? null, stockQuery: a.stockQuery, prompt: a.prompt ?? null, generator: a.generator ?? null })),
        checkReport: (row.checkReport?.reportJson as CheckReport | undefined) ?? null,
        brief: {
          fieldId: row.brief.fieldId,
          themeId: row.brief.themeId,
          topic: row.brief.topic,
          context: row.brief.context,
          style: row.brief.style as BriefInput['style'],
          storyArc: row.brief.storyArc as BriefInput['storyArc'],
          level: row.brief.level,
          series: row.brief.series,
          crossFieldId: row.brief.crossFieldId,
        },
      }
    },

    async editUnit(id, edit) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { id: true, status: true, format: true, updatedAt: true } })
      if (!row) return 'not_found'
      if (row.status === 'drafting' && (await isUnitStuck(db, row))) {
        // The edited draft is what "Fortsetzen" checks and renders, so it must be complete
        const schema = row.format === 'written' ? draftWrittenSchema : draftAudioSchema
        if (!schema.safeParse(edit.contentJson).success) return 'invalid_content'
        // updatedAt stays untouched: the unit must remain stuck so it can be resumed afterwards
        const saved = await db.update(unit).set({ title: edit.title, contentJson: edit.contentJson }).where(stillStuck(id, 'drafting')).returning({ id: unit.id })
        return saved.length ? 'ok' : 'invalid_state'
      }
      // Locked units are edited while hidden from the feed
      if (row.status !== 'in_review' && row.status !== 'locked') return 'invalid_state'
      if (!unitContentSchema.safeParse(edit.contentJson).success) return 'invalid_content'
      const saved = await db
        .update(unit)
        .set({ title: edit.title, contentJson: edit.contentJson, updatedAt: new Date() })
        .where(and(eq(unit.id, id), eq(unit.status, row.status)))
        .returning({ id: unit.id })
      return saved.length ? 'ok' : 'invalid_state'
    },

    async approve(id) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { contentJson: true } })
      if (!row) return 'not_found'
      // Never publish content the app cannot render
      if (!unitContentSchema.safeParse(row.contentJson).success) return 'invalid_content'
      const result = await move(id, 'published', { publishedAt: new Date() })
      if (result === 'ok' && onPublished) await onPublished(id).catch((e: unknown) => console.error(`[links] ${id}:`, e))
      return result
    },

    reject: (id, reason) => move(id, 'rejected', { failureReason: reason }),

    // publishedAt stays: the unit keeps its place in "new" lists and user history
    lock: (id) => move(id, 'locked'),

    async unlock(id) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { contentJson: true, status: true } })
      if (!row) return 'not_found'
      if (row.status !== 'locked') return 'invalid_state'
      // Edits made while locked must still render in the app
      if (!unitContentSchema.safeParse(row.contentJson).success) return 'invalid_content'
      const result = await move(id, 'published')
      // Title/content may have changed while locked → refresh the knowledge-graph links
      if (result === 'ok' && onPublished) await onPublished(id).catch((e: unknown) => console.error(`[links] ${id}:`, e))
      return result
    },

    // Clearing publishedAt keeps a regenerated unit consistent until it is approved again
    requeue: (id) => move(id, 'queued', { failureReason: null, publishedAt: null }),

    async redraft(id) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { id: true, status: true, updatedAt: true } })
      if (!row) return 'not_found'
      const stuck = await isUnitStuck(db, row)
      if (!REDRAFTABLE.includes(row.status) && !stuck) return 'invalid_state'
      // Keeping the sources is the point; without them the draft step has nothing to write from
      if (!(await db.query.source.findFirst({ where: eq(source.unitId, id), columns: { id: true } }))) return 'invalid_state'
      // Parks the unit where the research step leaves it, so the draft job's compare-and-set picks it up
      const updated = await db
        .update(unit)
        .set({ status: 'researching', updatedAt: new Date(), failureReason: null, publishedAt: null })
        .where(stuck ? stillStuck(id, row.status) : and(eq(unit.id, id), eq(unit.status, row.status)))
        .returning({ id: unit.id })
      return updated.length ? 'ok' : 'invalid_state'
    },

    async deleteUnit(id) {
      return db.transaction(async (tx): Promise<AdminActionResult> => {
        const row = await tx.query.unit.findFirst({ where: eq(unit.id, id), columns: { id: true, status: true, updatedAt: true } })
        if (!row) return 'not_found'
        if (!canDelete(row.status, await isUnitStuck(db, row))) return 'invalid_state'
        // Completions feed XP/streaks and impressions the feed history: never drop units users have seen
        const [done] = await tx.select({ id: completionEvent.unitId }).from(completionEvent).where(eq(completionEvent.unitId, id)).limit(1)
        const [served] = await tx.select({ id: feedImpression.unitId }).from(feedImpression).where(eq(feedImpression.unitId, id)).limit(1)
        if (done || served) return 'has_history'
        // Status guard: a worker may have picked the unit up since the read
        const deleted = await tx.delete(unit).where(and(eq(unit.id, id), eq(unit.status, row.status))).returning({ id: unit.id })
        return deleted.length ? 'ok' : 'invalid_state'
      })
    },

    resume: (id) => claimResume(db, id),

    async listLogs(id, after): Promise<UnitLogDto[]> {
      // Newest 500 lines, returned oldest first
      const rows = await db
        .select()
        .from(unitLog)
        .where(after !== undefined ? and(eq(unitLog.unitId, id), gt(unitLog.id, after)) : eq(unitLog.unitId, id))
        .orderBy(desc(unitLog.id))
        .limit(500)
      return rows.reverse().map((r) => ({ id: r.id, at: r.at.toISOString(), level: r.level, step: r.step, message: r.message }))
    },

    async addLog(id, message) {
      await db.insert(unitLog).values({ unitId: id, level: 'info', step: null, message })
    },
  }
}

