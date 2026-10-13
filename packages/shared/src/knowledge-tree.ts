import { LEVELS, MAX_LEVEL, levelLabel, type Level } from './levels.js'
import type { UnitStatus } from './unit-status.js'

export interface TreeUnit {
  id: string
  fieldSlug: string
  themeSlug: string | null
  themeName: string | null
  series: string | null
  level: Level
  status: UnitStatus
}

/** A unit in these states never reached readers, so it does not continue its series */
const DEAD: readonly UnitStatus[] = ['failed', 'rejected']

/** IDs of the units a follow-up can still be written for: below the top level and not continued by a deeper level of their series */
export function withoutDeeperLevel(units: Pick<TreeUnit, 'id' | 'series' | 'level' | 'status'>[]): Set<string> {
  const deepest = new Map<string, Level>()
  for (const u of units) {
    if (u.series && !DEAD.includes(u.status) && u.level > (deepest.get(u.series) ?? 0)) deepest.set(u.series, u.level)
  }
  return new Set(units.filter((u) => u.level < MAX_LEVEL && (!u.series || u.level >= (deepest.get(u.series) ?? 0))).map((u) => u.id))
}

export type KnowledgeNodeKind = 'field' | 'theme' | 'series' | 'level'

/** Field → theme → series → chain of levels; `key` selects the node and everything below it (inKnowledgeNode) */
export interface KnowledgeNode {
  key: string
  kind: KnowledgeNodeKind
  label: string
  /** Units at this node and below */
  count: number
  /** Units exactly at this node; only level nodes hold units themselves */
  own: number
  children: KnowledgeNode[]
}

/** Stands for "no theme" / "no series" in keys; neither slugs nor series keys can be a lone dash */
const NONE = '-'
const byLabel = (a: string, b: string): number => a.localeCompare(b, 'de', { sensitivity: 'base' })

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item])
  return groups
}

/** Each existing level hangs below the next lower one, so the series reads from broad to deep */
function levelChain(path: string, units: TreeUnit[]): KnowledgeNode[] {
  return LEVELS.filter((l) => units.some((u) => u.level === l)).reduceRight<KnowledgeNode[]>(
    (deeper, level) => [
      {
        key: `level:${path}/${level}`,
        kind: 'level',
        label: levelLabel(level),
        count: units.filter((u) => u.level >= level).length,
        own: units.filter((u) => u.level === level).length,
        children: deeper,
      },
    ],
    [],
  )
}

function seriesNodes(path: string, units: TreeUnit[]): KnowledgeNode[] {
  return [...groupBy(units, (u) => u.series ?? NONE)]
    .sort(([a], [b]) => Number(a === NONE) - Number(b === NONE) || byLabel(a, b))
    .map(([series, members]) => ({
      key: `series:${path}/${series}`,
      kind: 'series' as const,
      label: series === NONE ? 'ohne Serie' : series,
      count: members.length,
      own: 0,
      // Units without a series are single items, not a ladder
      children: series === NONE ? [] : levelChain(`${path}/${series}`, members),
    }))
}

function themeNodes(fieldSlug: string, units: TreeUnit[]): KnowledgeNode[] {
  return [...groupBy(units, (u) => u.themeSlug ?? NONE)]
    .map(([theme, members]) => ({
      key: `theme:${fieldSlug}/${theme}`,
      kind: 'theme' as const,
      label: theme === NONE ? 'ohne Thema' : (members[0]!.themeName ?? theme),
      count: members.length,
      own: 0,
      children: seriesNodes(`${fieldSlug}/${theme}`, members),
    }))
    .sort((a, b) => byLabel(a.label, b.label))
}

export function knowledgeTree(units: TreeUnit[]): KnowledgeNode[] {
  return [...groupBy(units, (u) => u.fieldSlug)]
    .sort(([a], [b]) => byLabel(a, b))
    .map(([fieldSlug, members]) => ({ key: `field:${fieldSlug}`, kind: 'field' as const, label: fieldSlug, count: members.length, own: 0, children: themeNodes(fieldSlug, members) }))
}

/** Whether the unit sits at the node with this key or anywhere below it; for a level node that is this level and deeper */
export function inKnowledgeNode(unit: TreeUnit, key: string): boolean {
  const split = key.indexOf(':')
  const kind = key.slice(0, split)
  const [field, theme, series, level] = key.slice(split + 1).split('/')
  if (!['field', 'theme', 'series', 'level'].includes(kind) || unit.fieldSlug !== field) return false
  if (kind === 'field') return true
  if ((unit.themeSlug ?? NONE) !== theme) return false
  if (kind === 'theme') return true
  if ((unit.series ?? NONE) !== series) return false
  return kind === 'series' || unit.level >= Number(level)
}
