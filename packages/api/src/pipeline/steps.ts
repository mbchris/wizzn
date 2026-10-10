import {
  audioUnitSchema,
  draftAudioSchema,
  draftWrittenSchema,
  evaluateCheck,
  llmCheckSchema,
  scheduleImages,
  sourcePickSchema,
  writtenUnitSchema,
  type DraftAudio,
  type DraftWritten,
  type UnitStatus,
} from '@wizzn/shared'
import type { StockImageClient } from '../providers/stock-images/types.js'
import type { ImageClient } from '../providers/image.js'
import type { LlmClient } from '../providers/llm.js'
import { extFor, type MediaStore } from '../providers/media-store.js'
import type { PageFetcher } from '../providers/fetch-page.js'
import type { SearchClient } from '../providers/search.js'
import type { TtsClient } from '../providers/tts.js'
import { wavToMp3 } from '../providers/transcode.js'
import { QUEUES, type QueueName } from '../jobs/queues.js'
import {
  PROMPT_VERSION,
  checkPrompt,
  draftAudioPrompt,
  draftWrittenPrompt,
  searchQuery,
  sourcePickPrompt,
  type ResearchedSource,
} from './prompts.js'
import { resolveImage, type ImageSlot, type ResolvedImage } from './images.js'
import type { NewAsset, PipelineStore, PipelineUnit } from './store.js'

export interface PipelineDeps {
  store: PipelineStore
  llm: LlmClient
  search: SearchClient
  fetchPage: PageFetcher
  tts: TtsClient
  images: ImageClient
  media: MediaStore
  stock: StockImageClient | null
  stockConfig: { minEdgePx: number; maxBytes: number }
  fetchFn?: typeof fetch
  enqueue(queue: QueueName, unitId: string): Promise<void>
  transcode?: (wav: Buffer) => Promise<Buffer | null>
}

export type StepName = 'research' | 'draft' | 'check' | 'media'

/** Each step: unit must be in `from`, moves to `working`, then to `done`, then enqueues `next`. */
const STEPS: Record<StepName, { from: UnitStatus; working: UnitStatus; done: UnitStatus; next: QueueName | null }> = {
  research: { from: 'queued', working: 'researching', done: 'researching', next: QUEUES.draft },
  draft: { from: 'researching', working: 'drafting', done: 'drafting', next: QUEUES.check },
  check: { from: 'drafting', working: 'checking', done: 'checking', next: QUEUES.media },
  media: { from: 'checking', working: 'rendering_media', done: 'in_review', next: null },
}

export async function runStep(step: StepName, unitId: string, deps: PipelineDeps): Promise<void> {
  const cfg = STEPS[step]
  const unit = await deps.store.getUnit(unitId)
  if (!unit) throw new Error(`Unit ${unitId} not found`)
  // Compare-and-set makes duplicate or stale jobs a no-op
  if (!(await deps.store.transition(unitId, cfg.from, cfg.working))) return
  try {
    await WORK[step](unit, deps)
    if (cfg.done !== cfg.working) await deps.store.transition(unitId, cfg.working, cfg.done)
  } catch (err) {
    await deps.store.transition(unitId, cfg.working, 'failed', err instanceof Error ? err.message : String(err))
    return
  }
  if (cfg.next) await deps.enqueue(cfg.next, unitId)
}

