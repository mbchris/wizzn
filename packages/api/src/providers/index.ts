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
import { createChatterboxTts, createQwenTts, createPiperTts, createRequestyTts, createSilentTts, type TtsClient } from './tts.js'

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
  if (env.LLM_PROVIDER === 'requesty') {
    if (!env.LLM_MODEL) throw new Error('LLM_PROVIDER=requesty requires LLM_MODEL (provider/model, e.g. google/gemini-2.5-flash)')
    return createLlmClient({ baseUrl: env.REQUESTY_BASE_URL, model: env.LLM_MODEL, apiKey: env.REQUESTY_API_KEY })
  }
  if (!env.LLM_MODEL) throw new Error('LLM_PROVIDER=openai requires LLM_MODEL')
  return createLlmClient({ baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY })
}

/** `fit: false` skips the 3–5 min duration fitting (single render); `noCache` bypasses the server render cache — for debugging */
/** TTS_VOICE wins; otherwise the set TTS_VOICE_1..3 (random pick per unit) */
export function ttsVoices(env: Env): string[] {
  if (env.TTS_VOICE) return [env.TTS_VOICE]
  return [env.TTS_VOICE_1, env.TTS_VOICE_2, env.TTS_VOICE_3].filter(Boolean)
}

export function createTts(env: Env, { fit = true, noCache = false }: { fit?: boolean; noCache?: boolean } = {}): TtsClient {
  const voices = ttsVoices(env)
  if (env.TTS_PROVIDER === 'piper') {
    if (!voices.length) throw new Error('TTS_PROVIDER=piper requires TTS_VOICE or TTS_VOICE_1..3')
    return createPiperTts(env.TTS_URL, voices, fetch, env.TTS_LENGTH_SCALE, fit)
  }
  if (env.TTS_PROVIDER === 'chatterbox') return createChatterboxTts(env.TTS_URL, fetch, env.TTS_LENGTH_SCALE, undefined, fit, noCache)
  if (env.TTS_PROVIDER === 'qwen') return createQwenTts(env.TTS_URL, fetch, env.TTS_LENGTH_SCALE, undefined, fit, noCache, env.TTS_VOICE ? [] : voices)
  if (env.TTS_PROVIDER === 'requesty')
    return createRequestyTts({ baseUrl: env.REQUESTY_BASE_URL, apiKey: env.REQUESTY_API_KEY, model: env.REQUESTY_TTS_MODEL, voice: env.REQUESTY_TTS_VOICE, instructions: env.TTS_INSTRUCTIONS, lengthScale: env.TTS_LENGTH_SCALE, fit })
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
