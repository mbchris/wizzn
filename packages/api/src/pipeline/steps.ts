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
import type { ResearchProvider } from '../providers/research/types.js'
import type { TtsClient } from '../providers/tts.js'
import { wavToMp3 } from '../providers/transcode.js'
import { QUEUES, type QueueName } from '../jobs/queues.js'
import {
  PROMPT_VERSION,
  checkPrompt,
  draftAudioPrompt,
  draftWrittenPrompt,
  pickEditorial,
} from './prompts.js'
import { longestSharedRun } from './overlap.js'
import { researchSources } from './research.js'
import { resolveImage, type ImageSlot, type ResolvedImage } from './images.js'
import type { NewAsset, PipelineStore, PipelineUnit } from './store.js'

export interface PipelineDeps {
  store: PipelineStore
  llm: LlmClient
  /** Knowledge sources by tier (issue #4) */
  research: ResearchProvider[]
  /** Fewer usable tier 1–3 sources → open-web fallback */
  researchMinSources: number
  fetchPage: PageFetcher
  tts: TtsClient
  images: ImageClient
  media: MediaStore
  stock: StockImageClient | null
  stockConfig: { minEdgePx: number; maxBytes: number }
  fetchFn?: typeof fetch
  enqueue(queue: QueueName, unitId: string): Promise<void>
  transcode?: (wav: Buffer) => Promise<Buffer | null>
  /** Picks style and story arc when the brief leaves them open; injectable for tests */
  random?: () => number
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
  async research(unit, { research, fetchPage, llm, store, researchMinSources }) {
    // Written and audio of one pair share the research: same facts, half the cost
    await store.researchOnce(unit.id, () => researchSources(unit.brief, { research, fetchPage, llm, minSources: researchMinSources }))
  },

  async draft(unit, { llm, store, random }) {
    const sources = await store.getSources(unit.id)
    // Per unit, so the variants of one brief get different voices
    const editorial = pickEditorial(unit.brief, random)
    const draft =
      unit.format === 'written'
        ? await llm.chatJson(draftWrittenPrompt(unit.brief, sources, editorial), draftWrittenSchema)
        : await llm.chatJson(draftAudioPrompt(unit.brief, sources, editorial), draftAudioSchema)
    await store.saveDraft(unit.id, { title: draft.title, contentJson: { ...draft, editorial }, promptVersion: PROMPT_VERSION, model: llm.model })
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
    const verbatim = { tiers: sources.map((s) => s.tier), maxVerbatimRun: longestSharedRun(text, sources.map((s) => s.excerpt)) }
    await store.saveCheck(unit.id, evaluateCheck(llmResult, links, verbatim))
  },

  async media(unit, deps) {
    const current = await deps.store.getUnit(unit.id)
    const sources = (await deps.store.getSources(unit.id)).map(({ url, title, publisher }) => ({ url, title, publisher }))
    if (unit.format === 'written') {
      const draft = draftWrittenSchema.parse(current?.contentJson)
      // Cover first so it gets the best stock match; the shared exclude set keeps slide images distinct
      const slots = [
        { prompt: draft.cover.imagePrompt, query: draft.cover.imageQuery },
        ...draft.slides.flatMap((s) => (s.imagePrompt ? [{ prompt: s.imagePrompt, query: s.imageQuery }] : [])),
      ]
      const resolved = await resolveSlots(unit.id, slots.map((sl) => ({ ...sl, field: unit.brief.fieldSlug })), deps)
      const [coverAsset, ...slideAssets] = await deps.store.replaceAssets(unit.id, resolved.map(toImageAsset))
      if (!coverAsset) throw new Error('Cover image asset missing')
      let next = 0
      const slides = draft.slides.map(({ title, body, imagePrompt }) => ({
        title,
        body,
        ...(imagePrompt ? { imageId: slideAssets[next++]?.id } : {}),
      }))
      const cover = { hook: draft.hook, imageId: coverAsset.id }
      await deps.store.saveContent(unit.id, writtenUnitSchema.parse({ format: 'written', cover, slides, sources }))
      return
    }
    const draft = draftAudioSchema.parse(current?.contentJson)
    const speech = await deps.tts.synthesize(draft.script)
    const mp3 = await (deps.transcode ?? wavToMp3)(speech.audio)
    const audioPath = mp3 ? await deps.media.put(unit.id, mp3, 'mp3') : await deps.media.put(unit.id, speech.audio, extFor(speech.contentType))
    const resolved = await resolveSlots(unit.id, draft.images.map((i) => ({ ...i, field: unit.brief.fieldSlug })), deps)
    const assets = await deps.store.replaceAssets(unit.id, [
      { kind: 'audio', path: audioPath, durationSec: speech.durationSec, generator: deps.tts.name },
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
  return { kind: 'image', path: r.path, origin: r.origin, credit: r.credit, stockQuery: r.stockQuery, prompt: r.prompt, generator: r.generator }
}

function draftText(format: PipelineUnit['format'], json: unknown): string {
  if (format === 'written') {
    const d: DraftWritten = draftWrittenSchema.parse(json)
    return [d.title, d.hook, ...d.slides.map((s) => `${s.title}: ${s.body}`)].join('\n\n')
  }
  const d: DraftAudio = draftAudioSchema.parse(json)
  return `${d.title}\n\n${d.script}`
}
