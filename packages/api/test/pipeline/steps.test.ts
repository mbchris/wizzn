import { describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { audioUnitSchema, writtenUnitSchema } from '@wizzn/shared'
import { runStep, type PipelineDeps } from '../../src/pipeline/steps.js'
import { PROMPT_VERSION, draftAudioPrompt, draftWrittenPrompt, pickEditorial } from '../../src/pipeline/prompts.js'
import type { StockCandidate, StockImageClient } from '../../src/providers/stock-images/types.js'
import { createPlaceholderImages } from '../../src/providers/image.js'
import { createSilentTts } from '../../src/providers/tts.js'
import { createWebProvider } from '../../src/providers/research/web.js'
import type { ChatMessage, LlmClient } from '../../src/providers/llm.js'
import { FakeStore } from './fake-store.js'

const words = (n: number) => Array(n).fill('Geld').join(' ')

/** Issue #4 long form: 5 × 90 words + 30-word hook; images on the first two slides */
const longSlides = [1, 2, 3, 4, 5].map((n) => ({ title: `S${n}`, body: words(90), ...(n <= 2 ? { imagePrompt: `Motiv ${n + 1}`, imageQuery: `query ${n + 1}` } : {}) }))
const cover = { imagePrompt: 'Motiv 1', imageQuery: 'query 1' }

/** Answers by recognising which prompt it got. */
function scriptedLlm(overrides: { claims?: { text: string; sourceIndex: number | null }[]; slides?: unknown[] } = {}): LlmClient & { prompts: string[] } {
  const prompts: string[] = []
  return {
    model: 'fake',
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
      const prompt = messages.map((m) => m.content).join('\n')
      prompts.push(prompt)
      let answer: unknown
      if (prompt.includes('Gesuchtes Motiv')) answer = { index: 0 }
      else if (prompt.includes('Suchanfragen')) answer = { de: 'Budget 50 30 20', en: 'budget rule' }
      else if (prompt.includes('"picks"')) answer = { picks: [{ index: 0, publisher: 'Verbraucherzentrale' }, { index: 1, publisher: 'BaFin' }] }
      else if (prompt.includes('Sprechskript')) answer = { title: 'Budget mit System', script: words(500), images: [{ prompt: 'Sparschwein', atFraction: 0.1 }, { prompt: 'Kuchendiagramm', atFraction: 0.6 }] }
      else if (prompt.includes('"hook"')) answer = { title: 'Die 50/30/20-Regel', hook: words(30), cover, slides: overrides.slides ?? longSlides }
      else answer = { claims: overrides.claims ?? [{ text: '50 % für Fixkosten', sourceIndex: 0 }], issues: [] }
      return schema.parse(answer)
    },
    prompts,
  }
}

function deps(store: FakeStore, over: Partial<PipelineDeps> = {}): PipelineDeps & { queued: string[] } {
  const queued: string[] = []
  const stored: string[] = []
  return {
    queued,
    store,
    llm: scriptedLlm(),
    // Only the web tier answers here → exercises the fallback path; tiers are covered in research.test.ts
    research: [createWebProvider({ search: async () => [{ url: 'https://vz.de/a', title: 'A', snippet: '' }, { url: 'https://bafin.de/b', title: 'B', snippet: '' }] })],
    researchMinSources: 2,
    fetchPage: async () => ({ ok: true, status: 200, title: 'Seite', text: 'x'.repeat(300) }),
    tts: createSilentTts(100),
    images: createPlaceholderImages(),
    media: { put: async (p, _d, ext) => (stored.push(ext), `${p}/${stored.length}.${ext}`), publicUrl: (p) => `https://m/${p}` },
    enqueue: async (q, id) => void queued.push(`${q}:${id}`),
    transcode: async () => null,
    stock: null,
    stockConfig: { minEdgePx: 800, maxBytes: 5_000_000 },
    ...over,
  }
}

async function runAll(id: string, d: PipelineDeps) {
  for (const step of ['research', 'draft', 'check', 'media'] as const) await runStep(step, id, d)
}

function cand(id: string): StockCandidate {
  return {
    provider: 'openverse',
    providerId: id,
    title: `Bild ${id}`,
    tags: [],
    imageUrl: `https://img.test/${id}.jpg`,
    width: 1200,
    height: 900,
    mime: 'image/jpeg',
    credit: { title: `Bild ${id}`, creator: 'Anna', creatorUrl: null, license: 'by', licenseVersion: '4.0', licenseUrl: 'https://cc/by/4.0', sourceUrl: `https://src/${id}`, provider: 'openverse', providerId: id },
  }
}

