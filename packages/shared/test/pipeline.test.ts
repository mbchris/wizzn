import { describe, expect, it } from 'vitest'
import { draftAudioSchema, draftWrittenSchema, evaluateCheck, imagePickSchema, scheduleImages } from '../src/pipeline.js'

const ok = [{ url: 'https://a.de', ok: true, status: 200 }]

describe('evaluateCheck', () => {
  it('passes when all claims are sourced and links work', () => {
    expect(evaluateCheck({ claims: [{ text: 'x', sourceIndex: 0 }], issues: [] }, ok).passed).toBe(true)
  })
  it('fails on an unsupported claim', () => {
    const r = evaluateCheck({ claims: [{ text: 'x', sourceIndex: null }], issues: [] }, ok)
    expect(r.passed).toBe(false)
    expect(r.unsupportedClaims).toBe(1)
  })
  it('fails on a high-severity issue or dead link, not on a low one', () => {
    expect(evaluateCheck({ claims: [], issues: [{ severity: 'high', message: 'm' }] }, ok).passed).toBe(false)
    expect(evaluateCheck({ claims: [], issues: [{ severity: 'low', message: 'm' }] }, ok).passed).toBe(true)
    expect(evaluateCheck({ claims: [], issues: [] }, [{ url: 'u', ok: false, status: 404 }]).passed).toBe(false)
  })
})

describe('scheduleImages', () => {
  it('maps fractions to seconds inside the duration', () => {
    expect(scheduleImages(200, [0, 0.5, 0.95])).toEqual([0, 100, 190])
    expect(scheduleImages(10, [1])).toEqual([9])
  })
})

describe('draftAudioSchema', () => {
  const words = (n: number) => Array(n).fill('wort').join(' ')
  it('enforces 420–700 words', () => {
    const base = { title: 'Titel', images: [{ prompt: 'eine Zeichnung', atFraction: 0 }] }
    expect(draftAudioSchema.safeParse({ ...base, script: words(500) }).success).toBe(true)
    expect(draftAudioSchema.safeParse({ ...base, script: words(419) }).success).toBe(false)
    expect(draftAudioSchema.safeParse({ ...base, script: words(701) }).success).toBe(false)
  })
})

describe('draftWrittenSchema imageQuery', () => {
  const slide = { title: 'T', body: 'kurzer Text' }
  const draft = (extra: object) => ({ title: 'Titel', slides: [{ ...slide, ...extra }, slide, slide] })
  it('accepts slides with and without imageQuery', () => {
    expect(draftWrittenSchema.safeParse(draft({})).success).toBe(true)
    expect(draftWrittenSchema.safeParse(draft({ imageQuery: 'apple tree' })).success).toBe(true)
  })
  it('rejects too short or too long imageQuery', () => {
    expect(draftWrittenSchema.safeParse(draft({ imageQuery: 'x' })).success).toBe(false)
    expect(draftWrittenSchema.safeParse(draft({ imageQuery: 'x'.repeat(41) })).success).toBe(false)
  })
})

describe('draftAudioSchema image query', () => {
  const words = (n: number) => Array(n).fill('wort').join(' ')
  const draft = (image: object) => ({ title: 'Titel', script: words(500), images: [image] })
  it('accepts optional images[].query', () => {
    expect(draftAudioSchema.safeParse(draft({ prompt: 'eine Zeichnung', atFraction: 0 })).success).toBe(true)
    expect(draftAudioSchema.safeParse(draft({ prompt: 'eine Zeichnung', atFraction: 0, query: 'apple tree' })).success).toBe(true)
    expect(draftAudioSchema.safeParse(draft({ prompt: 'eine Zeichnung', atFraction: 0, query: 'x' })).success).toBe(false)
  })
})

describe('imagePickSchema', () => {
  it('accepts an index or null', () => {
    expect(imagePickSchema.safeParse({ index: 2 }).success).toBe(true)
    expect(imagePickSchema.safeParse({ index: null }).success).toBe(true)
    expect(imagePickSchema.safeParse({ index: -1 }).success).toBe(false)
  })
})
