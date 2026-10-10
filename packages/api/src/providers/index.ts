import type { Env } from '../env.js'
import { createPageFetcher } from './fetch-page.js'
import { createApiImages, createPlaceholderImages, type ImageClient } from './image.js'
import { createGeminiCliClient, createLlmClient, type LlmClient } from './llm.js'
import { createLocalMediaStore } from './media-store.js'
import { createCuratedProvider } from './research/curated.js'
import { createEuropePmcProvider } from './research/europepmc.js'
import type { ResearchProvider } from './research/types.js'
import { createWebProvider } from './research/web.js'
import { createWikipediaProvider } from './research/wikipedia.js'
import { createSearxngClient, type SearchClient } from './search.js'
import { createStockChain } from './stock-images/chain.js'
import { createCommonsClient } from './stock-images/commons.js'
import { createOpenverseClient } from './stock-images/openverse.js'
import type { StockImageClient } from './stock-images/types.js'
import { createChatterboxTts, createQwenTts, createPiperTts, createSilentTts, type TtsClient } from './tts.js'

export function createProviders(env: Env) {
  const search = createSearxngClient(env.SEARCH_URL)
  return {
    llm: createLlm(env),
    search,
    research: createResearchProviders(env, search),
    fetchPage: createPageFetcher(),
    tts: createTts(env),
    images: createImageClient(env),
    stock: createStockClient(env),
    media: createLocalMediaStore(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL),
  }
}

export function createLlm(env: Env): LlmClient {
  if (env.LLM_PROVIDER === 'gemini-cli')
    return createGeminiCliClient({ model: env.LLM_MODEL, bin: env.GEMINI_CLI_BIN, timeoutMs: env.GEMINI_CLI_TIMEOUT_MS })
  if (!env.LLM_MODEL) throw new Error('LLM_PROVIDER=openai requires LLM_MODEL')
  return createLlmClient({ baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY })
}

/** `fit: false` skips the 3–5 min duration fitting (single render); `noCache` bypasses the server render cache — for debugging */
export function createTts(env: Env, { fit = true, noCache = false }: { fit?: boolean; noCache?: boolean } = {}): TtsClient {
  if (env.TTS_PROVIDER === 'piper') return createPiperTts(env.TTS_URL, env.TTS_VOICE, fetch, env.TTS_LENGTH_SCALE, fit)
  if (env.TTS_PROVIDER === 'chatterbox') return createChatterboxTts(env.TTS_URL, fetch, env.TTS_LENGTH_SCALE, undefined, fit, noCache)
  if (env.TTS_PROVIDER === 'qwen') return createQwenTts(env.TTS_URL, fetch, env.TTS_LENGTH_SCALE, undefined, fit, noCache)
  return createSilentTts()
}

function createImageClient(env: Env): ImageClient {
  if (env.IMAGE_PROVIDER === 'placeholder') return createPlaceholderImages()
  if (!env.IMAGE_BASE_URL || !env.IMAGE_MODEL) throw new Error('IMAGE_PROVIDER=api requires IMAGE_BASE_URL and IMAGE_MODEL')
  return createApiImages({ baseUrl: env.IMAGE_BASE_URL, model: env.IMAGE_MODEL, apiKey: env.IMAGE_API_KEY, ephemeral: env.IMAGE_EPHEMERAL })
}

function createStockClient(env: Env): StockImageClient | null {
  const clients = env.STOCK_IMAGE_PROVIDERS.map((name) =>
    name === 'openverse'
      ? createOpenverseClient({ clientId: env.OPENVERSE_CLIENT_ID || undefined, clientSecret: env.OPENVERSE_CLIENT_SECRET || undefined })
      : createCommonsClient({ userAgent: env.STOCK_USER_AGENT }),
  )
  return clients.length ? createStockChain(clients) : null
}

function createResearchProviders(env: Env, search: SearchClient): ResearchProvider[] {
  return env.RESEARCH_PROVIDERS.map((name) => {
    if (name === 'curated') return createCuratedProvider(search)
    if (name === 'wikipedia') return createWikipediaProvider({ userAgent: env.STOCK_USER_AGENT })
    if (name === 'europepmc') return createEuropePmcProvider()
    return createWebProvider(search)
  })
}
