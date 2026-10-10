import { and, desc, eq, type SQL } from 'drizzle-orm'
import { canTransition, unitContentSchema, type CheckReport, type UnitDetailDto, type UnitStatus, type UnitSummaryDto } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { contentBrief, unit } from './db/schema/index.js'
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

function summary(row: Pick<UnitRow, 'id' | 'title' | 'format' | 'status' | 'failureReason' | 'updatedAt' | 'field' | 'brief' | 'checkReport'>): UnitSummaryDto {
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
  }
}

export function createAdminRepo(db: Db, mediaUrl: (path: string) => string): AdminRepo {
  async function move(id: string, to: UnitStatus, extra: Partial<typeof unit.$inferInsert> = {}): Promise<AdminActionResult> {
    const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { status: true } })
    if (!row) return 'not_found'
    if (!canTransition(row.status, to)) return 'invalid_state'
    const updated = await db
      .update(unit)
      .set({ status: to, updatedAt: new Date(), ...extra })
      .where(and(eq(unit.id, id), eq(unit.status, row.status)))
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
          .values(Array.from({ length: input.count }, () => ({ briefId: brief.id, fieldId: input.fieldId, themeId: input.themeId, format: input.format })))
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
      return rows.map(summary)
    },

    async getUnit(id): Promise<UnitDetailDto | null> {
      const row = await loadUnit(db, id)
      if (!row) return null
      return {
        ...summary(row),
        contentJson: row.contentJson,
        promptVersion: row.promptVersion,
        model: row.model,
        sources: row.sources.map(({ url, title, publisher }) => ({ url, title, publisher })),
        assets: row.assets.map((a) => ({ id: a.id, kind: a.kind, url: mediaUrl(a.path), durationSec: a.durationSec, origin: a.origin, credit: a.credit ?? null, stockQuery: a.stockQuery })),
        checkReport: (row.checkReport?.reportJson as CheckReport | undefined) ?? null,
      }
    },

    async editUnit(id, edit) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { status: true } })
      if (!row) return 'not_found'
      if (row.status !== 'in_review') return 'invalid_state'
      if (!unitContentSchema.safeParse(edit.contentJson).success) return 'invalid_content'
      await db.update(unit).set({ title: edit.title, contentJson: edit.contentJson, updatedAt: new Date() }).where(eq(unit.id, id))
      return 'ok'
    },

    async approve(id) {
      const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { contentJson: true } })
      if (!row) return 'not_found'
      // Never publish content the app cannot render
      if (!unitContentSchema.safeParse(row.contentJson).success) return 'invalid_content'
      return move(id, 'published', { publishedAt: new Date() })
    },

    reject: (id, reason) => move(id, 'rejected', { failureReason: reason }),

    requeue: (id) => move(id, 'queued', { failureReason: null }),
  }
}