const stockDeps = (search: StockImageClient['search']): Partial<PipelineDeps> => ({
  stock: { name: 'fake', search },
  stockConfig: { minEdgePx: 800, maxBytes: 5_000_000 },
  fetchFn: (async (url: string | URL | Request) => new Response(Buffer.from(`b:${String(url)}`), { headers: { 'content-type': 'image/jpeg' } })) as typeof fetch,
})


describe('media step stock images', () => {
  it('uses distinct stock images for slides that hit the same top result', async () => {
    const store = new FakeStore()
    store.add('s1', 'written')
    // cover + 2 slide images = 3 slots
    const d = deps(store, { ...stockDeps(async () => [cand('top'), cand('x'), cand('y')]) })
    await runAll('s1', d)
    const assets = store.assets.get('s1')!
    expect(assets).toHaveLength(3)
    expect(assets.every((a) => a.origin === 'stock')).toBe(true)
    expect(new Set(assets.map((a) => a.credit?.providerId)).size).toBe(3)
    expect(assets.map((a) => a.stockQuery)).toEqual(['query 1', 'query 2', 'query 3'])
    expect(assets.map((a) => a.prompt)).toEqual(['Motiv 1', 'Motiv 2', 'Motiv 3'])
    const content = writtenUnitSchema.parse(store.units.get('s1')!.contentJson)
    expect(content.cover).toEqual({ hook: words(30), imageId: assets[0]!.id })
    expect(content.slides.flatMap((s) => (s.imageId ? [s.imageId] : []))).toEqual(assets.slice(1).map((a) => a.id))
  })

  it('generates images for an audio unit when stock is disabled and keeps the audio asset', async () => {
    const store = new FakeStore()
    store.add('a2', 'audio')
    await runAll('a2', deps(store))
    const assets = store.assets.get('a2')!
    expect(assets[0]).toMatchObject({ kind: 'audio' })
    const imgs = assets.slice(1)
    expect(imgs).toHaveLength(2)
    expect(imgs.every((a) => a.origin === 'generated' && !a.credit)).toBe(true)
  })

  it('falls back to a generated image when one stock search throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new FakeStore()
    store.add('s2', 'written')
    const d = deps(store, {
      ...stockDeps(async (q) => {
        if (q === 'query 2') throw new Error('boom')
        return [cand(q.replace(' ', '-'))]
      }),
    })
    await runAll('s2', d)
    expect(store.units.get('s2')!.status).toBe('in_review')
    expect(store.assets.get('s2')!.map((a) => a.origin)).toEqual(['stock', 'generated', 'stock'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('query 2'))
    warn.mockRestore()
  })
})

describe('draft prompts', () => {
  it('asks for imageQuery and has the new prompt version', () => {
    const text = draftWrittenPrompt({ topic: 'Geld', format: 'written' } as never, []).map((m) => m.content).join('\n')
    expect(text).toContain('imageQuery')
    expect(text).toContain('420–600 Wörter')
    expect(text).toContain('keine Sätze wörtlich')
    expect(PROMPT_VERSION).toBe('2026-10-12.2')
  })

  it('always demands the five-part structure in the chosen style and arc', () => {
    const e = { style: 'friendly', arc: 'quest' } as const
    for (const prompt of [draftWrittenPrompt, draftAudioPrompt]) {
      const text = prompt({ topic: 'Steuern' } as never, [], e).map((m) => m.content).join('\n')
      for (const part of ['1. These', '2. Problem oder Chance', '3. Lösung', '4. Was heißt das für mich?', '5. Fazit']) expect(text).toContain(part)
      expect(text).toContain('Freundlich-humorvoll')
      expect(text).toContain('Die Suche')
      expect(text).not.toContain('Sachlich-faktenbasiert')
    }
  })

  it('keeps the editor choice and picks the rest at random', () => {
    expect(pickEditorial({ style: 'factual', arc: 'comedy' }, () => 0.99)).toEqual({ style: 'factual', arc: 'comedy' })
    expect(pickEditorial({}, () => 0)).toEqual({ style: 'friendly', arc: 'rags_to_riches' })
    expect(pickEditorial({ style: 'narrative' }, () => 0.999)).toEqual({ style: 'narrative', arc: 'rebirth' })
  })
})

