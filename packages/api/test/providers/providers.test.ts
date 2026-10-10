import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { htmlToText, extractTitle } from '../../src/providers/fetch-page.js'
import { createLlmClient, stripWrappers } from '../../src/providers/llm.js'
import { createApiImages } from '../../src/providers/image.js'
import { createSearxngClient } from '../../src/providers/search.js'
import { silentWav, wavDurationSec } from '../../src/providers/tts.js'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const completion = (content: string) => json({ choices: [{ message: { content } }] })

describe('llm client', () => {
  it('strips <think> and code fences', () => {
    expect(stripWrappers('<think>hmm</think>\n```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('retries once with the validation error, then succeeds', async () => {
    const bodies: string[] = []
    const answers = ['{"n":"x"}', '{"n":2}']
    const llm = createLlmClient({
      baseUrl: 'http://ollama/v1/',
      model: 'm',
      apiKey: 'k',
      fetchFn: async (_u, init) => (bodies.push(String(init?.body)), completion(answers.shift()!)),
    })
    expect(await llm.chatJson([{ role: 'user', content: 'q' }], z.object({ n: z.number() }))).toEqual({ n: 2 })
    expect(bodies[1]).toContain('ungültig')
  })
  it('gives up after two invalid answers', async () => {
    const llm = createLlmClient({ baseUrl: 'http://x', model: 'm', apiKey: '', fetchFn: async () => completion('nope') })
    await expect(llm.chatJson([], z.object({}))).rejects.toThrow(/twice/)
  })
})

describe('searxng', () => {
  it('dedupes, keeps https only and respects the limit', async () => {
    const s = createSearxngClient('http://sx', async () =>
      json({ results: [{ url: 'https://a.de', title: 'A' }, { url: 'https://a.de', title: 'A2' }, { url: 'http://b.de', title: 'B' }, { url: 'https://c.de', title: 'C' }] }),
    )
    expect((await s.search('q', 5)).map((r) => r.url)).toEqual(['https://a.de', 'https://c.de'])
  })
})

describe('html extraction', () => {
  it('drops scripts/nav and keeps paragraphs', () => {
    const html = '<title>Tipps &amp; Tricks</title><nav>Menü Menü Menü Menü Menü Menü Menü</nav><script>x()</script><p>Ein ausreichend langer Absatz über Budgetplanung im Alltag.</p>'
    expect(extractTitle(html)).toBe('Tipps & Tricks')
    expect(htmlToText(html)).toBe('Ein ausreichend langer Absatz über Budgetplanung im Alltag.')
  })
})

describe('wav', () => {
  it('reads the duration of a generated WAV', () => {
    expect(wavDurationSec(silentWav(3, 8000))).toBe(3)
  })
})

describe('api images (ImageRouter compatible)', () => {
  const png = Buffer.from('fake-png')
  const b64 = png.toString('base64')
  const capture = () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return json({ data: [{ b64_json: b64 }] })
    }) as unknown as typeof fetch
    return { calls, fetchFn }
  }
  const cfg = { baseUrl: 'http://img/v1/', model: 'm', apiKey: 'k' }

  it('sends output_format png and b64_ephemeral when ephemeral is true', async () => {
    const { calls, fetchFn } = capture()
    const out = await createApiImages({ ...cfg, ephemeral: true, fetchFn }).generate('oatmeal')
    expect(calls[0]!.url).toBe('http://img/v1/images/generations')
    expect(calls[0]!.body).toMatchObject({ output_format: 'png', response_format: 'b64_ephemeral' })
    expect(out.data).toEqual(png)
    expect(out.contentType).toBe('image/png')
  })

  it('sends b64_json when ephemeral is false', async () => {
    const { calls, fetchFn } = capture()
    const out = await createApiImages({ ...cfg, ephemeral: false, fetchFn }).generate('oatmeal')
    expect(calls[0]!.body).toMatchObject({ output_format: 'png', response_format: 'b64_json' })
    expect(out.data).toEqual(png)
  })

  it('defaults to b64_ephemeral when ephemeral is undefined', async () => {
    const { calls, fetchFn } = capture()
    await createApiImages({ ...cfg, fetchFn }).generate('oatmeal')
    expect(calls[0]!.body).toMatchObject({ response_format: 'b64_ephemeral' })
  })
})
