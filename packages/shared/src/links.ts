/** German stop words that carry no topical signal */
const STOP = new Set(
  'der die das und oder ein eine einer eines einem einen mit für von zu zum zur im in am an auf aus bei ist sind wie was warum wann wer dein deine du dich dir ich wir ihr sie es nicht kein keine mehr als auch so nur noch schon über unter nach vor durch ohne um bis den dem des sich man'.split(' '),
)

/** Lower-cased content words (≥ 3 letters, no stop words) */
export function topicTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

export const RELATED_MIN_SCORE = 0.12
export const RELATED_MAX = 5

export interface LinkCandidate {
  id: string
  pairId: string | null
  text: string
}

/** Best related units by keyword overlap; pair siblings of the source never count. */
export function scoreRelated(from: { id: string; pairId: string | null; text: string }, others: LinkCandidate[]): { id: string; score: number }[] {
  const mine = topicTokens(from.text)
  return others
    .filter((o) => o.id !== from.id && !(from.pairId && o.pairId === from.pairId))
    .map((o) => ({ id: o.id, score: jaccard(mine, topicTokens(o.text)) }))
    .filter((r) => r.score >= RELATED_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, RELATED_MAX)
}
