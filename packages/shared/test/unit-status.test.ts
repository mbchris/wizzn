import { describe, expect, it } from 'vitest'
import { canTransition } from '../src/unit-status.js'
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
})

describe('FIELD_SEEDS', () => {
  it('has the 5 launch fields with unique slugs', () => {
    expect(FIELD_SEEDS.map((f) => f.slug)).toEqual(['nutrition', 'partnership', 'finance', 'sports', 'psychology'])
  })
})
