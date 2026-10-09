import { z } from 'zod'

export const unitFormatSchema = z.enum(['audio', 'written'])
export type UnitFormat = z.infer<typeof unitFormatSchema>

export const sourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
})
export type Source = z.infer<typeof sourceSchema>

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

// Spec: 3–5 slides, ≤ 60 words body each, ≥ 1 source
export const slideSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).refine((b) => wordCount(b) <= 60, { message: 'Slide body exceeds 60 words' }),
  imageId: z.string().optional(),
})

export const writtenUnitSchema = z.object({
  format: z.literal('written'),
  slides: z.array(slideSchema).min(3).max(5),
  sources: z.array(sourceSchema).min(1).max(3),
})
export type WrittenUnit = z.infer<typeof writtenUnitSchema>

// Spec: 3–5 min audio, 1–3 images timed to the script
export const audioUnitSchema = z
  .object({
    format: z.literal('audio'),
    script: z.string().min(1),
    durationSec: z.number().int().min(180).max(300),
    audioId: z.string().min(1),
    images: z
      .array(z.object({ imageId: z.string().min(1), showAtSec: z.number().int().min(0) }))
      .min(1)
      .max(3),
    sources: z.array(sourceSchema).min(1).max(3),
  })
  .refine((u) => u.images.every((i) => i.showAtSec < u.durationSec), {
    message: 'Image showAtSec must be within the audio duration',
    path: ['images'],
  })
export type AudioUnit = z.infer<typeof audioUnitSchema>

export const unitContentSchema = z.union([writtenUnitSchema, audioUnitSchema])
export type UnitContent = z.infer<typeof unitContentSchema>
