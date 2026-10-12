import { describe, expect, it } from 'vitest'
import { parseBatchFile, type FieldDto } from '../src/index.js'

const F = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const T = '8f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const fields: FieldDto[] = [{ id: F, slug: 'finanzen', nameDe: 'Finanzen', adviceDisclaimer: true, themes: [{ id: T, slug: 'sparen', nameDe: 'Sparen' }] }]

describe('parseBatchFile', () => {
  it('resolves field/theme by slug or name and maps format "both" to one paired brief', () => {
    const { rows, fileError } = parseBatchFile(
      JSON.stringify({ version: 1, jobs: [{ field: 'FINANZEN', theme: 'Sparen', topic: 'Notgroschen', storyArc: 'quest', count: 2 }] }),
      fields,
    )
    expect(fileError).toBeNull()
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.briefs.map((b) => [b.format, b.fieldId, b.themeId, b.count, b.storyArc])).toEqual([
      [null, F, T, 2, 'quest'],
    ])
  })
  it('accepts a bare array and a ```json fence', () => {
    const { rows } = parseBatchFile('```json\n[{"field":"finanzen","topic":"Zinseszins","format":"audio"}]\n```', fields)
    expect(rows[0]?.briefs).toHaveLength(1)
  })
  it('reports per-row errors without failing other rows', () => {
    const { rows } = parseBatchFile(
      JSON.stringify({ version: 1, jobs: [{ field: 'kochen', topic: 'Pasta' }, { field: 'finanzen', theme: 'aktien', topic: 'ETF' }, { field: 'finanzen', topic: 'x' }, { field: 'finanzen', topic: 'Gut' }] }),
      fields,
    )
    expect(rows[0]?.errors[0]).toContain('Unbekannter Bereich')
    expect(rows[1]?.errors[0]).toContain('Unbekanntes Thema')
    expect(rows[2]?.errors[0]).toContain('topic')
    expect(rows[3]?.errors).toEqual([])
  })
  it('reports invalid JSON and wrong version as file errors', () => {
    expect(parseBatchFile('{nope', fields).fileError).toContain('Kein gültiges JSON')
    expect(parseBatchFile(JSON.stringify({ version: 2, jobs: [{}] }), fields).fileError).toContain('version')
  })
})

const L1 = '11111111-1111-4111-8111-111111111111'
const L1B = '22222222-2222-4222-8222-222222222222'
const job = (extra: Record<string, unknown>) => ({ field: 'finanzen', topic: 'Tagesgeld als Parkplatz', ...extra })
const parse = (jobs: unknown[], refs: Parameters<typeof parseBatchFile>[2] = null) => parseBatchFile(JSON.stringify({ version: 1, jobs }), fields, refs)

describe('parseBatchFile with exported context', () => {
  it('skips entries that carry "published" instead of importing them again', () => {
    const { rows } = parse([job({ ref: L1, published: { title: 'Notgroschen' } }), job({})])
    expect(rows.map((r) => [r.skipped, r.briefs.length, r.errors])).toEqual([[true, 0, []], [false, 1, []]])
  })
  it('blocks jobs with "after" until the referenced units are loaded', () => {
    const { rows } = parse([job({ after: L1, level: 2, series: 'notgroschen' })])
    expect(rows[0]?.errors[0]).toContain('wird geprüft')
    expect(rows[0]?.briefs).toEqual([])
  })
  it('inherits the series of the referenced unit', () => {
    const { rows, assignments } = parse([job({ after: L1, level: 2 })], { units: [{ id: L1, title: 'Notgroschen', level: 1, series: 'notgroschen' }], usedSeries: [] })
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.briefs[0]?.series).toBe('notgroschen')
    expect(rows[0]?.after?.title).toBe('Notgroschen')
    expect(assignments).toEqual([])
  })
  it('rejects a series key that differs from the referenced unit', () => {
    const { rows } = parse([job({ after: L1, level: 2, series: 'anders' })], { units: [{ id: L1, title: 'Notgroschen', level: 1, series: 'notgroschen' }], usedSeries: ['anders'] })
    expect(rows[0]?.errors[0]).toContain('gehört zur Serie „notgroschen“')
  })
  it('assigns the proposed series to a referenced unit without one, once per unit', () => {
    const refs = { units: [{ id: L1, title: 'Notgroschen', level: 1 as const, series: null }], usedSeries: [] }
    const { rows, assignments } = parse([job({ after: L1, level: 2, series: 'Notgroschen' }), job({ after: L1, level: 2, series: 'notgroschen', topic: 'Zweiter Aspekt' })], refs)
    expect(rows.flatMap((r) => r.errors)).toEqual([])
    expect(rows.map((r) => r.briefs[0]?.series)).toEqual(['notgroschen', 'notgroschen'])
    expect(assignments).toEqual([{ unitId: L1, series: 'notgroschen', title: 'Notgroschen' }])
  })
  it('requires a series when the referenced unit has none', () => {
    const { rows } = parse([job({ after: L1, level: 2 })], { units: [{ id: L1, title: 'Notgroschen', level: 1, series: null }], usedSeries: [] })
    expect(rows[0]?.errors[0]).toContain('"series" fehlt')
  })
  it('rejects unknown references and levels that do not go deeper', () => {
    const refs = { units: [{ id: L1, title: 'Notgroschen', level: 2 as const, series: 'notgroschen' }], usedSeries: [] }
    const { rows } = parse([job({ after: L1B, level: 2, series: 'x1' }), job({ after: L1, level: 2 })], refs)
    expect(rows[0]?.errors[0]).toContain('Unbekannter Bezug')
    expect(rows[1]?.errors[0]).toContain('muss über Stufe 2')
  })
  it('rejects a new series key that another ladder already uses', () => {
    const { rows, assignments } = parse([job({ after: L1, level: 2, series: 'vergeben' })], { units: [{ id: L1, title: 'Notgroschen', level: 1, series: null }], usedSeries: ['vergeben'] })
    expect(rows[0]?.errors[0]).toContain('bereits vergeben')
    expect(assignments).toEqual([])
  })
  it('rejects conflicting keys for one unit and one key for two units', () => {
    const refs = { units: [{ id: L1, title: 'A', level: 1 as const, series: null }, { id: L1B, title: 'B', level: 1 as const, series: null }], usedSeries: [] }
    const twoKeys = parse([job({ after: L1, level: 2, series: 'eins' }), job({ after: L1, level: 2, series: 'zwei' })], refs)
    expect(twoKeys.rows[1]?.errors[0]).toContain('bereits die Serie „eins“')
    const oneKey = parse([job({ after: L1, level: 2, series: 'eins' }), job({ after: L1B, level: 2, series: 'eins' })], refs)
    expect(oneKey.rows[1]?.errors[0]).toContain('bereits „A“ zugewiesen')
  })
})
