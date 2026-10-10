import { queryPlanSchema, sourcePickSchema } from '@wizzn/shared'
import type { PageFetcher } from '../providers/fetch-page.js'
import type { LlmClient } from '../providers/llm.js'
import { EXCERPT_MAX, RESEARCH_TIMEOUT_MS, type ResearchCandidate, type ResearchProvider, type ResearchQuery } from '../providers/research/types.js'
import { queryPlanPrompt, searchQuery, sourcePickPrompt, type BriefContext, type ResearchedSource } from './prompts.js'

const MAX_CANDIDATES = 12
const MIN_EXCERPT_CHARS = 200
const WEB_TIER = 4

export interface ResearchDeps {
  research: ResearchProvider[]
  llm: LlmClient
  fetchPage: PageFetcher
  /** Fewer usable sources from tiers 1–3 → open-web fallback */
  minSources: number
  log?: (msg: string) => void
  /** Per-provider guard on top of the providers' own HTTP timeouts */
  timeoutMs?: number
}

/** Issue #4: reputable tiers first, open web only as a fallback. Throws when nothing usable is found. */
export async function researchSources(brief: BriefContext, deps: ResearchDeps): Promise<ResearchedSource[]> {
  const log = deps.log ?? ((m: string) => console.warn(m))
  const query = { brief, ...(await planQuery(brief, deps.llm, log)) }
  const primary = deps.research.filter((p) => p.tier < WEB_TIER)
  const web = deps.research.filter((p) => p.tier === WEB_TIER)

  const candidates = await gather(primary, query, deps, log)
  let sources = candidates.length ? await pickAndLoad(brief, candidates, deps) : []
  if (sources.length < deps.minSources && web.length) {
    const webCandidates = await gather(web, query, deps, log)
    if (webCandidates.length) {
      const merged = await pickAndLoad(brief, [...candidates, ...webCandidates], deps)
      if (merged.length > sources.length) sources = merged
    }
  }
  if (sources.length === 0) throw new Error('No usable sources (all picks unreachable or empty)')
  return sources
}

async function planQuery(brief: BriefContext, llm: LlmClient, log: (m: string) => void): Promise<Pick<ResearchQuery, 'de' | 'en'>> {
  try {
    return await llm.chatJson(queryPlanPrompt(brief), queryPlanSchema)
  } catch (err) {
    log(`[research] query plan failed, using brief: ${err instanceof Error ? err.message : String(err)}`)
    const fallback = searchQuery(brief)
    return { de: fallback, en: fallback }
  }
}

async function gather(providers: ResearchProvider[], query: ResearchQuery, deps: ResearchDeps, log: (m: string) => void): Promise<ResearchCandidate[]> {
  const lists = await Promise.all(
    providers.map((p) =>
      withTimeout(p.find(query), deps.timeoutMs ?? RESEARCH_TIMEOUT_MS * 2).catch((err: unknown) => {
        log(`[research] ${p.name}: ${err instanceof Error ? err.message : String(err)}`)
        return [] as ResearchCandidate[]
      }),
    ),
  )
  return rank(lists.flat())
}

/** Tier asc, then quality desc; first occurrence of a URL wins (lowest tier) */
function rank(candidates: ResearchCandidate[]): ResearchCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.tier - b.tier || (b.quality ?? 0) - (a.quality ?? 0))
  const seen = new Set<string>()
  return sorted.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, MAX_CANDIDATES)
}

async function pickAndLoad(brief: BriefContext, candidates: ResearchCandidate[], deps: ResearchDeps): Promise<ResearchedSource[]> {
  const pool = rank(candidates)
  const { picks } = await deps.llm.chatJson(sourcePickPrompt(brief, pool), sourcePickSchema)
  const sources: ResearchedSource[] = []
  const used = new Set<string>()
  for (const pick of picks) {
    const c = pool[pick.index]
    if (!c || used.has(c.url)) continue
    used.add(c.url)
    const loaded = await loadText(c, deps.fetchPage)
    if (!loaded || loaded.text.length < MIN_EXCERPT_CHARS) continue
    sources.push({
      url: c.url,
      title: loaded.title || c.title,
      // Tiers 1–3 carry a verified publisher (registry, Wikipedia, journal); only web needs the LLM's guess
      publisher: c.tier === WEB_TIER ? pick.publisher : c.publisher,
      excerpt: loaded.text.slice(0, EXCERPT_MAX),
      tier: c.tier,
      provider: c.provider,
    })
  }
  return sources
}

async function loadText(c: ResearchCandidate, fetchPage: PageFetcher): Promise<{ title: string; text: string } | null> {
  if (c.text) return { title: c.title, text: c.text }
  const page = await fetchPage(c.url)
  return page.ok ? { title: page.title, text: page.text } : null
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms)
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e)),
    )
  })
}
