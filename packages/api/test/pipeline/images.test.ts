import { describe, expect, it, vi } from 'vitest'
import { resolveImage, type ImageDeps } from '../../src/pipeline/images.js'
import type { StockCandidate, StockImageClient } from '../../src/providers/stock-images/types.js'
import type { ChatMessage, LlmClient } from '../../src/providers/llm.js'
import type { MediaStore } from '../../src/providers/media-store.js'

function cand(id: string, over: Partial<StockCandidate> = {}): StockCandidate {
  return {
    provider: 'openverse',
    providerId: id,
    title: `Bild ${id}`,
    tags: ['tag'],
    imageUrl: `https://img.test/${id}.jpg`,
    width: 1200,
    height: 900,
    mime: 'image/jpeg',
    credit: {
      title: `Bild ${id}`,
      creator: 'Anna',
      creatorUrl: null,
      license: 'by',
      licenseVersion: '4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: `https://src.test/${id}`,
      provider: 'openverse',
      providerId: id,
    },
    ...over,
  }
}

function setup(opts: {
  candidates?: StockCandidate[]
  pick?: { index: number | null } | Error
  responses?: Record<string, () => Response>
  stockNull?: boolean
}) {
  const stored: { prefix: string; data: Buffer; ext: string }[] = []
  const media: MediaStore = {
    async put(prefix, data, ext) {
      stored.push({ prefix, data, ext })
      return `${prefix}/f${stored.length}.${ext}`
    },
    publicUrl: (p) => p,
  }
  const search = vi.fn(async (_q: string) => opts.candidates ?? [])
  const stock: StockImageClient = { name: 'chain', search }
  const prompts: ChatMessage[][] = []
  const chatJson = vi.fn(async (messages: ChatMessage[]) => {
    prompts.push(messages)
    if (opts.pick instanceof Error) throw opts.pick
    return (opts.pick ?? { index: 0 }) as never
  })
  const llm: LlmClient = { model: 'fake', chatJson: chatJson as LlmClient['chatJson'] }
  const generate = vi.fn(async () => ({ data: Buffer.from('<svg/>'), contentType: 'image/svg+xml' as const }))
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    const r = opts.responses?.[u]
    if (r) return r()
    return new Response(Buffer.from(`bytes:${u}`), { headers: { 'content-type': 'image/jpeg' } })
  })
  const deps: ImageDeps = {
    stock: opts.stockNull ? null : stock,
    images: { generate },
    media,
    llm,
    fetchFn: fetchFn as unknown as typeof fetch,
    minEdgePx: 800,
    maxBytes: 5_000_000,
  }
  return { deps, stored, search, chatJson, prompts, generate, fetchFn }
}

const slot = { prompt: 'Ein Apfel auf dem Tisch', query: 'apple table' }

