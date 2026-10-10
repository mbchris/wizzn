import type { SearchClient } from '../search.js'
import type { ResearchProvider } from './types.js'

/** Never useful as a knowledge source: shops, Q&A forums, social media */
const BLOCKED_HOSTS = ['amazon.', 'ebay.', 'reddit.', 'gutefrage.', 'facebook.', 'instagram.', 'tiktok.', 'youtube.', 'pinterest.', 'x.com', 'twitter.']
const WEB_LIMIT = 8

/** Tier 4: open-web fallback (previous research behaviour), only used when tiers 1–3 come up short. */
export function createWebProvider(search: Pick<SearchClient, 'search'>): ResearchProvider {
  return {
    name: 'web',
    tier: 4,
    async find({ de }) {
      const results = await search.search(de, WEB_LIMIT)
      return results.flatMap((r) => {
        const host = hostnameOf(r.url)
        if (!host || BLOCKED_HOSTS.some((b) => host.includes(b))) return []
        // Publisher is refined by the LLM pick; host is the honest default
        return [{ url: r.url, title: r.title, snippet: r.snippet, publisher: host, tier: 4 as const, provider: 'web' as const }]
      })
    },
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
