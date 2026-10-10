import { describe, expect, it } from 'vitest'
import { draftAudioSchema, draftWrittenSchema, evaluateCheck, imagePickSchema, scheduleImages } from '../src/pipeline.js'

const ok = [{ url: 'https://a.de', ok: true, status: 200 }]

describe('evaluateCheck', () => {
  it('passes when all claims are sourced and links work', () => {
    expect(evaluateCheck({ claims: [{ text: 'x', sourceIndex: 0 }], issues: [] }, ok).passed).toBe(true)
  })
  it('fails on an unsupported claim', () => {
    const r = evaluateCheck({ claims: [{ text: 'x', sourceIndex: null }], issues: [] }, ok)
    expect(r.passed).toBe(false)
    expect(r.unsupportedClaims).toBe(1)
  })
  it('fails on a high-severity issue or dead link, not on a low one', () => {
    expect(evaluateCheck({ claims: [], issues: [{ severity: 'high', message: 'm' }] }, ok).passed).toBe(false)
    expect(evaluateCheck({ claims: [], issues: [{ severity: 'low', message: 'm' }] }, ok).passed).toBe(true)
    expect(evaluateCheck({ claims: [], issues: [] }, [{ url: 'u', ok: false, status: 404 }]).passed).toBe(false)
  })
})

describe('scheduleImages', () => {
  it('maps fractions to seconds inside the duration', () => {
    expect(scheduleImages(200, [0, 0.5, 0.95])).toEqual([0, 100, 190])
    expect(scheduleImages(10, [1])).toEqual([9])
  })
})

describe('draftAudioSchema', () => {
  const words = (n: number) => Array(n).fill('wort').join(' ')
  it('enforces 420–700 words', () => {
    const base = { title: 'Titel', images: [{ prompt: 'eine Zeichnung', atFraction: 0 }] }
    expect(draftAudioSchema.safeParse({ ...base, script: words(500) }).success).toBe(true)
    expect(draftAudioSchema.safeParse({ ...base, script: words(419) }).success).toBe(false)
    expect(draftAudioSchema.safeParse({ ...base, script: words(701) }).success).toBe(false)
  })
})

describe('draftWrittenSchema imageQuery', () => {
  // v2 drafts need cover + 4–6 slides with 60–120 words (issue #4); hint leniency is unchanged
  const body = Array(90).fill('wort').join(' ')
  const slide = { title: 'T', body }
  const draft = (extra: object) => ({ title: 'Titel', hook: 'Kurzer Aufhänger', cover: { imagePrompt: 'ein Apfel' }, slides: [{ ...slide, ...extra }, slide, slide, slide, slide] })
  it('accepts slides with and without imageQuery', () => {
    expect(draftWrittenSchema.safeParse(draft({})).success).toBe(true)
    expect(draftWrittenSchema.safeParse(draft({ imageQuery: 'apple tree' })).success).toBe(true)
  })
  it('drops too short and truncates too long imageQuery instead of failing the draft', () => {
    expect(draftWrittenSchema.parse(draft({ imageQuery: 'x' })).slides[0]!.imageQuery).toBeUndefined()
    expect(draftWrittenSchema.parse(draft({ imageQuery: 'x'.repeat(41) })).slides[0]!.imageQuery).toBe('x'.repeat(40))
  })
})

describe('draftWrittenSchema v2 (long form)', () => {
  const w = (n: number) => Array(n).fill('wort').join(' ')
  const slide = (n = 90, extra: object = {}) => ({ title: 'T', body: w(n), ...extra })
  const draft = (slides: object[], hook = w(30)) => ({ title: 'Titel', hook, cover: { imagePrompt: 'ein Apfel', imageQuery: 'apple' }, slides })
  it('accepts cover + 5 slides of 90 words + 30-word hook (480 words)', () => {
    expect(draftWrittenSchema.safeParse(draft(Array(5).fill(slide()))).success).toBe(true)
  })
  it('rejects 3 or 7 slides', () => {
    expect(draftWrittenSchema.safeParse(draft(Array(3).fill(slide(120)))).success).toBe(false)
    expect(draftWrittenSchema.safeParse(draft(Array(7).fill(slide(60)))).success).toBe(false)
  })
  it('enforces 420–600 total words and reports the count', () => {
    const r = draftWrittenSchema.safeParse(draft(Array(6).fill(slide(110))))
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('has 690')
    expect(draftWrittenSchema.safeParse(draft(Array(4).fill(slide(60)), w(10))).success).toBe(false)
  })
  it('enforces 60–120 words per slide body and ≤ 35 words hook', () => {
    expect(draftWrittenSchema.safeParse(draft([slide(130), slide(), slide(), slide()])).success).toBe(false)
    expect(draftWrittenSchema.safeParse(draft([slide(40), slide(), slide(), slide(), slide()])).success).toBe(false)
    expect(draftWrittenSchema.safeParse(draft(Array(5).fill(slide()), w(36))).success).toBe(false)
  })
  it('allows at most 2 slide images', () => {
    const img = slide(90, { imagePrompt: 'ein Bild' })
    expect(draftWrittenSchema.safeParse(draft([img, img, slide(), slide(), slide()])).success).toBe(true)
    expect(draftWrittenSchema.safeParse(draft([img, img, img, slide(), slide()])).success).toBe(false)
  })
  it('requires a cover image prompt', () => {
    expect(draftWrittenSchema.safeParse({ ...draft(Array(5).fill(slide())), cover: {} }).success).toBe(false)
  })
})

