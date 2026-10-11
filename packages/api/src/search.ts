import { SEARCH_MAX_PAGES, SEARCH_PAGE_SIZE, type FieldDto, type SearchTopicDto } from '@wizzn/shared'
import type { SearchHit } from './knowledge-repo.js'

export const SEARCH_MAX_RESULTS = SEARCH_PAGE_SIZE * SEARCH_MAX_PAGES
const MAX_TOPICS = 4

/** Opaque page cursor; deliberately carries no counts */
export const encodeCursor = (page: number): string => Buffer.from(JSON.stringify({ p: page })).toString('base64url')
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const p: unknown = (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { p?: unknown }).p
    return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < SEARCH_MAX_PAGES ? p : SEARCH_MAX_PAGES
  } catch {
    return SEARCH_MAX_PAGES
  }
}

function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  // mulberry32
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Keeps relevance bands (title before topic before theme …) but shuffles inside a band with a seed,
 * so the grid feels curated and stays stable across pages of the same query.
 */
export function shuffleWithinBands(hits: SearchHit[], seed: string): string[] {
  const random = seededRandom(seed)
  const bands = new Map<number, string[]>()
  for (const h of hits) bands.set(h.rank, [...(bands.get(h.rank) ?? []), h.id])
  return [...bands.keys()]
    .sort((a, b) => a - b)
    .flatMap((rank) => {
      const ids = [...bands.get(rank)!]
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
      }
      return ids
    })
}

/** Page slice + next cursor; never more than SEARCH_MAX_PAGES pages */
export function pageOf(ids: string[], page: number): { ids: string[]; cursor: string | null } {
  const start = page * SEARCH_PAGE_SIZE
  const slice = ids.slice(start, start + SEARCH_PAGE_SIZE)
  const more = ids.length > start + SEARCH_PAGE_SIZE && page + 1 < SEARCH_MAX_PAGES
  return { ids: slice, cursor: more ? encodeCursor(page + 1) : null }
}

/** Fields and themes whose German name or slug contains the query */
export function matchTopics(fields: FieldDto[], q: string): SearchTopicDto[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < 2) return []
  const hit = (x: { slug: string; nameDe: string }) => x.nameDe.toLowerCase().includes(needle) || x.slug.includes(needle)
  const out: SearchTopicDto[] = []
  for (const f of fields) {
    if (hit(f)) out.push({ fieldId: f.id, fieldSlug: f.slug, themeId: null, nameDe: f.nameDe })
    for (const t of f.themes) if (hit(t)) out.push({ fieldId: f.id, fieldSlug: f.slug, themeId: t.id, nameDe: t.nameDe })
  }
  return out.slice(0, MAX_TOPICS)
}
