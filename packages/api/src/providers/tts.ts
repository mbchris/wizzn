import { AUDIO_MAX_SEC, AUDIO_MIN_SEC } from '@wizzn/shared'
import { timeStretchWav } from './transcode.js'

export interface TtsResult {
  audio: Buffer
  contentType: 'audio/wav'
  durationSec: number
  /** Voice picked for this render (random pick from TTS_VOICE_1..3), when the client has several */
  voice?: string
}

export interface TtsClient {
  /** Engine/voice label stored on the audio asset and shown in the admin UI */
  readonly name: string
  synthesize(text: string): Promise<TtsResult>
}

const WORDS_PER_MIN = 140

/** Dev/test: silent WAV with realistic duration, so the pipeline runs without a TTS server. */
export function createSilentTts(sampleRate = 8000): TtsClient {
  return {
    name: 'silent (dev)',
    async synthesize(text) {
      const words = text.trim().split(/\s+/).filter(Boolean).length
      const durationSec = Math.max(1, Math.round((words / WORDS_PER_MIN) * 60))
      return { audio: silentWav(durationSec, sampleRate), contentType: 'audio/wav', durationSec }
    },
  }
}

/** Aim inside the 3–5 min window with headroom, so rounding never lands on the edge */
const TARGET_MIN_SEC = AUDIO_MIN_SEC + 5
const TARGET_MAX_SEC = AUDIO_MAX_SEC - 5
const MIN_LENGTH_SCALE = 0.7
const MAX_LENGTH_SCALE = 2
const MAX_RENDERS = 4
/** Last resort for slightly short audio: trailing silence (never more than this) */
const MAX_PAD_SEC = 30

const clampScale = (s: number): number => Math.min(MAX_LENGTH_SCALE, Math.max(MIN_LENGTH_SCALE, s))

/**
 * Next length_scale towards `target`. Duration ≈ pauses + speech × scale (pauses barely change), so with two
 * measurements we fit that line; with one we fall back to proportional scaling.
 */
export function nextLengthScale(tries: { scale: number; sec: number }[], target: number): number {
  const last = tries[tries.length - 1]!
  const prev = tries[tries.length - 2]
  if (prev && prev.scale !== last.scale && prev.sec !== last.sec) {
    const slope = (last.sec - prev.sec) / (last.scale - prev.scale)
    if (slope > 0) return clampScale(last.scale + (target - last.sec) / slope)
  }
  return clampScale((last.scale * target) / Math.max(1, last.sec))
}

const inWindow = (sec: number): boolean => sec >= AUDIO_MIN_SEC && sec <= AUDIO_MAX_SEC

/**
 * Piper HTTP server (`python -m piper.http_server`): POST JSON { text, voice, length_scale } to /synthesize → WAV.
 */
export function createPiperTts(baseUrl: string, voice: string | string[], fetchFn: typeof fetch = fetch, lengthScale = 1, fit = true): TtsClient {
  const voices = typeof voice === 'string' ? [voice] : voice
  const render: Render = (text, scale, v) => postWav(fetchFn, baseUrl, { text, voice: v, length_scale: scale })
  const pick = voicePicker(voices)
  return { ...(fit ? fitToWindow(render, lengthScale, pick) : renderOnce(render, lengthScale, pick)), name: `piper · ${voices.join(' | ')}` }
}

/**
 * Chatterbox Multilingual (`scripts/tts/chatterbox_server.py`, same /synthesize contract). Its generation length is
 * limited, so the script is sent in sentence-group chunks and the WAVs are joined. The server caches raw renders and
 * applies length_scale as a time-stretch, so pace re-renders cost little.
 */
/** `noCache` makes the server re-generate instead of returning cached renders (tts:entry tests) */
/** `voices`: optional per-request voices (Qwen design mode); one is picked at random per synthesize() call */
export function createChatterboxTts(baseUrl: string, fetchFn: typeof fetch = fetch, lengthScale = 1, maxChunkChars = CHUNK_CHARS, fit = true, noCache = false, voices: string[] = []): TtsClient {
  const render: Render = async (text, scale, voice) => {
    const parts: Buffer[] = []
    for (const chunk of splitIntoChunks(text, maxChunkChars)) parts.push(await postWav(fetchFn, baseUrl, { text: chunk, length_scale: scale, ...(voice && { voice }), ...(noCache && { no_cache: true }) }))
    return concatWav(parts)
  }
  const pick = voicePicker(voices)
  return { ...(fit ? fitToWindow(render, lengthScale, pick) : renderOnce(render, lengthScale, pick)), name: 'chatterbox-multilingual' }
}

