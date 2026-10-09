import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { htmlToText, extractTitle } from '../../src/providers/fetch-page.js'
import { createLlmClient, stripWrappers } from '../../src/providers/llm.js'
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
