import { describe, expect, it } from 'vitest'
import { formatPushList, pushListFilename } from '../src/push-list.js'

const ID_A = '3f2a1b9c-0000-4000-8000-000000000001'
const ID_B = '3f2a1b9c-0000-4000-8000-000000000002'
const at = new Date(2026, 9, 12, 14, 5)

describe('formatPushList', () => {
  it('writes a comment header and one tab-separated line per unit, id first', () => {
    const text = formatPushList(
      [
        { id: ID_A, status: 'published', format: 'audio', title: 'Notgroschen', topic: 'Kernidee' },
        { id: ID_B, status: 'in_review', format: 'written', title: null, topic: 'Nur Kernidee' },
      ],
      at,
    )
    expect(text).toBe(
      `# wizzn push list · 2026-10-12 14:05 · 2 units\n${ID_A}\tpublished\taudio\tNotgroschen\n${ID_B}\tin_review\twritten\tNur Kernidee\n`,
    )
  })

  it('keeps every unit on one line when the title contains tabs or line breaks', () => {
    const text = formatPushList([{ id: ID_A, status: 'published', format: 'audio', title: 'Zeile 1\nZeile\t2', topic: '' }], at)
    expect(text.split('\n')).toEqual([expect.stringMatching(/^#/), `${ID_A}\tpublished\taudio\tZeile 1 Zeile 2`, ''])
  })
})

describe('pushListFilename', () => {
  it('is sortable by export time', () => {
    expect(pushListFilename(at)).toBe('wizzn-push-20261012-1405.txt')
  })
})
