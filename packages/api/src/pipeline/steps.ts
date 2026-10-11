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
  type UnitLogLevel,
  type UnitStatus,
} from '@wizzn/shared'
import type { StockImageClient } from '../providers/stock-images/types.js'
import type { ImageClient } from '../providers/image.js'
import type { LlmClient } from '../providers/llm.js'
import { extFor, type MediaStore } from '../providers/media-store.js'
import type { PageFetcher } from '../providers/fetch-page.js'
import type { ResearchProvider } from '../providers/research/types.js'
import { ttsGeneratorLabel, type TtsClient } from '../providers/tts.js'
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

const STEP_LABEL: Record<StepName, string> = { research: 'Recherche', draft: 'Entwurf', check: 'Prüfung', media: 'Medien' }

export type StepLog = (message: string, level?: UnitLogLevel) => void

/** Protocol lines for the admin live log; a failing log write must never break the pipeline */
function stepLogger(store: PipelineStore, unitId: string, step: StepName | null): StepLog {
  return (message, level = 'info') => {
    store.appendLog(unitId, { level, step, message }).catch((err: unknown) => console.warn(`[log] ${unitId}: ${err instanceof Error ? err.message : String(err)}`))
  }
}

export async function runStep(step: StepName, unitId: string, deps: PipelineDeps): Promise<void> {
  const cfg = STEPS[step]
  const unit = await deps.store.getUnit(unitId)
  if (!unit) throw new Error(`Unit ${unitId} not found`)
  // Compare-and-set makes duplicate or stale jobs a no-op
  if (!(await deps.store.transition(unitId, cfg.from, cfg.working))) return
  const log = stepLogger(deps.store, unitId, step)
  const started = Date.now()
  log(`${STEP_LABEL[step]} gestartet`)
  try {
    await WORK[step](unit, deps, log)
    if (cfg.done !== cfg.working) await deps.store.transition(unitId, cfg.working, cfg.done)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log(`${STEP_LABEL[step]} fehlgeschlagen: ${reason}`, 'error')
    await deps.store.transition(unitId, cfg.working, 'failed', reason)
    return
  }
  log(`${STEP_LABEL[step]} fertig (${((Date.now() - started) / 1000).toFixed(1)} s)${cfg.next ? '' : ' – bereit zur Freigabe'}`)
  if (cfg.next) await deps.enqueue(cfg.next, unitId)
}

