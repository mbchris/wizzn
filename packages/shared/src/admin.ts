import { z } from 'zod'
import { unitFormatSchema, type ImageCredit } from './content.js'
import { UNIT_STATUSES, type UnitStatus } from './unit-status.js'
import { EDITORIAL_STYLES, STORY_ARCS, type CheckReport, type SourceTier } from './pipeline.js'
import { levelSchema, seriesSchema, type Level } from './levels.js'
import type { DuplicateReason } from './duplicates.js'

export const briefInputSchema = z.object({
  fieldId: z.string().uuid(),
  themeId: z.string().uuid().nullable().default(null),
  topic: z.string().min(3).max(200),
  context: z.string().max(4000).default(''),
  // null → picked at random per unit
  style: z.enum(EDITORIAL_STYLES).nullable().default(null),
  storyArc: z.enum(STORY_ARCS).nullable().default(null),
  // Omitted → each variant becomes a written + audio pair
  format: unitFormatSchema.nullable().default(null),
  // Each unit is generated independently from the same brief
  count: z.number().int().min(1).max(10).default(1),
  /** Depth 1–5 within the series (spec: knowledge stream) */
  level: levelSchema.default(1),
  series: seriesSchema.nullable().default(null),
  /** Level 4 only: the field the unit bridges to */
  crossFieldId: z.string().uuid().nullable().default(null),
})
export type BriefInput = z.infer<typeof briefInputSchema>

export const bulkActionSchema = z.object({
  action: z.enum(['approve', 'regenerate', 'resume', 'delete', 'lock', 'unlock']),
  ids: z.array(z.string().uuid()).min(1).max(200),
})
export type BulkActionInput = z.infer<typeof bulkActionSchema>
export type BulkSkipReason = 'not_found' | 'invalid_state' | 'has_history'
export interface BulkResultDto {
  done: string[]
  skipped: { id: string; reason: BulkSkipReason }[]
}

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
  /** Depth within its series (1 for units without series) */
  level: Level
  series: string | null
  checkPassed: boolean | null
  failureReason: string | null
  updatedAt: string
  /** Working status older than STUCK_AFTER_MS: its job is gone, admins may resume/regenerate/edit it */
  stuck: boolean
}

/** Units of one format that share a series or a subject (duplicateGroups) */
export interface DuplicateGroupDto {
  reasons: DuplicateReason[]
  units: UnitSummaryDto[]
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
    /** AI prompt of the slot; editable before re-generating the image */
    prompt: string | null
    /** Model/engine that produced it (TTS voice, image model); null for stock or unknown */
    generator: string | null
  }[]
  checkReport: CheckReport | null
  /** The job behind the unit, so a failed one can be edited and sent again as a new brief */
  brief: Omit<BriefInput, 'format' | 'count'>
}

/** `prompt` (generated mode only) overrides the stored AI prompt and is saved on the asset */
export const replaceImageSchema = z.object({ mode: z.enum(['next-stock', 'generated']), prompt: z.string().trim().min(3).max(1000).optional() })
export type ReplaceImageMode = z.infer<typeof replaceImageSchema>['mode']

export const UNIT_LOG_LEVELS = ['info', 'warn', 'error'] as const
export type UnitLogLevel = (typeof UNIT_LOG_LEVELS)[number]
/** One line of the pipeline protocol shown live in the admin unit view */
export interface UnitLogDto {
  id: number
  at: string
  level: UnitLogLevel
  step: string | null
  message: string
}
export const unitLogQuerySchema = z.object({ after: z.coerce.number().int().min(0).optional() })
