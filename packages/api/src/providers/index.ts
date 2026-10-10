import type { Env } from '../env.js'
import { createPageFetcher } from './fetch-page.js'
import { createApiImages, createPlaceholderImages, type ImageClient } from './image.js'
import { createLlmClient } from './llm.js'
import { createLocalMediaStore } from './media-store.js'
import { createSearxngClient } from './search.js'
import { createStockChain } from './stock-images/chain.js'
import { createCommonsClient } from './stock-images/commons.js'
import { createOpenverseClient } from './stock-images/openverse.js'
import type { StockImageClient } from './stock-images/types.js'
import { createPiperTts, createSilentTts } from './tts.js'

export function createProviders(env: Env) {
  return {
    llm: createLlmClient({ baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY }),
    search: createSearxngClient(env.SEARCH_URL),
    fetchPage: createPageFetcher(),
    tts: env.TTS_PROVIDER === 'piper' ? createPiperTts(env.TTS_URL, env.TTS_VOICE, fetch, env.TTS_LENGTH_SCALE) : createSilentTts(),
    images: createImageClient(env),
    stock: createStockClient(env),
    media: createLocalMediaStore(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL),
  }
}

function createImageClient(env: Env): ImageClient {
  if (env.IMAGE_PROVIDER === 'placeholder') return createPlaceholderImages()
  if (!env.IMAGE_BASE_URL || !env.IMAGE_MODEL) throw new Error('IMAGE_PROVIDER=api requires IMAGE_BASE_URL and IMAGE_MODEL')
  return createApiImages({ baseUrl: env.IMAGE_BASE_URL, model: env.IMAGE_MODEL, apiKey: env.IMAGE_API_KEY })
}

function createStockClient(env: Env): StockImageClient | null {
  const clients = env.STOCK_IMAGE_PROVIDERS.map((name) =>
    name === 'openverse'
      ? createOpenverseClient({ clientId: env.OPENVERSE_CLIENT_ID || undefined, clientSecret: env.OPENVERSE_CLIENT_SECRET || undefined })
      : createCommonsClient({ userAgent: env.STOCK_USER_AGENT }),
  )
  return clients.length ? createStockChain(clients) : null
}
