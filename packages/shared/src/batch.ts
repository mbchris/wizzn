import { z } from 'zod'
import type { FieldDto } from './api.js'
import { briefInputSchema, type BriefInput } from './admin.js'
import { EDITORIAL_STYLES, STORY_ARCS } from './pipeline.js'
import { levelSchema, seriesBase, seriesSchema, uniqueSeries, type Level } from './levels.js'

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
  // LLMs repeat the story arc here: an unknown style means "pick one", like null
  style: z.enum(EDITORIAL_STYLES).nullish().catch(null),
  storyArc: z.enum(STORY_ARCS).nullish(),
  count: z.number().int().min(1).max(10).default(1),
  level: levelSchema.default(1),
  series: seriesSchema.nullish(),
  /** Slug or German name of the field a level-4 unit bridges to */
  crossField: z.string().nullish(),
  /** Unit ID (`ref` of a context export) this job continues at a deeper level of the same series */
  after: z.string().uuid().nullish(),
  /** Present on entries of a context export: the unit exists already, so the row is never imported */
  published: z.unknown().optional(),
})
export type BatchJob = z.infer<typeof batchJobSchema>

export const batchFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(z.unknown()).min(1).max(BATCH_MAX_JOBS),
})

/** Request body of POST /api/admin/briefs/batch: already resolved briefs, validated all-or-nothing. */
export const seriesAssignmentSchema = z.object({ unitId: z.string().uuid(), series: seriesSchema })
export const briefBatchSchema = z.object({
  briefs: z.array(briefInputSchema).min(1).max(BATCH_MAX_JOBS * 2),
  /** Existing units that join the series of the new briefs; applied before any brief is created */
  seriesAssignments: z.array(seriesAssignmentSchema).max(BATCH_MAX_JOBS).default([]),
})
export type BriefBatch = z.infer<typeof briefBatchSchema>
export interface BriefBatchResultDto {
  briefs: { briefId: string; unitIds: string[] }[]
}

/** A unit referenced by `after`, as far as the preview needs it */
export interface BatchRefUnit {
  id: string
  title: string
  level: Level
  series: string | null
}
export const batchRefQuerySchema = z.object({ ids: z.array(z.string().uuid()).max(BATCH_MAX_JOBS), series: z.array(seriesSchema).max(BATCH_MAX_JOBS * 2) })
export type BatchRefQuery = z.infer<typeof batchRefQuerySchema>
/** Response of POST /api/admin/briefs/batch/refs */
export interface BatchRefs {
  units: BatchRefUnit[]
  /** Requested series keys and their `<key>-<n>` variants that some unit already carries */
  usedSeries: string[]
}

/** Series an existing unit receives on import because a deeper job continues it */
export interface SeriesAssignment {
  unitId: string
  series: string
  title: string
}

export interface BatchRow {
  index: number
  job: BatchJob | null
  briefs: BriefInput[]
  errors: string[]
  /** Entry of a context export: shown, never imported */
  skipped: boolean
  /** Resolved `after` reference */
  after: BatchRefUnit | null
}

/** A proposed series key that units already carry, and the free key the import uses instead */
export interface SeriesRename {
  from: string
  to: string
}

/** What the preview has to load before jobs with `after` or a series can be checked */
export function batchRefQuery(rows: BatchRow[]): BatchRefQuery {
  const jobs = rows.flatMap((r) => (r.job && !r.skipped ? [r.job] : []))
  return {
    ids: [...new Set(jobs.flatMap((j) => (j.after ? [j.after] : [])))],
    series: [...new Set(jobs.flatMap((j) => (j.series ? [j.series, seriesBase(j.series)] : [])))],
  }
}

/** Keys of the series a file creates: every proposed key maps to one that no existing unit and no other key of the file uses */
function newSeriesKeys(usedSeries: string[]): { resolve: (key: string) => string; renames: SeriesRename[] } {
  const taken = new Set(usedSeries)
  const resolved = new Map<string, string>()
  const renames: SeriesRename[] = []
  const resolve = (key: string): string => {
    const known = resolved.get(key)
    if (known) return known
    const to = uniqueSeries(key, taken)
    taken.add(to)
    resolved.set(key, to)
    if (to !== key) renames.push({ from: key, to })
    return to
  }
  return { resolve, renames }
}

const norm = (s: string): string => s.trim().toLowerCase()
const matches = (x: { slug: string; nameDe: string }, key: string): boolean => norm(x.slug) === norm(key) || norm(x.nameDe) === norm(key)

/**
 * Resolves the series of a job that continues an existing unit. A unit without series starts a new one under
 * the job's key, recorded in `assignments`; every other mismatch is a row error.
 */
