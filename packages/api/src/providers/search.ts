export interface SearchResult {
  url: string
  title: string
  snippet: string
}

export interface SearchClient {
  search(query: string, limit?: number): Promise<SearchResult[]>
}

interface SearxResponse {
  results?: { url?: string; title?: string; content?: string }[]
}

export function createSearxngClient(baseUrl: string, fetchFn: typeof fetch = fetch): SearchClient {
  return {
    async search(query, limit = 8) {
      const url = `${baseUrl.replace(/\/$/, '')}/search?format=json&language=de&safesearch=1&q=${encodeURIComponent(query)}`
      const res = await fetchFn(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`Search HTTP ${res.status}`)
      const body = (await res.json()) as SearxResponse
      const seen = new Set<string>()
      const out: SearchResult[] = []
      for (const r of body.results ?? []) {
        if (!r.url || !r.title || seen.has(r.url) || !r.url.startsWith('https://')) continue
        seen.add(r.url)
        out.push({ url: r.url, title: r.title, snippet: r.content ?? '' })
        if (out.length >= limit) break
      }
      return out
    },
  }
}
