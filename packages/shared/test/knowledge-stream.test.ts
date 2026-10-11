import { describe, expect, it } from 'vitest'
import { buildAffinity, jaccard, levelLabel, parseBatchFile, rankCandidates, scoreRelated, topicTokens, unlockedLevel, EMPTY_AFFINITY, type FeedbackSignal, type FieldDto } from '../src/index.js'

const now = new Date('2026-10-11T12:00:00Z')
const sig = (p: Partial<FeedbackSignal>): FeedbackSignal => ({ vote: 1, fieldId: 'F', themeId: null, series: null, level: 1, at: now, ...p })

describe('levels', () => {
  it('labels levels', () => expect(levelLabel(3)).toBe('L3 · Praxis'))
})

describe('buildAffinity', () => {
  it('weights series > theme > field and halves old votes', () => {
    const old = new Date(now.getTime() - 20 * 86_400_000)
    const a = buildAffinity([sig({ series: 's', themeId: 't' }), sig({ vote: -1, fieldId: 'G', at: old })], now)
    expect(a.series).toEqual({ s: 3 })
    expect(a.theme).toEqual({ t: 2 })
    expect(a.field).toEqual({ F: 1, G: -0.5 })
  })
  it('unlocks level n+1 after "more" on level n, capped at 5, never lowered by "less"', () => {
    expect(unlockedLevel(EMPTY_AFFINITY, 's')).toBe(1)
    const a = buildAffinity([sig({ series: 's', level: 2 }), sig({ series: 's', level: 1 }), sig({ vote: -1, series: 's', level: 3 })], now)
    expect(unlockedLevel(a, 's')).toBe(3)
    expect(unlockedLevel(buildAffinity([sig({ series: 's', level: 5 })], now), 's')).toBe(5)
  })
})

describe('rankCandidates', () => {
  const c = (id: string, p: object = {}) => ({ id, fieldId: 'F', ...p })
  it('hides locked levels of a series but keeps units without series', () => {
    const out = rankCandidates([c('a', { series: 's', level: 1 }), c('b', { series: 's', level: 2 }), c('x', { level: 4 })], EMPTY_AFFINITY)
    expect(out.map((x) => x.id)).toEqual(['a', 'x'])
  })
  it('sorts liked first, keeps recency for ties and drops strongly disliked', () => {
    const a = buildAffinity([sig({ series: 'veg', themeId: 'protein' }), sig({ vote: -1, series: 'keto', themeId: 'keto', fieldId: 'N' })], now)
    const out = rankCandidates(
      [c('new'), c('liked', { series: 'veg', themeId: 'protein' }), c('hated', { series: 'keto', themeId: 'keto' }), c('old')],
      a,
    )
    expect(out.map((x) => x.id)).toEqual(['liked', 'new', 'old'])
  })
  it('prefers chosen themes', () => {
    expect(rankCandidates([c('a', { themeId: 'x' }), c('b', { themeId: 'y' })], EMPTY_AFFINITY, ['y']).map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('links', () => {
  it('tokenises without stop words', () => expect([...topicTokens('Warum Linsen das bessere Protein sind')]).toEqual(['linsen', 'bessere', 'protein']))
  it('scores overlap and skips the pair sibling', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
    const out = scoreRelated({ id: '1', pairId: 'p', text: 'Pflanzliches Protein aus Linsen' }, [
      { id: '2', pairId: 'p', text: 'Pflanzliches Protein aus Linsen' },
      { id: '3', pairId: null, text: 'Linsen Protein Rezepte' },
      { id: '4', pairId: null, text: 'ETF Sparplan' },
    ])
    expect(out.map((r) => r.id)).toEqual(['3'])
  })
})

describe('batch: levels and series', () => {
  const fields: FieldDto[] = [
    { id: '00000000-0000-4000-8000-000000000001', slug: 'nutrition', nameDe: 'Ernährung', adviceDisclaimer: true, themes: [] },
    { id: '00000000-0000-4000-8000-000000000002', slug: 'sports', nameDe: 'Sport', adviceDisclaimer: false, themes: [] },
  ]
  it('defaults to level 1 without series (old files stay valid)', () => {
    const { rows } = parseBatchFile(JSON.stringify({ version: 1, jobs: [{ field: 'nutrition', topic: 'Protein allgemein' }] }), fields)
    expect(rows[0]!.briefs[0]).toMatchObject({ level: 1, series: null, crossFieldId: null })
  })
  it('resolves level, series and cross field', () => {
    const job = { field: 'nutrition', topic: 'Protein im Training', level: 4, series: 'Veg-Protein', crossField: 'Sport' }
    const { rows } = parseBatchFile(JSON.stringify([job]), fields)
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.briefs[0]).toMatchObject({ level: 4, series: 'veg-protein', crossFieldId: fields[1]!.id })
  })
  it('rejects bad levels, series and unknown cross fields', () => {
    const { rows } = parseBatchFile(
      JSON.stringify([
        { field: 'nutrition', topic: 'abc', level: 6 },
        { field: 'nutrition', topic: 'abc', series: 'mit leerzeichen' },
        { field: 'nutrition', topic: 'abc', crossField: 'astro' },
      ]),
      fields,
    )
    expect(rows.map((r) => r.errors.length > 0)).toEqual([true, true, true])
  })
})
