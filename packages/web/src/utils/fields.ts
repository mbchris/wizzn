/** Display helpers for the 5 launch fields (slugs come from the API) */
export const FIELD_EMOJI: Record<string, string> = {
  nutrition: '🥗',
  partnership: '🤝',
  finance: '💰',
  sports: '🏃',
  psychology: '🧠',
}

export const fieldEmoji = (slug: string): string => FIELD_EMOJI[slug] ?? '✨'
