export interface FieldSeed {
  slug: string
  nameDe: string
  themes: { slug: string; nameDe: string }[]
  /** Spec §1: finance/nutrition/psychology show a "no professional advice" note */
  adviceDisclaimer: boolean
}

export const FIELD_SEEDS: readonly FieldSeed[] = [
  {
    slug: 'nutrition',
    nameDe: 'Gesunde Ernährung',
    adviceDisclaimer: true,
    themes: [
      { slug: 'protein', nameDe: 'Protein' },
      { slug: 'vegan', nameDe: 'Vegan' },
      { slug: 'vegetarian', nameDe: 'Vegetarisch' },
      { slug: 'keto', nameDe: 'Keto' },
    ],
  },
  {
    slug: 'partnership',
    nameDe: 'Partnerschaft',
    adviceDisclaimer: false,
    themes: [
      { slug: 'seduction', nameDe: 'Verführung' },
      { slug: 'needs', nameDe: 'Bedürfnisse' },
      { slug: 'love', nameDe: 'Liebe' },
      { slug: 'balance', nameDe: 'Balance in der Partnerschaft' },
    ],
  },
  {
    slug: 'finance',
    nameDe: 'Finanzen',
    adviceDisclaimer: true,
    themes: [
      { slug: 'investments', nameDe: 'Geldanlage' },
      { slug: 'tax-optimization', nameDe: 'Steueroptimierung' },
      { slug: 'budget', nameDe: 'Budget & Selbstkontrolle' },
    ],
  },
  {
    slug: 'sports',
    nameDe: 'Sport',
    adviceDisclaimer: false,
    themes: [
      { slug: 'routine', nameDe: 'Sportroutine aufbauen' },
      { slug: 'workout-types', nameDe: 'Trainingsarten' },
      { slug: 'strength', nameDe: 'Kraft' },
      { slug: 'cardio', nameDe: 'Ausdauer' },
    ],
  },
  {
    slug: 'psychology',
    nameDe: 'Psychologie',
    adviceDisclaimer: true,
    themes: [
      { slug: 'behaviour-patterns', nameDe: 'Verhaltensmuster' },
      { slug: 'neurodivergence', nameDe: 'Neurodivergenz' },
      { slug: 'developmental', nameDe: 'Entwicklungspsychologie' },
      { slug: 'social', nameDe: 'Sozialpsychologie' },
    ],
  },
]