describe('evaluateCheck trust and verbatim', () => {
  const llm = { claims: [], issues: [] }
  it('derives trust from source tiers without affecting passed', () => {
    expect(evaluateCheck(llm, ok, { tiers: [1, 2], maxVerbatimRun: 0 }).trust).toBe('high')
    expect(evaluateCheck(llm, ok, { tiers: [3], maxVerbatimRun: 0 }).trust).toBe('high')
    expect(evaluateCheck(llm, ok, { tiers: [2, 4], maxVerbatimRun: 0 }).trust).toBe('mixed')
    const low = evaluateCheck(llm, ok, { tiers: [4], maxVerbatimRun: 0 })
    expect(low.trust).toBe('low')
    expect(low.passed).toBe(true)
  })
  it('fails with a high issue when 12+ words are copied verbatim', () => {
    const r = evaluateCheck(llm, ok, { tiers: [1], maxVerbatimRun: 12 })
    expect(r.passed).toBe(false)
    expect(r.maxVerbatimRun).toBe(12)
    expect(r.issues).toContainEqual({ severity: 'high', message: 'Wörtliche Übernahme aus Quelle (12 Wörter am Stück)' })
    expect(evaluateCheck(llm, ok, { tiers: [1], maxVerbatimRun: 11 }).passed).toBe(true)
  })
  it('defaults to unknown trust when no source info is given (legacy callers)', () => {
    expect(evaluateCheck(llm, ok).trust).toBe('low')
  })
})

describe('draftAudioSchema image query', () => {
  const words = (n: number) => Array(n).fill('wort').join(' ')
  const draft = (image: object) => ({ title: 'Titel', script: words(500), images: [image] })
  it('accepts optional images[].query', () => {
    expect(draftAudioSchema.safeParse(draft({ prompt: 'eine Zeichnung', atFraction: 0 })).success).toBe(true)
    expect(draftAudioSchema.safeParse(draft({ prompt: 'eine Zeichnung', atFraction: 0, query: 'apple tree' })).success).toBe(true)
    expect(draftAudioSchema.parse(draft({ prompt: 'eine Zeichnung', atFraction: 0, query: 'x' })).images[0]!.query).toBeUndefined()
  })
})

describe('imagePickSchema', () => {
  it('accepts an index or null', () => {
    expect(imagePickSchema.safeParse({ index: 2 }).success).toBe(true)
    expect(imagePickSchema.safeParse({ index: null }).success).toBe(true)
    expect(imagePickSchema.safeParse({ index: -1 }).success).toBe(false)
  })
})

describe('draft image hints are lenient (small local models)', () => {
  const body = Array(90).fill('wort').join(' ') // v2 drafts need 60–120 words per slide (issue #4)
  const slide = (extra: Record<string, unknown>) => ({ title: 'T', body, ...extra })
  const draft = (extra: Record<string, unknown>) => ({ title: 'Titel', hook: 'Aufhänger', cover: { imagePrompt: 'ein Apfel' }, slides: [slide(extra), slide({}), slide({}), slide({}), slide({})] })

  it('treats null and empty strings as absent', () => {
    const d = draftWrittenSchema.parse(draft({ imagePrompt: null, imageQuery: '' }))
    expect(d.slides[0]!.imagePrompt).toBeUndefined()
    expect(d.slides[0]!.imageQuery).toBeUndefined()
  })

  it('joins array queries and clamps them to 40 chars at a word boundary', () => {
    const d = draftWrittenSchema.parse(draft({ imagePrompt: 'Eier auf Holztisch', imageQuery: ['eggs', 'beans'] }))
    expect(d.slides[0]!.imageQuery).toBe('eggs beans')
    const long = draftWrittenSchema.parse(draft({ imageQuery: 'grilled chicken breast lentils chickpeas tofu' }))
    expect(long.slides[0]!.imageQuery).toBe('grilled chicken breast lentils chickpeas')
  })

  it('applies the same leniency to audio image queries', () => {
    const script = Array.from({ length: 450 }, () => 'wort').join(' ')
    const d = draftAudioSchema.parse({ title: 'Titel', script, images: [{ prompt: 'Ein Teller', query: null, atFraction: 0.1 }] })
    expect(d.images[0]!.query).toBeUndefined()
  })
})

describe('draftAudioSchema word count message', () => {
  it('reports the actual word count and direction', () => {
    const r = draftAudioSchema.safeParse({ title: 'Titel', script: Array(300).fill('wort').join(' '), images: [{ prompt: 'Ein Teller', atFraction: 0 }] })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toContain('has 300 (expand)')
  })
})
