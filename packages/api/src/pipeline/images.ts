import { imagePickSchema, type ImageCredit } from '@wizzn/shared'
import type { ImageClient } from '../providers/image.js'
import type { LlmClient } from '../providers/llm.js'
import { extFor, type MediaStore } from '../providers/media-store.js'
import { stockKey, type StockCandidate, type StockImageClient } from '../providers/stock-images/types.js'
import { imagePickPrompt } from './prompts.js'

export interface ImageDeps {
  stock: StockImageClient | null
  images: ImageClient
  media: MediaStore
  llm: LlmClient
  fetchFn?: typeof fetch
  minEdgePx: number
  maxBytes: number
  log?: (m: string) => void
}

export interface ImageSlot {
  prompt: string
  query?: string
}

export interface ResolvedImage {
  path: string
  origin: 'stock' | 'generated'
  credit: ImageCredit | null
  stockQuery: string | null
  key: string | null
}

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PICK_LIMIT = 8
const MAX_DOWNLOADS = 3

/** Resolves one image slot: CC stock image if a fitting one downloads, otherwise AI generation. Adds the stock key to `exclude` on a hit. */
export async function resolveImage(
  unitId: string,
  slot: ImageSlot,
  exclude: Set<string>,
  deps: ImageDeps,
  opts: { skipPick?: boolean; forceGenerated?: boolean } = {},
): Promise<ResolvedImage> {
  if (deps.stock && !opts.forceGenerated) {
    const hit = await tryStock(unitId, slot, exclude, deps, deps.stock, opts.skipPick ?? false)
    if (hit) return hit
  }
  const img = await deps.images.generate(slot.prompt)
  const path = await deps.media.put(unitId, img.data, extFor(img.contentType))
  return { path, origin: 'generated', credit: null, stockQuery: null, key: null }
}

/** Stock-only variant for admin swaps: returns null instead of generating an AI image when no stock candidate fits. */
export async function resolveStockImage(
  unitId: string,
  slot: ImageSlot,
  exclude: Set<string>,
  deps: ImageDeps,
  opts: { skipPick?: boolean } = {},
): Promise<ResolvedImage | null> {
  return deps.stock ? tryStock(unitId, slot, exclude, deps, deps.stock, opts.skipPick ?? false) : null
}

async function tryStock(
  unitId: string,
  slot: ImageSlot,
  exclude: Set<string>,
  deps: ImageDeps,
  stock: StockImageClient,
  skipPick: boolean,
): Promise<ResolvedImage | null> {
  const query = slot.query ?? slot.prompt
  let candidates: StockCandidate[]
  try {
    candidates = (await stock.search(query)).filter(
      (c) => Math.min(c.width, c.height) >= deps.minEdgePx && ALLOWED_MIMES.has(c.mime) && !exclude.has(stockKey(c)),
    )
  } catch (err) {
    deps.log?.(`stock search failed for "${query}": ${(err as Error).message}`)
    return null
  }
  if (candidates.length === 0) {
    deps.log?.(`no stock candidates for "${query}"`)
    return null
  }

  let first = 0
  if (!skipPick) {
    const top = candidates.slice(0, PICK_LIMIT)
    try {
      const { index } = await deps.llm.chatJson(imagePickPrompt(slot.prompt, top), imagePickSchema)
      if (index === null || !top[index]) {
        deps.log?.(`no fitting stock image for "${query}"`)
        return null
      }
      first = index
    } catch (err) {
      deps.log?.(`stock pick failed for "${query}": ${(err as Error).message}`)
      return null
    }
  }

  // Picked candidate first, then the remaining filtered ones in order
  const order = [candidates[first]!, ...candidates.filter((_, i) => i !== first)].slice(0, MAX_DOWNLOADS)
  for (const c of order) {
    const key = stockKey(c)
    try {
      const { data, mime } = await download(c.imageUrl, deps)
      const path = await deps.media.put(unitId, data, extFor(mime))
      exclude.add(key)
      return { path, origin: 'stock', credit: c.credit, stockQuery: query, key }
    } catch (err) {
      deps.log?.(`stock download ${key} failed: ${(err as Error).message}`)
    }
  }
  return null
}

async function download(url: string, deps: ImageDeps): Promise<{ data: Buffer; mime: string }> {
  const res = await (deps.fetchFn ?? fetch)(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!ALLOWED_MIMES.has(mime)) throw new Error(`unexpected content-type "${mime}"`)
  const declared = Number(res.headers.get('content-length'))
  if (declared > deps.maxBytes) throw new Error(`content-length ${declared} exceeds limit`)
  if (!res.body) throw new Error('empty body')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > deps.maxBytes) {
      await reader.cancel()
      throw new Error(`body exceeds ${deps.maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return { data: Buffer.concat(chunks), mime }
}
