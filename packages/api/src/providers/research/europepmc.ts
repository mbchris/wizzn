import { SOURCE_REGISTRY } from '../../pipeline/source-registry.js'
import { EXCERPT_MAX, RESEARCH_TIMEOUT_MS, type ResearchCandidate, type ResearchProvider } from './types.js'

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const PAGE_SIZE = 8
const MAX_AGE_YEARS = 10
/** ~1 000 citations saturate the ranking hint */
const CITATION_SCALE = 3

interface EpmcResult {
  id?: string
  source?: string
  title?: string
  abstractText?: string
  citedByCount?: number
  journalInfo?: { journal?: { title?: string } }
}

export interface EuropePmcOptions {
  fetchFn?: typeof fetch
  now?: () => Date
  log?: (msg: string) => void
}

/** Tier 3: systematic reviews and meta-analyses (English abstracts) for fields with a scientific base. */
export function createEuropePmcProvider({ fetchFn = fetch, now = () => new Date(), log = console.warn }: EuropePmcOptions = {}): ResearchProvider {
  return {
    name: 'europepmc',
    tier: 3,
    async find({ brief, en }) {
      if (!SOURCE_REGISTRY[brief.fieldSlug]?.scholarly) return []
      const year = now().getUTCFullYear()
      const query = [
        `(${en})`,
        '(PUB_TYPE:"review" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis")',
        'HAS_ABSTRACT:y',
        `PUB_YEAR:[${year - MAX_AGE_YEARS} TO ${year}]`,
      ].join(' AND ')
      const params = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: String(PAGE_SIZE), sort: 'CITED desc' })
      try {
        const res = await fetchFn(`${API}?${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { resultList?: { result?: EpmcResult[] } }
        return (body.resultList?.result ?? []).flatMap((r) => toCandidate(r) ?? [])
      } catch (err) {
        log(`[research] europepmc: ${err instanceof Error ? err.message : String(err)}`)
        return []
      }
    },
  }
}

function toCandidate(r: EpmcResult): ResearchCandidate | null {
  const text = stripMarkup(r.abstractText ?? '')
  if (!r.id || !r.source || !r.title || !text) return null
  return {
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
    title: r.title,
    snippet: text.slice(0, 200),
    publisher: r.journalInfo?.journal?.title ?? 'Europe PMC',
    tier: 3,
    provider: 'europepmc',
    text: text.slice(0, EXCERPT_MAX),
    quality: Math.min(1, Math.log10((r.citedByCount ?? 0) + 1) / CITATION_SCALE),
  }
}

/** Section headings become separate words; inline tags (<sup>, <i>) vanish without a gap */
function stripMarkup(html: string): string {
  return html
    .replace(/<\/?h\d[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
