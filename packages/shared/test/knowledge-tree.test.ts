import { describe, expect, it } from 'vitest'
import { inKnowledgeNode, knowledgeTree, withoutDeeperLevel, type KnowledgeNode, type TreeUnit } from '../src/knowledge-tree.js'

const unit = (id: string, over: Partial<TreeUnit> = {}): TreeUnit => ({
  id,
  fieldSlug: 'ernaehrung',
  themeSlug: 'eiweiss',
  themeName: 'Eiweiß',
  series: null,
  level: 1,
  status: 'published',
  ...over,
})

describe('withoutDeeperLevel', () => {
  it('keeps the deepest units of a series and drops those a higher level continues', () => {
    const ids = withoutDeeperLevel([
      unit('l1', { series: 'veg-protein', level: 1 }),
      unit('l2a', { series: 'veg-protein', level: 2 }),
      unit('l2b', { series: 'veg-protein', level: 2 }),
      unit('other', { series: 'schlaf', level: 1 }),
    ])
    expect([...ids].sort()).toEqual(['l2a', 'l2b', 'other'])
  })

  it('keeps units without a series', () => {
    expect([...withoutDeeperLevel([unit('a'), unit('b')])].sort()).toEqual(['a', 'b'])
  })

  it('drops level 5, which nothing can follow', () => {
    expect([...withoutDeeperLevel([unit('top', { series: 'schlaf', level: 5 }), unit('solo', { level: 5 })])]).toEqual([])
  })

  it.each(['failed', 'rejected'] as const)('ignores a %s unit as the deeper level', (status) => {
    const ids = withoutDeeperLevel([unit('l1', { series: 'schlaf', level: 1 }), unit('l2', { series: 'schlaf', level: 2, status })])
    expect(ids.has('l1')).toBe(true)
  })

  it('counts a unit still in the pipeline as the deeper level', () => {
    const ids = withoutDeeperLevel([unit('l1', { series: 'schlaf', level: 1 }), unit('l2', { series: 'schlaf', level: 2, status: 'queued' })])
    expect(ids.has('l1')).toBe(false)
  })
})

/** key, label and counts per node, indented by depth */
const outline = (nodes: KnowledgeNode[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.key} "${n.label}" ${n.count}/${n.own}`, ...outline(n.children, depth + 1)])

describe('knowledgeTree', () => {
  it('nests field, theme, series and a chain of levels that starts at the lowest existing one', () => {
    const tree = knowledgeTree([
      unit('a', { series: 'veg-protein', level: 2 }),
      unit('b', { series: 'veg-protein', level: 2 }),
      unit('c', { series: 'veg-protein', level: 4 }),
      unit('d'),
      unit('e', { fieldSlug: 'finanzen', themeSlug: null, themeName: null }),
    ])
    expect(outline(tree)).toEqual([
      'field:ernaehrung "ernaehrung" 4/0',
      '  theme:ernaehrung/eiweiss "Eiweiß" 4/0',
      '    series:ernaehrung/eiweiss/veg-protein "veg-protein" 3/0',
      '      level:ernaehrung/eiweiss/veg-protein/2 "L2 · Vertiefung" 3/2',
      '        level:ernaehrung/eiweiss/veg-protein/4 "L4 · Querverbindung" 1/1',
      '    series:ernaehrung/eiweiss/- "ohne Serie" 1/0',
      'field:finanzen "finanzen" 1/0',
      '  theme:finanzen/- "ohne Thema" 1/0',
      '    series:finanzen/-/- "ohne Serie" 1/0',
    ])
  })

  it('sorts themes by name and puts units without a series last', () => {
    const tree = knowledgeTree([
      unit('a'),
      unit('b', { series: 'zink' }),
      unit('c', { themeSlug: 'ballast', themeName: 'Ballaststoffe', series: 'hafer' }),
    ])
    expect(tree[0]!.children.map((t) => t.label)).toEqual(['Ballaststoffe', 'Eiweiß'])
    expect(tree[0]!.children[1]!.children.map((s) => s.label)).toEqual(['zink', 'ohne Serie'])
  })
})

describe('inKnowledgeNode', () => {
  const l2 = unit('a', { series: 'veg-protein', level: 2 })
  it.each([
    ['field:ernaehrung', true],
    ['field:finanzen', false],
    ['theme:ernaehrung/eiweiss', true],
    ['theme:ernaehrung/-', false],
    ['series:ernaehrung/eiweiss/veg-protein', true],
    ['series:ernaehrung/eiweiss/-', false],
    ['level:ernaehrung/eiweiss/veg-protein/1', true],
    ['level:ernaehrung/eiweiss/veg-protein/2', true],
    ['level:ernaehrung/eiweiss/veg-protein/3', false],
    ['level:ernaehrung/eiweiss/schlaf/1', false],
    ['garbage', false],
  ])('%s → %s for a level-2 unit of veg-protein', (key, want) => {
    expect(inKnowledgeNode(l2, key)).toBe(want)
  })

  it('matches units without theme or series by the placeholder nodes', () => {
    const bare = unit('b', { themeSlug: null, themeName: null })
    expect(inKnowledgeNode(bare, 'theme:ernaehrung/-')).toBe(true)
    expect(inKnowledgeNode(bare, 'series:ernaehrung/-/-')).toBe(true)
  })
})
