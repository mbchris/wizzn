import { describe, expect, it } from 'vitest'
import { audioUnitSchema, formatLicense, imageCreditSchema, writtenUnitSchema } from '../src/content.js'

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

describe('formatLicense', () => {
  it('formats license code and version', () => {
    expect(formatLicense({ license: 'by-sa', licenseVersion: '4.0' })).toBe('CC BY-SA 4.0')
    expect(formatLicense({ license: 'by', licenseVersion: '2.0' })).toBe('CC BY 2.0')
    expect(formatLicense({ license: 'cc0', licenseVersion: '1.0' })).toBe('CC0 1.0')
    expect(formatLicense({ license: 'pdm', licenseVersion: null })).toBe('Gemeinfrei')
    expect(formatLicense({ license: 'by', licenseVersion: null })).toBe('CC BY')
  })
})

describe('imageCreditSchema', () => {
  const credit = {
    title: 'Apfel',
    creator: null,
    creatorUrl: null,
    license: 'by-sa',
    licenseVersion: '4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Apfel.jpg',
    provider: 'commons',
    providerId: '123',
  }
  it('accepts a valid credit', () => {
    expect(imageCreditSchema.safeParse(credit).success).toBe(true)
  })
  it('rejects non-whitelisted licenses and non-URL licenseUrl', () => {
    expect(imageCreditSchema.safeParse({ ...credit, license: 'by-nc' }).success).toBe(false)
    expect(imageCreditSchema.safeParse({ ...credit, licenseUrl: 'not a url' }).success).toBe(false)
  })
})
