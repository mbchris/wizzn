import { canTransition, type CheckReport, type UnitFormat, type UnitStatus } from '@wizzn/shared'
import type { ResearchedSource } from '../../src/pipeline/prompts.js'
import type { AssetPatch, NewAsset, PipelineStore, PipelineUnit } from '../../src/pipeline/store.js'

export class FakeStore implements PipelineStore {
  units = new Map<string, PipelineUnit & { failureReason?: string; title?: string }>()
  sources = new Map<string, ResearchedSource[]>()
  assets = new Map<string, (NewAsset & { id: string; rejectedStockIds: string[] })[]>()
  checks = new Map<string, CheckReport>()

  add(id: string, format: UnitFormat, status: UnitStatus = 'queued'): void {
    this.units.set(id, {
      id,
      format,
      status,
      contentJson: null,
      brief: { fieldName: 'Finanzen', themeName: 'Budget', topic: 'Die 50/30/20-Regel', context: '', adviceDisclaimer: true },
    })
  }
  async getUnit(id: string) {
    return this.units.get(id) ?? null
  }
  async transition(id: string, from: UnitStatus, to: UnitStatus, reason?: string) {
    const u = this.units.get(id)
    if (!u || u.status !== from || !canTransition(from, to)) return false
    u.status = to
    if (reason) u.failureReason = reason
    return true
  }
  async replaceSources(id: string, s: ResearchedSource[]) {
    this.sources.set(id, s)
  }
  async getSources(id: string) {
    return this.sources.get(id) ?? []
  }
  async saveDraft(id: string, d: { title: string; contentJson: unknown }) {
    const u = this.units.get(id)!
    u.contentJson = d.contentJson
    u.title = d.title
  }
  async saveCheck(id: string, r: CheckReport) {
    this.checks.set(id, r)
  }
  async replaceAssets(id: string, a: NewAsset[]) {
    const withIds = a.map((x, i) => ({ ...x, id: `${id}-asset-${i}`, rejectedStockIds: [] as string[] }))
    this.assets.set(id, withIds)
    return withIds.map(({ id: aid, kind }) => ({ id: aid, kind }))
  }
  async getAsset(assetId: string) {
    for (const [unitId, list] of this.assets) {
      const found = list.find((a) => a.id === assetId)
      if (found) return { ...found, unitId }
    }
    return null
  }
  async listAssets(unitId: string) {
    return this.assets.get(unitId) ?? []
  }
  async updateAsset(assetId: string, patch: AssetPatch) {
    for (const list of this.assets.values()) {
      const i = list.findIndex((a) => a.id === assetId)
      if (i >= 0) list[i] = { ...list[i]!, ...patch, rejectedStockIds: patch.rejectedStockIds ?? list[i]!.rejectedStockIds }
    }
  }
  async saveContent(id: string, c: unknown) {
    this.units.get(id)!.contentJson = c
  }
}
