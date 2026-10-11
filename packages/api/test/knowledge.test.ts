import { describe, expect, it } from 'vitest'
import { SEARCH_MAX_PAGES, SEARCH_PAGE_SIZE, type FeedUnitDto, type SearchResponse, type TilePage, type UnitContent } from '@wizzn/shared'
import { createApp } from '../src/app.js'
import type { FeedRepo } from '../src/feed-repo.js'
import type { KnowledgeRepo } from '../src/knowledge-repo.js'
import { decodeCursor, encodeCursor, matchTopics, pageOf, shuffleWithinBands } from '../src/search.js'
import { fakeAuth, fakeProgress, fakeRepos } from './fakes.js'

const headers = { authorization: 'Bearer t', 'content-type': 'application/json' }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const content: UnitContent = { format: 'written', slides: [{ title: 'a', body: 'b' }, { title: 'a', body: 'b' }, { title: 'a', body: 'b' }], sources: [{ url: 'https://a.de', title: 't', publisher: 'p' }] }
const PUBLISHED = new Set([id(1), id(2), id(3)])

function fakeFeed(): FeedRepo {
  return {
    getPrefs: async () => ({ fieldIds: ['A'], themeIds: [], formats: ['written'], timezone: 'Europe/Berlin' }),
    getCandidates: async () => [],
    getSignals: async () => [],
    loadUnits: async (ids) =>
      new Map(
        ids.filter((i) => PUBLISHED.has(i)).map((i): [string, Omit<FeedUnitDto, 'discovery'>] => [
          i,
          { id: i, title: i, format: 'written', field: { id: 'A', slug: 'nutrition', nameDe: 'Ernährung', adviceDisclaimer: true }, content, media: {}, credits: {}, level: 1, series: null, saved: false },
        ]),
      ),
    recordImpressions: async () => undefined,
    getPublishedContent: async () => content,
  }
}

function fakeKnowledge(hits = 100) {
  const votes: [string, number][] = []
  const saved = new Set<string>()
  const repo: KnowledgeRepo = {
    linkUnit: async () => undefined,
    nextIds: async (_u, unitId, _f, limit) => [id(2), id(3)].filter((i) => i !== unitId).slice(0, limit),
    vote: async (_u, unitId, vote) => {
      if (!PUBLISHED.has(unitId)) return false
      votes.push([unitId, vote])
      return true
    },
    save: async (_u, unitId) => (PUBLISHED.has(unitId) ? Boolean(saved.add(unitId)) : false),
    unsave: async (_u, unitId) => void saved.delete(unitId),
    listSaved: async (_u, limit) => ({ tiles: [...saved].slice(0, limit).map((i) => ({ id: i, title: i, format: 'written' as const, field: { slug: 'n', nameDe: 'N' }, level: 1 as const, image: null })), next: null }),
    search: async (_q, limit) => Array.from({ length: Math.min(hits, limit) }, (_, i) => ({ id: id(100 + i), rank: i % 3 })),
    forYou: async (_u, limit) => Array.from({ length: Math.min(5, limit) }, (_, i) => id(200 + i)),
    tiles: async (ids) => ids.map((i) => ({ id: i, title: i, format: 'written' as const, field: { slug: 'n', nameDe: 'N' }, level: 1 as const, image: null })),
  }
  return { repo, votes, saved }
}

const app = (k = fakeKnowledge()) => createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [], feed: fakeFeed(), knowledge: k.repo, progress: { repo: fakeProgress(), freeDailyCap: 3 } })

describe('unit viewer + continuation', () => {
  it('requires a session', async () => {
    expect((await app().request(`/api/units/${id(1)}`)).status).toBe(401)
  })
  it('returns a published unit and 404 otherwise', async () => {
    expect(((await (await app().request(`/api/units/${id(1)}`, { headers })).json()) as FeedUnitDto).id).toBe(id(1))
    expect((await app().request(`/api/units/${id(9)}`, { headers })).status).toBe(404)
  })
  it('continues through linked units', async () => {
    const body = (await (await app().request(`/api/units/${id(1)}/next?limit=3`, { headers })).json()) as FeedUnitDto[]
    expect(body.map((u) => u.id)).toEqual([id(2), id(3)])
  })
})

