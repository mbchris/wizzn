import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/env.js'
import { createLocalMediaStore, createMediaStore, createS3MediaStore, IMMUTABLE_CACHE } from '../../src/providers/media-store.js'

const bytes = Buffer.from('hello media')
const HASHED_PATH = /^u1\/[0-9a-f]{24}\.mp3$/

describe('createLocalMediaStore', () => {
  let dir = ''
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

  it('writes content-addressed files and deletes them', async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-'))
    const store = createLocalMediaStore(dir, 'http://m/')
    const path = await store.put('u1', bytes, 'mp3')
    expect(path).toMatch(HASHED_PATH)
    expect(await readFile(join(dir, path))).toEqual(bytes)
    expect(store.publicUrl(path)).toBe(`http://m/${path}`)
    await store.delete(path)
    await expect(stat(join(dir, path))).rejects.toThrow()
  })

  it('ignores deleting a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-'))
    await expect(createLocalMediaStore(dir, 'http://m').delete('u1/missing.mp3')).resolves.toBeUndefined()
  })
})

describe('createS3MediaStore', () => {
  const setup = () => {
    const sent: unknown[] = []
    const client = { send: async (cmd: unknown) => (sent.push(cmd), {}) } as Parameters<typeof createS3MediaStore>[0]['client']
    return { sent, store: createS3MediaStore({ bucket: 'wizzn-media', publicBaseUrl: 'https://media.example.com', client }) }
  }

  it('uploads with content type and immutable caching under a content-addressed path', async () => {
    const { sent, store } = setup()
    const path = await store.put('u1', bytes, 'mp3')
    expect(path).toMatch(HASHED_PATH)
    expect(path).toBe(`u1/${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.mp3`)
    const cmd = sent[0] as PutObjectCommand
    expect(cmd).toBeInstanceOf(PutObjectCommand)
    expect(cmd.input).toMatchObject({ Bucket: 'wizzn-media', Key: path, ContentType: 'audio/mpeg', CacheControl: IMMUTABLE_CACHE })
    expect(store.publicUrl(path)).toBe(`https://media.example.com/${path}`)
  })

  it('deletes by key', async () => {
    const { sent, store } = setup()
    await store.delete('u1/abc.jpg')
    expect(sent[0]).toBeInstanceOf(DeleteObjectCommand)
    expect((sent[0] as DeleteObjectCommand).input).toEqual({ Bucket: 'wizzn-media', Key: 'u1/abc.jpg' })
  })

  it('propagates upload errors', async () => {
    const client = { send: async () => { throw new Error('AccessDenied') } } as Parameters<typeof createS3MediaStore>[0]['client']
    const store = createS3MediaStore({ bucket: 'b', publicBaseUrl: 'https://m', client })
    await expect(store.put('u1', bytes, 'png')).rejects.toThrow('AccessDenied')
  })
})

describe('createMediaStore', () => {
  const base = {
    DATABASE_URL: 'postgres://wizzn:wizzn@localhost:5432/wizzn',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    LLM_MODEL: 'm',
    SEARCH_URL: 'http://localhost:8080',
    MEDIA_PUBLIC_URL: 'https://media.example.com',
    STOCK_USER_AGENT: 'wizzn-test/1.0 (a@b.c)',
  }

  it('picks the driver from MEDIA_DRIVER', () => {
    expect(createMediaStore(loadEnv(base)).publicUrl('a/b.png')).toBe('https://media.example.com/a/b.png')
    const s3 = createMediaStore(loadEnv({ ...base, MEDIA_DRIVER: 's3', S3_ENDPOINT: 'https://s3.example.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'GK1', S3_SECRET_ACCESS_KEY: 's' }))
    expect(s3.publicUrl('a/b.png')).toBe('https://media.example.com/a/b.png')
  })
})
