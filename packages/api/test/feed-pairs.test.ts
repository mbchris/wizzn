import { describe, expect, it } from 'vitest'
import { counterpartIds, pickOnePerPair } from '../src/feed-repo.js'

const rows = [
  { id: 'w1', pairId: 'p1' },
  { id: 'solo', pairId: null },
  { id: 'a1', pairId: 'p1' },
  { id: 'a2', pairId: 'p2' },
  { id: 'w2', pairId: 'p2' },
]

describe('pickOnePerPair', () => {
  it('keeps exactly one variant per slides/audio pair at the first position', () => {
    expect(pickOnePerPair(rows, () => 0).map((r) => r.id)).toEqual(['w1', 'solo', 'a2'])
    expect(pickOnePerPair(rows, () => 0.99).map((r) => r.id)).toEqual(['a1', 'solo', 'w2'])
  })

  it('passes single remaining variants through', () => {
    expect(pickOnePerPair([{ id: 'a1', pairId: 'p1' }], () => 0.5).map((r) => r.id)).toEqual(['a1'])
  })
})

describe('counterpartIds', () => {
  const published = [
    { id: 'w1', pairId: 'p1' },
    { id: 'a1', pairId: 'p1' },
    { id: 'a2', pairId: 'p2' },
  ]

  it('links each variant of a pair to the other one', () => {
    const out = counterpartIds([{ id: 'w1', pairId: 'p1' }, { id: 'a1', pairId: 'p1' }], published)
    expect(out.get('w1')).toBe('a1')
    expect(out.get('a1')).toBe('w1')
  })

  it('has no entry for unpaired units', () => {
    expect(counterpartIds([{ id: 'solo', pairId: null }], published).get('solo')).toBeUndefined()
  })

  it('has no entry when the sibling is not published', () => {
    expect(counterpartIds([{ id: 'a2', pairId: 'p2' }], published).get('a2')).toBeUndefined()
  })
})
