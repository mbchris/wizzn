import type { CheckReport, ImageCredit, UnitFormat, UnitStatus } from '@wizzn/shared'
import type { BriefContext, ResearchedSource } from './prompts.js'

export interface PipelineUnit {
  id: string
  format: UnitFormat
  status: UnitStatus
  brief: BriefContext
  /** Draft JSON before media; final unit content after media */
  contentJson: unknown
}

export interface NewAsset {
  kind: 'image' | 'audio'
  path: string
  durationSec?: number
  origin?: 'generated' | 'stock'
  credit?: ImageCredit | null
  stockQuery?: string | null
  /** AI prompt of the slot (final contentJson no longer holds draft prompts) */
  prompt?: string | null
}

export interface AssetPatch {
  path: string
  origin: 'generated' | 'stock'
  credit: ImageCredit | null
  stockQuery: string | null
  rejectedStockIds?: string[]
  prompt?: string | null
  durationSec?: number
}

/** Persistence used by pipeline steps; Drizzle implementation in store-db.ts, in-memory fake in tests. */
export interface PipelineStore {
  getUnit(id: string): Promise<PipelineUnit | null>
  /** Compare-and-set; returns false if the unit was not in `from` (e.g. a duplicate job). */
  transition(id: string, from: UnitStatus, to: UnitStatus, failureReason?: string): Promise<boolean>
  replaceSources(unitId: string, sources: ResearchedSource[]): Promise<void>
  getSources(unitId: string): Promise<ResearchedSource[]>
  saveDraft(unitId: string, draft: { title: string; contentJson: unknown; promptVersion: string; model: string }): Promise<void>
  saveCheck(unitId: string, report: CheckReport): Promise<void>
  replaceAssets(unitId: string, assets: NewAsset[]): Promise<{ id: string; kind: NewAsset['kind'] }[]>
  getAsset(assetId: string): Promise<(NewAsset & { id: string; unitId: string; rejectedStockIds: string[] }) | null>
  listAssets(unitId: string): Promise<(NewAsset & { id: string; rejectedStockIds: string[] })[]>
  updateAsset(assetId: string, patch: AssetPatch): Promise<void>
  saveContent(unitId: string, contentJson: unknown): Promise<void>
}