describe('resolveImage', () => {
  it('stores the LLM-picked stock candidate and excludes its key', async () => {
    const cs = [cand('a'), cand('b')]
    const t = setup({ candidates: cs, pick: { index: 1 } })
    const exclude = new Set<string>()
    const r = await resolveImage('u1', slot, exclude, t.deps)
    expect(t.search).toHaveBeenCalledWith('apple table', expect.anything())
    expect(t.stored[0]!.data.toString()).toBe('bytes:https://img.test/b.jpg')
    expect(t.stored[0]!.ext).toBe('jpg')
    expect(r).toEqual({ path: 'u1/f1.jpg', origin: 'stock', credit: cs[1]!.credit, stockQuery: 'apple table', key: 'openverse:b' })
    expect(exclude.has('openverse:b')).toBe(true)
  })

  it('searches with the prompt when query is missing', async () => {
    const t = setup({ candidates: [cand('a')] })
    const r = await resolveImage('u1', { prompt: 'Ein Apfel' }, new Set(), t.deps)
    expect(t.search).toHaveBeenCalledWith('Ein Apfel', expect.anything())
    expect(r.stockQuery).toBe('Ein Apfel')
  })

  it('filters small, wrong-mime and excluded candidates before the pick', async () => {
    const cs = [cand('small', { width: 600, height: 2000 }), cand('gif', { mime: 'image/gif' }), cand('ex'), cand('ok'), cand('ok2', { mime: 'image/webp' })]
    const t = setup({ candidates: cs, pick: { index: 0 } })
    const r = await resolveImage('u1', slot, new Set(['openverse:ex']), t.deps)
    const user = t.prompts[0]!.find((m) => m.role === 'user')!.content
    expect(user.match(/^\[\d+\]/gm)).toHaveLength(2)
    expect(user).not.toContain('Bild small')
    expect(r.key).toBe('openverse:ok')
  })

  it('shows at most 8 candidates to the LLM', async () => {
    const t = setup({ candidates: Array.from({ length: 12 }, (_, i) => cand(`c${i}`)) })
    await resolveImage('u1', slot, new Set(), t.deps)
    const user = t.prompts[0]!.find((m) => m.role === 'user')!.content
    expect(user.match(/^\[\d+\]/gm)).toHaveLength(8)
  })

  it('falls back to generation when the LLM picks null', async () => {
    const t = setup({ candidates: [cand('a')], pick: { index: null } })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(t.generate).toHaveBeenCalledWith(slot.prompt)
    expect(r).toEqual({ path: 'u1/f1.svg', origin: 'generated', credit: null, stockQuery: null, key: null })
    expect(t.fetchFn).not.toHaveBeenCalled()
  })

  it('falls back to generation when the LLM throws', async () => {
    const t = setup({ candidates: [cand('a')], pick: new Error('boom') })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.origin).toBe('generated')
  })

  it('falls back to generation when stock search throws', async () => {
    const t = setup({ candidates: [] })
    t.search.mockRejectedValueOnce(new Error('down'))
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.origin).toBe('generated')
  })

  it('generates without searching when stock is null', async () => {
    const t = setup({ stockNull: true })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.origin).toBe('generated')
    expect(t.search).not.toHaveBeenCalled()
  })

  it('generates without searching when forceGenerated', async () => {
    const t = setup({ candidates: [cand('a')] })
    const r = await resolveImage('u1', slot, new Set(), t.deps, { forceGenerated: true })
    expect(r.origin).toBe('generated')
    expect(t.search).not.toHaveBeenCalled()
  })

  it('skipPick uses the first filtered candidate without the LLM', async () => {
    const t = setup({ candidates: [cand('small', { height: 500 }), cand('a'), cand('b')] })
    const r = await resolveImage('u1', slot, new Set(), t.deps, { skipPick: true })
    expect(t.chatJson).not.toHaveBeenCalled()
    expect(r.key).toBe('openverse:a')
  })

  it('skips a download that returns text/html', async () => {
    const t = setup({
      candidates: [cand('a'), cand('b')],
      responses: { 'https://img.test/a.jpg': () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }) },
    })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.key).toBe('openverse:b')
    expect(t.stored).toHaveLength(1)
  })

  it('skips a download whose declared content-length exceeds maxBytes', async () => {
    const t = setup({
      candidates: [cand('a'), cand('b')],
      responses: { 'https://img.test/a.jpg': () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': '6000000' } }) },
    })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.key).toBe('openverse:b')
  })

  it('skips a streamed download without content-length exceeding maxBytes', async () => {
    const chunk = new Uint8Array(1_000_000)
    const big = () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 6; i++) c.enqueue(chunk)
            c.close()
          },
        }),
        { headers: { 'content-type': 'image/jpeg' } },
      )
    const t = setup({ candidates: [cand('a'), cand('b')], responses: { 'https://img.test/a.jpg': big } })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.key).toBe('openverse:b')
    expect(t.stored).toHaveLength(1)
  })

  it('gives up after 3 failed downloads and generates', async () => {
    const fail = () => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } })
    const t = setup({
      candidates: [cand('a'), cand('b'), cand('c'), cand('d')],
      responses: { 'https://img.test/a.jpg': fail, 'https://img.test/b.jpg': fail, 'https://img.test/c.jpg': fail },
    })
    const r = await resolveImage('u1', slot, new Set(), t.deps)
    expect(r.origin).toBe('generated')
    expect(t.fetchFn).toHaveBeenCalledTimes(3)
    expect(t.fetchFn.mock.calls.map((c) => String(c[0]))).not.toContain('https://img.test/d.jpg')
  })

  it('gives a second slot a different image when both hit the same top result', async () => {
    const t = setup({ candidates: [cand('a'), cand('b')], pick: { index: 0 } })
    const exclude = new Set<string>()
    const r1 = await resolveImage('u1', slot, exclude, t.deps)
    const r2 = await resolveImage('u1', slot, exclude, t.deps)
    expect(r1.key).toBe('openverse:a')
    expect(r2.key).toBe('openverse:b')
  })
})
