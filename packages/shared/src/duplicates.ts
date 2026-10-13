import type { UnitFormat } from './content.js'
import { jaccard, topicTokens } from './links.js'

/** Share of content words two units must have in common to count as the same subject */
export const DUPLICATE_MIN_SCORE = 0.6

export type DuplicateReason = 'series' | 'subject'

export interface DuplicateCandidate {
  id: string
  format: UnitFormat
  fieldSlug: string
  series: string | null
  /** Title and core idea */
  text: string
}

export interface DuplicateGroup {
  ids: string[]
  reasons: DuplicateReason[]
}

const REASON_ORDER: readonly DuplicateReason[] = ['series', 'subject']

/** `<key>-<n>` is the importer's name for a second series under a taken key, so it counts as `<key>` while that exists */
function seriesRoot(key: string, known: ReadonlySet<string>): string {
  const shorter = /^(.+)-[0-9]+$/.exec(key)?.[1]
  return shorter && known.has(shorter) ? seriesRoot(shorter, known) : key
}

/**
 * Units of one format that cover the same ground: same series (any level) or, within a field, mostly the same content words.
 * Groups are transitive; ids keep the input order.
 */
export function duplicateGroups(units: DuplicateCandidate[]): DuplicateGroup[] {
  const parent = units.map((_, i) => i)
  const reasons = new Map<number, Set<DuplicateReason>>()
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const pairReasons: [number, DuplicateReason][] = []
  const link = (a: number, b: number, reason: DuplicateReason): void => {
    parent[find(b)] = find(a)
    pairReasons.push([a, reason])
  }

  const known = new Set(units.flatMap((u) => (u.series ? [u.series] : [])))
  const firstOfSeries = new Map<string, number>()
  units.forEach((u, i) => {
    if (!u.series) return
    const key = `${u.format}:${seriesRoot(u.series, known)}`
    const first = firstOfSeries.get(key)
    if (first === undefined) firstOfSeries.set(key, i)
    else link(first, i, 'series')
  })

  const tokens = units.map((u) => topicTokens(u.text))
  for (let a = 0; a < units.length; a++) {
    for (let b = a + 1; b < units.length; b++) {
      const [x, y] = [units[a]!, units[b]!]
      if (x.format !== y.format || x.fieldSlug !== y.fieldSlug) continue
      if (jaccard(tokens[a]!, tokens[b]!) >= DUPLICATE_MIN_SCORE) link(a, b, 'subject')
    }
  }

  for (const [i, reason] of pairReasons) {
    const root = find(i)
    reasons.set(root, (reasons.get(root) ?? new Set()).add(reason))
  }
  const members = new Map<number, string[]>()
  units.forEach((u, i) => {
    const root = find(i)
    if (reasons.has(root)) members.set(root, [...(members.get(root) ?? []), u.id])
  })
  return [...members].map(([root, ids]) => ({ ids, reasons: REASON_ORDER.filter((r) => reasons.get(root)!.has(r)) }))
}
