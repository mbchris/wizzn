import { describe, expect, it } from 'vitest'
import { STUCK_AFTER_MS, canDelete, canTransition, isStuck } from '../src/unit-status.js'
import { FIELD_SEEDS } from '../src/fields.js'

describe('canTransition', () => {
  it('locks published units and publishes them again', () => {
    expect(canTransition('published', 'locked')).toBe(true)
    expect(canTransition('locked', 'published')).toBe(true)
    expect(canTransition('locked', 'queued')).toBe(true)
    expect(canTransition('in_review', 'locked')).toBe(false)
    expect(canTransition('locked', 'in_review')).toBe(false)
  })
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
  it('allows stuck units', () => expect(canDelete('drafting', true)).toBe(true))
})

describe('isStuck', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()
  it('flags working units older than the job expiry', () => {
    expect(isStuck('drafting', ago(STUCK_AFTER_MS + 1), now)).toBe(true)
    expect(isStuck('rendering_media', ago(STUCK_AFTER_MS + 1), now)).toBe(true)
  })
  it('ignores fresh working units and idle statuses', () => {
    expect(isStuck('drafting', ago(60_000), now)).toBe(false)
    expect(isStuck('queued', ago(STUCK_AFTER_MS * 10), now)).toBe(false)
    expect(isStuck('in_review', ago(STUCK_AFTER_MS * 10), now)).toBe(false)
  })
})

describe('FIELD_SEEDS', () => {
  it('has the 7 launch fields with unique slugs', () => {
    expect(FIELD_SEEDS.map((f) => f.slug)).toEqual(['nutrition', 'funfacts', 'partnership', 'finance', 'sports', 'psychology', 'work'])
  })
})
