import { describe, expect, it } from 'vitest'
import { draftAudioPrompt, draftWrittenPrompt, levelBlock, type BriefContext } from '../../src/pipeline/prompts.js'

const b: BriefContext = { fieldSlug: 'nutrition', fieldName: 'Ernährung', themeName: 'Vegetarisch', topic: 'Protein ohne Fleisch', context: '', adviceDisclaimer: true }

describe('level-aware prompts', () => {
  it('defaults to level 1 overview', () => {
    expect(levelBlock(b)).toContain('Wissensstufe: 1 von 5 – Überblick')
  })
  it('level 4 bridges to the cross field and builds on prior titles', () => {
    const text = levelBlock({ ...b, level: 4, crossFieldName: 'Sport', seriesPrior: ['Vegetarisches Protein', 'Linsen im Detail'] })
    expect(text).toContain('Querverbindung')
    expect(text).toContain('„Sport“')
    expect(text).toContain('„Linsen im Detail“')
  })
  it('asks to assume prior knowledge above level 1 without prior titles', () => {
    expect(levelBlock({ ...b, level: 3 })).toContain('Grundwissen der vorigen Stufen')
  })
  it('is part of both draft prompts', () => {
    for (const p of [draftWrittenPrompt, draftAudioPrompt]) {
      expect(p({ ...b, level: 5 }, []).map((m) => m.content).join('\n')).toContain('Expertenwissen')
    }
  })
})
