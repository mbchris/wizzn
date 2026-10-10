import { z } from 'zod'

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

/** German TTS speaks ~140 words/min → 420–700 words ≈ 3–5 min (spec §1). */
export const AUDIO_SCRIPT_WORDS = { min: 420, max: 700 } as const

/**
 * Optional free-text hint from the LLM (image prompt / stock query). Small local models send null, "",
 * arrays of terms or overlong strings; a bad hint must not fail the whole draft, so normalise instead of reject.
 */
const hint = (min: number, max?: number) =>
  z.preprocess(
    (v) => {
      if (v == null) return undefined
      const raw = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : v
      if (typeof raw !== 'string') return raw
      let s = raw.replace(/\s+/g, ' ').trim()
      if (s.length < min) return undefined
      if (max && s.length > max) {
        const cut = s.slice(0, max + 1).lastIndexOf(' ')
        s = (cut > 0 ? s.slice(0, cut) : s.slice(0, max)).trim()
      }
      return s
    },
    (max ? z.string().min(min).max(max) : z.string().min(min)).optional(),
  )

/** Editorial voice of a unit; picked at random per unit unless the brief names one. */
export const EDITORIAL_STYLES = ['friendly', 'factual', 'narrative'] as const
export type EditorialStyle = (typeof EDITORIAL_STYLES)[number]

/** Booker's basic plots that suit a positive knowledge app (no tragedy). */
export const STORY_ARCS = ['rags_to_riches', 'quest', 'voyage_and_return', 'comedy', 'overcoming_the_monster', 'rebirth'] as const
export type StoryArc = (typeof STORY_ARCS)[number]

/** Recorded on every draft so reviewers see which voice and plot were used. */
export const editorialSchema = z.object({ style: z.enum(EDITORIAL_STYLES), arc: z.enum(STORY_ARCS) })
export type Editorial = z.infer<typeof editorialSchema>

/** Issue #4: 2–3 min reading at ~200 wpm (German, mobile) → hook + slide bodies. */
export const WRITTEN_WORDS = { min: 420, max: 600 } as const
export const WRITTEN_SLIDE_WORDS = { min: 60, max: 120 } as const
export const WRITTEN_HOOK_MAX_WORDS = 35
export const WRITTEN_MAX_SLIDE_IMAGES = 2

// LLMs can't count words: report the actual count so the repair round knows whether to expand or cut
const wordRange = (min: number, max: number, label: string) =>
  z.string().min(1).superRefine((s, ctx) => {
    const n = words(s)
    if (n < min || n > max) ctx.addIssue({ code: 'custom', message: `${label} must have ${min}–${max} words, has ${n} (${n < min ? 'expand' : 'shorten'})` })
  })

export const draftWrittenSchema = z
  .object({
    title: z.string().min(3).max(80),
    hook: wordRange(1, WRITTEN_HOOK_MAX_WORDS, 'Hook'),
    cover: z.object({ imagePrompt: z.string().min(3), imageQuery: hint(2, 40) }),
    slides: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          body: wordRange(WRITTEN_SLIDE_WORDS.min, WRITTEN_SLIDE_WORDS.max, 'Slide body'),
          imagePrompt: hint(3),
          imageQuery: hint(2, 40),
        }),
      )
      .min(4)
      .max(6)
      .refine((slides) => slides.filter((s) => s.imagePrompt).length <= WRITTEN_MAX_SLIDE_IMAGES, {
        message: `At most ${WRITTEN_MAX_SLIDE_IMAGES} slide images`,
      }),
    editorial: editorialSchema.optional(),
  })
  .superRefine((d, ctx) => {
    const n = words(d.hook) + d.slides.reduce((sum, s) => sum + words(s.body), 0)
    if (n < WRITTEN_WORDS.min || n > WRITTEN_WORDS.max)
      ctx.addIssue({
        code: 'custom',
        path: ['slides'],
        message: `Hook + slide bodies must have ${WRITTEN_WORDS.min}–${WRITTEN_WORDS.max} words, has ${n} (${n < WRITTEN_WORDS.min ? 'expand' : 'shorten'})`,
      })
  })
export type DraftWritten = z.infer<typeof draftWrittenSchema>

