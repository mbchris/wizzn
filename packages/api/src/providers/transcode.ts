import { spawn } from 'node:child_process'

/** WAV → MP3 64 kbit/s mono via ffmpeg (installed in the Docker image). Returns null when ffmpeg is unavailable. */
export function wavToMp3(wav: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-ac', '1', '-b:a', '64k', '-f', 'mp3', 'pipe:1'])
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : null))
    p.stdin.on('error', () => resolve(null))
    p.stdin.end(wav)
  })
}
