import { describe, expect, it } from 'vitest'
import { duplicateGroups, type DuplicateCandidate } from '../src/duplicates.js'

const unit = (id: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  format: 'written',
  fieldSlug: 'ernaehrung',
  series: null,
  text: `thema${id}`,
  ...over,
})

describe('duplicateGroups', () => {
  it('groups units of the same series and format regardless of level text', () => {
    const groups = duplicateGroups([
      unit('a', { series: 'veg-protein', text: 'Pflanzliches Eiweiß Überblick' }),
      unit('b', { series: 'veg-protein', text: 'Linsen richtig kochen' }),
      unit('c', { series: 'schlaf', text: 'Schlafphasen verstehen' }),
    ])
    expect(groups).toEqual([{ ids: ['a', 'b'], reasons: ['series'] }])
  })

  it('never groups a written unit with an audio unit', () => {
    const groups = duplicateGroups([
      unit('a', { series: 'veg-protein', text: 'Pflanzliches Eiweiß Überblick' }),
      unit('b', { series: 'veg-protein', text: 'Pflanzliches Eiweiß Überblick', format: 'audio' }),
    ])
    expect(groups).toEqual([])
  })

  it('treats the numbered variant of an existing series key as the same series', () => {
    const groups = duplicateGroups([
      unit('a', { series: 'veg-protein', text: 'Pflanzliches Eiweiß' }),
      unit('b', { series: 'veg-protein-2', text: 'Linsen kochen' }),
      unit('c', { series: 'veg-protein-2-2', text: 'Tofu marinieren' }),
    ])
    expect(groups).toEqual([{ ids: ['a', 'b', 'c'], reasons: ['series'] }])
  })

  it('keeps keys that merely end in a number apart when the shorter key does not exist', () => {
    const groups = duplicateGroups([unit('a', { series: 'omega-3', text: 'Fischöl' }), unit('b', { series: 'omega-6', text: 'Sonnenblumenöl' })])
    expect(groups).toEqual([])
  })

  it('groups units of one field whose title and core idea share most content words', () => {
    const groups = duplicateGroups([
      unit('a', { text: 'Notgroschen aufbauen: Wie viel Rücklage brauchst du?', fieldSlug: 'finanzen' }),
      unit('b', { text: 'Notgroschen aufbauen – wie viel Rücklage du brauchst', fieldSlug: 'finanzen' }),
      unit('c', { text: 'ETF Sparplan starten', fieldSlug: 'finanzen' }),
    ])
    expect(groups).toEqual([{ ids: ['a', 'b'], reasons: ['subject'] }])
  })

  it('does not group the same subject across fields', () => {
    const groups = duplicateGroups([
      unit('a', { text: 'Notgroschen aufbauen Rücklage', fieldSlug: 'finanzen' }),
      unit('b', { text: 'Notgroschen aufbauen Rücklage', fieldSlug: 'psychologie' }),
    ])
    expect(groups).toEqual([])
  })

  it('does not group units that share only a few words', () => {
    const groups = duplicateGroups([
      unit('a', { text: 'Protein nach dem Training: Timing und Menge' }),
      unit('b', { text: 'Protein in Hülsenfrüchten: Linsen, Bohnen, Erbsen' }),
    ])
    expect(groups).toEqual([])
  })

  it('merges chains into one group and reports both reasons', () => {
    const groups = duplicateGroups([
      unit('a', { series: 'schlaf', text: 'Schlafphasen verstehen REM Tiefschlaf' }),
      unit('b', { series: 'schlaf', text: 'Abendroutine planen' }),
      unit('c', { text: 'Abendroutine planen' }),
    ])
    expect(groups).toEqual([{ ids: ['a', 'b', 'c'], reasons: ['series', 'subject'] }])
  })
})