function resolveAfter(job: BatchJob, refs: BatchRefs | null, assignments: SeriesAssignment[], newKey: (key: string) => string): { ref: BatchRefUnit | null; series: string | null; errors: string[] } {
  const fail = (message: string, ref: BatchRefUnit | null = null) => ({ ref, series: null, errors: [message] })
  if (!refs) return fail('Bezug („after“) wird geprüft …')
  const ref = refs.units.find((u) => u.id === job.after)
  if (!ref) return fail(`Unbekannter Bezug „${job.after}“`)
  if (job.level <= ref.level) return fail(`Stufe ${job.level} muss über Stufe ${ref.level} von „${ref.title}“ liegen`, ref)
  if (ref.series) {
    if (job.series && job.series !== ref.series) return fail(`„${ref.title}“ gehört zur Serie „${ref.series}“, nicht „${job.series}“`, ref)
    return { ref, series: ref.series, errors: [] }
  }
  if (!job.series) return fail(`"series" fehlt: „${ref.title}“ hat noch keine Serie`, ref)
  const series = newKey(job.series)
  const mine = assignments.find((a) => a.unitId === ref.id)
  if (mine) return mine.series === series ? { ref, series, errors: [] } : fail(`„${ref.title}“ erhält in dieser Datei bereits die Serie „${mine.series}“`, ref)
  const other = assignments.find((a) => a.series === series)
  if (other) return fail(`Serie „${series}“ wird in dieser Datei bereits „${other.title}“ zugewiesen`, ref)
  assignments.push({ unitId: ref.id, series, title: ref.title })
  return { ref, series, errors: [] }
}

/**
 * Parses a batch file (JSON text, optionally wrapped in a ```json fence) and resolves fields/themes.
 * `refs` are the units behind `after` and the taken series keys (see batchRefQuery); without them such jobs stay blocked.
 * A job with a series key and no `after` starts a new series; taken keys are replaced, see `renames`.
 */
export function parseBatchFile(
  text: string,
  fields: FieldDto[],
  refs: BatchRefs | null = null,
): { rows: BatchRow[]; fileError: string | null; assignments: SeriesAssignment[]; renames: SeriesRename[] } {
  const assignments: SeriesAssignment[] = []
  const { resolve: newKey, renames } = newSeriesKeys(refs?.usedSeries ?? [])
  let raw: unknown
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))
  } catch (e) {
    return { rows: [], fileError: `Kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`, assignments, renames }
  }
  // Accept a bare array of jobs too: LLMs often drop the wrapper
  if (Array.isArray(raw)) raw = { version: 1, jobs: raw }
  const file = batchFileSchema.safeParse(raw)
  if (!file.success) return { rows: [], fileError: file.error.issues.map((i) => `${i.path.join('.') || 'Datei'}: ${i.message}`).join('; '), assignments, renames }

  const rows = file.data.jobs.map((rawJob, index): BatchRow => {
    const parsed = batchJobSchema.safeParse(rawJob)
    if (!parsed.success) return { index, job: null, briefs: [], errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), skipped: false, after: null }
    const job = parsed.data
    if (job.published !== undefined) return { index, job, briefs: [], errors: [], skipped: true, after: null }
    const errors: string[] = []
    const field = fields.find((f) => matches(f, job.field))
    if (!field) errors.push(`Unbekannter Bereich „${job.field}“`)
    const theme = job.theme && field ? field.themes.find((t) => matches(t, job.theme as string)) : undefined
    if (job.theme && field && !theme) errors.push(`Unbekanntes Thema „${job.theme}“ in ${field.nameDe}`)
    const crossField = job.crossField ? fields.find((f) => matches(f, job.crossField as string)) : undefined
    if (job.crossField && !crossField) errors.push(`Unbekannter Querbereich „${job.crossField}“`)
    const linked = job.after ? resolveAfter(job, refs, assignments, newKey) : null
    if (linked) errors.push(...linked.errors)
    if (!linked && job.series && !refs) errors.push('Serie wird geprüft …')
    const after = linked?.ref ?? null
    if (errors.length || !field) return { index, job, briefs: [], errors, skipped: false, after }
    // "both" is ONE brief with format null: the API then creates linked written/audio pairs (pairId),
    // so the feed shows only one variant per topic and completing either counts for both
    const briefs = [
      {
        fieldId: field.id,
        themeId: theme?.id ?? null,
        topic: job.topic,
        context: job.context,
        style: job.style ?? null,
        storyArc: job.storyArc ?? null,
        format: job.format === 'both' ? null : job.format,
        count: job.count,
        level: job.level,
        series: linked ? linked.series : job.series ? newKey(job.series) : null,
        crossFieldId: crossField?.id ?? null,
      },
    ]
    return { index, job, briefs, errors, skipped: false, after }
  })
  return { rows, fileError: null, assignments, renames }
}
