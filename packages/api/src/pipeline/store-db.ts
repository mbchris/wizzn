import { and, eq } from 'drizzle-orm'
import type { CheckReport, UnitStatus } from '@wizzn/shared'
import type { Db } from '../db/client.js'
import { asset, checkReport, source, unit } from '../db/schema/index.js'
import type { ResearchedSource } from './prompts.js'
import type { NewAsset, PipelineStore, PipelineUnit } from './store.js'

function toStoredAsset(row: typeof asset.$inferSelect) {
  return {
    id: row.id,
    unitId: row.unitId,
    kind: row.kind,
    path: row.path,
    ...(row.durationSec !== null ? { durationSec: row.durationSec } : {}),
    origin: row.origin,
    credit: row.credit,
    stockQuery: row.stockQuery,
    prompt: row.prompt,
    rejectedStockIds: row.rejectedStockIds,
  }
}

export function createDbPipelineStore(db: Db): PipelineStore {
  return {
    async getUnit(id): Promise<PipelineUnit | null> {
      const row = await db.query.unit.findFirst({
        where: eq(unit.id, id),
        with: { brief: { with: { field: true, theme: true } } },
      })
      if (!row) return null
      return {
        id: row.id,
        format: row.format,
        status: row.status,
        contentJson: row.contentJson,
        brief: {
          fieldName: row.brief.field.nameDe,
          themeName: row.brief.theme?.nameDe ?? null,
          topic: row.brief.topic,
          context: row.brief.context,
          adviceDisclaimer: row.brief.field.adviceDisclaimer,
        },
      }
    },

    async transition(id, from: UnitStatus, to: UnitStatus, failureReason) {
      const rows = await db
        .update(unit)
        .set({ status: to, updatedAt: new Date(), failureReason: to === 'failed' ? (failureReason ?? 'unknown') : null })
        .where(and(eq(unit.id, id), eq(unit.status, from)))
        .returning({ id: unit.id })
      return rows.length === 1
    },

    async replaceSources(unitId, sources: ResearchedSource[]) {
      await db.transaction(async (tx) => {
        await tx.delete(source).where(eq(source.unitId, unitId))
        if (sources.length) await tx.insert(source).values(sources.map((s, position) => ({ unitId, position, ...s, lastCheckedAt: new Date() })))
      })
    },

    async getSources(unitId) {
      const rows = await db.select().from(source).where(eq(source.unitId, unitId)).orderBy(source.position)
      return rows.map(({ url, title, publisher, excerpt }) => ({ url, title, publisher, excerpt }))
    },

    async saveDraft(unitId, d) {
      await db.update(unit).set({ title: d.title, contentJson: d.contentJson, promptVersion: d.promptVersion, model: d.model, updatedAt: new Date() }).where(eq(unit.id, unitId))
    },

    async saveCheck(unitId, report: CheckReport) {
      await db
        .insert(checkReport)
        .values({ unitId, reportJson: report, passed: report.passed })
        .onConflictDoUpdate({ target: checkReport.unitId, set: { reportJson: report, passed: report.passed, createdAt: new Date() } })
    },

    async replaceAssets(unitId, assets: NewAsset[]) {
      return db.transaction(async (tx) => {
        await tx.delete(asset).where(eq(asset.unitId, unitId))
        if (!assets.length) return []
        const rows = await tx
          .insert(asset)
          .values(
            assets.map((a, position) => ({
              unitId,
              position,
              kind: a.kind,
              path: a.path,
              durationSec: a.durationSec ?? null,
              origin: a.origin ?? 'generated',
              credit: a.credit ?? null,
              stockQuery: a.stockQuery ?? null,
              prompt: a.prompt ?? null,
            })),
          )
          .returning({ id: asset.id, kind: asset.kind, position: asset.position })
        // Callers map ids back by input order
        return rows.sort((a, b) => a.position - b.position).map(({ id, kind }) => ({ id, kind }))
      })
    },

    async getAsset(assetId) {
      const [row] = await db.select().from(asset).where(eq(asset.id, assetId))
      return row ? toStoredAsset(row) : null
    },

    async listAssets(unitId) {
      const rows = await db.select().from(asset).where(eq(asset.unitId, unitId)).orderBy(asset.position)
      return rows.map(toStoredAsset)
    },

    async updateAsset(assetId, patch) {
      await db
        .update(asset)
        .set({
          path: patch.path,
          origin: patch.origin,
          credit: patch.credit,
          stockQuery: patch.stockQuery,
          ...(patch.rejectedStockIds ? { rejectedStockIds: patch.rejectedStockIds } : {}),
        })
        .where(eq(asset.id, assetId))
    },

    async saveContent(unitId, contentJson) {
      await db.update(unit).set({ contentJson, updatedAt: new Date() }).where(eq(unit.id, unitId))
    },
  }
}