const WORK: Record<StepName, (unit: PipelineUnit, deps: PipelineDeps, log: StepLog) => Promise<void>> = {
  async research(unit, { research, fetchPage, llm, store, researchMinSources }, log) {
    log(`Suche Quellen zu „${unit.brief.topic}“ (${research.map((p) => p.name).join(', ')})`)
    // Written and audio of one pair share the research: same facts, half the cost
    const how = await store.researchOnce(unit.id, () =>
      researchSources(unit.brief, { research, fetchPage, llm, minSources: researchMinSources, log: (m) => log(m.replace(/^\[research\]\s*/, ''), 'warn') }),
    )
    const sources = await store.getSources(unit.id)
    const byProvider = new Map<string, number>()
    for (const s of sources) byProvider.set(s.provider, (byProvider.get(s.provider) ?? 0) + 1)
    const detail = [...byProvider].map(([p, n]) => `${p} ×${n}`).join(' · ')
    log(how === 'reused' ? `${sources.length} Quellen vom Partner-Wissenshappen übernommen (${detail})` : `${sources.length} Quellen ausgewählt (${detail})`)
  },

  async draft(unit, { llm, store, random }, log) {
    const sources = await store.getSources(unit.id)
    // Per unit, so the variants of one brief get different voices
    const editorial = pickEditorial(unit.brief, random)
    log(`Schreibe ${unit.format === 'written' ? 'Text' : 'Sprechskript'} mit ${llm.model} · Stil ${editorial.style} · Bogen ${editorial.arc} · ${sources.length} Quellen`)
    const draft =
      unit.format === 'written'
        ? await llm.chatJson(draftWrittenPrompt(unit.brief, sources, editorial), draftWrittenSchema)
        : await llm.chatJson(draftAudioPrompt(unit.brief, sources, editorial), draftAudioSchema)
    await store.saveDraft(unit.id, { title: draft.title, contentJson: { ...draft, editorial }, promptVersion: PROMPT_VERSION, model: llm.model })
    log(`Entwurf „${draft.title}“ gespeichert`)
  },

  async check(unit, { llm, store, fetchPage }, log) {
    const current = await store.getUnit(unit.id)
    const sources = await store.getSources(unit.id)
    const text = draftText(unit.format, current?.contentJson)
    log('KI-Faktencheck gegen die Quellen läuft')
    const llmResult = await llm.chatJson(checkPrompt(text, sources), llmCheckSchema)
    log(`Prüfe ${sources.length} Quellen-Links`)
    const links = await Promise.all(
      sources.map(async (s) => {
        const page = await fetchPage(s.url)
        return { url: s.url, ok: page.ok, status: page.status }
      }),
    )
    const verbatim = { tiers: sources.map((s) => s.tier), maxVerbatimRun: longestSharedRun(text, sources.map((s) => s.excerpt)) }
    const report = evaluateCheck(llmResult, links, verbatim)
    await store.saveCheck(unit.id, report)
    const unsupported = report.claims.filter((c) => c.sourceIndex === null).length
    const deadLinks = report.links.filter((l) => !l.ok).length
    log(
      `KI-Check ${report.passed ? 'bestanden' : 'mit Hinweisen'}: ${report.claims.length} Aussagen (${unsupported} ohne Quelle), ${report.issues.length} Hinweise, ${deadLinks} tote Links`,
      report.passed ? 'info' : 'warn',
    )
  },

  async media(unit, deps, log) {
    const current = await deps.store.getUnit(unit.id)
    const sources = (await deps.store.getSources(unit.id)).map(({ url, title, publisher }) => ({ url, title, publisher }))
    if (unit.format === 'written') {
      const draft = draftWrittenSchema.parse(current?.contentJson)
      // Cover first so it gets the best stock match; the shared exclude set keeps slide images distinct
      const slots = [
        { prompt: draft.cover.imagePrompt, query: draft.cover.imageQuery },
        ...draft.slides.flatMap((s) => (s.imagePrompt ? [{ prompt: s.imagePrompt, query: s.imageQuery }] : [])),
      ]
      log(`${slots.length} Bilder werden besorgt (Titelbild + ${slots.length - 1} Slide-Bilder)`)
      const resolved = await resolveSlots(unit.id, slots.map((sl) => ({ ...sl, field: unit.brief.fieldSlug })), deps, log, (i) => (i === 0 ? 'Titelbild' : `Bild ${i}`))
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
    log(`Vertone Skript mit ${deps.tts.name} (${draft.script.split(/\s+/).length} Wörter)`)
    const speech = await deps.tts.synthesize(draft.script)
    log(`Audio fertig: ${Math.floor(speech.durationSec / 60)}:${String(Math.round(speech.durationSec % 60)).padStart(2, '0')} min${speech.voice ? ` · Stimme ${speech.voice}` : ''}`)
    const mp3 = await (deps.transcode ?? wavToMp3)(speech.audio)
    const audioPath = mp3 ? await deps.media.put(unit.id, mp3, 'mp3') : await deps.media.put(unit.id, speech.audio, extFor(speech.contentType))
    log(`${draft.images.length} Bilder werden besorgt`)
    const resolved = await resolveSlots(unit.id, draft.images.map((i) => ({ ...i, field: unit.brief.fieldSlug })), deps, log, (i) => `Bild ${i + 1}`)
    const assets = await deps.store.replaceAssets(unit.id, [
      { kind: 'audio', path: audioPath, durationSec: speech.durationSec, generator: ttsGeneratorLabel(deps.tts, speech.voice) },
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
async function resolveSlots(
  unitId: string,
  slots: ImageSlot[],
  deps: PipelineDeps,
  log: StepLog = () => {},
  label: (i: number) => string = (i) => `Bild ${i + 1}`,
): Promise<(ResolvedImage & { prompt: string })[]> {
  const exclude = new Set<string>()
  const imageDeps = {
    stock: deps.stock,
    images: deps.images,
    media: deps.media,
    llm: deps.llm,
    fetchFn: deps.fetchFn,
    ...deps.stockConfig,
    log: (m: string) => {
      console.warn(`[media] ${unitId}: ${m}`)
      log(m, 'warn')
    },
  }
  const out: (ResolvedImage & { prompt: string })[] = []
  for (const [i, slot] of slots.entries()) {
    const r = await resolveImage(unitId, slot, exclude, imageDeps)
    log(`${label(i)}: ${r.credit ? `Stock · ${r.credit.provider}` : `KI · ${r.generator ?? 'Modell unbekannt'}`}`)
    out.push({ ...r, prompt: slot.prompt })
  }
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
