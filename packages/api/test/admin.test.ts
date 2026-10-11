import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ImageReplacer } from '../src/pipeline/replace-image.js'
import type { AdminRepo, SessionUser } from '../src/types.js'
import { fakeAuth, fakeRepos } from './fakes.js'

const admin: SessionUser = { id: 'a1', name: 'Chris', email: 'Chris@Wizzn.app', isAnonymous: false }
const headers = { authorization: 'Bearer t', 'content-type': 'application/json' }
const FIELD = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc'
const UNIT = '7f1c2a3e-1b2c-4d5e-8f90-123456789abc'

function setup(user: SessionUser = admin, overrides: Partial<AdminRepo> = {}, images?: ImageReplacer) {
  const enqueued: string[] = []
  const jobs: [string, string][] = []
  const repo: AdminRepo = {
    createBrief: async (input) => ({ briefId: 'b1', unitIds: Array.from({ length: input.count }, (_, i) => `u${i}`) }),
    listUnits: async () => [],
    getUnit: async () => null,
    editUnit: async () => 'ok',
    approve: async () => 'ok',
    reject: async () => 'ok',
    requeue: async () => 'ok',
    redraft: async () => 'ok',
    deleteUnit: async () => 'ok',
    resume: async () => ({ result: 'ok', queue: 'unit.check' }),
    lock: async () => 'ok',
    unlock: async () => 'ok',
    listLogs: async () => [],
    addLog: async () => {},
    ...overrides,
  }
  const app = createApp({
    auth: fakeAuth(user),
    repos: fakeRepos(),
    corsOrigins: [],
    admin: { emails: ['chris@wizzn.app'], repo, queue: { enqueueResearch: async (id) => void enqueued.push(id), enqueue: async (q, id) => void jobs.push([q, id]) }, ...(images ? { images } : {}) },
  })
  return { app, enqueued, jobs }
}