export const draftAudioSchema = z.object({
  title: z.string().min(3).max(80),
  // LLMs can't count words: report the actual count so the repair round knows whether to expand or cut
  script: z.string().superRefine((s, ctx) => {
    const n = words(s)
    if (n < AUDIO_SCRIPT_WORDS.min || n > AUDIO_SCRIPT_WORDS.max)
      ctx.addIssue({ code: 'custom', message: `Script must have ${AUDIO_SCRIPT_WORDS.min}–${AUDIO_SCRIPT_WORDS.max} words, has ${n} (${n < AUDIO_SCRIPT_WORDS.min ? 'expand' : 'shorten'})` })
  }),
  images: z
    .array(z.object({ prompt: z.string().min(3), query: hint(2, 40), atFraction: z.number().min(0).max(0.95) }))
    .min(1)
    .max(3),
  editorial: editorialSchema.optional(),
})
export type DraftAudio = z.infer<typeof draftAudioSchema>

/** Issue #4: German query for web/Wikipedia, English for scholarly databases */
export const queryPlanSchema = z.object({ de: z.string().trim().min(2).max(120), en: z.string().trim().min(2).max(120) })
export type QueryPlan = z.infer<typeof queryPlanSchema>

export const sourcePickSchema = z.object({
  picks: z.array(z.object({ index: z.number().int().min(0), publisher: z.string().min(1) })).min(1).max(3),
})
export type SourcePick = z.infer<typeof sourcePickSchema>

export const imagePickSchema = z.object({ index: z.number().int().min(0).nullable() })
export type ImagePick = z.infer<typeof imagePickSchema>

export const llmCheckSchema = z.object({
  claims: z.array(z.object({ text: z.string(), sourceIndex: z.number().int().min(0).nullable() })),
  issues: z.array(z.object({ severity: z.enum(['low', 'high']), message: z.string() })),
})
export type LlmCheck = z.infer<typeof llmCheckSchema>

export type SourceTier = 1 | 2 | 3 | 4
export type SourceTrust = 'high' | 'mixed' | 'low'
/** Spec #4 §6: a run this long copied from a source is a licensing problem (Wikipedia is CC BY-SA). */
export const VERBATIM_MAX_RUN = 12

export interface CheckReport extends LlmCheck {
  links: { url: string; ok: boolean; status: number | null }[]
  unsupportedClaims: number
  /** Optional on reports created before issue #4 */
  trust?: SourceTrust
  maxVerbatimRun?: number
  passed: boolean
}

export function sourceTrust(tiers: SourceTier[]): SourceTrust {
  const web = tiers.filter((t) => t === 4).length
  if (web === 0 && tiers.length > 0) return 'high'
  return web === tiers.length ? 'low' : 'mixed'
}

/** Spec §4: unsupported claims, high-severity issues, dead links or verbatim copies fail the check (unit still goes to human review). Trust only flags. */
export function evaluateCheck(
  llm: LlmCheck,
  links: CheckReport['links'],
  sources: { tiers: SourceTier[]; maxVerbatimRun: number } = { tiers: [], maxVerbatimRun: 0 },
): CheckReport {
  const issues =
    sources.maxVerbatimRun >= VERBATIM_MAX_RUN
      ? [...llm.issues, { severity: 'high' as const, message: `Wörtliche Übernahme aus Quelle (${sources.maxVerbatimRun} Wörter am Stück)` }]
      : llm.issues
  const unsupportedClaims = llm.claims.filter((c) => c.sourceIndex === null).length
  const passed = unsupportedClaims === 0 && !issues.some((i) => i.severity === 'high') && links.every((l) => l.ok)
  return { ...llm, issues, links, unsupportedClaims, trust: sourceTrust(sources.tiers), maxVerbatimRun: sources.maxVerbatimRun, passed }
}

/** Converts draft image fractions into whole seconds inside the audio (audioUnitSchema requires showAtSec < duration). */
export function scheduleImages(durationSec: number, fractions: number[]): number[] {
  return fractions.map((f) => Math.min(Math.max(0, Math.floor(f * durationSec)), Math.max(0, durationSec - 1)))
}
