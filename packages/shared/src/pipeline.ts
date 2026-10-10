import { z } from 'zod'

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

/** German TTS speaks ~140 words/min → 420–700 words ≈ 3–5 min (spec §1). */
export const AUDIO_SCRIPT_WORDS = { min: 420, max: 700 } as const

export const draftWrittenSchema = z.object({
  title: z.string().min(3).max(80),
  slides: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).refine((b) => words(b) <= 60, { message: 'Slide body exceeds 60 words' }),
        imagePrompt: z.string().min(3).optional(),
        imageQuery: z.string().min(2).max(40).optional(),
      }),
    )
    .min(3)
    .max(5),
})
export type DraftWritten = z.infer<typeof draftWrittenSchema>

export const draftAudioSchema = z.object({
  title: z.string().min(3).max(80),
  script: z.string().refine((s) => words(s) >= AUDIO_SCRIPT_WORDS.min && words(s) <= AUDIO_SCRIPT_WORDS.max, {
    message: `Script must have ${AUDIO_SCRIPT_WORDS.min}–${AUDIO_SCRIPT_WORDS.max} words`,
  }),
  images: z
    .array(z.object({ prompt: z.string().min(3), query: z.string().min(2).max(40).optional(), atFraction: z.number().min(0).max(0.95) }))
    .min(1)
    .max(3),
})
export type DraftAudio = z.infer<typeof draftAudioSchema>

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

export interface CheckReport extends LlmCheck {
  links: { url: string; ok: boolean; status: number | null }[]
  unsupportedClaims: number
  passed: boolean
}

/** Spec §4: unsupported claims, high-severity issues or dead links fail the check (unit still goes to human review). */
export function evaluateCheck(llm: LlmCheck, links: CheckReport['links']): CheckReport {
  const unsupportedClaims = llm.claims.filter((c) => c.sourceIndex === null).length
  const passed = unsupportedClaims === 0 && !llm.issues.some((i) => i.severity === 'high') && links.every((l) => l.ok)
  return { ...llm, links, unsupportedClaims, passed }
}

/** Converts draft image fractions into whole seconds inside the audio (audioUnitSchema requires showAtSec < duration). */
export function scheduleImages(durationSec: number, fractions: number[]): number[] {
  return fractions.map((f) => Math.min(Math.max(0, Math.floor(f * durationSec)), Math.max(0, durationSec - 1)))
}
