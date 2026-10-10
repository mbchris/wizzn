// Fixture follows the documented Europe PMC REST (resultType=core) shape; re-record live per plan Task 5 Step 0.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createEuropePmcProvider } from '../../src/providers/research/europepmc.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/europepmc-search.json', import.meta.url), 'utf8'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const q = (fieldSlug = 'sports') => ({ brief: { fieldSlug, fieldName: 'S', themeName: null, topic: 't', context: '', adviceDisclaimer: false }, de: 'Protein', en: 'protein intake muscle hypertrophy' })
const now = () => new Date('2026-10-10T12:00:00Z')

describe('europe pmc provider', () => {
  it('queries reviews with abstracts from the last 10 years, sorted by citations', async () => {
    const fetchFn = vi.fn(async () => json(fixture))
    await createEuropePmcProvider({ fetchFn: fetchFn as unknown as typeof fetch, now }).find(q())
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0])
    expect(url.origin + url.pathname).toBe('https://www.ebi.ac.uk/europepmc/webservices/rest/search')
    const query = url.searchParams.get('query')!
    expect(query).toContain('(protein intake muscle hypertrophy)')
    expect(query).toContain('PUB_TYPE:"systematic review"')
    expect(query).toContain('PUB_TYPE:"meta-analysis"')
    expect(query).toContain('HAS_ABSTRACT:y')
    expect(query).toContain('PUB_YEAR:[2016 TO 2026]')
    expect(url.searchParams.get('resultType')).toBe('core')
    expect(url.searchParams.get('sort')).toBe('CITED desc')
  })
  it('maps results, strips markup, drops items without abstract', async () => {
    const out = await createEuropePmcProvider({ fetchFn: (async () => json(fixture)) as unknown as typeof fetch, now }).find(q())
    expect(out.map((c) => c.url)).toEqual(['https://europepmc.org/article/MED/38000001', 'https://europepmc.org/article/PMC/PMC999'])
    expect(out[0]).toMatchObject({ tier: 3, provider: 'europepmc', publisher: 'British Journal of Sports Medicine', title: 'Protein intake and muscle hypertrophy: a systematic review and meta-analysis.' })
    expect(out[0]!.text).toBe('Background Protein supplementation augments gains in muscle mass1 during resistance training. Results Pooled data from 49 trials (n=1863) …')
    expect(out[0]!.quality).toBe(1)
    expect(out[1]!.quality).toBe(0)
  })
  it('skips fields without scholarly flag and tolerates errors', async () => {
    const fetchFn = vi.fn(async () => json({}, 503))
    expect(await createEuropePmcProvider({ fetchFn: fetchFn as unknown as typeof fetch, now }).find(q('finance'))).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
    expect(await createEuropePmcProvider({ fetchFn: fetchFn as unknown as typeof fetch, now, log: () => {} }).find(q())).toEqual([])
  })
})
