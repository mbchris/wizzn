import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { audioUnitSchema, writtenUnitSchema } from '@wizzn/shared'
import { runStep, type PipelineDeps } from '../../src/pipeline/steps.js'
import { createPlaceholderImages } from '../../src/providers/image.js'
import { createSilentTts } from '../../src/providers/tts.js'
import type { ChatMessage, LlmClient } from '../../src/providers/llm.js'
import { FakeStore } from './fake-store.js'

const words = (n: number) => Array(n).fill('Geld').join(' ')

/** Answers by recognising which prompt it got. */
function scriptedLlm(overrides: { claims?: { text: string; sourceIndex: number | null }[] } = {}): LlmClient {
  return {
    model: 'fake',
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
      const prompt = messages.map((m) => m.content).join('\n')
      let answer: unknown
      if (prompt.includes('"picks"')) answer = { picks: [{ index: 0, publisher: 'Verbraucherzentrale' }, { index: 1, publisher: 'BaFin' }] }
      else if (prompt.includes('Sprechskript')) answer = { title: 'Budget mit System', script: words(500), images: [{ prompt: 'Sparschwein', atFraction: 0.1 }, { prompt: 'Kuchendiagramm', atFraction: 0.6 }] }
      else if (prompt.includes('3–5 Slides'))
        answer = { title: 'Die 50/30/20-Regel', slides: [{ title: 'A', body: 'eins', imagePrompt: 'Sparschwein' }, { title: 'B', body: 'zwei' }, { title: 'C', body: 'drei', imagePrompt: 'Waage' }] }
      else answer = { claims: overrides.claims ?? [{ text: '50 % für Fixkosten', sourceIndex: 0 }], issues: [] }
      return schema.parse(answer)
    },
  }
}

function deps(store: FakeStore, over: Partial<PipelineDeps> = {}): PipelineDeps & { queued: string[] } {
  const queued: string[] = []
  const stored: string[] = []
  return {
    queued,
    store,
    llm: scriptedLlm(),
    search: { search: async () => [{ url: 'https://vz.de/a', title: 'A', snippet: '' }, { url: 'https://bafin.de/b', title: 'B', snippet: '' }] },
    fetchPage: async () => ({ ok: true, status: 200, title: 'Seite', text: 'x'.repeat(300) }),
    tts: createSilentTts(100),
    images: createPlaceholderImages(),
    media: { put: async (p, _d, ext) => (stored.push(ext), `${p}/${stored.length}.${ext}`), publicUrl: (p) => `https://m/${p}` },
    enqueue: async (q, id) => void queued.push(`${q}:${id}`),
    transcode: async () => null,
    ...over,
  }
}

async function runAll(id: string, d: PipelineDeps) {
  for (const step of ['research', 'draft', 'check', 'media'] as const) await runStep(step, id, d)
}

describe('pipeline', () => {
  it('takes a written unit from queued to in_review with valid content', async () => {
    const store = new FakeStore()
    store.add('w1', 'written')
    const d = deps(store)
    await runAll('w1', d)
    const u = store.units.get('w1')!
    expect(u.status).toBe('in_review')
    const content = writtenUnitSchema.parse(u.contentJson)
    expect(content.slides.filter((s) => s.imageId)).toHaveLength(2)
    expect(content.sources.map((s) => s.publisher)).toEqual(['Verbraucherzentrale', 'BaFin'])
    expect(store.checks.get('w1')?.passed).toBe(true)
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

  it('ignores a duplicate job for a step that already ran', async () => {
    const store = new FakeStore()
    store.add('d1', 'written')
    const d = deps(store)
    await runStep('research', 'd1', d)
    await runStep('research', 'd1', d)
    expect(d.queued).toEqual(['unit.draft:d1'])
  })
})
