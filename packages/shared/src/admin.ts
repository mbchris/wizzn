import { z } from 'zod'
import { unitFormatSchema, type ImageCredit } from './content.js'
import { UNIT_STATUSES, type UnitStatus } from './unit-status.js'
import { EDITORIAL_STYLES, STORY_ARCS, type CheckReport, type SourceTier } from './pipeline.js'

export const briefInputSchema = z.object({
  fieldId: z.string().uuid(),
  themeId: z.string().uuid().nullable().default(null),
  topic: z.string().min(3).max(200),
  context: z.string().max(4000).default(''),
  // null → picked at random per unit
  style: z.enum(EDITORIAL_STYLES).nullable().default(null),
  storyArc: z.enum(STORY_ARCS).nullable().default(null),
  format: unitFormatSchema,
  // Each unit is generated independently from the same brief
  count: z.number().int().min(1).max(10).default(1),
})
export type BriefInput = z.infer<typeof briefInputSchema>

export const unitListQuerySchema = z.object({
  status: z.enum(UNIT_STATUSES).optional(),
  fieldId: z.string().uuid().optional(),
})
export type UnitListQuery = z.infer<typeof unitListQuerySchema>

export const unitEditSchema = z.object({
  title: z.string().min(3).max(80),
  contentJson: z.unknown(),
})
export type UnitEdit = z.infer<typeof unitEditSchema>

export const rejectSchema = z.object({ reason: z.string().min(1).max(500) })

export interface UnitSummaryDto {
  id: string
  title: string | null
  format: 'audio' | 'written'
  status: UnitStatus
  fieldSlug: string
  topic: string
  checkPassed: boolean | null
  failureReason: string | null
  updatedAt: string
}

export interface UnitDetailDto extends UnitSummaryDto {
  contentJson: unknown
  promptVersion: string | null
  model: string | null
  sources: { url: string; title: string; publisher: string; tier: SourceTier; provider: string }[]
  assets: {
    id: string
    kind: 'image' | 'audio'
    url: string
    durationSec: number | null
    origin: 'generated' | 'stock'
    credit: ImageCredit | null
    stockQuery: string | null
  }[]
  checkReport: CheckReport | null
}

export const replaceImageSchema = z.object({ mode: z.enum(['next-stock', 'generated']) })
export type ReplaceImageMode = z.infer<typeof replaceImageSchema>['mode']
