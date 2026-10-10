import type { ImageCredit, ReplaceImageMode, UnitDetailDto } from '@wizzn/shared'
import { resolveImage, resolveStockImage, type ImageDeps, type ResolvedImage } from './images.js'
import type { PipelineStore } from './store.js'

export type ReplaceImageResult =
  | { ok: true; asset: UnitDetailDto['assets'][number] }
  | { ok: false; error: 'not_found' | 'invalid_state' | 'no_stock_candidate' }

/** Same format as stockKey(); credit.provider is a plain string in the shared schema */
const creditKey = (c: ImageCredit) => `${c.provider}:${c.providerId}`

export interface ImageReplacer {
  replace(unitId: string, assetId: string, mode: ReplaceImageMode): Promise<ReplaceImageResult>
}

/** Admin image swap during review: next stock candidate or a fresh AI image. Asset id stays stable, contentJson is untouched. */
export function createImageReplacer(deps: { store: PipelineStore; image: ImageDeps; mediaUrl: (p: string) => string }): ImageReplacer {
  const { store, image, mediaUrl } = deps
  return {
    async replace(unitId, assetId, mode) {
      const unit = await store.getUnit(unitId)
      const asset = await store.getAsset(assetId)
      if (!unit || !asset || asset.unitId !== unitId || asset.kind !== 'image') return { ok: false, error: 'not_found' }
      if (unit.status !== 'in_review') return { ok: false, error: 'invalid_state' }

      const currentKey = asset.credit ? creditKey(asset.credit) : null
      let resolved: ResolvedImage
      let rejectedStockIds: string[] | undefined
      if (mode === 'next-stock') {
        const query = asset.stockQuery ?? asset.prompt
        if (!query) return { ok: false, error: 'not_found' }
        const exclude = new Set(asset.rejectedStockIds)
        for (const a of await store.listAssets(unitId)) if (a.credit) exclude.add(creditKey(a.credit))
        const hit = await resolveStockImage(unitId, { prompt: asset.prompt ?? query, query }, exclude, image, { skipPick: true })
        if (!hit) return { ok: false, error: 'no_stock_candidate' }
        resolved = hit
        if (currentKey) rejectedStockIds = [...asset.rejectedStockIds, currentKey]
      } else {
        const prompt = asset.prompt ?? asset.credit?.title ?? asset.stockQuery
        if (!prompt) return { ok: false, error: 'not_found' }
        resolved = await resolveImage(unitId, { prompt }, new Set(), image, { forceGenerated: true })
      }

      const { path, origin, credit, stockQuery } = resolved
      await store.updateAsset(assetId, { path, origin, credit, stockQuery, ...(rejectedStockIds ? { rejectedStockIds } : {}) })
      // Old file stays in the media store (no delete helper)
      return { ok: true, asset: { id: assetId, kind: 'image', url: mediaUrl(path), durationSec: asset.durationSec ?? null, origin, credit, stockQuery } }
    },
  }
}
