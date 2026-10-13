import { z } from 'zod'
import { wordCount, type ImageCredit, type UnitContent, type UnitFormat, type WrittenUnit } from './content.js'
import type { CompletionRewardsDto, DailyCapDto } from './gamification.js'
import { MAX_LEVEL, type Level } from './levels.js'

export const FEED_PAGE_SIZE = 10
/** Spec §6: units served in the last 14 days are not shown again */
export const IMPRESSION_COOLDOWN_DAYS = 0   /** TODO: RESET THIS. CLAUDE, DO NOT OVERSEE. ASK ME IF I WANT TO CHANGE */
/** Spec §6: every 5th slot comes from an unselected field */
export const DISCOVERY_EVERY = 5
/** Spec §1 (halved): written = last slide + ≥ 8 s dwell; audio = ≥ 45 % played */
export const WRITTEN_MIN_DWELL_SEC = 8
export const AUDIO_MIN_PLAYED = 0.45
/** Issue #4: German reading speed on mobile; dwell gate is a fraction of the estimated reading time */
export const READING_WPM = 200
export const WRITTEN_DWELL_FRACTION = 0.15

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
  /** Depth within its series (1 for units without series) */
  level: Level
  series: string | null
  /** Bookmarked by the current user */
  saved: boolean
  /** Published unit of the same article in the other format (read ↔ listen); null without one */
  counterpartId: string | null
}

/** Grid tile for search results and saved units; never paired with a total count */
export interface UnitTileDto {
  id: string
  title: string
  format: UnitFormat
  field: { slug: string; nameDe: string }
  level: Level
  /** Cover / first image URL */
  image: string | null
}

export interface TilePage {
  items: UnitTileDto[]
  /** Opaque; null when there is nothing more to show */
  cursor: string | null
}

export interface SearchTopicDto {
  fieldId: string
  fieldSlug: string
  themeId: string | null
  nameDe: string
}

export interface SearchResponse extends TilePage {
  topics: SearchTopicDto[]
}

export const SEARCH_PAGE_SIZE = 12
/** Search never reveals catalogue size: at most this many pages per query */
export const SEARCH_MAX_PAGES = 5
export const SAVED_PAGE_SIZE = 18
export const searchQuerySchema = z.object({ q: z.string().trim().max(80).default(''), cursor: z.string().max(200).optional() })

export const feedbackInputSchema = z.object({ vote: z.union([z.literal(1), z.literal(-1)]) })
export type FeedbackVote = z.infer<typeof feedbackInputSchema>['vote']
export interface FeedbackResult {
  /** Units to show right after the voted one ("mehr davon"); empty for -1 */
  next: FeedUnitDto[]
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
  themeId?: string | null
  series?: string | null
  level?: Level
}

/* ---------- More / less feedback → affinity ---------- */

export interface FeedbackSignal {
  vote: FeedbackVote
  fieldId: string
  themeId: string | null
  series: string | null
  level: Level
  at: Date
}

export interface Affinity {
  series: Record<string, number>
  theme: Record<string, number>
  field: Record<string, number>
  /** Highest level the user may see per series */
  unlocked: Record<string, Level>
}

export const AFFINITY_WEIGHTS = { series: 3, theme: 2, field: 1 } as const
/** Votes older than this count half */
export const AFFINITY_DECAY_DAYS = 14
/** Candidates scoring at or below this are not served */
export const AFFINITY_DROP_SCORE = -4
export const EMPTY_AFFINITY: Affinity = { series: {}, theme: {}, field: {}, unlocked: {} }

export function buildAffinity(signals: FeedbackSignal[], now: Date): Affinity {
  const a: Affinity = { series: {}, theme: {}, field: {}, unlocked: {} }
  const add = (m: Record<string, number>, k: string | null, w: number) => {
    if (k) m[k] = (m[k] ?? 0) + w
  }
  for (const s of signals) {
    const decay = now.getTime() - s.at.getTime() > AFFINITY_DECAY_DAYS * 86_400_000 ? 0.5 : 1
    add(a.series, s.series, s.vote * AFFINITY_WEIGHTS.series * decay)
    add(a.theme, s.themeId, s.vote * AFFINITY_WEIGHTS.theme * decay)
    add(a.field, s.fieldId, s.vote * AFFINITY_WEIGHTS.field * decay)
    if (s.series && s.vote === 1) a.unlocked[s.series] = Math.min(MAX_LEVEL, Math.max(unlockedLevel(a, s.series), s.level + 1)) as Level
  }
  return a
}

/** Level 1 is always open; "mehr davon" on level n opens n + 1 */
export const unlockedLevel = (a: Affinity, series: string): Level => a.unlocked[series] ?? 1

export function scoreCandidate(c: FeedCandidate, a: Affinity, preferredThemes: ReadonlySet<string> = new Set()): number {
  return (
    (c.series ? (a.series[c.series] ?? 0) : 0) +
    (c.themeId ? (a.theme[c.themeId] ?? 0) + (preferredThemes.has(c.themeId) ? 1 : 0) : 0) +
    (a.field[c.fieldId] ?? 0)
  )
}

/**
 * Applies level gating and affinity before orderFeed: locked levels and strongly disliked units are dropped,
 * the rest is stably sorted by score (input order = recency breaks ties).
 */
export function rankCandidates(candidates: FeedCandidate[], a: Affinity, preferredThemeIds: string[] = []): FeedCandidate[] {
  const preferred = new Set(preferredThemeIds)
  return candidates
    .filter((c) => !c.series || (c.level ?? 1) <= unlockedLevel(a, c.series))
    .map((c, i) => ({ c, i, score: scoreCandidate(c, a, preferred) }))
    .filter((x) => x.score > AFFINITY_DROP_SCORE)
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((x) => x.c)
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
