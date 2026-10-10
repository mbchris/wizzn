import { describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { researchSources, type ResearchDeps } from '../../src/pipeline/research.js'
import type { ChatMessage, LlmClient } from '../../src/providers/llm.js'
import type { ResearchCandidate, ResearchProvider } from '../../src/providers/research/types.js'
import type { BriefContext } from '../../src/pipeline/prompts.js'
import type { SourceTier } from '@wizzn/shared'

const brief: BriefContext = { fieldSlug: 'nutrition', fieldName: 'Gesunde Ernährung', themeName: 'Protein', topic: 'Wie viel Protein?', context: '', adviceDisclaimer: true }
const long = 'x'.repeat(400)

const cand = (url: string, tier: SourceTier, extra: Partial<ResearchCandidate> = {}): ResearchCandidate => ({
  url, title: url, snippet: '', publisher: `pub ${url}`, tier,
  provider: tier === 1 ? 'curated' : tier === 2 ? 'wikipedia' : tier === 3 ? 'europepmc' : 'web', ...extra,
})
const provider = (tier: SourceTier, out: ResearchCandidate[] | (() => Promise<ResearchCandidate[]>)): ResearchProvider & { find: ReturnType<typeof vi.fn> } => ({
  name: cand('u', tier).provider, tier,
  find: vi.fn(async () => (typeof out === 'function' ? out() : out)),
})

/** Picks the first n listed candidates; records prompts */
function llm(n = 2, plan: unknown = { de: 'Proteinbedarf Erwachsene', en: 'protein requirement adults' }) {
  const prompts: string[] = []
  const client: LlmClient = {
    model: 'fake',
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
      const p = messages.map((m) => m.content).join('\n')
      prompts.push(p)
      if (p.includes('Suchanfragen')) {
        if (plan instanceof Error) throw plan
        return schema.parse(plan)
      }
      return schema.parse({ picks: Array.from({ length: n }, (_, index) => ({ index, publisher: `LLM ${index}` })) })
    },
  }
  return { client, prompts }
}

const fetchPage = vi.fn(async (url: string) => ({ ok: true, status: 200, title: `T ${url}`, text: url.includes('short') ? 'kurz' : long }))
const deps = (research: ResearchProvider[], l = llm(), over: Partial<ResearchDeps> = {}): ResearchDeps => ({
  research, llm: l.client, fetchPage, minSources: 2, log: () => {}, timeoutMs: 50, ...over,
})

describe('researchSources', () => {
  it('passes the query plan to providers and lists candidates by tier then quality, deduped, with tier labels', async () => {
    const l = llm(3)
    const p1 = provider(1, [cand('https://dge.de/a', 1)])
    const p2 = provider(2, [cand('https://de.wikipedia.org/w', 2, { quality: 0.5, text: long }), cand('https://de.wikipedia.org/x', 2, { quality: 1, text: long })])
    const p3 = provider(3, [cand('https://dge.de/a', 3)])
    const out = await researchSources(brief, deps([p3, p2, p1], l))
    expect(p1.find).toHaveBeenCalledWith({ brief, de: 'Proteinbedarf Erwachsene', en: 'protein requirement adults' })
    const pick = l.prompts.find((p) => p.includes('"picks"'))!
    expect(pick.indexOf('[0] (Stufe 1)')).toBeGreaterThan(-1)
    expect(pick.indexOf('https://de.wikipedia.org/x')).toBeLessThan(pick.indexOf('https://de.wikipedia.org/w'))
    expect(pick.match(/\(Stufe \d\) pub https:\/\/dge\.de\/a/g)).toHaveLength(1)
    expect(out.map((s) => [s.url, s.tier, s.provider])).toEqual([
      ['https://dge.de/a', 1, 'curated'],
      ['https://de.wikipedia.org/x', 2, 'wikipedia'],
      ['https://de.wikipedia.org/w', 2, 'wikipedia'],
    ])
  })

  it('uses provider text without fetching and the provider publisher for tiers 1–3', async () => {
    fetchPage.mockClear()
    const out = await researchSources(brief, deps([provider(2, [cand('https://de.wikipedia.org/a', 2, { text: long }), cand('https://de.wikipedia.org/b', 2, { text: long })])]))
    expect(fetchPage).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ publisher: 'pub https://de.wikipedia.org/a', excerpt: long })
  })

  it('does not query the web when tiers 1–3 give enough usable sources', async () => {
    const web = provider(4, [cand('https://blog.de/a', 4)])
    await researchSources(brief, deps([provider(1, [cand('https://dge.de/a', 1), cand('https://bzfe.de/b', 1)]), web]))
    expect(web.find).not.toHaveBeenCalled()
  })

  it('falls back to the web below the threshold and stores tier 4 with the LLM publisher', async () => {
    const web = provider(4, [cand('https://blog.de/a', 4)])
    const out = await researchSources(brief, deps([provider(1, [cand('https://dge.de/short', 1)]), web]))
    expect(web.find).toHaveBeenCalled()
    expect(out.map((s) => [s.url, s.tier, s.publisher])).toEqual([['https://blog.de/a', 4, 'LLM 1']])
  })

  it('ignores failing and hanging providers', async () => {
    const out = await researchSources(
      brief,
      deps([provider(1, () => Promise.reject(new Error('boom'))), provider(2, () => new Promise(() => {})), provider(4, [cand('https://a.de/1', 4), cand('https://a.de/2', 4)])]),
    )
    expect(out).toHaveLength(2)
  })

  it('falls back to the brief as query when the plan fails', async () => {
    const p = provider(1, [cand('https://dge.de/a', 1), cand('https://dge.de/b', 1)])
    await researchSources(brief, deps([p], llm(2, new Error('llm down'))))
    expect(p.find).toHaveBeenCalledWith({ brief, de: 'Wie viel Protein? Protein Gesunde Ernährung', en: 'Wie viel Protein? Protein Gesunde Ernährung' })
  })

  it('throws when nothing usable remains', async () => {
    await expect(researchSources(brief, deps([provider(1, [cand('https://dge.de/short', 1)])]))).rejects.toThrow('No usable sources (all picks unreachable or empty)')
    await expect(researchSources(brief, deps([provider(1, [])]))).rejects.toThrow('No usable sources')
  })
})
