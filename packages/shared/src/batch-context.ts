import { unitContentSchema, type Source } from './content.js'
import type { BriefInput } from './admin.js'

/** A unit as loaded for the context export: its brief with slugs instead of IDs, plus the stored content */
export interface ContextUnit {
  id: string
  pairId: string | null
  fieldSlug: string
  themeSlug: string | null
  crossFieldSlug: string | null
  brief: Pick<BriefInput, 'topic' | 'context' | 'style' | 'storyArc' | 'format' | 'count' | 'level' | 'series'>
  title: string | null
  contentJson: unknown
}

/** What readers of the unit already know; media IDs and timings are left out */
export interface ContextPublished {
  title: string
  hook?: string
  slides?: { title: string; body: string }[]
  script?: string
  sources: Source[]
}

/**
 * One exported unit in batch-import shape, so an LLM planning the next level sees job and result together.
 * Batch import skips these entries because of `published`; new jobs point back with `after: ref`.
 */
export interface ContextJob {
  ref: string
  field: string
  theme: string | null
  topic: string
  context: string
  format: 'written' | 'audio' | 'both'
  style: BriefInput['style']
  storyArc: BriefInput['storyArc']
  count: number
  level: BriefInput['level']
  series: string | null
  crossField: string | null
  published: ContextPublished
}

function published(title: string | null, contentJson: unknown): ContextPublished | null {
  const parsed = unitContentSchema.safeParse(contentJson)
  if (!parsed.success) return null
  const content = parsed.data
  const base = { title: title ?? '' }
  if (content.format === 'audio') return { ...base, script: content.script, sources: content.sources }
  return {
    ...base,
    ...(content.cover ? { hook: content.cover.hook } : {}),
    slides: content.slides.map(({ title: slideTitle, body }) => ({ title: slideTitle, body })),
    sources: content.sources,
  }
}

/** Units without renderable content are left out; of a written/audio pair only the written unit is exported. */
export function contextJobs(units: ContextUnit[]): ContextJob[] {
  const readable = units.flatMap((unit) => {
    const text = published(unit.title, unit.contentJson)
    return text ? [{ unit, text }] : []
  })
  const isWritten = (text: ContextPublished): boolean => text.script === undefined
  const writtenPairs = new Set(readable.flatMap(({ unit, text }) => (unit.pairId && isWritten(text) ? [unit.pairId] : [])))
  const exportedPairs = new Set<string>()
  return readable.flatMap(({ unit, text }) => {
    if (unit.pairId) {
      if (exportedPairs.has(unit.pairId) || (!isWritten(text) && writtenPairs.has(unit.pairId))) return []
      exportedPairs.add(unit.pairId)
    }
    return [
      {
        ref: unit.id,
        field: unit.fieldSlug,
        theme: unit.themeSlug,
        topic: unit.brief.topic,
        context: unit.brief.context,
        format: unit.brief.format ?? 'both',
        style: unit.brief.style,
        storyArc: unit.brief.storyArc,
        count: unit.brief.count,
        level: unit.brief.level,
        series: unit.brief.series,
        crossField: unit.crossFieldSlug,
        published: text,
      },
    ]
  })
}

export const formatContextFile = (jobs: ContextJob[]): string => `${JSON.stringify({ version: 1, kind: 'context', jobs }, null, 2)}\n`

const pad = (n: number): string => String(n).padStart(2, '0')

export function contextFilename(at: Date): string {
  return `wizzn-context-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.json`
}
