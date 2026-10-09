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
})
