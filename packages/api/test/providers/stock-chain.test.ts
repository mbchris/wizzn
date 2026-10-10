import { describe, expect, it, vi } from 'vitest'
import { createStockChain } from '../../src/providers/stock-images/chain.js'
import { StockSearchError, type StockCandidate, type StockImageClient } from '../../src/providers/stock-images/types.js'

const cand = (id: string): StockCandidate => ({
  provider: 'openverse',
  providerId: id,
  title: id,
  tags: [],
  imageUrl: `https://x/${id}.jpg`,
  width: 1000,
  height: 1000,
  mime: 'image/jpeg',
  credit: {} as StockCandidate['credit'],
})
const client = (name: string, fn: () => Promise<StockCandidate[]>): StockImageClient & { search: ReturnType<typeof vi.fn> } => ({
  name,
  search: vi.fn(fn),
})

describe('stock chain', () => {
  it('returns the first non-empty result without calling later clients', async () => {
    const a = client('a', async () => [cand('1'), cand('2')])
    const b = client('b', async () => [cand('3')])
    const chain = createStockChain([a, b])
    expect(chain.name).toBe('chain')
    expect(await chain.search('q')).toHaveLength(2)
    expect(b.search).not.toHaveBeenCalled()
  })
  it('falls through on StockSearchError and logs provider and status', async () => {
    const log = vi.fn()
    const a = client('a', async () => { throw new StockSearchError('a', 429, 'rate limited') })
    const b = client('b', async () => [cand('3')])
    expect((await createStockChain([a, b], { log }).search('q')).map((c) => c.providerId)).toEqual(['3'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toMatch(/a.*429/)
  })
  it('falls through on raw errors', async () => {
    const a = client('a', async () => { throw new TypeError('boom') })
    const b = client('b', async () => [cand('3')])
    expect(await createStockChain([a, b], { log: () => {} }).search('q')).toHaveLength(1)
  })
  it('falls through on an empty result', async () => {
    const a = client('a', async () => [])
    const b = client('b', async () => [cand('3')])
    expect(await createStockChain([a, b]).search('q')).toHaveLength(1)
  })
  it('returns [] and logs per failure when all fail', async () => {
    const log = vi.fn()
    const a = client('a', async () => { throw new StockSearchError('a', 500, 'x') })
    const b = client('b', async () => { throw new SyntaxError('bad json') })
    expect(await createStockChain([a, b], { log }).search('q')).toEqual([])
    expect(log).toHaveBeenCalledTimes(2)
  })
  it('gives up on a client that never resolves after timeoutMs', async () => {
    const log = vi.fn()
    const a = client('a', () => new Promise(() => {}))
    const b = client('b', async () => [cand('3')])
    expect(await createStockChain([a, b], { timeoutMs: 20, log }).search('q')).toHaveLength(1)
    expect(log).toHaveBeenCalledTimes(1)
  })
  it('moves to the next client when accept rejects every candidate', async () => {
    const a = client('a', async () => [cand('1'), cand('2')])
    const b = client('b', async () => [cand('3'), cand('4')])
    const out = await createStockChain([a, b]).search('q', { accept: (c) => c.providerId !== '1' && c.providerId !== '2' })
    expect(out.map((c) => c.providerId)).toEqual(['3', '4'])
  })
  it('keeps the first client result when at least one candidate is accepted', async () => {
    const a = client('a', async () => [cand('1'), cand('2')])
    const b = client('b', async () => [cand('3')])
    const out = await createStockChain([a, b]).search('q', { accept: (c) => c.providerId === '2' })
    expect(out.map((c) => c.providerId)).toEqual(['1', '2'])
    expect(b.search).not.toHaveBeenCalled()
  })
})
