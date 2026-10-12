import { describe, expect, it } from 'vitest'
import { contextFilename, contextJobs, formatContextFile, parseBatchFile, type ContextUnit, type FieldDto } from '../src/index.js'

const sources = [{ url: 'https://bundesbank.de/a', title: 'Sparen', publisher: 'Bundesbank' }]
const slides = [1, 2, 3].map((n) => ({ title: `Slide ${n}`, body: `Text ${n}`, imageId: `img${n}` }))
const unit = (extra: Partial<ContextUnit>): ContextUnit => ({
  id: '11111111-1111-4111-8111-111111111111',
  pairId: null,
  fieldSlug: 'finanzen',
  themeSlug: 'sparen',
  crossFieldSlug: null,
  brief: { topic: 'Notgroschen', context: 'Briefing', style: null, storyArc: 'quest', format: null, count: 1, level: 1, series: null },
  title: 'Dein Notgroschen',
  contentJson: { format: 'written', cover: { hook: 'Drei Gehälter?', imageId: 'c' }, slides, sources },
  ...extra,
})

describe('contextJobs', () => {
  it('exports the brief in import shape plus the published text without media ids', () => {
    expect(contextJobs([unit({})])).toEqual([
      {
        ref: '11111111-1111-4111-8111-111111111111',
        field: 'finanzen',
        theme: 'sparen',
        topic: 'Notgroschen',
        context: 'Briefing',
        format: 'both',
        style: null,
        storyArc: 'quest',
        count: 1,
        level: 1,
        series: null,
        crossField: null,
        published: { title: 'Dein Notgroschen', hook: 'Drei Gehälter?', slides: slides.map(({ title, body }) => ({ title, body })), sources },
      },
    ])
  })
  it('exports a written/audio pair once, as the written unit', () => {
    const audio = unit({ id: '22222222-2222-4222-8222-222222222222', pairId: 'p', contentJson: { format: 'audio', script: 'Hallo', durationSec: 200, audioId: 'a', images: [{ imageId: 'i', showAtSec: 0 }], sources } })
    const jobs = contextJobs([audio, unit({ pairId: 'p' })])
    expect(jobs.map((j) => j.ref)).toEqual(['11111111-1111-4111-8111-111111111111'])
  })
  it('exports the script of an audio-only unit', () => {
    const [job] = contextJobs([unit({ brief: { ...unit({}).brief, format: 'audio' }, contentJson: { format: 'audio', script: 'Hallo', durationSec: 200, audioId: 'a', images: [{ imageId: 'i', showAtSec: 0 }], sources } })])
    expect(job?.format).toBe('audio')
    expect(job?.published).toEqual({ title: 'Dein Notgroschen', script: 'Hallo', sources })
  })
  it('leaves out units without renderable content', () => {
    expect(contextJobs([unit({ contentJson: null }), unit({ contentJson: { format: 'written' } })])).toEqual([])
  })
})

describe('formatContextFile', () => {
  const fields: FieldDto[] = [{ id: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc', slug: 'finanzen', nameDe: 'Finanzen', adviceDisclaimer: true, themes: [{ id: '8f1c2a3e-1b2c-4d5e-8f90-123456789abc', slug: 'sparen', nameDe: 'Sparen' }] }]
  it('writes a version 1 file that batch import reads back as skipped rows', () => {
    const text = formatContextFile(contextJobs([unit({})]))
    expect(JSON.parse(text)).toMatchObject({ version: 1, kind: 'context' })
    const { rows, fileError } = parseBatchFile(text, fields)
    expect(fileError).toBeNull()
    expect(rows.map((r) => [r.skipped, r.errors])).toEqual([[true, []]])
  })
  it('names the file by export time', () => {
    expect(contextFilename(new Date(2026, 9, 12, 9, 5))).toBe('wizzn-context-20261012-0905.json')
  })
})