const WORK: Record<StepName, (unit: PipelineUnit, deps: PipelineDeps) => Promise<void>> = {
  async research(unit, { search, fetchPage, llm, store }) {
    const results = await search.search(searchQuery(unit.brief))
    if (results.length === 0) throw new Error('No search results')
    const { picks } = await llm.chatJson(sourcePickPrompt(unit.brief, results), sourcePickSchema)
    const sources: ResearchedSource[] = []
    for (const pick of picks) {
      const r = results[pick.index]
      if (!r) continue
      const page = await fetchPage(r.url)
      if (!page.ok || page.text.length < 200) continue
      sources.push({ url: r.url, title: page.title || r.title, publisher: pick.publisher, excerpt: page.text })
    }
    if (sources.length === 0) throw new Error('No usable sources (all picks unreachable or empty)')
    await store.replaceSources(unit.id, sources)
  },

  async draft(unit, { llm, store }) {
    const sources = await store.getSources(unit.id)
    const draft =
      unit.format === 'written'
        ? await llm.chatJson(draftWrittenPrompt(unit.brief, sources), draftWrittenSchema)
        : await llm.chatJson(draftAudioPrompt(unit.brief, sources), draftAudioSchema)
    await store.saveDraft(unit.id, { title: draft.title, contentJson: draft, promptVersion: PROMPT_VERSION, model: llm.model })
  },

  async check(unit, { llm, store, fetchPage }) {
    const current = await store.getUnit(unit.id)
    const sources = await store.getSources(unit.id)
    const text = draftText(unit.format, current?.contentJson)
    const llmResult = await llm.chatJson(checkPrompt(text, sources), llmCheckSchema)
    const links = await Promise.all(
      sources.map(async (s) => {
        const page = await fetchPage(s.url)
        return { url: s.url, ok: page.ok, status: page.status }
      }),
    )
    await store.saveCheck(unit.id, evaluateCheck(llmResult, links))
  },

  async media(unit, deps) {
    const current = await deps.store.getUnit(unit.id)
    const sources = (await deps.store.getSources(unit.id)).map(({ url, title, publisher }) => ({ url, title, publisher }))
    if (unit.format === 'written') {
      const draft = draftWrittenSchema.parse(current?.contentJson)
      const slots = draft.slides.flatMap((s) => (s.imagePrompt ? [{ prompt: s.imagePrompt, query: s.imageQuery }] : []))
      const resolved = await resolveSlots(unit.id, slots, deps)
      const assets = await deps.store.replaceAssets(unit.id, resolved.map(toImageAsset))
      let next = 0
      const slides = draft.slides.map(({ title, body, imagePrompt }) => ({
        title,
        body,
        ...(imagePrompt ? { imageId: assets[next++]?.id } : {}),
      }))
      await deps.store.saveContent(unit.id, writtenUnitSchema.parse({ format: 'written', slides, sources }))
      return
    }
    const draft = draftAudioSchema.parse(current?.contentJson)
    const speech = await deps.tts.synthesize(draft.script)
    const mp3 = await (deps.transcode ?? wavToMp3)(speech.audio)
    const audioPath = mp3 ? await deps.media.put(unit.id, mp3, 'mp3') : await deps.media.put(unit.id, speech.audio, extFor(speech.contentType))
    const resolved = await resolveSlots(unit.id, draft.images, deps)
    const assets = await deps.store.replaceAssets(unit.id, [
      { kind: 'audio', path: audioPath, durationSec: speech.durationSec },
      ...resolved.map(toImageAsset),
    ])
    const [audio, ...imgs] = assets
    if (!audio) throw new Error('Audio asset missing')
    const at = scheduleImages(speech.durationSec, draft.images.map((i) => i.atFraction))
    const content = {
      format: 'audio',
      script: draft.script,
      durationSec: speech.durationSec,
      audioId: audio.id,
      images: imgs.map((img, i) => ({ imageId: img.id, showAtSec: at[i] ?? 0 })),
      sources,
    }
    const parsed = audioUnitSchema.safeParse(content)
    if (!parsed.success) throw new Error(`Audio unit invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
    await deps.store.saveContent(unit.id, parsed.data)
  },
}

/** Sequential on purpose: slots of one unit share an exclude set so they never get the same stock image. */
async function resolveSlots(unitId: string, slots: ImageSlot[], deps: PipelineDeps): Promise<(ResolvedImage & { prompt: string })[]> {
  const exclude = new Set<string>()
  const imageDeps = {
    stock: deps.stock,
    images: deps.images,
    media: deps.media,
    llm: deps.llm,
    fetchFn: deps.fetchFn,
    ...deps.stockConfig,
    log: (m: string) => console.warn(`[media] ${unitId}: ${m}`),
  }
  const out: (ResolvedImage & { prompt: string })[] = []
  for (const slot of slots) out.push({ ...(await resolveImage(unitId, slot, exclude, imageDeps)), prompt: slot.prompt })
  return out
}

function toImageAsset(r: ResolvedImage & { prompt: string }): NewAsset {
  return { kind: 'image', path: r.path, origin: r.origin, credit: r.credit, stockQuery: r.stockQuery, prompt: r.prompt }
}

function draftText(format: PipelineUnit['format'], json: unknown): string {
  if (format === 'written') {
    const d: DraftWritten = draftWrittenSchema.parse(json)
    return [d.title, ...d.slides.map((s) => `${s.title}: ${s.body}`)].join('\n\n')
  }
  const d: DraftAudio = draftAudioSchema.parse(json)
  return `${d.title}\n\n${d.script}`
}
