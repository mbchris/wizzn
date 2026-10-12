import { describe, expect, it, vi } from 'vitest'
import { FIELD_SEEDS } from '@wizzn/shared'
import { createCuratedProvider } from '../../src/providers/research/curated.js'
import { hostMatches, SOURCE_REGISTRY } from '../../src/pipeline/source-registry.js'
import type { SearchClient } from '../../src/providers/search.js'
import type { ResearchQuery } from '../../src/providers/research/types.js'

const brief = (fieldSlug: string) => ({ fieldSlug, fieldName: 'Ernährung', themeName: 'Protein', topic: 'Proteinbedarf', context: '', adviceDisclaimer: true })
const q = (fieldSlug = 'nutrition'): ResearchQuery => ({ brief: brief(fieldSlug), de: 'Protein Bedarf', en: 'protein requirement' })

const results = [
  { url: 'https://www.dge.de/wissenschaft/protein/', title: 'Protein', snippet: 'DGE' },
  { url: 'https://ernaehrung.verbraucherzentrale.de/proteine', title: 'Proteine', snippet: 'VZ' },
  { url: 'https://notdge.de/protein', title: 'Fake', snippet: '' },
  { url: 'https://www.amazon.de/whey', title: 'Shop', snippet: '' },
]

describe('hostMatches', () => {
  it('matches the host, www and subdomains but not lookalikes', () => {
    expect(hostMatches('https://dge.de/x', 'dge.de')).toBe(true)
    expect(hostMatches('https://www.dge.de/x', 'dge.de')).toBe(true)
    expect(hostMatches('https://a.b.dge.de/x', 'dge.de')).toBe(true)
    expect(hostMatches('https://notdge.de/x', 'dge.de')).toBe(false)
    expect(hostMatches('not a url', 'dge.de')).toBe(false)
  })
})

describe('source registry', () => {
  it('covers every seeded field; scholarly only where research exists', () => {
    expect(Object.keys(SOURCE_REGISTRY).sort()).toEqual(FIELD_SEEDS.map((f) => f.slug).sort())
    expect(SOURCE_REGISTRY.nutrition!.scholarly).toBe(true)
    expect(SOURCE_REGISTRY.finance!.scholarly).toBe(false)
  })
})

describe('curated provider', () => {
  it('restricts the query to registry hosts and keeps only registry results', async () => {
    const search = vi.fn<SearchClient['search']>(async () => results)
    const out = await createCuratedProvider({ search }).find(q())
    const query = search.mock.calls[0]![0]
    expect(query).toContain('site:dge.de')
    expect(query).toContain('site:bzfe.de')
    expect(query.endsWith('Protein Bedarf')).toBe(true)
    expect(out.map((c) => c.url)).toEqual(['https://www.dge.de/wissenschaft/protein/', 'https://ernaehrung.verbraucherzentrale.de/proteine'])
    expect(out[0]).toMatchObject({ tier: 1, provider: 'curated', publisher: 'Deutsche Gesellschaft für Ernährung (DGE)' })
    expect(out[1]!.publisher).toBe('Verbraucherzentrale')
  })
  it('returns [] for a field without registry entry', async () => {
    const search = vi.fn<SearchClient['search']>(async () => results)
    expect(await createCuratedProvider({ search }).find(q('unknown'))).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })
})