describe('POST /api/units/:id/feedback', () => {
  const post = (a: ReturnType<typeof app>, unit: string, vote: number) => a.request(`/api/units/${unit}/feedback`, { method: 'POST', headers, body: JSON.stringify({ vote }) })
  it('"mehr davon" records the vote and returns follow-up units', async () => {
    const k = fakeKnowledge()
    const res = await post(app(k), id(1), 1)
    expect(((await res.json()) as { next: FeedUnitDto[] }).next.map((u) => u.id)).toEqual([id(2), id(3)])
    expect(k.votes).toEqual([[id(1), 1]])
  })
  it('"weniger davon" returns nothing to insert', async () => {
    expect(await (await post(app(), id(1), -1)).json()).toEqual({ next: [] })
  })
  it('rejects other votes and unpublished units', async () => {
    expect((await post(app(), id(1), 2)).status).toBe(400)
    expect((await post(app(), id(9), 1)).status).toBe(404)
  })
})

describe('saved units', () => {
  it('saves, lists and removes', async () => {
    const k = fakeKnowledge()
    const a = app(k)
    expect((await a.request(`/api/me/saved/${id(1)}`, { method: 'PUT', headers })).status).toBe(200)
    expect((await a.request(`/api/me/saved/${id(9)}`, { method: 'PUT', headers })).status).toBe(404)
    const page = (await (await a.request('/api/me/saved', { headers })).json()) as TilePage
    expect(page).toMatchObject({ items: [{ id: id(1) }], cursor: null })
    await a.request(`/api/me/saved/${id(1)}`, { method: 'DELETE', headers })
    expect(k.saved.size).toBe(0)
  })
})

describe('GET /api/search', () => {
  it('pages without ever revealing a total and stops after the page cap', async () => {
    const a = app(fakeKnowledge(500))
    let cursor: string | null = null
    const seen: string[] = []
    let pages = 0
    do {
      const res: Response = await a.request(`/api/search?q=protein${cursor ? `&cursor=${cursor}` : ''}`, { headers })
      const body = (await res.json()) as SearchResponse
      expect(Object.keys(body).sort()).toEqual(['cursor', 'items', 'topics'])
      seen.push(...body.items.map((t) => t.id))
      cursor = body.cursor
      pages++
    } while (cursor)
    expect(pages).toBe(SEARCH_MAX_PAGES)
    expect(new Set(seen).size).toBe(SEARCH_PAGE_SIZE * SEARCH_MAX_PAGES)
  })
  it('shows "für dich" tiles for an empty query', async () => {
    const body = (await (await app().request('/api/search', { headers })).json()) as SearchResponse
    expect(body.items).toHaveLength(5)
    expect(body.topics).toEqual([])
  })
})

describe('search helpers', () => {
  it('keeps relevance bands and is stable per seed', () => {
    const hits = [{ id: 'c', rank: 1 }, { id: 'a', rank: 0 }, { id: 'd', rank: 1 }, { id: 'b', rank: 0 }]
    const out = shuffleWithinBands(hits, 'protein')
    expect(new Set(out.slice(0, 2))).toEqual(new Set(['a', 'b']))
    expect(shuffleWithinBands(hits, 'protein')).toEqual(out)
  })
  it('rejects forged cursors beyond the cap', () => {
    expect(decodeCursor(encodeCursor(2))).toBe(2)
    expect(decodeCursor(encodeCursor(99))).toBe(SEARCH_MAX_PAGES)
    expect(decodeCursor('garbage')).toBe(SEARCH_MAX_PAGES)
    expect(pageOf(['x'], SEARCH_MAX_PAGES)).toEqual({ ids: [], cursor: null })
  })
  it('matches fields and themes by name', () => {
    const fields = [{ id: 'f', slug: 'nutrition', nameDe: 'Ernährung', adviceDisclaimer: true, themes: [{ id: 't', slug: 'protein', nameDe: 'Protein' }] }]
    expect(matchTopics(fields, 'prot')).toEqual([{ fieldId: 'f', fieldSlug: 'nutrition', themeId: 't', nameDe: 'Protein' }])
  })
})
