import { createHash } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Env } from '../env.js'

export interface MediaStore {
  /** Stores bytes under a content-addressed path and returns that path (relative, e.g. `unitId/abc123.wav`). */
  put(prefix: string, data: Buffer, ext: string): Promise<string>
  /** Removes a stored file; missing files are not an error. */
  delete(path: string): Promise<void>
  publicUrl(path: string): string
}

const EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))
export const extFor = (contentType: string): string => EXT[contentType] ?? 'bin'
export const contentTypeFor = (ext: string): string => MIME[ext] ?? 'application/octet-stream'

/** Paths are content-addressed, so a stored object never changes */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const contentPath = (prefix: string, data: Buffer, ext: string) => `${prefix}/${createHash('sha256').update(data).digest('hex').slice(0, 24)}.${ext}`
const urlFor = (publicBaseUrl: string) => (path: string) => `${publicBaseUrl.replace(/\/$/, '')}/${path}`

export function createLocalMediaStore(rootDir: string, publicBaseUrl: string): MediaStore {
  return {
    async put(prefix, data, ext) {
      const path = contentPath(prefix, data, ext)
      const full = join(rootDir, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, data)
      return path
    },
    async delete(path) {
      await unlink(join(rootDir, path)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err
      })
    },
    publicUrl: urlFor(publicBaseUrl),
  }
}

export interface S3MediaStoreOptions {
  bucket: string
  publicBaseUrl: string
  /** Injected in tests; built from endpoint + credentials otherwise */
  client: Pick<S3Client, 'send'>
}

export function createS3MediaStore({ bucket, publicBaseUrl, client }: S3MediaStoreOptions): MediaStore {
  return {
    async put(prefix, data, ext) {
      const path = contentPath(prefix, data, ext)
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: path, Body: data, ContentType: contentTypeFor(ext), CacheControl: IMMUTABLE_CACHE }))
      return path
    },
    async delete(path) {
      // S3 DELETE is idempotent: a missing key succeeds
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }))
    },
    publicUrl: urlFor(publicBaseUrl),
  }
}

export function createS3Client(env: Pick<Env, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'>): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    // Garage serves buckets path-style; virtual-host style would need wildcard DNS + certs
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  })
}

export function createMediaStore(env: Env): MediaStore {
  if (env.MEDIA_DRIVER === 's3') return createS3MediaStore({ bucket: env.S3_BUCKET, publicBaseUrl: env.MEDIA_PUBLIC_URL, client: createS3Client(env) })
  return createLocalMediaStore(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL)
}
