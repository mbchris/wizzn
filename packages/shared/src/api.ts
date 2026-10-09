import { z } from 'zod'
import { unitFormatSchema } from './content.js'

export const interestsInputSchema = z.object({
  fieldIds: z.array(z.string().uuid()).min(1),
  themeIds: z.array(z.string().uuid()).default([]),
  formats: z.array(unitFormatSchema).min(1),
  timezone: z.string().min(1).optional(),
})
export type InterestsInput = z.infer<typeof interestsInputSchema>

export interface FieldDto {
  id: string
  slug: string
  nameDe: string
  adviceDisclaimer: boolean
  themes: { id: string; slug: string; nameDe: string }[]
}

export interface MeDto {
  id: string
  name: string
  isAnonymous: boolean
  timezone: string
  formats: z.infer<typeof unitFormatSchema>[]
  interests: { fieldId: string; themeId: string | null }[]
}
