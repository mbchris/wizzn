import { describe, expect, it } from 'vitest'
import { dailyCap, levelFor, type CompletionRewardsDto, type UnitContent } from '@wizzn/shared'
import { createApp } from '../src/app.js'
import { creditsFor, type FeedPrefs, type FeedRepo } from '../src/feed-repo.js'
import { localDate } from '../src/local-date.js'
import { fakeAuth, fakeProgress, fakeRepos } from './fakes.js'

const headers = { authorization: 'Bearer t', 'content-type': 'application/json' }
const UNIT = '7f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const UNIT2 = '7f1c2a3e-1b2c-4d5e-8f90-123456789abd'
const written: UnitContent = {
  format: 'written',
  slides: [{ title: 'a', body: 'b' }, { title: 'a', body: 'b' }, { title: 'a', body: 'b' }],
  sources: [{ url: 'https://a.de', title: 't', publisher: 'p' }],
}
const done = JSON.stringify({ format: 'written', slidesSeen: 3, dwellSec: 20 })
const LONG = '7f1c2a3e-1b2c-4d5e-8f90-123456789abe'
// Issue #4: cover + 5 × 95 words + 25-word hook = 500 words → 6 pages, 45 s
const longWritten: UnitContent = {
  format: 'written',
  cover: { hook: Array(25).fill('wort').join(' '), imageId: 'c1' },
  slides: Array(5).fill({ title: 'a', body: Array(95).fill('wort').join(' ') }),
  sources: [{ url: 'https://a.de', title: 't', publisher: 'p' }],
}

function fakeFeed(prefs: Partial<FeedPrefs> = {}) {
  const impressions: string[] = []
  const repo: FeedRepo = {
    getPrefs: async () => ({ fieldIds: ['A'], themeIds: [], formats: ['written'], timezone: 'Europe/Berlin', ...prefs }),
    getCandidates: async () => [{ id: 'u1', fieldId: 'A' }, { id: 'u2', fieldId: 'B' }],
    loadUnits: async (ids) =>
      new Map(ids.map((id) => [id, { id, title: id, format: 'written' as const, field: { id: 'A', slug: 'finance', nameDe: 'Finanzen', adviceDisclaimer: true }, content: written, media: {} }])),
    recordImpressions: async (_u, ids) => void impressions.push(...ids),
    getPublishedContent: async (id) => (id === LONG ? longWritten : [UNIT, UNIT2].includes(id) ? written : null),
  }
  return { repo, impressions }
}

const app = (repo: FeedRepo, progress = fakeProgress()) =>
  createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [], feed: repo, progress: { repo: progress, freeDailyCap: 3 } })

describe('GET /api/feed', () => {
  it('requires onboarding', async () => {
    const res = await app(fakeFeed({ fieldIds: [] }).repo).request('/api/feed', { headers })
    expect(res.status).toBe(409)
  })
  it('returns ordered units, the cap state and records impressions', async () => {
    const f = fakeFeed()
    const res = await app(f.repo).request('/api/feed', { headers })
    const body = (await res.json()) as { units: { id: string; discovery: boolean }[]; cap: unknown }
    expect(body.units.map((u) => [u.id, u.discovery])).toEqual([['u1', false], ['u2', true]])
    expect(body.cap).toEqual({ limit: 3, done: 0, remaining: 3, reached: false })
    expect(f.impressions).toEqual(['u1', 'u2'])
  })
  it('serves nothing once the free cap is reached', async () => {
    const f = fakeFeed()
    const res = await app(f.repo, fakeProgress({ doneToday: 3 })).request('/api/feed', { headers })
    expect(await res.json()).toEqual({ units: [], cap: { limit: 3, done: 3, remaining: 0, reached: true } })
    expect(f.impressions).toEqual([])
  })
  it('has no cap for premium users', async () => {
    const res = await app(fakeFeed().repo, fakeProgress({ doneToday: 7, premium: true })).request('/api/feed', { headers })
    const body = (await res.json()) as { units: unknown[]; cap: { reached: boolean; limit: number | null } }
    expect(body.units).toHaveLength(2)
    expect(body.cap).toMatchObject({ reached: false, limit: null })
  })
})

