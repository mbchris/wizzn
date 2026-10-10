import { describe, expect, it } from 'vitest'
import { concatWav, createChatterboxTts, silentWav, splitIntoChunks, wavDurationSec } from '../../src/providers/tts.js'

describe('splitIntoChunks', () => {
  it('packs whole sentences up to the limit', () => {
    expect(splitIntoChunks('Eins ist hier. Zwei ist da! Drei?', 30)).toEqual(['Eins ist hier. Zwei ist da!', 'Drei?'])
  })
  it('splits overlong sentences at commas, then words', () => {
    const chunks = splitIntoChunks(`${'wort '.repeat(30).trim()}, kurz.`, 40)
    expect(chunks.every((c) => c.length <= 40)).toBe(true)
    expect(chunks.join(' ').split(/\s+/)).toHaveLength(31)
  })
})

describe('concatWav', () => {
  it('sums durations and fixes headers', () => {
    const out = concatWav([silentWav(2, 800), silentWav(3, 800)])
    expect(wavDurationSec(out)).toBe(5)
    expect(out.readUInt32LE(4)).toBe(out.length - 8)
  })
})

describe('createChatterboxTts', () => {
  it('posts one request per chunk and joins the audio', async () => {
    const bodies: { text: string; length_scale: number }[] = []
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(silentWav(100, 800))
    }) as typeof fetch
    const r = await createChatterboxTts('http://tts/synthesize', fetchFn, 1, 20).synthesize('Erster Satz hier. Zweiter Satz da.')
    expect(bodies.map((b) => b.text)).toEqual(['Erster Satz hier.', 'Zweiter Satz da.'])
    expect(r.durationSec).toBe(200)
  })
})

describe('createQwenTts', () => {
  it('uses the same chunked /synthesize contract with larger chunks', async () => {
    const { createQwenTts } = await import('../../src/providers/tts.js')
    const bodies: { text: string }[] = []
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(silentWav(100, 800))
    }) as typeof fetch
    const sentence = 'Das ist ein Satz mit ungefähr fünfzig Zeichen Länge. '
    const r = await createQwenTts('http://tts/synthesize', fetchFn, 1).synthesize(sentence.repeat(12))
    expect(bodies.length).toBe(2) // 12 × ~52 chars at ≤500 per chunk
    expect(bodies.every((b) => b.text.length <= 500)).toBe(true)
    expect(r.durationSec).toBe(200)
  })
})

describe('random voices (TTS_VOICE_1..3)', () => {
  it('sends one picked voice for every chunk of a unit', async () => {
    const { createQwenTts } = await import('../../src/providers/tts.js')
    const sent: unknown[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).voice)
      return new Response(silentWav(2))
    }) as unknown as typeof fetch
    const r = await createQwenTts('http://tts/synthesize', fetchFn, 1, 20, false, false, ['design:A', 'design:B']).synthesize('Erster Satz hier. Zweiter Satz da.')
    expect(new Set(sent).size).toBe(1)
    expect(['design:A', 'design:B']).toContain(r.voice)
  })
  it('voicePicker covers all voices', async () => {
    const { voicePicker } = await import('../../src/providers/tts.js')
    expect(voicePicker(['a', 'b', 'c'], () => 0)()).toBe('a')
    expect(voicePicker(['a', 'b', 'c'], () => 0.99)()).toBe('c')
    expect(voicePicker([])()).toBeUndefined()
  })
})