describe('/api/admin', () => {
  it('rejects anonymous and non-listed users with 403', async () => {
    const anon = setup({ ...admin, isAnonymous: true })
    const other = setup({ ...admin, email: 'x@y.de' })
    expect((await anon.app.request('/api/admin/units', { headers })).status).toBe(403)
    expect((await other.app.request('/api/admin/units', { headers })).status).toBe(403)
  })
  it('returns the unit protocol and passes the polling cursor', async () => {
    const calls: [string, number | undefined][] = []
    const line = { id: 8, at: '2026-10-11T10:00:00.000Z', level: 'info' as const, step: 'draft', message: 'Entwurf gestartet' }
    const { app } = setup(admin, { listLogs: async (id, after) => (calls.push([id, after]), [line]) })
    const res = await app.request(`/api/admin/units/${UNIT}/logs?after=7`, { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([line])
    expect(calls).toEqual([[UNIT, 7]])
  })
  it('locks and unlocks units and notes it in the protocol', async () => {
    const notes: string[] = []
    const { app } = setup(admin, { addLog: async (_id, m) => void notes.push(m) })
    expect((await app.request(`/api/admin/units/${UNIT}/lock`, { method: 'POST', headers })).status).toBe(200)
    expect((await app.request(`/api/admin/units/${UNIT}/unlock`, { method: 'POST', headers })).status).toBe(200)
    expect(notes).toEqual([expect.stringContaining('Gesperrt'), expect.stringContaining('Entsperrt')])
    const refused = setup(admin, { lock: async () => 'invalid_state', unlock: async () => 'invalid_content' }).app
    expect((await refused.request(`/api/admin/units/${UNIT}/lock`, { method: 'POST', headers })).status).toBe(409)
    expect((await refused.request(`/api/admin/units/${UNIT}/unlock`, { method: 'POST', headers })).status).toBe(400)
  })
  it('notes a manual restart in the unit protocol', async () => {
    const notes: string[] = []
    const { app } = setup(admin, { addLog: async (_id, m) => void notes.push(m) })
    await app.request(`/api/admin/units/${UNIT}/requeue`, { method: 'POST', headers })
    expect(notes).toEqual([expect.stringContaining('Alles neu generieren')])
  })
  it('matches admin emails case-insensitively', async () => {
    expect((await setup().app.request('/api/admin/units', { headers })).status).toBe(200)
  })
  it('creates a brief and enqueues one research job per unit', async () => {
    const { app, enqueued } = setup()
    const res = await app.request('/api/admin/briefs', { method: 'POST', headers, body: JSON.stringify({ fieldId: FIELD, topic: 'Notgroschen', format: 'written', count: 3 }) })
    expect(res.status).toBe(201)
    expect(enqueued).toEqual(['u0', 'u1', 'u2'])
  })
  it('creates a batch of briefs and enqueues all units', async () => {
    const { app, enqueued } = setup()
    const brief = { fieldId: FIELD, topic: 'Notgroschen', format: 'written', count: 2 }
    const res = await app.request('/api/admin/briefs/batch', { method: 'POST', headers, body: JSON.stringify({ briefs: [brief, { ...brief, format: 'audio', count: 1 }] }) })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { briefs: unknown[] }).briefs).toHaveLength(2)
    expect(enqueued).toEqual(['u0', 'u1', 'u0'])
  })
  it('rejects the whole batch if one brief is invalid, creating nothing', async () => {
    const { app, enqueued } = setup()
    const ok = { fieldId: FIELD, topic: 'Notgroschen', format: 'written' }
    const res = await app.request('/api/admin/briefs/batch', { method: 'POST', headers, body: JSON.stringify({ briefs: [ok, { ...ok, topic: 'x' }] }) })
    expect(res.status).toBe(400)
    expect(enqueued).toEqual([])
  })
  it('rejects a brief with count > 10', async () => {
    const res = await setup().app.request('/api/admin/briefs', { method: 'POST', headers, body: JSON.stringify({ fieldId: FIELD, topic: 'Notgroschen', format: 'written', count: 11 }) })
    expect(res.status).toBe(400)
  })
  it('maps repo results to HTTP codes', async () => {
    const { app } = setup(admin, { approve: async () => 'invalid_state', reject: async () => 'not_found', editUnit: async () => 'invalid_content' })
    expect((await app.request(`/api/admin/units/${UNIT}/approve`, { method: 'POST', headers })).status).toBe(409)
    expect((await app.request(`/api/admin/units/${UNIT}/reject`, { method: 'POST', headers, body: JSON.stringify({ reason: 'zu werblich' }) })).status).toBe(404)
    expect((await app.request(`/api/admin/units/${UNIT}`, { method: 'PUT', headers, body: JSON.stringify({ title: 'Neu', contentJson: {} }) })).status).toBe(400)
  })
  it('requeue enqueues research only on success', async () => {
    const ok = setup()
    await ok.app.request(`/api/admin/units/${UNIT}/requeue`, { method: 'POST', headers })
    expect(ok.enqueued).toEqual([UNIT])
    const blocked = setup(admin, { requeue: async () => 'invalid_state' })
    await blocked.app.request(`/api/admin/units/${UNIT}/requeue`, { method: 'POST', headers })
    expect(blocked.enqueued).toEqual([])
  })

  it('redraft enqueues the draft step only on success', async () => {
    const ok = setup()
    expect((await ok.app.request(`/api/admin/units/${UNIT}/redraft`, { method: 'POST', headers })).status).toBe(200)
    expect(ok.jobs).toEqual([['unit.draft', UNIT]])
    const blocked = setup(admin, { redraft: async () => 'invalid_state' })
    expect((await blocked.app.request(`/api/admin/units/${UNIT}/redraft`, { method: 'POST', headers })).status).toBe(409)
    expect(blocked.jobs).toEqual([])
  })

  describe('POST /units/:id/resume', () => {
    it('enqueues the step the repo resumes at', async () => {
      const { app, jobs } = setup(admin, { resume: async () => ({ result: 'ok', queue: 'unit.media' }) })
      const res = await app.request(`/api/admin/units/${UNIT}/resume`, { method: 'POST', headers })
      expect(res.status).toBe(200)
      expect(jobs).toEqual([['unit.media', UNIT]])
    })
    it('returns 409 and enqueues nothing for units that are not stuck', async () => {
      const { app, jobs } = setup(admin, { resume: async () => ({ result: 'invalid_state' }) })
      expect((await app.request(`/api/admin/units/${UNIT}/resume`, { method: 'POST', headers })).status).toBe(409)
      expect(jobs).toEqual([])
    })
  })

  describe('POST /units/bulk', () => {
    const U2 = '9f1c2a3e-1b2c-4d5e-8f90-123456789abc'
    const bulk = (app: ReturnType<typeof setup>['app'], body: unknown) => app.request('/api/admin/units/bulk', { method: 'POST', headers, body: JSON.stringify(body) })

    it('validates action and ids', async () => {
      const { app } = setup()
      expect((await bulk(app, { action: 'nuke', ids: [UNIT] })).status).toBe(400)
      expect((await bulk(app, { action: 'delete', ids: [] })).status).toBe(400)
      expect((await bulk(app, { action: 'delete', ids: ['nope'] })).status).toBe(400)
    })
    it('regenerates and enqueues only the units that could be requeued', async () => {
      const { app, enqueued } = setup(admin, { requeue: async (id) => (id === UNIT ? 'ok' : 'invalid_state') })
      const res = await bulk(app, { action: 'regenerate', ids: [UNIT, U2] })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ done: [UNIT], skipped: [{ id: U2, reason: 'invalid_state' }] })
      expect(enqueued).toEqual([UNIT])
    })
    it('resumes stuck units at their own step', async () => {
      const { app, jobs, enqueued } = setup(admin, { resume: async (id) => (id === UNIT ? { result: 'ok', queue: 'unit.check' } : { result: 'invalid_state' }) })
      const res = await bulk(app, { action: 'resume', ids: [UNIT, U2] })
      expect(await res.json()).toEqual({ done: [UNIT], skipped: [{ id: U2, reason: 'invalid_state' }] })
      expect(jobs).toEqual([['unit.check', UNIT]])
      expect(enqueued).toEqual([])
    })
    it('deletes without enqueueing and reports units with user history', async () => {
      const deleted: string[] = []
      const { app, enqueued } = setup(admin, { deleteUnit: async (id) => (id === UNIT ? (deleted.push(id), 'ok') : 'has_history') })
      const res = await bulk(app, { action: 'delete', ids: [UNIT, U2, UNIT] })
      expect(await res.json()).toEqual({ done: [UNIT], skipped: [{ id: U2, reason: 'has_history' }] })
      expect(deleted).toEqual([UNIT])
      expect(enqueued).toEqual([])
    })
  })

  describe('POST /units/:id/assets/:assetId/replace', () => {
    const ASSET = '8f1c2a3e-1b2c-4d5e-8f90-123456789abc'
    const url = `/api/admin/units/${UNIT}/assets/${ASSET}/replace`
    const asset = { id: ASSET, kind: 'image' as const, url: 'https://m/x.jpg', durationSec: null, origin: 'generated' as const, credit: null, stockQuery: null, prompt: null }
    it('passes a custom prompt through', async () => {
      const calls: unknown[] = []
      const { app } = setup(admin, {}, { replace: async (...args) => (calls.push(args), { ok: true, asset }), revoice: async () => ({ ok: false, error: 'not_found' }) })
      await app.request(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'generated', prompt: 'flat diagram' }) })
      expect(calls).toEqual([[UNIT, ASSET, 'generated', 'flat diagram']])
    })
    it('passes the body through and returns the asset', async () => {
      const calls: unknown[] = []
      const { app } = setup(admin, {}, { replace: async (...args) => (calls.push(args), { ok: true, asset }) })
      const res = await app.request(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'generated' }) })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(asset)
      expect(calls).toEqual([[UNIT, ASSET, 'generated', undefined]])
    })
    it('maps errors to 404 / 409 / 422', async () => {
      const r = (error: 'not_found' | 'invalid_state' | 'no_stock_candidate') => setup(admin, {}, { replace: async () => ({ ok: false, error }) }).app
      const body = JSON.stringify({ mode: 'next-stock' })
      expect((await r('not_found').request(url, { method: 'POST', headers, body })).status).toBe(404)
      expect((await r('invalid_state').request(url, { method: 'POST', headers, body })).status).toBe(409)
      const res = await r('no_stock_candidate').request(url, { method: 'POST', headers, body })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'no_stock_candidate' })
    })
    it('rejects bad modes, non-admins and returns 501 when not configured', async () => {
      const images: ImageReplacer = { replace: async () => ({ ok: true, asset }), revoice: async () => ({ ok: false, error: 'not_found' }) }
      expect((await setup(admin, {}, images).app.request(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'x' }) })).status).toBe(400)
      expect((await setup({ ...admin, email: 'x@y.de' }, {}, images).app.request(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'generated' }) })).status).toBe(403)
      expect((await setup().app.request(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'generated' }) })).status).toBe(501)
    })
  })
})
