import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCommonsClient } from '../../src/providers/stock-images/commons.js'
import { StockSearchError } from '../../src/providers/stock-images/types.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/commons-search.json', import.meta.url), 'utf8'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const make = (body: unknown = fixture, status = 200) =>
  createCommonsClient({ userAgent: 'wizzn-test/1.0 (a@b.c)', fetchFn: (async () => json(body, status)) as unknown as typeof fetch })

describe('commons client', () => {
  it('builds the query URL and sends the user agent', async () => {
    const fetchFn = vi.fn(async () => json(fixture))
    await createCommonsClient({ userAgent: 'wizzn-test/1.0 (a@b.c)', fetchFn: fetchFn as unknown as typeof fetch }).search('healthy breakfast')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const p = new URL(url).searchParams
    expect(new URL(url).origin + new URL(url).pathname).toBe('https://commons.wikimedia.org/w/api.php')
    expect(Object.fromEntries(p)).toEqual({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: 'healthy breakfast filetype:bitmap',
      gsrlimit: '20',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1080',
      format: 'json',
    })
    expect(p.has('origin')).toBe(false)
    expect((init.headers as Record<string, string>)['user-agent']).toBe('wizzn-test/1.0 (a@b.c)')
  })

  it('maps files, drops NC and attribution-required without artist', async () => {
    const out = await make().search('x')
    expect(out.map((o) => o.providerId)).toEqual(['File:Apple tree.jpg', 'File:Zero bread.png', 'File:Old map.jpg'])
    expect(out[0]).toMatchObject({
      provider: 'commons',
      title: 'Apple tree in bloom',
      imageUrl: 'https://upload.wikimedia.org/thumb/1.jpg/1080px-1.jpg',
      width: 3001,
      height: 2001,
      mime: 'image/jpeg',
      credit: {
        creator: 'Foo',
        creatorUrl: 'https://commons.wikimedia.org/wiki/User:Foo',
        license: 'by-sa',
        licenseVersion: '3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Apple_tree.jpg',
        providerId: 'File:Apple tree.jpg',
      },
    })
  })

  it('keeps CC0 without artist (creator null) and falls back to page title', async () => {
    const out = await make().search('x')
    expect(out[1]!.credit).toMatchObject({ creator: null, creatorUrl: null, license: 'cc0', title: 'Zero bread' })
  })

  it('decodes entities and strips tags from Artist; maps public domain', async () => {
    const out = await make().search('x')
    expect(out[2]!.credit).toMatchObject({ creator: 'Bar & Baz', creatorUrl: null, license: 'pdm', licenseVersion: null })
    expect(out[2]!.credit.licenseUrl).toBe('https://creativecommons.org/publicdomain/mark/1.0/')
  })

  it('nulls an invalid creator url instead of dropping the item', async () => {
    const body = structuredClone(fixture)
    body.query.pages['1'].imageinfo[0].extmetadata.Artist.value = '<a href="javascript:x">Foo</a>'
    const out = await make(body).search('x')
    expect(out[0]!.credit).toMatchObject({ creator: 'Foo', creatorUrl: null })
  })

  it('returns [] without query and throws StockSearchError on HTTP error', async () => {
    expect(await make({ batchcomplete: '' }).search('x')).toEqual([])
    await expect(make({}, 503).search('x')).rejects.toBeInstanceOf(StockSearchError)
  })
})