/**
 * Qwen3-TTS (`scripts/tts/qwen_server.py`, same /synthesize contract and server-side cache as Chatterbox). Handles
 * longer inputs than Chatterbox, so chunks are larger (fewer joins, more natural phrasing).
 */
export function createQwenTts(baseUrl: string, fetchFn: typeof fetch = fetch, lengthScale = 1, maxChunkChars = QWEN_CHUNK_CHARS, fit = true, noCache = false, voices: string[] = []): TtsClient {
  return { ...createChatterboxTts(baseUrl, fetchFn, lengthScale, maxChunkChars, fit, noCache, voices), name: 'qwen3-tts' }
}

/** Voices accepted by Requesty's /audio/speech (OpenAI voice set) */
export const REQUESTY_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'] as const
/** Hard API limit per request */
const REQUESTY_MAX_CHARS = 4096
/** Soft target per request; whole sentences only, a chunk may grow up to REQUESTY_MAX_CHARS for one long sentence */
const REQUESTY_CHUNK_CHARS = 3500
/** Chatterbox & co. generate a limited length per call (local Chatterbox uses 280) → small, sentence-aligned requests */
const REQUESTY_OTHER_CHUNK_CHARS = 300
/** OpenAI `pcm` output: raw 16-bit signed LE, mono, 24 kHz */
const REQUESTY_PCM_RATE = 24_000

export interface RequestyTtsConfig {
  /** Router base incl. /v1, e.g. https://router.requesty.ai/v1 */
  baseUrl: string
  apiKey: string
  /** e.g. openai/gpt-4o-mini-tts, deepinfra/ResembleAI/chatterbox-multilingual */
  model: string
  /** openai/*: one of REQUESTY_VOICES (empty → nova). Other models: passed through; empty → model default */
  voice?: string
  /** Non-OpenAI models: language code sent as `language`, e.g. `de` */
  language?: string
  /** openai/gpt-4o-mini-tts only: tone/accent/pacing steering */
  instructions?: string
  lengthScale?: number
  fit?: boolean
  maxChunkChars?: number
  fetchFn?: typeof fetch
}

/**
 * Requesty router (`POST /audio/speech`).
 * - openai/* models: raw PCM wrapped in a WAV header here (OpenAI's streamed WAV carries placeholder sizes);
 *   `length_scale` → `speed = 1 / scale`, so each fitting re-render is a paid call (max 4 per unit).
 * - other models (e.g. deepinfra/ResembleAI/chatterbox-multilingual): `response_format: wav` + optional `voice` /
 *   `language`. Like the local Chatterbox server, the raw render is generated once per text and cached in memory;
 *   `length_scale` is applied as a local ffmpeg time-stretch, so fitting re-renders cost nothing.
 */