describe('pipeline', () => {
  it('takes a written unit from queued to in_review with valid content', async () => {
    const store = new FakeStore()
    store.add('w1', 'written')
    const d = deps(store)
    await runAll('w1', d)
    const u = store.units.get('w1')!
    expect(u.status).toBe('in_review')
    const content = writtenUnitSchema.parse(u.contentJson)
    expect(content.slides).toHaveLength(5)
    expect(content.slides.filter((s) => s.imageId)).toHaveLength(2)
    expect(content.cover?.hook).toBe(words(30))
    expect(content.sources.map((s) => s.publisher)).toEqual(['Verbraucherzentrale', 'BaFin'])
    expect(store.sources.get('w1')!.map((s) => [s.tier, s.provider])).toEqual([[4, 'web'], [4, 'web']])
    expect(store.checks.get('w1')).toMatchObject({ passed: true, trust: 'low', maxVerbatimRun: 0 })
    expect(d.queued).toEqual(['unit.draft:w1', 'unit.check:w1', 'unit.media:w1'])
  })

  it('builds an audio unit with timed images inside the duration', async () => {
    const store = new FakeStore()
    store.add('a1', 'audio')
    await runAll('a1', deps(store))
    const content = audioUnitSchema.parse(store.units.get('a1')!.contentJson)
    expect(content.durationSec).toBeGreaterThanOrEqual(180)
    expect(content.images.map((i) => i.showAtSec)).toEqual([Math.floor(0.1 * content.durationSec), Math.floor(0.6 * content.durationSec)])
    expect(store.assets.get('a1')?.[0]?.kind).toBe('audio')
  })

  it('marks the unit failed when no source is reachable', async () => {
    const store = new FakeStore()
    store.add('f1', 'written')
    const d = deps(store, { fetchPage: async () => ({ ok: false, status: 404, title: '', text: '' }) })
    await runStep('research', 'f1', d)
    expect(store.units.get('f1')!.status).toBe('failed')
    expect(store.units.get('f1')!.failureReason).toMatch(/No usable sources/)
    expect(d.queued).toEqual([])
  })

  it('flags unsupported claims but still sends the unit to review', async () => {
    const store = new FakeStore()
    store.add('c1', 'written')
    await runAll('c1', deps(store, { llm: scriptedLlm({ claims: [{ text: 'erfunden', sourceIndex: null }] }) }))
    expect(store.checks.get('c1')).toMatchObject({ passed: false, unsupportedClaims: 1 })
    expect(store.units.get('c1')!.status).toBe('in_review')
  })

  it('fails the check when the draft copies a source verbatim', async () => {
    const store = new FakeStore()
    store.add('v1', 'written')
    await runAll('v1', deps(store, { fetchPage: async () => ({ ok: true, status: 200, title: 'Seite', text: words(300) }) }))
    const report = store.checks.get('v1')!
    expect(report.passed).toBe(false)
    expect(report.maxVerbatimRun).toBeGreaterThanOrEqual(12)
    expect(report.issues.some((i) => i.message.startsWith('Wörtliche Übernahme'))).toBe(true)
  })

  it('puts the hook into the text the fact checker sees', async () => {
    const store = new FakeStore()
    store.add('h1', 'written')
    const llm = scriptedLlm({ claims: [] })
    await runAll('h1', deps(store, { llm }))
    const check = llm.prompts.find((p) => p.includes('Faktenprüfer') || p.includes('Tatsachenbehauptung'))!
    expect(check).toContain(`Die 50/30/20-Regel\n\n${words(30)}`)
  })

  it('researches a written/audio pair only once and shares the sources', async () => {
    const store = new FakeStore()
    store.add('pw', 'written')
    store.add('pa', 'audio')
    store.pairs.set('pw', 'p1').set('pa', 'p1')
    let searches = 0
    const d = deps(store, { research: [createWebProvider({ search: async () => (searches++, [{ url: 'https://vz.de/a', title: 'A', snippet: '' }, { url: 'https://bafin.de/b', title: 'B', snippet: '' }]) })] })
    await runStep('research', 'pw', d)
    await runStep('research', 'pa', d)
    expect(searches).toBe(1)
    expect(store.sources.get('pa')).toEqual(store.sources.get('pw'))
    expect(store.sources.get('pa')?.length).toBeGreaterThan(0)
    expect(d.queued).toEqual(['unit.draft:pw', 'unit.draft:pa'])
  })

  it('ignores a duplicate job for a step that already ran', async () => {
    const store = new FakeStore()
    store.add('d1', 'written')
    const d = deps(store)
    await runStep('research', 'd1', d)
    await runStep('research', 'd1', d)
    expect(d.queued).toEqual(['unit.draft:d1'])
  })
})
