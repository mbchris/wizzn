import { registryHostFor, SOURCE_REGISTRY } from '../../pipeline/source-registry.js'
import type { SearchClient } from '../search.js'
import type { ResearchProvider } from './types.js'

/** Tier 1: SearXNG restricted to registry hosts. Results are post-filtered because not every engine honours `site:`. */
export function createCuratedProvider(search: Pick<SearchClient, 'search'>): ResearchProvider {
  return {
    name: 'curated',
    tier: 1,
    async find({ brief, de }) {
      const field = SOURCE_REGISTRY[brief.fieldSlug]
      if (!field) return []
      const sites = field.hosts.map((h) => `site:${h.host}`).join(' OR ')
      const results = await search.search(`(${sites}) ${de}`, 10)
      return results.flatMap((r) => {
        const host = registryHostFor(r.url, brief.fieldSlug)
        return host ? [{ url: r.url, title: r.title, snippet: r.snippet, publisher: host.publisher, tier: 1 as const, provider: 'curated' as const }] : []
      })
    },
  }
}
