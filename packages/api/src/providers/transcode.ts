import { spawn } from 'node:child_process'

/**
 * Loudness target for spoken word (EBU R128 / podcast standard). TTS engines emit very quiet audio
 * (Chatterbox/Piper land around -40 LUFS), so every render is normalized before encoding.
 */
export const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 }

function ffmpeg(args: string[], input: Buffer): Promise<{ code: number | null; stdout: Buffer; stderr: string } | null> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', ...args])
    const out: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c: Buffer) => out.push(c))
    p.stderr.on('data', (c: Buffer) => (err += c.toString()))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }))
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}

interface Measured { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }

/** Pass 1 of loudnorm: measures the input. Null when ffmpeg is missing or the output can't be parsed. */
export async function measureLoudness(wav: Buffer): Promise<Measured | null> {
  const { I, TP, LRA } = LOUDNESS
  const r = await ffmpeg(['-f', 'wav', '-i', 'pipe:0', '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'], wav)
  if (!r || r.code !== 0) return null
  const json = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1)
  try {
    const m = JSON.parse(json) as Measured
    return Number.isFinite(Number(m.input_i)) ? m : null
  } catch {
    return null
  }
}

/** Two-pass loudnorm filter (linear gain when possible, so speech dynamics stay natural) */
export function loudnormFilter(m: Measured | null): string {
  const { I, TP, LRA } = LOUDNESS
  const base = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`
  if (!m) return base // single pass (dynamic) fallback
  return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
}

/**
 * WAV → loudness-normalized MP3 64 kbit/s mono via ffmpeg (installed in the Docker image).
 * Returns null when ffmpeg is unavailable.
 */
export async function wavToMp3(wav: Buffer): Promise<Buffer | null> {
  const measured = await measureLoudness(wav)
  // loudnorm upsamples to 192 kHz internally; resample back to the source rate
  const rate = wav.length >= 28 && wav.toString('ascii', 0, 4) === 'RIFF' ? wav.readUInt32LE(24) : 24000
  const r = await ffmpeg(
    ['-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-af', loudnormFilter(measured), '-ar', String(rate), '-ac', '1', '-b:a', '64k', '-f', 'mp3', 'pipe:1'],
    wav,
  )
  return r && r.code === 0 ? r.stdout : null
}
