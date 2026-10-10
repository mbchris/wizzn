import { describe, expect, it } from 'vitest'
import { parseBatchFile, type FieldDto } from '../src/index.js'

const F = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const T = '8f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const fields: FieldDto[] = [{ id: F, slug: 'finanzen', nameDe: 'Finanzen', adviceDisclaimer: true, themes: [{ id: T, slug: 'sparen', nameDe: 'Sparen' }] }]

describe('parseBatchFile', () => {
  it('resolves field/theme by slug or name and splits format "both"', () => {
    const { rows, fileError } = parseBatchFile(
      JSON.stringify({ version: 1, jobs: [{ field: 'FINANZEN', theme: 'Sparen', topic: 'Notgroschen', storyArc: 'quest', count: 2 }] }),
      fields,
    )
    expect(fileError).toBeNull()
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.briefs.map((b) => [b.format, b.fieldId, b.themeId, b.count, b.storyArc])).toEqual([
      ['written', F, T, 2, 'quest'],
      ['audio', F, T, 2, 'quest'],
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
