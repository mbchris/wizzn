import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadEnv } from '../../src/env.js'
import { createLlm, createTts } from '../../src/providers/index.js'
import { createRequestyTts, pcmToWav, splitIntoSentenceChunks, wavDurationSec } from '../../src/providers/tts.js'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  SEARCH_URL: 'http://localhost:8080',
  MEDIA_PUBLIC_URL: 'http://localhost:8081',
  STOCK_USER_AGENT: 'test',
}
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }
const recorder = (respond: (body: Record<string, unknown>) => Response) => {
  const calls: Call[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body })
    return respond(body)
  }) as typeof fetch
  return { calls, fetchFn }
}
/** 1 s of 24 kHz 16-bit mono PCM per request */
const pcmSecond = () => new Response(Buffer.alloc(48_000), { status: 200 })

describe('requesty env', () => {
  it('requires REQUESTY_API_KEY for requesty llm/tts', () => {
    expect(() => loadEnv({ ...base, LLM_PROVIDER: 'requesty' })).toThrow(/REQUESTY_API_KEY/)
    expect(() => loadEnv({ ...base, TTS_PROVIDER: 'requesty' })).toThrow(/REQUESTY_API_KEY/)
    const env = loadEnv({ ...base, TTS_PROVIDER: 'requesty', REQUESTY_API_KEY: 'k' })
    expect(env.REQUESTY_BASE_URL).toBe('https://router.requesty.ai/v1')
    expect(env.REQUESTY_TTS_MODEL).toBe('openai/gpt-4o-mini-tts')
  })
  it('wires the factories', () => {
    const env = loadEnv({ ...base, LLM_PROVIDER: 'requesty', TTS_PROVIDER: 'requesty', REQUESTY_API_KEY: 'k', LLM_MODEL: 'google/gemini-2.5-flash' })
    expect(createLlm(env).model).toBe('google/gemini-2.5-flash')
    expect(createTts({ ...env, TTS_VOICE_1: 'Serena', TTS_VOICE_2: 'Vivian' }).name).toBe('requesty · openai/gpt-4o-mini-tts · nova')
    expect(() => loadEnv({ ...base, TTS_PROVIDER: 'requesty', REQUESTY_API_KEY: 'k', REQUESTY_TTS_VOICE: 'Serena' })).toThrow(/REQUESTY_TTS_VOICE/)
    expect(() => createLlm({ ...env, LLM_MODEL: '' })).toThrow(/requires LLM_MODEL/)
  })
})

describe('requesty llm', () => {
  it('posts OpenAI chat completions to the router with bearer auth', async () => {
    const { calls, fetchFn } = recorder(() => new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] })))
    const env = loadEnv({ ...base, LLM_PROVIDER: 'requesty', REQUESTY_API_KEY: 'sk-r', LLM_MODEL: 'openai/gpt-4o-mini' })
    const realFetch = globalThis.fetch
    globalThis.fetch = fetchFn
    try {
      expect(await createLlm(env).chatJson([{ role: 'user', content: 'q' }], z.object({ a: z.number() }))).toEqual({ a: 1 })
    } finally {
      globalThis.fetch = realFetch
    }
    expect(calls[0]!.url).toBe('https://router.requesty.ai/v1/chat/completions')
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-r')
    expect(calls[0]!.body.model).toBe('openai/gpt-4o-mini')
  })
})

describe('requesty tts', () => {
  it('requests pcm, wraps WAV, maps length_scale to speed, uses the fixed voice', async () => {
    const { calls, fetchFn } = recorder(pcmSecond)
    const tts = createRequestyTts({ baseUrl: 'https://router.requesty.ai/v1/', apiKey: 'k', model: 'openai/gpt-4o-mini-tts', voice: 'Coral', instructions: 'ruhig', lengthScale: 1.25, fit: false, fetchFn })
    const out = await tts.synthesize('Hallo Welt.')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://router.requesty.ai/v1/audio/speech')
    expect(calls[0]!.body).toMatchObject({ model: 'openai/gpt-4o-mini-tts', input: 'Hallo Welt.', voice: 'coral', response_format: 'pcm', speed: 0.8, instructions: 'ruhig' })
    expect(out.voice).toBeUndefined()
    expect(out.durationSec).toBe(1)
  })
  it('defaults to nova and splits long scripts below the 4096-char limit', async () => {
    const { calls, fetchFn } = recorder(pcmSecond)
    const text = Array.from({ length: 120 }, (_, i) => `Das ist der ausführliche Testsatz Nummer ${i}.`).join(' ')
    const out = await createRequestyTts({ baseUrl: 'http://r/v1', apiKey: 'k', model: 'm', fit: false, fetchFn }).synthesize(text)
    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) {
      expect(String(c.body.input).length).toBeLessThanOrEqual(3500)
      expect(c.body.voice).toBe('nova')
      expect(c.body).not.toHaveProperty('instructions')
    }
    expect(out.durationSec).toBe(calls.length)
  })
  it('every chunk ends on a sentence boundary', async () => {
    const { calls, fetchFn } = recorder(pcmSecond)
    const text = Array.from({ length: 200 }, (_, i) => `Satz ${i}, mit Komma; und Doppelpunkt: Ende.`).join(' ')
    await createRequestyTts({ baseUrl: 'http://r/v1', apiKey: 'k', model: 'm', fit: false, fetchFn }).synthesize(text)
    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) expect(String(c.body.input)).toMatch(/^Satz \d+,[\s\S]*Ende\.$/)
    expect(calls.map((c) => c.body.input).join(' ')).toBe(text)
  })
  it('keeps one long sentence whole, rejects one over the hard limit', () => {
    const long = `${'Wort '.repeat(800).trim()}.`
    expect(splitIntoSentenceChunks(`Kurz. ${long} Ende!`, 3500, 4096)).toEqual(['Kurz.', long, 'Ende!'])
    expect(() => splitIntoSentenceChunks(`${'Wort '.repeat(900)}.`, 3500, 4096)).toThrow(/exceeds the 4096-char/)
  })
  it('surfaces HTTP errors', async () => {
    const { fetchFn } = recorder(() => new Response('balance exhausted', { status: 402 }))
    await expect(createRequestyTts({ baseUrl: 'http://r/v1', apiKey: 'k', model: 'm', fit: false, fetchFn }).synthesize('x')).rejects.toThrow(/402: balance/)
  })
  it('pcmToWav yields a valid header', () => {
    expect(wavDurationSec(pcmToWav(Buffer.alloc(48_001), 24_000))).toBe(1)
  })
})
