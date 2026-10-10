import { z } from 'zod'
import type { FieldDto } from './api.js'
import { briefInputSchema, type BriefInput } from './admin.js'
import { EDITORIAL_STYLES, STORY_ARCS } from './pipeline.js'

/** Max briefs per batch request (each brief can still spawn up to 10 units). */
export const BATCH_MAX_JOBS = 100

/**
 * One job as written by an external LLM (e.g. Gemini): field/theme by slug or German name, not UUID.
 * Lenient on optional fields so a small slip doesn't reject the row.
 */
export const batchJobSchema = z.object({
  field: z.string().min(1),
  theme: z.string().nullish(),
  topic: z.string().trim().min(3).max(200),
  context: z.string().max(4000).default(''),
  format: z.enum(['written', 'audio', 'both']).default('both'),
  style: z.enum(EDITORIAL_STYLES).nullish(),
  storyArc: z.enum(STORY_ARCS).nullish(),
  count: z.number().int().min(1).max(10).default(1),
})
export type BatchJob = z.infer<typeof batchJobSchema>

export const batchFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(z.unknown()).min(1).max(BATCH_MAX_JOBS),
})

/** Request body of POST /api/admin/briefs/batch: already resolved briefs, validated all-or-nothing. */
export const briefBatchSchema = z.object({ briefs: z.array(briefInputSchema).min(1).max(BATCH_MAX_JOBS * 2) })
export type BriefBatch = z.infer<typeof briefBatchSchema>
export interface BriefBatchResultDto {
  briefs: { briefId: string; unitIds: string[] }[]
}

export interface BatchRow {
  index: number
  job: BatchJob | null
  briefs: BriefInput[]
  errors: string[]
}

const norm = (s: string): string => s.trim().toLowerCase()
const matches = (x: { slug: string; nameDe: string }, key: string): boolean => norm(x.slug) === norm(key) || norm(x.nameDe) === norm(key)

/** Parses a batch file (JSON text, optionally wrapped in a ```json fence) and resolves fields/themes. */
export function parseBatchFile(text: string, fields: FieldDto[]): { rows: BatchRow[]; fileError: string | null } {
  let raw: unknown
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))
  } catch (e) {
    return { rows: [], fileError: `Kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  // Accept a bare array of jobs too: LLMs often drop the wrapper
  if (Array.isArray(raw)) raw = { version: 1, jobs: raw }
  const file = batchFileSchema.safeParse(raw)
  if (!file.success) return { rows: [], fileError: file.error.issues.map((i) => `${i.path.join('.') || 'Datei'}: ${i.message}`).join('; ') }

  const rows = file.data.jobs.map((rawJob, index): BatchRow => {
    const parsed = batchJobSchema.safeParse(rawJob)
    if (!parsed.success) return { index, job: null, briefs: [], errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
    const job = parsed.data
    const errors: string[] = []
    const field = fields.find((f) => matches(f, job.field))
    if (!field) errors.push(`Unbekannter Bereich „${job.field}“`)
    const theme = job.theme && field ? field.themes.find((t) => matches(t, job.theme as string)) : undefined
    if (job.theme && field && !theme) errors.push(`Unbekanntes Thema „${job.theme}“ in ${field.nameDe}`)
    if (errors.length || !field) return { index, job, briefs: [], errors }
    const formats = job.format === 'both' ? (['written', 'audio'] as const) : ([job.format] as const)
    const briefs = formats.map((format) => ({
      fieldId: field.id,
      themeId: theme?.id ?? null,
      topic: job.topic,
      context: job.context,
      style: job.style ?? null,
      storyArc: job.storyArc ?? null,
      format,
      count: job.count,
    }))
    return { index, job, briefs, errors }
  })
  return { rows, fileError: null }
}
