import { describe, expect, it } from 'vitest'
import type { UnitContent } from '@wizzn/shared'
import { createApp } from '../src/app.js'
import type { FeedPrefs, FeedRepo } from '../src/feed-repo.js'
import { localDate } from '../src/local-date.js'
import { fakeAuth, fakeRepos } from './fakes.js'

const headers = { authorization: 'Bearer t', 'content-type': 'application/json' }
const UNIT = '7f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const written: UnitContent = {
  format: 'written',
  slides: [{ title: 'a', body: 'b' }, { title: 'a', body: 'b' }, { title: 'a', body: 'b' }],
  sources: [{ url: 'https://a.de', title: 't', publisher: 'p' }],
}

function fakeFeed(prefs: Partial<FeedPrefs> = {}) {
  const impressions: string[] = []
  const completions: { unitId: string; date: string }[] = []
  const repo: FeedRepo = {
    getPrefs: async () => ({ fieldIds: ['A'], themeIds: [], formats: ['written'], timezone: 'Europe/Berlin', ...prefs }),
    getCandidates: async () => [{ id: 'u1', fieldId: 'A' }, { id: 'u2', fieldId: 'B' }],
    loadUnits: async (ids) =>
      new Map(ids.map((id) => [id, { id, title: id, format: 'written' as const, field: { id: 'A', slug: 'finance', nameDe: 'Finanzen', adviceDisclaimer: true }, content: written, media: {} }])),
    recordImpressions: async (_u, ids) => void impressions.push(...ids),
    getPublishedContent: async (id) => (id === UNIT ? written : null),
    insertCompletion: async (_u, unitId, date) => {
      const first = !completions.some((c) => c.unitId === unitId)
      if (first) completions.push({ unitId, date })
      return first
    },
  }
  return { repo, impressions, completions }
}

const app = (repo: FeedRepo) => createApp({ auth: fakeAuth(), repos: fakeRepos(), corsOrigins: [], feed: repo })

describe('GET /api/feed', () => {
  it('requires onboarding', async () => {
    const res = await app(fakeFeed({ fieldIds: [] }).repo).request('/api/feed', { headers })
    expect(res.status).toBe(409)
  })
  it('returns ordered units and records impressions', async () => {
    const f = fakeFeed()
    const res = await app(f.repo).request('/api/feed', { headers })
    const body = (await res.json()) as { units: { id: string; discovery: boolean }[] }
    expect(body.units.map((u) => [u.id, u.discovery])).toEqual([['u1', false], ['u2', true]])
    expect(f.impressions).toEqual(['u1', 'u2'])
  })
})

describe('POST /api/units/:id/complete', () => {
  it('records the first completion only once', async () => {
    const f = fakeFeed()
    const a = app(f.repo)
    const body = JSON.stringify({ format: 'written', slidesSeen: 3, dwellSec: 20 })
    const r1 = await (await a.request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body })).json()
    const r2 = await (await a.request(`/api/units/${UNIT}/complete`, { method: 'POST', headers, body })).json()
    expect(r1).toEqual({ completed: true, firstTime: true })
    expect(r2).toEqual({ completed: true, firstTime: false })
    expect(f.completions).toHaveLength(1)
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
