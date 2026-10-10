import { EXCERPT_MAX, RESEARCH_TIMEOUT_MS, type ResearchCandidate, type ResearchProvider } from './types.js'

const API = 'https://de.wikipedia.org/w/api.php'
const SEARCH_LIMIT = 5
/** Full-text extracts are returned one page per request, so cap the content calls */
const MAX_ARTICLES = 3
const MIN_EXTRACT_CHARS = 1_500
const MAX_RETRY_AFTER_SEC = 10
const BADGES: Record<string, number> = { 'Kategorie:Wikipedia:Exzellent': 1, 'Kategorie:Wikipedia:Lesenswert': 0.8 }
const DEFAULT_QUALITY = 0.5

interface WikiPage {
  title?: string
  extract?: string
  fullurl?: string
  missing?: boolean
  pageprops?: { disambiguation?: string }
  categories?: { title: string }[]
}

export interface WikipediaOptions {
  userAgent: string
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

/** Tier 2: German Wikipedia via the Action API (no key; a compliant User-Agent lifts the rate limit). */
export function createWikipediaProvider({ userAgent, fetchFn = fetch, sleep = defaultSleep, log = console.warn }: WikipediaOptions): ResearchProvider {
  async function call(params: Record<string, string>): Promise<unknown> {
    const url = `${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchFn(url, { headers: { 'user-agent': userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS) })
      if (res.ok) return res.json()
      const retryAfter = Number(res.headers.get('retry-after'))
      if (res.status === 429 && attempt === 0 && retryAfter >= 0 && retryAfter <= MAX_RETRY_AFTER_SEC) {
        await sleep(retryAfter * 1000)
        continue
      }
      throw new Error(`HTTP ${res.status}`)
    }
    throw new Error('HTTP 429')
  }

  async function article(title: string): Promise<ResearchCandidate | null> {
    const body = (await call({
      prop: 'extracts|info|pageprops|categories',
      explaintext: '1',
      inprop: 'url',
      redirects: '1',
      clcategories: Object.keys(BADGES).join('|'),
      titles: title,
    })) as { query?: { pages?: WikiPage[] } }
    const page = body.query?.pages?.[0]
    if (!page || page.missing || page.pageprops?.disambiguation !== undefined) return null
    const extract = (page.extract ?? '').trim()
    if (extract.length < MIN_EXTRACT_CHARS || !page.fullurl) return null
    const quality = Math.max(DEFAULT_QUALITY, ...(page.categories ?? []).map((c) => BADGES[c.title] ?? 0))
    return {
      url: page.fullurl,
      title: page.title ?? title,
      snippet: extract.slice(0, 200),
      publisher: 'Wikipedia',
      tier: 2,
      provider: 'wikipedia',
      text: extract.slice(0, EXCERPT_MAX),
      quality,
    }
  }

  return {
    name: 'wikipedia',
    tier: 2,
    async find({ de }) {
      try {
        const body = (await call({ list: 'search', srsearch: de, srlimit: String(SEARCH_LIMIT), srnamespace: '0' })) as { query?: { search?: { title: string }[] } }
        const out: ResearchCandidate[] = []
        // Sequential: polite to the API, and disambiguation/stubs are skipped without spending the cap
        for (const { title } of body.query?.search ?? []) {
          if (out.length >= MAX_ARTICLES) break
          if (/\(Begriffsklärung\)$/.test(title)) continue
          const c = await article(title)
          if (c) out.push(c)
        }
        return out
      } catch (err) {
        log(`[research] wikipedia: ${err instanceof Error ? err.message : String(err)}`)
        return []
      }
    },
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
