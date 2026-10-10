import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createOpenverseClient } from '../../src/providers/stock-images/openverse.js'
import { StockSearchError } from '../../src/providers/stock-images/types.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/openverse-search.json', import.meta.url), 'utf8'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('openverse client', () => {
  it('builds the search URL with license/mature/page_size filters', async () => {
    const fetchFn = vi.fn(async () => json(fixture))
    await createOpenverseClient({ fetchFn: fetchFn as unknown as typeof fetch }).search('healthy breakfast')
    const url = (fetchFn.mock.calls[0] as unknown[])[0] as string
    expect(url).toContain('q=healthy%20breakfast')
    expect(url).toContain('license=cc0%2Cpdm%2Cby%2Cby-sa')
    expect(url).toContain('mature=false')
    expect(url).toContain('page_size=20')
  })

  it('maps results, drops NC items, nulls missing creator, maps mime', async () => {
    const c = createOpenverseClient({ fetchFn: (async () => json(fixture)) as unknown as typeof fetch })
    const out = await c.search('x')
    expect(out.map((o) => o.providerId)).toEqual(['id-1', 'id-2', 'id-4'])
    expect(out[0]).toMatchObject({
      provider: 'openverse',
      providerId: 'id-1',
      imageUrl: 'https://live.staticflickr.com/1/a.jpg',
      mime: 'image/jpeg',
      credit: {
        provider: 'openverse/flickr',
        sourceUrl: 'https://www.flickr.com/photos/jane/1',
        license: 'by-sa',
        licenseVersion: '4.0',
        creator: 'Jane Doe',
        creatorUrl: 'https://www.flickr.com/photos/jane',
      },
    })
    expect(out[1]!.mime).toBe('image/png')
    expect(out[2]!.credit.creator).toBeNull()
  })

  it('drops items without width/height', async () => {
    const body = { results: [{ ...fixture.results[0], width: null }, { ...fixture.results[1], height: undefined }] }
    const c = createOpenverseClient({ fetchFn: (async () => json(body)) as unknown as typeof fetch })
    expect(await c.search('x')).toEqual([])
  })

  it('fetches a token once and reuses it until near expiry', async () => {
    let t = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth_tokens/token/') ? json({ access_token: 'tok', expires_in: 3600 }) : json(fixture),
    )
    const c = createOpenverseClient({ clientId: 'id', clientSecret: 's', fetchFn: fetchFn as unknown as typeof fetch, now: () => t })
    await c.search('a')
    t = 1000
    await c.search('b')
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][]
    const tokenCalls = calls.filter(([u]) => u.includes('/v1/auth_tokens/token/'))
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]![1].method).toBe('POST')
    expect(String(tokenCalls[0]![1].body)).toContain('grant_type=client_credentials')
    const search = calls.find(([u]) => u.includes('/v1/images/'))!
    expect((search[1].headers as Record<string, string>).authorization).toBe('Bearer tok')
    t = 3600_000 - 30_000 // inside the 60 s refresh margin
    await c.search('c')
    expect(calls.filter(([u]) => u.includes('/auth_tokens/'))).toHaveLength(2)
  })

  it('rejects with StockSearchError on 429', async () => {
    const c = createOpenverseClient({ fetchFn: (async () => json({}, 429)) as unknown as typeof fetch })
    await expect(c.search('x')).rejects.toMatchObject({ name: 'StockSearchError', status: 429 })
    await expect(c.search('x')).rejects.toBeInstanceOf(StockSearchError)
  })
})
