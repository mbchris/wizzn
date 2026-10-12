/** Display helpers for the launch fields (slugs come from the API) */
export const FIELD_EMOJI: Record<string, string> = {
  nutrition: '🥗',
  partnership: '🤝',
  finance: '💰',
  sports: '🏃',
  psychology: '🧠',
  funfacts: '🎉',
  work: '💼',
}

export const fieldEmoji = (slug: string): string => FIELD_EMOJI[slug] ?? '✨'
