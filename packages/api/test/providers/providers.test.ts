import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { htmlToText, extractTitle } from '../../src/providers/fetch-page.js'
import { createGeminiCliClient, createLlmClient, flattenMessages, stripWrappers } from '../../src/providers/llm.js'
import { createApiImages } from '../../src/providers/image.js'
import { createSearxngClient } from '../../src/providers/search.js'
import { silentWav, wavDurationSec } from '../../src/providers/tts.js'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const completion = (content: string) => json({ choices: [{ message: { content } }] })

describe('gemini-cli llm client', () => {
  it('runs gemini headless with model + json output, parses response, retries on invalid', async () => {
    const calls: { bin: string; args: string[]; stdin: string }[] = []
    const answers = ['{"n":"x"}', '```json\n{"n":2}\n```']
    const llm = createGeminiCliClient({
      model: 'gemini-2.5-flash',
      bin: '/opt/gemini',
      runFn: async (bin, args, stdin) => (calls.push({ bin, args, stdin }), JSON.stringify({ response: answers.shift() })),
    })
    expect(await llm.chatJson([{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }], z.object({ n: z.number() }))).toEqual({ n: 2 })
    expect(calls[0]).toMatchObject({ bin: '/opt/gemini', args: ['--output-format', 'json', '-m', 'gemini-2.5-flash'] })
    expect(calls[0]!.stdin).toContain('### SYSTEM\nsys')
    expect(calls[1]!.stdin).toContain('ungültig')
  })
  it('omits -m when no model is set and accepts plain-text stdout', async () => {
    let seen: string[] = []
    const llm = createGeminiCliClient({ model: '', runFn: async (_b, args) => ((seen = args), '{"ok":true}') })
    expect(await llm.chatJson([], z.object({ ok: z.boolean() }))).toEqual({ ok: true })
    expect(seen).toEqual(['--output-format', 'json'])
    expect(llm.model).toBe('gemini-cli')
  })
  it('surfaces CLI errors', async () => {
    const llm = createGeminiCliClient({ model: '', runFn: async () => JSON.stringify({ error: { message: 'quota' } }) })
    await expect(llm.chatJson([], z.object({}))).rejects.toThrow(/gemini-cli: quota/)
  })
  it('flattens roles in order', () => {
    expect(flattenMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toMatch(/USER\na[\s\S]*ASSISTANT\nb/)
  })
})

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
  it('repairs a second time when the first repair is still invalid', async () => {
    const answers = ['{"n":"x"}', '{"n":"y"}', '{"n":2}']
    const llm = createLlmClient({ baseUrl: 'http://x', model: 'm', apiKey: '', fetchFn: async () => completion(answers.shift()!) })
    expect(await llm.chatJson([{ role: 'user', content: 'q' }], z.object({ n: z.number() }))).toEqual({ n: 2 })
  })
  it('gives up after three invalid answers', async () => {
    let calls = 0
    const llm = createLlmClient({ baseUrl: 'http://x', model: 'm', apiKey: '', fetchFn: async () => (calls++, completion('nope')) })
    await expect(llm.chatJson([], z.object({}))).rejects.toThrow(/failed validation 3 times/)
    expect(calls).toBe(3)
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

describe('createProviders research wiring', () => {
  it('builds research providers from RESEARCH_PROVIDERS', async () => {
    const { createProviders } = await import('../../src/providers/index.js')
    const { loadEnv } = await import('../../src/env.js')
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:3000',
      LLM_BASE_URL: 'http://llm',
      LLM_MODEL: 'm',
      SEARCH_URL: 'http://sx',
      TTS_URL: 'http://tts',
      TTS_VOICE: 'v',
      STOCK_USER_AGENT: 'wizzn-test/1.0 (a@b.c)',
      MEDIA_PUBLIC_URL: 'http://localhost:3000/media',
    }
    expect(createProviders(loadEnv(base)).research.map((p) => p.name)).toEqual(['curated', 'wikipedia', 'europepmc', 'web'])
    expect(createProviders(loadEnv({ ...base, RESEARCH_PROVIDERS: 'web,curated' })).research.map((p) => p.name)).toEqual(['web', 'curated'])
  })
})
