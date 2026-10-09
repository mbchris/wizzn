import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { fakeAuth, fakeRepos } from './fakes.js'

const FIELD = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const auth = { authorization: 'Bearer t', 'content-type': 'application/json' }

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] }).request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
  it('GET /health/ready returns 503 when the DB is down', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos({ dbUp: false }), corsOrigins: [] }).request('/health/ready')
    expect(res.status).toBe(503)
  })
})

describe('auth passthrough', () => {
  it('forwards /api/auth/* to Better Auth', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] }).request('/api/auth/sign-in/anonymous', { method: 'POST' })
    expect(await res.text()).toBe('auth')
  })
})

describe('/api/fields', () => {
  it('is public', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] }).request('/api/fields')
    expect(res.status).toBe(200)
    expect((await res.json())[0].slug).toBe('finance')
  })
})

describe('/api/me', () => {
  it('returns 401 without a session', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] }).request('/api/me')
    expect(res.status).toBe(401)
  })
  it('returns the anonymous user', async () => {
    const res = await createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] }).request('/api/me', { headers: auth })
    expect((await res.json()).isAnonymous).toBe(true)
  })
  it('PUT /interests saves valid input', async () => {
    const repos = fakeRepos()
    const res = await createApp({ auth: fakeAuth(), repos, corsOrigins: [] }).request('/api/me/interests', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ fieldIds: [FIELD], formats: ['written'] }),
    })
    expect(res.status).toBe(200)
    expect(repos.saved[0]).toEqual({ fieldIds: [FIELD], themeIds: [], formats: ['written'] })
  })
  it('PUT /interests rejects empty fields and unknown formats', async () => {
    const app = createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [] })
    const bad1 = await app.request('/api/me/interests', { method: 'PUT', headers: auth, body: JSON.stringify({ fieldIds: [], formats: ['audio'] }) })
    const bad2 = await app.request('/api/me/interests', { method: 'PUT', headers: auth, body: JSON.stringify({ fieldIds: [FIELD], formats: ['video'] }) })
    expect(bad1.status).toBe(400)
    expect(bad2.status).toBe(400)
  })
})
