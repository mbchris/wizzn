import { audioUnitSchema, type ReplaceImageMode, type UnitDetailDto } from '@wizzn/shared'
import { resolveImage, resolveStockImage, type ImageDeps, type ResolvedImage } from './images.js'
import { creditStockKey as creditKey } from '../providers/stock-images/types.js'
import { extFor } from '../providers/media-store.js'
import type { TtsClient } from '../providers/tts.js'
import { wavToMp3 } from '../providers/transcode.js'
import type { PipelineStore } from './store.js'

type AssetDto = UnitDetailDto['assets'][number]

export type ReplaceImageResult =
  | { ok: true; asset: AssetDto }
  | { ok: false; error: 'not_found' | 'invalid_state' | 'no_stock_candidate' }

export type RevoiceResult = { ok: true; asset: AssetDto } | { ok: false; error: 'not_found' | 'invalid_state' | 'invalid_content' }

export interface ImageReplacer {
  /** `prompt` only applies to mode "generated" and replaces the stored AI prompt */
  replace(unitId: string, assetId: string, mode: ReplaceImageMode, prompt?: string): Promise<ReplaceImageResult>
  /** Re-synthesizes the audio asset from the unit's current (possibly edited) script */
  revoice(unitId: string, assetId: string): Promise<RevoiceResult>
}

export interface AudioDeps {
  tts: TtsClient
  put(unitId: string, data: Buffer, ext: string): Promise<string>
  transcode?: (wav: Buffer) => Promise<Buffer | null>
}

/** Admin media swaps during review: next stock candidate, a fresh AI image, or new speech. Asset ids stay stable. */
export function createImageReplacer(deps: { store: PipelineStore; image: ImageDeps; audio?: AudioDeps; mediaUrl: (p: string) => string }): ImageReplacer {
  const { store, image, mediaUrl } = deps
  return {
    async replace(unitId, assetId, mode, customPrompt) {
      const unit = await store.getUnit(unitId)
      const asset = await store.getAsset(assetId)
      if (!unit || !asset || asset.unitId !== unitId || asset.kind !== 'image') return { ok: false, error: 'not_found' }
      if (unit.status !== 'in_review') return { ok: false, error: 'invalid_state' }

      const currentKey = asset.credit ? creditKey(asset.credit) : null
      let resolved: ResolvedImage
      let rejectedStockIds: string[] | undefined
      let prompt = asset.prompt ?? null
      if (mode === 'next-stock') {
        const query = asset.stockQuery ?? asset.prompt
        if (!query) return { ok: false, error: 'not_found' }
        const exclude = new Set(asset.rejectedStockIds)
        for (const a of await store.listAssets(unitId)) if (a.credit) exclude.add(creditKey(a.credit))
        const hit = await resolveStockImage(unitId, { prompt: asset.prompt ?? query, query }, exclude, image, { skipPick: true })
        if (!hit) return { ok: false, error: 'no_stock_candidate' }
        resolved = hit
      } else {
        const base = customPrompt ?? asset.prompt ?? asset.credit?.title ?? asset.stockQuery
        if (!base) return { ok: false, error: 'not_found' }
        resolved = await resolveImage(unitId, { prompt: base, field: unit.brief.fieldSlug }, new Set(), image, { forceGenerated: true })
        prompt = base
      }

      if (currentKey) rejectedStockIds = [...asset.rejectedStockIds, currentKey]

      const { path, origin, credit, stockQuery, generator } = resolved
      await store.updateAsset(assetId, { path, origin, credit, stockQuery, prompt, generator, ...(rejectedStockIds ? { rejectedStockIds } : {}) })
      // Old file stays in the media store (no delete helper)
      return { ok: true, asset: { id: assetId, kind: 'image', url: mediaUrl(path), durationSec: asset.durationSec ?? null, origin, credit, stockQuery, prompt, generator } }
    },

    async revoice(unitId, assetId) {
      const unit = await store.getUnit(unitId)
      const asset = await store.getAsset(assetId)
      if (!deps.audio || !unit || !asset || asset.unitId !== unitId || asset.kind !== 'audio') return { ok: false, error: 'not_found' }
      if (unit.status !== 'in_review') return { ok: false, error: 'invalid_state' }
      const content = audioUnitSchema.safeParse(unit.contentJson)
      if (!content.success || content.data.audioId !== assetId) return { ok: false, error: 'invalid_content' }

      const speech = await deps.audio.tts.synthesize(content.data.script)
      const mp3 = await (deps.audio.transcode ?? wavToMp3)(speech.audio)
      const path = mp3 ? await deps.audio.put(unitId, mp3, 'mp3') : await deps.audio.put(unitId, speech.audio, extFor(speech.contentType))
      // Images keep their relative position in the new, possibly longer or shorter, recording
      const scale = content.data.durationSec > 0 ? speech.durationSec / content.data.durationSec : 1
      const images = content.data.images.map((i) => ({ ...i, showAtSec: Math.min(Math.max(0, speech.durationSec - 1), Math.round(i.showAtSec * scale)) }))
      const next = audioUnitSchema.safeParse({ ...content.data, durationSec: speech.durationSec, images })
      if (!next.success) return { ok: false, error: 'invalid_content' }

      await store.updateAsset(assetId, { path, origin: 'generated', credit: null, stockQuery: null, durationSec: speech.durationSec, generator: deps.audio.tts.name })
      await store.saveContent(unitId, next.data)
      return { ok: true, asset: { id: assetId, kind: 'audio', url: mediaUrl(path), durationSec: speech.durationSec, origin: 'generated', credit: null, stockQuery: null, prompt: null, generator: deps.audio.tts.name } }
    },
  }
}
