import { describe, expect, it } from 'vitest'
import { longestSharedRun } from '../../src/pipeline/overlap.js'

const source = 'Die Deutsche Gesellschaft für Ernährung empfiehlt Erwachsenen 0,8 Gramm Protein pro Kilogramm Körpergewicht und Tag, ältere Menschen brauchen etwas mehr.'

describe('longestSharedRun', () => {
  it('finds a copied sentence ignoring case and punctuation', () => {
    const draft = 'Wichtig: die deutsche Gesellschaft für Ernährung empfiehlt Erwachsenen 0,8 Gramm Protein pro Kilogramm Körpergewicht! Danach mehr.'
    expect(longestSharedRun(draft, [source])).toBe(13)
  })
  it('is small for own wording and 0 without excerpts', () => {
    expect(longestSharedRun('Für Erwachsene rät die DGE zu knapp einem Gramm Eiweiß je Kilo.', [source])).toBeLessThan(3)
    expect(longestSharedRun('irgendwas', [])).toBe(0)
  })
  it('takes the maximum across excerpts', () => {
    expect(longestSharedRun('a b c d e f', ['x a b y', 'c d e f'])).toBe(4)
  })
})
