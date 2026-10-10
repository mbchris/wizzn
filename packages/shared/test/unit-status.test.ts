import { describe, expect, it } from 'vitest'
import { canDelete, canTransition } from '../src/unit-status.js'
import { FIELD_SEEDS } from '../src/fields.js'

describe('canTransition', () => {
  it('moves forward one pipeline step', () => {
    expect(canTransition('queued', 'researching')).toBe(true)
    expect(canTransition('rendering_media', 'in_review')).toBe(true)
  })
  it('cannot skip steps or publish before review', () => {
    expect(canTransition('queued', 'drafting')).toBe(false)
    expect(canTransition('checking', 'published')).toBe(false)
  })
  it('review leads to published or rejected', () => {
    expect(canTransition('in_review', 'published')).toBe(true)
    expect(canTransition('in_review', 'rejected')).toBe(true)
  })
  it('failed units can be requeued', () => expect(canTransition('failed', 'queued')).toBe(true))
  it('published units can be regenerated', () => expect(canTransition('published', 'queued')).toBe(true))
  it('units mid-pipeline cannot be requeued', () => expect(canTransition('drafting', 'queued')).toBe(false))
})

describe('canDelete', () => {
  it('allows idle units', () => {
    for (const s of ['queued', 'in_review', 'published', 'rejected', 'failed'] as const) expect(canDelete(s)).toBe(true)
  })
  it('blocks units a worker is processing', () => {
    for (const s of ['researching', 'drafting', 'checking', 'rendering_media'] as const) expect(canDelete(s)).toBe(false)
  })
})

describe('FIELD_SEEDS', () => {
  it('has the 5 launch fields with unique slugs', () => {
    expect(FIELD_SEEDS.map((f) => f.slug)).toEqual(['nutrition', 'partnership', 'finance', 'sports', 'psychology'])
  })
})