describe('POST /api/units/:id/complete', () => {
  it('requires cover + all slides and length-based dwell for long-form units', async () => {
    const post = (body: object) => app(fakeFeed().repo).request(`/api/units/${LONG}/complete`, { method: 'POST', headers, body: JSON.stringify(body) })
    expect(await (await post({ format: 'written', slidesSeen: 5, dwellSec: 60 })).json()).toMatchObject({ completed: false, reason: 'not_enough_progress' })
    expect(await (await post({ format: 'written', slidesSeen: 6, dwellSec: 30 })).json()).toMatchObject({ completed: false, reason: 'not_enough_progress' })
    expect(await (await post({ format: 'written', slidesSeen: 6, dwellSec: 45 })).json()).toMatchObject({ completed: true })
  })
  it('records the first completion only once and returns rewards', async () => {
    const progress = fakeProgress()
    const a = app(fakeFeed().repo, progress)
    const r1 = (await (await a.request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body: done })).json()) as { firstTime: boolean; rewards?: CompletionRewardsDto }
    const r2 = await (await a.request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body: done })).json()
    expect(r1.firstTime).toBe(true)
    expect(r1.rewards?.xpGained).toBe(15)
    expect(r2).toEqual({ completed: true, firstTime: false })
    expect(progress.completions).toHaveLength(1)
  })
  it('uses the user local date', async () => {
    const progress = fakeProgress()
    await app(fakeFeed({ timezone: 'Pacific/Kiritimati' }).repo, progress).request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body: done })
    expect(progress.completions[0]?.date).toBe(localDate(new Date(), 'Pacific/Kiritimati'))
  })
  it('returns 402 after the free daily cap', async () => {
    const progress = fakeProgress({ doneToday: 3 })
    const res = await app(fakeFeed().repo, progress).request(`/api/units/${UNIT2}/complete`, { method: 'POST', headers, body: done })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ completed: false, reason: 'daily_cap' })
    expect(progress.completions).toHaveLength(0)
  })
  it('rejects too little progress', async () => {
    const res = await app(fakeFeed().repo).request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body: JSON.stringify({ format: 'written', slidesSeen: 1, dwellSec: 20 }) })
    expect(res.status).toBe(400)
  })
  it('returns 404 for unpublished units', async () => {
    const res = await app(fakeFeed().repo).request('/api/units/8f1c2a3e-1b2c-4d5e-8f90-123456789abc/complete', { method: 'POST', headers, body: JSON.stringify({ format: 'audio', listenedSec: 999 }) })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/me/progress', () => {
  it('returns the progress for the user', async () => {
    const res = await app(fakeFeed().repo, fakeProgress({ doneToday: 1 })).request('/api/me/progress', { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cap: dailyCap(1, false, 3), level: levelFor(0) })
  })
  it('requires a session', async () => {
    const res = await app(fakeFeed().repo).request('/api/me/progress')
    expect(res.status).toBe(401)
  })
})

describe('localDate', () => {
  it('uses the user time zone around midnight', () => {
    const at = new Date('2026-10-09T22:30:00Z')
    expect(localDate(at, 'Europe/Berlin')).toBe('2026-10-10')
    expect(localDate(at, 'America/New_York')).toBe('2026-10-09')
  })
  it('falls back to Berlin for unknown zones', () => {
    expect(localDate(new Date('2026-10-09T22:30:00Z'), 'Mars/Olympus')).toBe('2026-10-10')
  })
})

describe('creditsFor', () => {
  const c = { title: 't', creator: null, creatorUrl: null, license: 'cc0' as const, licenseVersion: null, licenseUrl: 'https://l', sourceUrl: 'https://s', provider: 'commons' as const, providerId: '1' }
  it('maps only assets with a credit (stock)', () => {
    expect(creditsFor([{ id: 's', credit: c }, { id: 'g', credit: null }])).toEqual({ s: c })
  })
  it('is empty for units without credits (pre-migration)', () => {
    expect(creditsFor([{ id: 'g', credit: null }])).toEqual({})
  })
})
