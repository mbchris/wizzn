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

/** Piper HTTP server (`python -m piper.http_server`): POST JSON { text, voice } → WAV. */
export function createPiperTts(baseUrl: string, voice: string, fetchFn: typeof fetch = fetch): TtsClient {
  return {
    async synthesize(text) {
      const res = await fetchFn(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      })
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`)
      const audio = Buffer.from(await res.arrayBuffer())
      return { audio, contentType: 'audio/wav', durationSec: Math.round(wavDurationSec(audio)) }
    },
  }
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
