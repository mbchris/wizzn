import { describe, expect, it } from 'vitest'
import { createPiperTts, nextLengthScale, padWav, silentWav, wavDurationSec } from '../../src/providers/tts.js'

/** Fake Piper: duration = pauseSec + speechSec × length_scale (pauses do not stretch, like the real model) */
function fakePiper(speechSec: number, pauseSec = 0) {
  const scales: number[] = []
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const scale = JSON.parse(String(init?.body)).length_scale as number
    scales.push(scale)
    return new Response(silentWav(Math.round(pauseSec + speechSec * scale), 800))
  }) as typeof fetch
  return { fetchFn, scales }
}

describe('createPiperTts', () => {
  it('keeps audio that is already 3–5 min', async () => {
    const p = fakePiper(200)
    const r = await createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 1).synthesize('x')
    expect(r.durationSec).toBe(200)
    expect(p.scales).toEqual([1])
  })
  it('re-renders slower when too short', async () => {
    const p = fakePiper(120) // 144 s at 1.2
    const r = await createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 1.2).synthesize('x')
    expect(p.scales).toHaveLength(2)
    expect(r.durationSec).toBeGreaterThanOrEqual(180)
    expect(r.durationSec).toBeLessThanOrEqual(300)
  })
  it('re-renders faster when too long', async () => {
    const p = fakePiper(400)
    const r = await createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 1).synthesize('x')
    expect(r.durationSec).toBeLessThanOrEqual(300)
  })
  it('converges when pauses do not stretch (the case seen with Thorsten)', async () => {
    // 152 s at 1.2 with 60 s of fixed pauses: one proportional step is not enough
    const p = fakePiper(92 / 1.2, 60)
    const r = await createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 1.2).synthesize('x')
    expect(r.durationSec).toBeGreaterThanOrEqual(180)
    expect(p.scales.length).toBeLessThanOrEqual(4)
  })
  it('pads a little silence when the pace cannot go slower', async () => {
    const p = fakePiper(80, 5) // 165 s even at length_scale 2
    const r = await createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 2).synthesize('x')
    expect(r.durationSec).toBe(180)
    expect(Math.floor(wavDurationSec(r.audio))).toBe(180)
  })
  it('fails clearly when a script is far too short', async () => {
    const p = fakePiper(30)
    await expect(createPiperTts('http://tts/synthesize', 'v', p.fetchFn, 1).synthesize('x')).rejects.toThrow(/lengthen the script/)
  })
})

describe('nextLengthScale', () => {
  it('fits pauses + speech × scale from two renders', () => {
    // 60 + 100·s: 160 s @1.0, 180 s @1.2 → 185 s needs 1.25
    expect(nextLengthScale([{ scale: 1, sec: 160 }, { scale: 1.2, sec: 180 }], 185)).toBeCloseTo(1.25)
  })
})

describe('padWav', () => {
  it('extends the data chunk and headers', () => {
    const out = padWav(silentWav(10, 800), 5)
    expect(wavDurationSec(out)).toBe(15)
    expect(out.readUInt32LE(4)).toBe(out.length - 8)
  })
})
