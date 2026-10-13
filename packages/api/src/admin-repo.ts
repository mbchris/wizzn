import { and, asc, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm'
import { canDelete, canTransition, draftAudioSchema, draftWrittenSchema, duplicateGroups, seriesVariantPattern, unitContentSchema, type BriefInput, type CheckReport, type UnitDetailDto, type UnitStatus, type UnitLogDto, type UnitSummaryDto } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { completionEvent, contentBrief, feedImpression, field, source, unit, unitLog } from './db/schema/index.js'
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

type SummaryRow = Pick<UnitRow, 'id' | 'title' | 'format' | 'status' | 'level' | 'series' | 'failureReason' | 'updatedAt'> & {
  field: Pick<UnitRow['field'], 'slug'>
  brief: Pick<UnitRow['brief'], 'topic'>
  checkReport: Pick<NonNullable<UnitRow['checkReport']>, 'passed'> | null
}

function summary(row: SummaryRow, stuck: boolean): UnitSummaryDto {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    status: row.status,
    fieldSlug: row.field.slug,
    topic: row.brief.topic,
    level: row.level,
    series: row.series,
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

    async contextUnits(ids) {
      if (!ids.length) return []
      const rows = await db.query.unit.findMany({ where: inArray(unit.id, ids), with: { brief: { with: { theme: true } }, field: true } })
      const crossIds = rows.flatMap((r) => (r.brief.crossFieldId ? [r.brief.crossFieldId] : []))
      const crossFields = crossIds.length ? await db.select({ id: field.id, slug: field.slug }).from(field).where(inArray(field.id, crossIds)) : []
      const crossSlug = new Map(crossFields.map((f) => [f.id, f.slug]))
      const byId = new Map(rows.map((r) => [r.id, r]))
      // Selection order of the admin list is kept in the file
      return ids.flatMap((id) => {
        const r = byId.get(id)
        if (!r) return []
        return [
          {
            id: r.id,
            pairId: r.pairId,
            fieldSlug: r.field.slug,
            themeSlug: r.brief.theme?.slug ?? null,
            crossFieldSlug: (r.brief.crossFieldId && crossSlug.get(r.brief.crossFieldId)) || null,
            brief: {
              topic: r.brief.topic,
              context: r.brief.context,
              style: r.brief.style as BriefInput['style'],
              storyArc: r.brief.storyArc as BriefInput['storyArc'],
              format: r.brief.format,
              count: r.brief.count,
              level: r.brief.level,
              series: r.brief.series,
            },
            title: r.title,
            contentJson: r.contentJson,
          },
        ]
      })
    },

    async batchRefs(query) {
      const rows = query.ids.length ? await db.query.unit.findMany({ where: inArray(unit.id, query.ids), columns: { id: true, title: true, level: true, series: true }, with: { brief: { columns: { topic: true } } } }) : []
      // Numbered variants count as taken too, so the preview can pick the next free suffix
      const used = query.series.length
        ? await db.selectDistinct({ series: unit.series }).from(unit).where(or(inArray(unit.series, query.series), sql`${unit.series} ~ ${seriesVariantPattern(query.series)}`))
        : []
      return {
        units: rows.map((r) => ({ id: r.id, title: r.title ?? r.brief.topic, level: r.level, series: r.series })),
        usedSeries: used.flatMap((u) => (u.series ? [u.series] : [])),
      }
    },

    async assignSeries(assignments) {
      const outcome = await db.transaction(async (tx) => {
        const targets = await tx.select({ id: unit.id, briefId: unit.briefId, series: unit.series }).from(unit).where(inArray(unit.id, assignments.map((a) => a.unitId)))
        const seriesByBrief = new Map<string, string>()
        for (const a of assignments) {
          const target = targets.find((t) => t.id === a.unitId)
          if (!target) return { result: 'not_found' as const, relink: [] }
          const planned = seriesByBrief.get(target.briefId)
          if ((target.series && target.series !== a.series) || (planned && planned !== a.series)) return { result: 'conflict' as const, relink: [] }
          seriesByBrief.set(target.briefId, a.series)
        }
        // A series is one ladder: the key may not belong to units of any other brief, nor to two briefs of this request
        if (new Set(seriesByBrief.values()).size !== seriesByBrief.size) return { result: 'conflict' as const, relink: [] }
        const holders = await tx.select({ briefId: unit.briefId, series: unit.series }).from(unit).where(inArray(unit.series, [...seriesByBrief.values()]))
        if (holders.some((h) => seriesByBrief.get(h.briefId) !== h.series)) return { result: 'conflict' as const, relink: [] }
        const relink: string[] = []
        for (const [briefId, series] of seriesByBrief) {
          await tx.update(contentBrief).set({ series }).where(eq(contentBrief.id, briefId))
          // updatedAt stays untouched so the stuck detection of working units is not reset
          const updated = await tx.update(unit).set({ series }).where(eq(unit.briefId, briefId)).returning({ id: unit.id, status: unit.status })
          relink.push(...updated.filter((u) => u.status === 'published').map((u) => u.id))
        }
        return { result: 'ok' as const, relink }
      })
      if (onPublished) for (const id of outcome.relink) await onPublished(id).catch((e: unknown) => console.error(`[links] ${id}:`, e))
      return outcome.result
    },

    async duplicateUnits() {
      const rows = await db.query.unit.findMany({
        columns: { id: true, title: true, format: true, status: true, level: true, series: true, failureReason: true, updatedAt: true },
        with: { brief: { columns: { topic: true } }, field: { columns: { slug: true } }, checkReport: { columns: { passed: true } } },
        orderBy: [desc(unit.updatedAt)],
      })
      const groups = duplicateGroups(rows.map((r) => ({ id: r.id, format: r.format, fieldSlug: r.field.slug, series: r.series, text: `${r.title ?? ''} ${r.brief.topic}` })))
      const byId = new Map(rows.map((r) => [r.id, r]))
      const members = groups.map((g) => g.ids.flatMap((id) => byId.get(id) ?? []))
      const stuck = await stuckIds(db, members.flat())
      return groups.map((g, i) => ({ reasons: g.reasons, units: members[i]!.map((r) => summary(r, stuck.has(r.id))) }))
    },
  }
}

