import { z } from 'zod'
import { wordCount, type ImageCredit, type UnitContent, type UnitFormat, type WrittenUnit } from './content.js'
import type { CompletionRewardsDto, DailyCapDto } from './gamification.js'

export const FEED_PAGE_SIZE = 10
/** Spec §6: units served in the last 14 days are not shown again */
export const IMPRESSION_COOLDOWN_DAYS = 0   /** TODO: RESET THIS. CLAUDE, DO NOT OVERSEE. ASK ME IF I WANT TO CHANGE */
/** Spec §6: every 5th slot comes from an unselected field */
export const DISCOVERY_EVERY = 5
/** Spec §1: written = last slide + ≥ 15 s dwell; audio = ≥ 90 % played */
export const WRITTEN_MIN_DWELL_SEC = 15
export const AUDIO_MIN_PLAYED = 0.9
/** Issue #4: German reading speed on mobile; dwell gate is a fraction of the estimated reading time */
export const READING_WPM = 200
export const WRITTEN_DWELL_FRACTION = 0.3

/** Cover counts as a page (it is page 0 in the app) */
export function writtenPageCount(u: WrittenUnit): number {
  return u.slides.length + (u.cover ? 1 : 0)
}

export function writtenWordCount(u: WrittenUnit): number {
  return (u.cover ? wordCount(u.cover.hook) : 0) + u.slides.reduce((sum, s) => sum + wordCount(s.body), 0)
}

export function readingMinutes(u: WrittenUnit): number {
  return Math.max(1, Math.round(writtenWordCount(u) / READING_WPM))
}

export function writtenMinDwellSec(u: WrittenUnit): number {
  return Math.max(WRITTEN_MIN_DWELL_SEC, Math.round((writtenWordCount(u) / READING_WPM) * 60 * WRITTEN_DWELL_FRACTION))
}

export interface FeedUnitDto {
  id: string
  title: string
  format: UnitFormat
  field: { id: string; slug: string; nameDe: string; adviceDisclaimer: boolean }
  content: UnitContent
  /** asset id → public URL */
  media: Record<string, string>
  /** asset id → credit; only stock images have an entry */
  credits: Record<string, ImageCredit>
  /** true when the unit comes from a field the user did not select */
  discovery: boolean
}

export interface FeedResponse {
  units: FeedUnitDto[]
  /** When reached (free tier), `units` is empty and the app shows the paywall */
  cap: DailyCapDto
}

export const completionInputSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('written'), slidesSeen: z.number().int().min(1), dwellSec: z.number().min(0) }),
  z.object({ format: z.literal('audio'), listenedSec: z.number().min(0) }),
])
export type CompletionInput = z.infer<typeof completionInputSchema>

export interface CompletionResult {
  completed: boolean
  /** false when the unit was already completed earlier */
  firstTime: boolean
  reason?: 'not_enough_progress' | 'format_mismatch' | 'daily_cap'
  /** Only on the first completion of a unit */
  rewards?: CompletionRewardsDto
}

export function isCompletion(content: UnitContent, input: CompletionInput): CompletionResult['reason'] | null {
  if (content.format !== input.format) return 'format_mismatch'
  if (content.format === 'written' && input.format === 'written') {
    return input.slidesSeen >= writtenPageCount(content) && input.dwellSec >= writtenMinDwellSec(content) ? null : 'not_enough_progress'
  }
  if (content.format === 'audio' && input.format === 'audio') {
    return input.listenedSec >= content.durationSec * AUDIO_MIN_PLAYED ? null : 'not_enough_progress'
  }
  return 'format_mismatch'
}

export interface FeedCandidate {
  id: string
  fieldId: string
}

/**
 * Spec §6: round-robin across selected fields, every DISCOVERY_EVERY-th slot from an unselected field.
 * Candidates must already be filtered (published, format, not completed, not recently served) and
 * ordered by preference within their field (e.g. newest first).
 */
export function orderFeed(candidates: FeedCandidate[], selectedFieldIds: string[], limit: number): { id: string; discovery: boolean }[] {
  const selected = new Set(selectedFieldIds)
  const queues = new Map<string, FeedCandidate[]>()
  const discovery: FeedCandidate[] = []
  for (const c of candidates) {
    if (!selected.has(c.fieldId)) {
      discovery.push(c)
      continue
    }
    const q = queues.get(c.fieldId) ?? []
    q.push(c)
    queues.set(c.fieldId, q)
  }
  const order = selectedFieldIds.filter((f) => queues.has(f))
  const out: { id: string; discovery: boolean }[] = []
  let rr = 0
  while (out.length < limit) {
    const slot = out.length + 1
    if (slot % DISCOVERY_EVERY === 0 && discovery.length) {
      out.push({ id: discovery.shift()!.id, discovery: true })
      continue
    }
    const active = order.filter((f) => (queues.get(f)?.length ?? 0) > 0)
    if (active.length === 0) {
      // Selected fields exhausted: fill with discovery rather than an empty feed
      const d = discovery.shift()
      if (!d) break
      out.push({ id: d.id, discovery: true })
      continue
    }
    const field = active[rr % active.length]!
    rr++
    out.push({ id: queues.get(field)!.shift()!.id, discovery: false })
  }
  return out
}
