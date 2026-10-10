import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface MediaStore {
  /** Stores bytes under a content-addressed path and returns that path (relative, e.g. `unitId/abc123.wav`). */
  put(prefix: string, data: Buffer, ext: string): Promise<string>
  publicUrl(path: string): string
}

const EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export const extFor = (contentType: string): string => EXT[contentType] ?? 'bin'

export function createLocalMediaStore(rootDir: string, publicBaseUrl: string): MediaStore {
  return {
    async put(prefix, data, ext) {
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 24)
      const path = `${prefix}/${hash}.${ext}`
      const full = join(rootDir, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, data)
      return path
    },
    publicUrl: (path) => `${publicBaseUrl.replace(/\/$/, '')}/${path}`,
  }
}
