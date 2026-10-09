import { describe, expect, it } from 'vitest'
import { audioUnitSchema, writtenUnitSchema } from '../src/content.js'

const source = { url: 'https://www.dge.de/x', title: 'Protein', publisher: 'DGE' }
const slide = { title: 'T', body: 'kurzer Text' }

describe('writtenUnitSchema', () => {
  it('accepts 3 slides with a source', () => {
    expect(writtenUnitSchema.safeParse({ format: 'written', slides: [slide, slide, slide], sources: [source] }).success).toBe(true)
  })
  it('rejects 2 or 6 slides', () => {
    expect(writtenUnitSchema.safeParse({ format: 'written', slides: [slide, slide], sources: [source] }).success).toBe(false)
    expect(writtenUnitSchema.safeParse({ format: 'written', slides: Array(6).fill(slide), sources: [source] }).success).toBe(false)
  })
  it('rejects a slide body over 60 words', () => {
    const long = { title: 'T', body: Array(61).fill('wort').join(' ') }
    expect(writtenUnitSchema.safeParse({ format: 'written', slides: [long, slide, slide], sources: [source] }).success).toBe(false)
  })
  it('rejects missing sources', () => {
    expect(writtenUnitSchema.safeParse({ format: 'written', slides: [slide, slide, slide], sources: [] }).success).toBe(false)
  })
})

describe('audioUnitSchema', () => {
  const base = { format: 'audio', script: 's', durationSec: 240, audioId: 'a1', images: [{ imageId: 'i1', showAtSec: 0 }], sources: [source] }
  it('accepts a 4 min unit', () => expect(audioUnitSchema.safeParse(base).success).toBe(true))
  it('rejects under 3 and over 5 minutes', () => {
    expect(audioUnitSchema.safeParse({ ...base, durationSec: 179 }).success).toBe(false)
    expect(audioUnitSchema.safeParse({ ...base, durationSec: 301 }).success).toBe(false)
  })
  it('rejects images timed after the end', () => {
    expect(audioUnitSchema.safeParse({ ...base, images: [{ imageId: 'i1', showAtSec: 240 }] }).success).toBe(false)
  })
})
