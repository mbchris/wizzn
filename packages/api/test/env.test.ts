import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'

const valid = {
  DATABASE_URL: 'postgres://wizzn:wizzn@localhost:5432/wizzn',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:9000, capacitor://localhost',
  LLM_BASE_URL: 'http://localhost:11434/v1',
  LLM_MODEL: 'qwen3:8b',
  SEARCH_URL: 'http://localhost:8080',
  TTS_URL: 'http://localhost:5000',
  TTS_VOICE: 'de_DE-thorsten-high',
  MEDIA_PUBLIC_URL: 'http://localhost:8081',
  STOCK_USER_AGENT: 'wizzn-test/1.0 (a@b.c)',
}

describe('loadEnv', () => {
  it('parses defaults and CSV origins', () => {
    const env = loadEnv(valid)
    expect(env.PORT).toBe(3000)
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:9000', 'capacitor://localhost'])
    expect(env.MEDIA_DRIVER).toBe('local')
  })
  it('rejects a short auth secret', () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/)
  })
  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _, ...rest } = valid
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/)
  })
  it('defaults stock settings', () => {
    const env = loadEnv(valid)
    expect(env.STOCK_IMAGE_PROVIDERS).toEqual(['openverse', 'commons'])
    expect(env.STOCK_MIN_EDGE_PX).toBe(800)
    expect(env.STOCK_MAX_BYTES).toBe(5_000_000)
    expect(env.IMAGE_EPHEMERAL).toBe(true)
  })
  it('requires STOCK_USER_AGENT when commons is enabled', () => {
    expect(() => loadEnv({ ...valid, STOCK_USER_AGENT: '' })).toThrow(/STOCK_USER_AGENT/)
    expect(() => loadEnv({ ...valid, STOCK_IMAGE_PROVIDERS: 'openverse,commons', STOCK_USER_AGENT: '' })).toThrow(/STOCK_USER_AGENT/)
  })
  it('accepts openverse alone without a user agent', () => {
    expect(loadEnv({ ...valid, STOCK_IMAGE_PROVIDERS: 'openverse', STOCK_USER_AGENT: '' }).STOCK_IMAGE_PROVIDERS).toEqual(['openverse'])
  })
  it('treats an empty provider list as stock disabled', () => {
    expect(loadEnv({ ...valid, STOCK_IMAGE_PROVIDERS: '', STOCK_USER_AGENT: '' }).STOCK_IMAGE_PROVIDERS).toEqual([])
  })
  it('rejects unknown stock providers', () => {
    expect(() => loadEnv({ ...valid, STOCK_IMAGE_PROVIDERS: 'foo' })).toThrow(/STOCK_IMAGE_PROVIDERS/)
  })
  it('parses IMAGE_EPHEMERAL=false', () => {
    expect(loadEnv({ ...valid, IMAGE_EPHEMERAL: 'false' }).IMAGE_EPHEMERAL).toBe(false)
  })
})
