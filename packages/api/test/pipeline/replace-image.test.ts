import { describe, expect, it, vi } from 'vitest'
import type { ImageCredit } from '@wizzn/shared'
import type { ImageDeps } from '../../src/pipeline/images.js'
import { createStockChain } from '../../src/providers/stock-images/chain.js'
import { createImageReplacer } from '../../src/pipeline/replace-image.js'
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

function setup(candidates: StockCandidate[] = [], status: 'in_review' | 'published' = 'in_review', stock?: ImageDeps['stock']) {
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
    media: { put: async (prefix, _d, ext) => `${prefix}/new${++n}.${ext}`, publicUrl: (p) => p },
    llm: { model: 'fake', chatJson },
    fetchFn: (async (u: string) => new Response(Buffer.from(String(u)), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch,
    minEdgePx: 800,
    maxBytes: 5_000_000,
  }
  const replacer = createImageReplacer({ store, image, mediaUrl: (p) => `https://media/${p}` })
  return { store, replacer, search, generate, chatJson }
}

describe('createImageReplacer', () => {
  it('requires the unit to be in_review', async () => {
    const { replacer } = setup([cand('n')], 'published')
    expect(await replacer.replace('u1', 'u1-asset-0', 'next-stock')).toEqual({ ok: false, error: 'invalid_state' })
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
      asset: { id: 'u1-asset-0', kind: 'image', url: 'https://media/u1/new1.jpg', durationSec: null, origin: 'stock', credit: credit('n'), stockQuery: 'Sparschwein' },
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
    expect(generate).toHaveBeenCalledWith('Geldscheine')
    expect(res).toMatchObject({ ok: true, asset: { id: 'u1-asset-1', origin: 'generated', credit: null, stockQuery: null } })
    expect(store.assets.get('u1')![1]).toMatchObject({ origin: 'generated', credit: null, path: 'u1/new1.svg' })
  })
  it('generated without prompt falls back to credit title, then stockQuery, else not_found', async () => {
    const { replacer, store, generate } = setup()
    store.assets.get('u1')![1]!.prompt = undefined
    await replacer.replace('u1', 'u1-asset-1', 'generated')
    expect(generate).toHaveBeenLastCalledWith('Bild b')
    const a = store.assets.get('u1')![0]!
    a.prompt = null
    a.credit = null
    await replacer.replace('u1', 'u1-asset-0', 'generated')
    expect(generate).toHaveBeenLastCalledWith('Sparschwein')
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
})
