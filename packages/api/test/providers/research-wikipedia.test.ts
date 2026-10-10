// Fixtures follow the documented Action API (formatversion=2) shape; re-record live per plan Task 4 Step 0.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createWikipediaProvider } from '../../src/providers/research/wikipedia.js'

const search = JSON.parse(readFileSync(new URL('./fixtures/wikipedia-search.json', import.meta.url), 'utf8'))
const pages = JSON.parse(readFileSync(new URL('./fixtures/wikipedia-pages.json', import.meta.url), 'utf8')) as Record<string, unknown>
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const q = { brief: { fieldSlug: 'nutrition', fieldName: 'E', themeName: null, topic: 't', context: '', adviceDisclaimer: false }, de: 'Protein Muskelaufbau', en: 'protein' }

function api() {
  return vi.fn(async (url: string) => {
    const p = new URL(url).searchParams
    if (p.get('list') === 'search') return json(search)
    return json(pages[p.get('titles')!])
  })
}

describe('wikipedia provider', () => {
  it('searches dewiki with the user agent and maps articles', async () => {
    const fetchFn = api()
    const out = await createWikipediaProvider({ userAgent: 'wizzn-test/1.0 (a@b.c)', fetchFn: fetchFn as unknown as typeof fetch }).find(q)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const p = new URL(url).searchParams
    expect(new URL(url).origin + new URL(url).pathname).toBe('https://de.wikipedia.org/w/api.php')
    expect(p.get('srsearch')).toBe('Protein Muskelaufbau')
    expect(p.get('srnamespace')).toBe('0')
    expect((init.headers as Record<string, string>)['user-agent']).toBe('wizzn-test/1.0 (a@b.c)')
    // disambiguation and stub dropped, max 3 content calls
    expect(out.map((c) => c.title)).toEqual(['Proteine', 'Muskelaufbau'])
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(out[0]).toMatchObject({ tier: 2, provider: 'wikipedia', publisher: 'Wikipedia', url: 'https://de.wikipedia.org/wiki/Proteine', quality: 1 })
    expect(out[1]!.quality).toBe(0.5)
    expect(out[0]!.text!.length).toBeLessThanOrEqual(8000)
  })
  it('maps the Lesenswert badge to 0.8', async () => {
    const lesenswert = structuredClone(pages['Muskelaufbau']) as { query: { pages: { categories?: unknown[] }[] } }
    lesenswert.query.pages[0]!.categories = [{ ns: 14, title: 'Kategorie:Wikipedia:Lesenswert' }]
    const fetchFn = vi.fn(async (url: string) => {
      const p = new URL(url).searchParams
      if (p.get('list') === 'search') return json({ query: { search: [{ title: 'Muskelaufbau' }] } })
      return json(lesenswert)
    })
    const out = await createWikipediaProvider({ userAgent: 'u', fetchFn: fetchFn as unknown as typeof fetch }).find(q)
    expect(out[0]!.quality).toBe(0.8)
  })
  it('retries once after 429 with Retry-After, then gives up', async () => {
    const sleep = vi.fn(async () => {})
    const fetchFn = vi.fn(async () => json({}, 429, { 'retry-after': '1' }))
    const out = await createWikipediaProvider({ userAgent: 'u', fetchFn: fetchFn as unknown as typeof fetch, sleep }).find(q)
    expect(out).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })
  it('returns [] on server errors', async () => {
    const fetchFn = vi.fn(async () => json({}, 500))
    expect(await createWikipediaProvider({ userAgent: 'u', fetchFn: fetchFn as unknown as typeof fetch }).find(q)).toEqual([])
  })
})
