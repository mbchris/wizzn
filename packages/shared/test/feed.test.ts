import { describe, expect, it } from 'vitest'
import { isCompletion, orderFeed, readingMinutes, writtenMinDwellSec, writtenPageCount, writtenWordCount } from '../src/feed.js'
import type { UnitContent, WrittenUnit } from '../src/content.js'

const c = (id: string, fieldId: string) => ({ id, fieldId })

describe('orderFeed', () => {
  it('alternates selected fields and puts discovery on every 5th slot', () => {
    const cands = [c('a1', 'A'), c('a2', 'A'), c('a3', 'A'), c('b1', 'B'), c('b2', 'B'), c('x1', 'X')]
    expect(orderFeed(cands, ['A', 'B'], 6)).toEqual([
      { id: 'a1', discovery: false },
      { id: 'b1', discovery: false },
      { id: 'a2', discovery: false },
      { id: 'b2', discovery: false },
      { id: 'x1', discovery: true },
      { id: 'a3', discovery: false },
    ])
  })
  it('fills with discovery when selected fields run out', () => {
    expect(orderFeed([c('a1', 'A'), c('x1', 'X'), c('x2', 'X')], ['A'], 10).map((u) => u.id)).toEqual(['a1', 'x1', 'x2'])
  })
  it('returns an empty list without candidates', () => {
    expect(orderFeed([], ['A'], 10)).toEqual([])
  })
})

describe('isCompletion', () => {
  const src = [{ url: 'https://a.de', title: 't', publisher: 'p' }]
  const written: UnitContent = { format: 'written', slides: [{ title: 'a', body: 'b' }, { title: 'a', body: 'b' }, { title: 'a', body: 'b' }], sources: src }
  const audio: UnitContent = { format: 'audio', script: 's', durationSec: 200, audioId: 'x', images: [{ imageId: 'i', showAtSec: 0 }], sources: src }
  it('long-form written needs cover + all slides and length-based dwell', () => {
    const body = Array(95).fill('wort').join(' ')
    const long: UnitContent = { format: 'written', cover: { hook: Array(25).fill('wort').join(' '), imageId: 'i' }, slides: Array(5).fill({ title: 'a', body }), sources: src }
    expect(writtenPageCount(long)).toBe(6)
    expect(writtenWordCount(long)).toBe(500)
    expect(readingMinutes(long)).toBe(3)
    expect(writtenMinDwellSec(long)).toBe(23)
    expect(isCompletion(long, { format: 'written', slidesSeen: 5, dwellSec: 60 })).toBe('not_enough_progress')
    expect(isCompletion(long, { format: 'written', slidesSeen: 6, dwellSec: 22 })).toBe('not_enough_progress')
    expect(isCompletion(long, { format: 'written', slidesSeen: 6, dwellSec: 23 })).toBeNull()
  })
  it('pre-#4 written units keep 8 s minimum and 1 min reading time', () => {
    expect(writtenMinDwellSec(written as WrittenUnit)).toBe(8)
    expect(writtenPageCount(written as WrittenUnit)).toBe(3)
    expect(readingMinutes(written as WrittenUnit)).toBe(1)
  })
  it('written needs all slides and 8 s', () => {
    expect(isCompletion(written, { format: 'written', slidesSeen: 3, dwellSec: 8 })).toBeNull()
    expect(isCompletion(written, { format: 'written', slidesSeen: 2, dwellSec: 60 })).toBe('not_enough_progress')
    expect(isCompletion(written, { format: 'written', slidesSeen: 3, dwellSec: 7 })).toBe('not_enough_progress')
  })
  it('audio needs 45 % played', () => {
    expect(isCompletion(audio, { format: 'audio', listenedSec: 90 })).toBeNull()
    expect(isCompletion(audio, { format: 'audio', listenedSec: 89 })).toBe('not_enough_progress')
  })
  it('rejects a format mismatch', () => {
    expect(isCompletion(audio, { format: 'written', slidesSeen: 3, dwellSec: 20 })).toBe('format_mismatch')
  })
})