export function createRequestyTts({ baseUrl, apiKey, model, voice = '', language = '', instructions = '', lengthScale = 1, fit = true, maxChunkChars, fetchFn = fetch, stretchFn = timeStretchWav }: RequestyTtsConfig & { stretchFn?: (wav: Buffer, scale: number) => Promise<Buffer | null> }): TtsClient {
  const url = `${baseUrl.replace(/\/$/, '')}/audio/speech`
  const openai = model.startsWith('openai/')
  const v = openai ? voice.trim().toLowerCase() || 'nova' : voice.trim()
  if (openai && !(REQUESTY_VOICES as readonly string[]).includes(v)) throw new Error(`Requesty TTS: unknown voice "${voice}" for ${model} (one of ${REQUESTY_VOICES.join(', ')})`)
  const chunkChars = maxChunkChars ?? (openai ? REQUESTY_CHUNK_CHARS : REQUESTY_OTHER_CHUNK_CHARS)

  const post = async (body: Record<string, unknown>): Promise<Buffer> => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Requesty TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return Buffer.from(await res.arrayBuffer())
  }
  const chunks = (text: string): string[] => splitIntoSentenceChunks(text, chunkChars, REQUESTY_MAX_CHARS)

  if (openai) {
    const render: Render = async (text, scale) => {
      const speed = Math.min(4, Math.max(0.25, 1 / scale))
      const parts: Buffer[] = []
      for (const chunk of chunks(text)) parts.push(await post({ model, input: chunk, voice: v, response_format: 'pcm', speed, ...(instructions && { instructions }) }))
      return pcmToWav(Buffer.concat(parts), REQUESTY_PCM_RATE)
    }
    return { ...(fit ? fitToWindow(render, lengthScale) : renderOnce(render, lengthScale)), name: `requesty · ${model} · ${v}` }
  }

  const raw = new Map<string, Promise<Buffer>>()
  const renderRaw = (text: string): Promise<Buffer> => {
    let p = raw.get(text)
    if (!p) {
      p = (async () => {
        const parts: Buffer[] = []
        for (const chunk of chunks(text)) {
          const wav = await post({ model, input: chunk, response_format: 'wav', ...(v && { voice: v }), ...(language && { language }) })
          if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Requesty TTS: ${model} did not return WAV (got ${wav.length} bytes starting "${wav.toString('latin1', 0, 4)}")`)
          parts.push(fixWavSizes(wav))
        }
        return concatWav(parts)
      })()
      p.catch(() => raw.delete(text))
      if (raw.size > 8) raw.delete(raw.keys().next().value!)
      raw.set(text, p)
    }
    return p
  }
  const render: Render = async (text, scale) => {
    const wav = await renderRaw(text)
    if (Math.abs(scale - 1) < 0.005) return wav
    const stretched = await stretchFn(wav, scale)
    if (!stretched) console.warn('tts: ffmpeg unavailable — Requesty audio kept at its native pace')
    return stretched ?? wav
  }
  return { ...(fit ? fitToWindow(render, lengthScale) : renderOnce(render, lengthScale)), name: `requesty · ${model}${v ? ` · ${v}` : ''}${language ? ` · ${language}` : ''}` }
}

/** Streamed WAVs may carry placeholder sizes (0 / 0xFFFFFFFF): rewrite RIFF + data sizes from the actual length */
export function fixWavSizes(wav: Buffer): Buffer {
  const out = Buffer.from(wav)
  let offset = 12
  while (offset + 8 <= out.length) {
    const id = out.toString('ascii', offset, offset + 4)
    const size = out.readUInt32LE(offset + 4)
    if (id === 'data') {
      out.writeUInt32LE(out.length - offset - 8, offset + 4)
      out.writeUInt32LE(out.length - 8, 4)
      return out
    }
    offset += 8 + size
  }
  throw new Error('WAV has no data chunk')
}

/**
 * Packs whole sentences (ending in . ! ? …, or a line break) into chunks of ≤ softMax chars. Never breaks inside a
 * sentence: a single sentence longer than softMax gets its own chunk; one longer than hardMax is an error.
 */
export function splitIntoSentenceChunks(text: string, softMax: number, hardMax = softMax): string[] {
  const sentences = text.split(/(?<=[.!?…]["'“”»«)\]]*)\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    if (sentence.length > hardMax) throw new Error(`TTS: sentence of ${sentence.length} chars exceeds the ${hardMax}-char request limit — split it in the script: "${sentence.slice(0, 80)}…"`)
    const last = chunks[chunks.length - 1]
    if (last && last.length + 1 + sentence.length <= softMax) chunks[chunks.length - 1] = `${last} ${sentence}`
    else chunks.push(sentence)
  }
  return chunks
}

/** Wraps raw 16-bit mono PCM in a WAV header */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const data = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm
  const wav = silentWav(0, sampleRate)
  wav.writeUInt32LE(36 + data.length, 4)
  wav.writeUInt32LE(data.length, 40)
  return Buffer.concat([wav, data])
}

/** Single render, no 3–5 min duration fitting (debugging / ad-hoc text) */
function renderOnce(renderWav: Render, lengthScale: number, pick: VoicePicker = () => undefined): Omit<TtsClient, 'name'> {
  return {
    async synthesize(raw) {
      const text = speakable(raw)
      const voice = pick()
      const audio = await renderWav(text, clampScale(lengthScale), voice)
      return { audio, contentType: 'audio/wav', durationSec: Math.floor(wavDurationSec(audio)), ...(voice && { voice }) }
    },
  }
}

type Render = (text: string, scale: number, voice?: string) => Promise<Buffer>
type VoicePicker = () => string | undefined

/** Random voice per unit; one voice → always that one; none → server default */
export function voicePicker(voices: string[], random: () => number = Math.random): VoicePicker {
  const list = voices.filter(Boolean)
  return () => (list.length ? list[Math.floor(random() * list.length)] : undefined)
}

async function postWav(fetchFn: typeof fetch, url: string, body: Record<string, unknown>): Promise<Buffer> {
  const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Chatterbox stays reliable up to a few sentences per generation */
const CHUNK_CHARS = 280
const QWEN_CHUNK_CHARS = 500

/** Packs whole sentences into chunks of ≤ maxChars; overlong sentences are split at commas, then at spaces */
export function splitIntoChunks(text: string, maxChars = CHUNK_CHARS): string[] {
  const pieces: string[] = []
  const split = (s: string, sep: RegExp): string[] => s.split(sep).map((x) => x.trim()).filter(Boolean)
  for (const sentence of split(text, /(?<=[.!?…:;])\s+|\n+/)) {
    if (sentence.length <= maxChars) { pieces.push(sentence); continue }
    for (const clause of split(sentence, /(?<=,)\s+/)) {
      if (clause.length <= maxChars) { pieces.push(clause); continue }
      let line = ''
      for (const word of clause.split(/\s+/)) {
        if (line && line.length + 1 + word.length > maxChars) { pieces.push(line); line = word } else line = line ? `${line} ${word}` : word
      }
      if (line) pieces.push(line)
    }
  }
  const chunks: string[] = []
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1]
    if (last && last.length + 1 + piece.length <= maxChars) chunks[chunks.length - 1] = `${last} ${piece}`
    else chunks.push(piece)
  }
  return chunks
}

/** Joins WAVs of the same format: header of the first, data chunks concatenated */
export function concatWav(wavs: Buffer[]): Buffer {
  if (wavs.length === 0) throw new Error('No audio to join')
  const first = dataChunk(wavs[0]!)
  const data = Buffer.concat(wavs.map((w) => { const d = dataChunk(w); return w.subarray(d.start, d.end) }))
  const out = Buffer.concat([wavs[0]!.subarray(0, first.start), data])
  out.writeUInt32LE(data.length, first.start - 4)
  out.writeUInt32LE(out.length - 8, 4)
  return out
}

function dataChunk(wav: Buffer): { start: number; end: number } {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file')
  let offset = 12
  while (offset + 8 <= wav.length) {
    const size = wav.readUInt32LE(offset + 4)
    if (wav.toString('ascii', offset, offset + 4) === 'data') return { start: offset + 8, end: Math.min(wav.length, offset + 8 + size) }
    offset += 8 + size
  }
  throw new Error('WAV has no data chunk')
}

/**
 * Units must run 3–5 min: renders up to MAX_RENDERS times with an adjusted pace, then pads up to MAX_PAD_SEC of
 * trailing silence; otherwise fails with a message that says what to change.
 */
function fitToWindow(renderWav: Render, lengthScale: number, pick: VoicePicker = () => undefined): Omit<TtsClient, 'name'> {
  return {
    async synthesize(raw) {
      const text = speakable(raw)
      // Same voice for every re-render of this unit
      const voice = pick()
      const render = async (t: string, scale: number): Promise<TtsResult> => {
        const audio = await renderWav(t, scale, voice)
        return { audio, contentType: 'audio/wav', durationSec: Math.floor(wavDurationSec(audio)), ...(voice && { voice }) }
      }
      let scale = clampScale(lengthScale)
      let best = await render(text, scale)
      const tries = [{ scale, sec: best.durationSec }]
      while (!inWindow(best.durationSec) && tries.length < MAX_RENDERS) {
        const target = best.durationSec < AUDIO_MIN_SEC ? TARGET_MIN_SEC : TARGET_MAX_SEC
        const next = nextLengthScale(tries, target)
        if (Math.abs(next - scale) < 0.01) break // clamped: another render would not change anything
        scale = next
        console.warn(`tts: ${best.durationSec}s → re-rendering at length_scale ${scale.toFixed(2)}`)
        best = await render(text, scale)
        tries.push({ scale, sec: best.durationSec })
      }
      const short = AUDIO_MIN_SEC - best.durationSec
      if (short > 0 && short <= MAX_PAD_SEC) {
        console.warn(`tts: ${best.durationSec}s after ${tries.length} renders → padding ${short}s of silence`)
        return { ...best, audio: padWav(best.audio, short), durationSec: AUDIO_MIN_SEC }
      }
      if (!inWindow(best.durationSec)) {
        throw new Error(`TTS: script renders to ${best.durationSec}s even at length_scale ${scale.toFixed(2)} (needs ${AUDIO_MIN_SEC}–${AUDIO_MAX_SEC}s) — shorten or lengthen the script`)
      }
      return best
    },
  }
}

/** Appends `seconds` of silence to the WAV data chunk (data must be the last chunk, as Piper writes it) */
export function padWav(wav: Buffer, seconds: number): Buffer {
  const byteRate = wav.readUInt32LE(28)
  const blockAlign = wav.readUInt16LE(32) || 1
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'data') {
      const extra = Math.ceil((seconds * byteRate) / blockAlign) * blockAlign
      const dataEnd = Math.min(wav.length, offset + 8 + size)
      const out = Buffer.concat([wav.subarray(0, dataEnd), Buffer.alloc(extra)])
      out.writeUInt32LE(dataEnd - offset - 8 + extra, offset + 4)
      out.writeUInt32LE(out.length - 8, 4)
      return out
    }
    offset += 8 + size
  }
  throw new Error('WAV has no data chunk')
}

export function wavDurationSec(wav: Buffer): number {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a WAV file')
  const byteRate = wav.readUInt32LE(28)
  // Find the "data" chunk; Piper may emit extra chunks before it
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'data') return Math.min(size, wav.length - offset - 8) / byteRate
    offset += 8 + size
  }
  throw new Error('WAV has no data chunk')
}

export function silentWav(durationSec: number, sampleRate = 8000): Buffer {
  const dataSize = durationSec * sampleRate * 2
  const b = Buffer.alloc(44 + dataSize)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + dataSize, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // mono
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(dataSize, 40)
  return b
}

/** German letter names, so acronyms are spelled out ("ETFs" → "E-Te-Effs") instead of read as a word ("atfs") */
const LETTER: Record<string, string> = {
  A: 'A', B: 'Be', C: 'Ze', D: 'De', E: 'E', F: 'Eff', G: 'Ge', H: 'Ha', I: 'I', J: 'Jott', K: 'Ka', L: 'Ell', M: 'Emm',
  N: 'Enn', O: 'O', P: 'Pe', Q: 'Ku', R: 'Err', S: 'Ess', T: 'Te', U: 'U', V: 'Fau', W: 'We', X: 'Ix', Y: 'Üpsilon', Z: 'Zett',
  Ä: 'Ä', Ö: 'Ö', Ü: 'Ü',
}
/** Acronyms spoken as words, left untouched */
const SPOKEN_AS_WORD = new Set(['NATO', 'DAX', 'MDAX', 'TECDAX', 'UNO', 'UNESCO', 'UNICEF', 'NASA', 'FIFA', 'UEFA', 'AIDS', 'LED', 'PIN', 'TÜV', 'BAföG', 'ESA', 'OPEC', 'ASEAN', 'LASER', 'RADAR', 'COVID', 'GAU', 'KITA', 'DIN', 'ISO'])

/** Expands ALL-CAPS acronyms (2–5 letters, optional plural "s") into hyphenated letter names for the TTS engine. */
export function speakable(text: string): string {
  return text.replace(/\b([A-ZÄÖÜ]{2,5})(s?)\b/g, (m, caps: string, plural: string) => {
    if (SPOKEN_AS_WORD.has(caps)) return m
    const letters = [...caps].map((c) => LETTER[c] ?? c)
    if (plural) letters[letters.length - 1] += 's'
    return letters.join('-')
  })
}
