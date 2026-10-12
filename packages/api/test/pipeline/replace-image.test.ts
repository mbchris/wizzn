import { describe, expect, it, vi } from 'vitest'
import type { ImageCredit, UnitStatus } from '@wizzn/shared'
import type { ImageDeps } from '../../src/pipeline/images.js'
import { createStockChain } from '../../src/providers/stock-images/chain.js'
import { createImageReplacer, type AudioDeps } from '../../src/pipeline/replace-image.js'
import type { StockCandidate } from '../../src/providers/stock-images/types.js'
import { FakeStore } from './fake-store.js'

function credit(id: string): ImageCredit {
  return {
    title: `Bild ${id}`, creator: 'Anna', creatorUrl: null, license: 'by', licenseVersion: '4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: `https://src.test/${id}`, provider: 'openverse', providerId: id,
  }
}
function cand(id: string): StockCandidate {
  return { provider: 'openverse', providerId: id, title: `Bild ${id}`, tags: [], imageUrl: `https://img.test/${id}.jpg`, width: 1200, height: 900, mime: 'image/jpeg', credit: credit(id) }
}

function setup(candidates: StockCandidate[] = [], status: UnitStatus = 'in_review', stock?: ImageDeps['stock']) {
  const store = new FakeStore()
  store.add('u1', 'written', status)
  store.add('u2', 'written', 'in_review')
  void store.replaceAssets('u1', [
    { kind: 'image', path: 'u1/a.jpg', origin: 'stock', credit: credit('a'), stockQuery: 'Sparschwein', prompt: 'ein Sparschwein' },
    { kind: 'image', path: 'u1/b.jpg', origin: 'stock', credit: credit('b'), stockQuery: 'Geld', prompt: 'Geldscheine' },
    { kind: 'audio', path: 'u1/c.mp3' },
    { kind: 'image', path: 'u1/d.png', origin: 'generated', credit: null, stockQuery: null, prompt: null },
  ])
  void store.replaceAssets('u2', [{ kind: 'image', path: 'u2/x.jpg', origin: 'generated', credit: null, stockQuery: null, prompt: 'x' }])
  store.assets.get('u1')![0]!.rejectedStockIds = ['openverse:old']
  const search = vi.fn(async (_q: string) => candidates)
  const generate = vi.fn(async (_p: string) => ({ data: Buffer.from('<svg/>'), contentType: 'image/svg+xml' as const }))
  const chatJson = vi.fn(async () => ({ index: 0 }) as never)
  let n = 0
  const image: ImageDeps = {
    stock: stock ?? { name: 'chain', search },
    images: { generate },
    media: { put: async (prefix, _d, ext) => `${prefix}/new${++n}.${ext}`, delete: async () => {}, publicUrl: (p) => p },
    llm: { model: 'fake', chatJson },
    fetchFn: (async (u: string) => new Response(Buffer.from(String(u)), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch,
    minEdgePx: 800,
    maxBytes: 5_000_000,
  }
  const replacer = createImageReplacer({ store, image, mediaUrl: (p) => `https://media/${p}` })
  return { store, replacer, search, generate, chatJson }
}

describe('createImageReplacer', () => {
  it('requires the unit to be in_review or published', async () => {
    expect(await setup([cand('n')], 'rejected').replacer.replace('u1', 'u1-asset-0', 'next-stock')).toEqual({ ok: false, error: 'invalid_state' })
    expect(await setup([cand('n')], 'drafting').replacer.replace('u1', 'u1-asset-0', 'generated')).toEqual({ ok: false, error: 'invalid_state' })
    expect(await setup([cand('n')], 'published').replacer.replace('u1', 'u1-asset-0', 'next-stock')).toMatchObject({ ok: true })
    expect(await setup([cand('n')], 'locked').replacer.replace('u1', 'u1-asset-0', 'next-stock')).toMatchObject({ ok: true })
  })
  it('returns not_found for assets of another unit, audio assets and unknown ids', async () => {
    const { replacer } = setup([cand('n')])
    expect(await replacer.replace('u1', 'u2-asset-0', 'generated')).toEqual({ ok: false, error: 'not_found' })
    expect(await replacer.replace('u1', 'u1-asset-2', 'generated')).toEqual({ ok: false, error: 'not_found' })
    expect(await replacer.replace('u1', 'nope', 'generated')).toEqual({ ok: false, error: 'not_found' })
    expect(await replacer.replace('nope', 'u1-asset-0', 'generated')).toEqual({ ok: false, error: 'not_found' })
  })
  it('next-stock excludes unit keys, rejected and current key, skips the pick and records the old key', async () => {
    const { replacer, store, search, chatJson } = setup([cand('a'), cand('b'), cand('old'), cand('n')])
    const res = await replacer.replace('u1', 'u1-asset-0', 'next-stock')
    expect(search).toHaveBeenCalledWith('Sparschwein', expect.objectContaining({ accept: expect.any(Function) }))
    expect(chatJson).not.toHaveBeenCalled()
    expect(res).toEqual({
      ok: true,
      asset: { id: 'u1-asset-0', kind: 'image', url: 'https://media/u1/new1.jpg', durationSec: null, origin: 'stock', credit: credit('n'), stockQuery: 'Sparschwein', prompt: 'ein Sparschwein', generator: null },
    })
    const a = store.assets.get('u1')![0]!
    expect(a).toMatchObject({ id: 'u1-asset-0', path: 'u1/new1.jpg', origin: 'stock', credit: credit('n') })
    expect(a.rejectedStockIds).toEqual(['openverse:old', 'openverse:a'])
  })
  it('next-stock queries with the slot prompt when the asset has no stockQuery', async () => {
    const { replacer, store, search } = setup([cand('n')])
    store.assets.get('u1')![1]!.stockQuery = null
    await replacer.replace('u1', 'u1-asset-1', 'next-stock')
    expect(search).toHaveBeenCalledWith('Geldscheine', expect.anything())
  })
  it('next-stock with only excluded candidates → no_stock_candidate, nothing generated or stored', async () => {
    const { replacer, store, generate } = setup([cand('a'), cand('b'), cand('old')])
    const before = structuredClone(store.assets.get('u1'))
    expect(await replacer.replace('u1', 'u1-asset-0', 'next-stock')).toEqual({ ok: false, error: 'no_stock_candidate' })
    expect(generate).not.toHaveBeenCalled()
    expect(store.assets.get('u1')).toEqual(before)
  })
  it('generated uses the asset prompt and clears the credit', async () => {
    const { replacer, store, generate } = setup()
    const res = await replacer.replace('u1', 'u1-asset-1', 'generated')
    expect(generate).toHaveBeenCalledWith('Geldscheine', { field: expect.anything() })
    expect(res).toMatchObject({ ok: true, asset: { id: 'u1-asset-1', origin: 'generated', credit: null, stockQuery: null } })
    expect(store.assets.get('u1')![1]).toMatchObject({ origin: 'generated', credit: null, path: 'u1/new1.svg' })
  })
  it('generated without prompt falls back to credit title, then stockQuery, else not_found', async () => {
    const { replacer, store, generate } = setup()
    store.assets.get('u1')![1]!.prompt = undefined
    await replacer.replace('u1', 'u1-asset-1', 'generated')
    expect(generate).toHaveBeenLastCalledWith('Bild b', expect.anything())
    const a = store.assets.get('u1')![0]!
    a.prompt = null
    a.credit = null
    await replacer.replace('u1', 'u1-asset-0', 'generated')
    expect(generate).toHaveBeenLastCalledWith('Sparschwein', expect.anything())
    expect(await replacer.replace('u1', 'u1-asset-3', 'generated')).toEqual({ ok: false, error: 'not_found' })
  })
  it('next-stock matches openverse/<source> credits against openverse candidates', async () => {
    const { replacer, store } = setup([cand('a'), cand('b'), cand('old'), cand('n')])
    for (const a of store.assets.get('u1')!) if (a.credit) a.credit = { ...a.credit, provider: 'openverse/flickr' }
    const res = await replacer.replace('u1', 'u1-asset-0', 'next-stock')
    expect(res).toMatchObject({ ok: true, asset: { credit: { providerId: 'n' } } })
    expect(store.assets.get('u1')![0]!.rejectedStockIds).toEqual(['openverse:old', 'openverse:a'])
  })
  it('next-stock falls through the chain when all first-provider results are excluded', async () => {
    const commons = { ...cand('c1'), provider: 'commons' as const, credit: { ...credit('c1'), provider: 'commons' } }
    const first = vi.fn(async () => [cand('a'), cand('b'), cand('old')])
    const second = vi.fn(async () => [commons])
    const chain = createStockChain([{ name: 'openverse', search: first }, { name: 'commons', search: second }])
    const { replacer } = setup([], 'in_review', chain)
    const res = await replacer.replace('u1', 'u1-asset-0', 'next-stock')
    expect(second).toHaveBeenCalled()
    expect(res).toMatchObject({ ok: true, asset: { credit: { providerId: 'c1', provider: 'commons' } } })
  })
  it('generated records the outgoing stock key as rejected', async () => {
    const { replacer, store } = setup()
    await replacer.replace('u1', 'u1-asset-0', 'generated')
    expect(store.assets.get('u1')![0]!.rejectedStockIds).toEqual(['openverse:old', 'openverse:a'])
  })
  it('generated with a custom prompt uses and stores it', async () => {
    const { replacer, store, generate } = setup()
    const res = await replacer.replace('u1', 'u1-asset-1', 'generated', 'isometric diagram of a savings jar')
    expect(generate).toHaveBeenCalledWith('isometric diagram of a savings jar', { field: 'finance' })
    expect(res).toMatchObject({ ok: true, asset: { prompt: 'isometric diagram of a savings jar' } })
    expect(store.assets.get('u1')![1]!.prompt).toBe('isometric diagram of a savings jar')
  })
  it('next-stock ignores a custom prompt and keeps the stored one', async () => {
    const { replacer, store } = setup([cand('n')])
    await replacer.replace('u1', 'u1-asset-0', 'next-stock', 'something else')
    expect(store.assets.get('u1')![0]!.prompt).toBe('ein Sparschwein')
  })
})

describe('revoice', () => {
  const content = (durationSec: number) => ({
    format: 'audio', script: 'Neues Skript', durationSec, audioId: 'a1-asset-0',
    images: [{ imageId: 'a1-asset-1', showAtSec: 100 }],
    sources: [{ url: 'https://q.test', title: 'Q', publisher: 'P' }],
  })
  function audioSetup(newDuration: number, status: UnitStatus = 'in_review') {
    const t = setup()
    t.store.add('a1', 'audio', status)
    void t.store.replaceAssets('a1', [{ kind: 'audio', path: 'a1/old.mp3', durationSec: 200 }, { kind: 'image', path: 'a1/i.png', origin: 'generated', prompt: 'p' }])
    t.store.units.get('a1')!.contentJson = content(200)
    const synthesize = vi.fn(async () => ({ audio: Buffer.from('wav'), contentType: 'audio/wav' as const, durationSec: newDuration }))
    const audio: AudioDeps = { tts: { synthesize }, put: async (u, _d, ext) => `${u}/voice.${ext}`, transcode: async () => Buffer.from('mp3') }
    const replacer = createImageReplacer({ store: t.store, image: {} as ImageDeps, audio, mediaUrl: (p) => `https://media/${p}` })
    return { ...t, replacer, synthesize }
  }
  it('re-synthesizes from the current script and rescales image times', async () => {
    const { replacer, store, synthesize } = audioSetup(240)
    const res = await replacer.revoice('a1', 'a1-asset-0')
    expect(synthesize).toHaveBeenCalledWith('Neues Skript')
    expect(res).toMatchObject({ ok: true, asset: { url: 'https://media/a1/voice.mp3', durationSec: 240 } })
    expect(store.units.get('a1')!.contentJson).toMatchObject({ durationSec: 240, images: [{ imageId: 'a1-asset-1', showAtSec: 120 }] })
    expect(store.assets.get('a1')![0]).toMatchObject({ path: 'a1/voice.mp3', durationSec: 240 })
  })
  it('rejects a recording outside the allowed length without touching the unit', async () => {
    const { replacer, store } = audioSetup(30)
    expect(await replacer.revoice('a1', 'a1-asset-0')).toEqual({ ok: false, error: 'invalid_content' })
    expect(store.units.get('a1')!.contentJson).toEqual(content(200))
  })
  it('re-voices with the voice of the current recording', async () => {
    const t = audioSetup(240)
    t.store.assets.get('a1')![0]!.generator = 'fake-tts · design:Anna'
    const synthesize = vi.fn(async (_t: string, _o?: { voice?: string }) => ({ audio: Buffer.from('wav'), contentType: 'audio/wav' as const, durationSec: 240, voice: _o?.voice }))
    const audio: AudioDeps = { tts: { name: 'fake-tts', synthesize }, put: async (u, _d, ext) => `${u}/voice.${ext}`, transcode: async () => Buffer.from('mp3') }
    const replacer = createImageReplacer({ store: t.store, image: {} as ImageDeps, audio, mediaUrl: (p) => `https://media/${p}` })
    const res = await replacer.revoice('a1', 'a1-asset-0')
    expect(synthesize).toHaveBeenCalledWith('Neues Skript', { voice: 'design:Anna' })
    expect(res).toMatchObject({ ok: true, asset: { generator: 'fake-tts · design:Anna' } })
    expect(t.store.assets.get('a1')![0]).toMatchObject({ generator: 'fake-tts · design:Anna' })
  })
  it('requires in_review/published and an audio asset of the unit', async () => {
    expect(await audioSetup(240, 'rejected').replacer.revoice('a1', 'a1-asset-0')).toEqual({ ok: false, error: 'invalid_state' })
    expect(await audioSetup(240, 'published').replacer.revoice('a1', 'a1-asset-0')).toMatchObject({ ok: true })
    expect(await audioSetup(240).replacer.revoice('a1', 'a1-asset-1')).toEqual({ ok: false, error: 'not_found' })
  })
})
