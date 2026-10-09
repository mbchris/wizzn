import { AUDIO_MAX_SEC, AUDIO_MIN_SEC } from '@wizzn/shared'

export interface TtsResult {
  audio: Buffer
  contentType: 'audio/wav'
  durationSec: number
}

export interface TtsClient {
  synthesize(text: string): Promise<TtsResult>
}

const WORDS_PER_MIN = 140

/** Dev/test: silent WAV with realistic duration, so the pipeline runs without a TTS server. */
export function createSilentTts(sampleRate = 8000): TtsClient {
  return {
    async synthesize(text) {
      const words = text.trim().split(/\s+/).filter(Boolean).length
      const durationSec = Math.max(1, Math.round((words / WORDS_PER_MIN) * 60))
      return { audio: silentWav(durationSec, sampleRate), contentType: 'audio/wav', durationSec }
    },
  }
}

/** Piper HTTP server (`python -m piper.http_server`): POST JSON { text, voice } to /synthesize → WAV. */
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
 * Units must run 3–5 min: renders up to MAX_RENDERS times with an adjusted pace, then pads up to MAX_PAD_SEC of
 * trailing silence; otherwise fails with a message that says what to change.
 */
export function createPiperTts(baseUrl: string, voice: string, fetchFn: typeof fetch = fetch, lengthScale = 1): TtsClient {
  async function render(text: string, scale: number): Promise<TtsResult> {
    const res = await fetchFn(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice, length_scale: scale }),
    })
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`)
    const audio = Buffer.from(await res.arrayBuffer())
    return { audio, contentType: 'audio/wav', durationSec: Math.floor(wavDurationSec(audio)) }
  }
  return {
    async synthesize(text) {
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
