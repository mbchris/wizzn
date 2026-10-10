import { describe, expect, it } from 'vitest'
import { speakable } from '../../src/providers/tts.js'

describe('speakable', () => {
  it('spells out acronyms with German letter names', () => {
    expect(speakable('Kauf ETFs statt Aktien.')).toBe('Kauf E-Te-Effs statt Aktien.')
    expect(speakable('Ein ETF der EZB')).toBe('Ein E-Te-Eff der E-Zett-Be')
    expect(speakable('Die USA und die EU')).toBe('Die U-Ess-A und die E-U')
  })
  it('keeps acronyms spoken as words and normal words', () => {
    expect(speakable('Der DAX und die NATO')).toBe('Der DAX und die NATO')
    expect(speakable('Ich gehe heute A und Bank')).toBe('Ich gehe heute A und Bank')
  })
})
