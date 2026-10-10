import { describe, expect, it } from 'vitest'
import { pickOnePerPair } from '../src/feed-repo.js'

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
