import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { briefBatchSchema, briefInputSchema, bulkActionSchema, type BriefBatchResultDto, rejectSchema, type BulkResultDto, replaceImageSchema, unitEditSchema, unitListQuerySchema, unitLogQuerySchema } from '@wizzn/shared'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin.js'
import { QUEUES } from '../jobs/queues.js'
import type { ImageReplacer } from '../pipeline/replace-image.js'
import type { AdminActionResult, AdminRepo, AppVariables, AuthPort, JobQueue } from '../types.js'

const idParam = zValidator('param', z.object({ id: z.string().uuid() }))

function respond(c: Context, result: AdminActionResult) {
  if (result === 'ok') return c.json({ ok: true })
  if (result === 'not_found') return c.json({ error: 'Not Found' }, 404)
  if (result === 'invalid_content') return c.json({ error: 'Content does not match the unit schema' }, 400)
  if (result === 'has_history') return c.json({ error: 'Unit has user history' }, 409)
  return c.json({ error: 'Action not allowed in the current status' }, 409)
}

export const adminRoutes = (auth: AuthPort, adminEmails: string[], repo: AdminRepo, queue: JobQueue, images?: ImageReplacer) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireAdmin(auth, adminEmails))
    .post('/briefs', zValidator('json', briefInputSchema), async (c) => {
      const created = await repo.createBrief(c.req.valid('json'), c.get('user').email)
      await Promise.all(created.unitIds.map((id) => queue.enqueueResearch(id)))
      return c.json(created, 201)
    })
    .post('/briefs/batch', zValidator('json', briefBatchSchema), async (c) => {
      // Whole body is validated up front (all-or-nothing); briefs are then created in file order
      const email = c.get('user').email
      const out: BriefBatchResultDto = { briefs: [] }
      for (const brief of c.req.valid('json').briefs) {
        const created = await repo.createBrief(brief, email)
        await Promise.all(created.unitIds.map((id) => queue.enqueueResearch(id)))
        out.briefs.push(created)
      }
      return c.json(out, 201)
    })
    .get('/units', zValidator('query', unitListQuerySchema), async (c) => c.json(await repo.listUnits(c.req.valid('query'))))
    .get('/units/:id', idParam, async (c) => {
      const unit = await repo.getUnit(c.req.valid('param').id)
      return unit ? c.json(unit) : c.json({ error: 'Not Found' }, 404)
    })
    .get('/units/:id/logs', idParam, zValidator('query', unitLogQuerySchema), async (c) =>
      c.json(await repo.listLogs(c.req.valid('param').id, c.req.valid('query').after)),
    )
    .put('/units/:id', idParam, zValidator('json', unitEditSchema), async (c) =>
      respond(c, await repo.editUnit(c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/units/:id/approve', idParam, async (c) => respond(c, await repo.approve(c.req.valid('param').id)))
    .post('/units/:id/lock', idParam, async (c) => {
      const id = c.req.valid('param').id
      const result = await repo.lock(id)
      if (result === 'ok') await repo.addLog(id, `Gesperrt von ${c.get('user').email}`)
      return respond(c, result)
    })
    .post('/units/:id/unlock', idParam, async (c) => {
      const id = c.req.valid('param').id
      const result = await repo.unlock(id)
      if (result === 'ok') await repo.addLog(id, `Entsperrt und wieder veröffentlicht von ${c.get('user').email}`)
      return respond(c, result)
    })
    .post('/units/:id/reject', idParam, zValidator('json', rejectSchema), async (c) =>
      respond(c, await repo.reject(c.req.valid('param').id, c.req.valid('json').reason)),
    )
    .post('/units/:id/requeue', idParam, async (c) => {
      const id = c.req.valid('param').id
      const result = await repo.requeue(id)
      if (result === 'ok') {
        await repo.addLog(id, `Alles neu generieren angestoßen von ${c.get('user').email}`)
        await queue.enqueueResearch(id)
      }
      return respond(c, result)
    })
    // Partial regeneration: new text from the existing sources, then check and media run again
    .post('/units/:id/redraft', idParam, async (c) => {
      const id = c.req.valid('param').id
      const result = await repo.redraft(id)
      if (result === 'ok') {
        await repo.addLog(id, `Text neu schreiben angestoßen von ${c.get('user').email}`)
        await queue.enqueue(QUEUES.draft, id)
      }
      return respond(c, result)
    })
    .post('/units/:id/resume', idParam, async (c) => {
      const id = c.req.valid('param').id
      const claim = await repo.resume(id)
      if (claim.result === 'ok') {
        await repo.addLog(id, `Fortsetzen angestoßen von ${c.get('user').email}`)
        await queue.enqueue(claim.queue, id)
      }
      return respond(c, claim.result)
    })
    .post('/units/bulk', zValidator('json', bulkActionSchema), async (c) => {
      const { action, ids } = c.req.valid('json')
      const out: BulkResultDto = { done: [], skipped: [] }
      // Sequential: each unit uses its own compare-and-set, and enqueueing stays in order
      for (const id of new Set(ids)) {
        let result: AdminActionResult
        if (action === 'resume') {
          const claim = await repo.resume(id)
          if (claim.result === 'ok') await queue.enqueue(claim.queue, id)
          result = claim.result
        } else if (action === 'delete') {
          result = await repo.deleteUnit(id)
        } else if (action === 'lock' || action === 'unlock') {
          result = action === 'lock' ? await repo.lock(id) : await repo.unlock(id)
          if (result === 'ok') await repo.addLog(id, `${action === 'lock' ? 'Gesperrt' : 'Entsperrt und wieder veröffentlicht'} von ${c.get('user').email} (Mehrfachauswahl)`)
        } else {
          result = await repo.requeue(id)
          if (result === 'ok') await queue.enqueueResearch(id)
        }
        if (result === 'ok') {
          out.done.push(id)
        } else {
          out.skipped.push({ id, reason: result === 'invalid_content' ? 'invalid_state' : result })
        }
      }
      return c.json(out)
    })
    .post(
      '/units/:id/assets/:assetId/replace',
      zValidator('param', z.object({ id: z.string().uuid(), assetId: z.string().uuid() })),
      zValidator('json', replaceImageSchema),
      async (c) => {
        if (!images) return c.json({ error: 'Image replacement not configured' }, 501)
        const { id, assetId } = c.req.valid('param')
        const { mode, prompt } = c.req.valid('json')
        const result = await images.replace(id, assetId, mode, prompt)
        if (result.ok) return c.json(result.asset)
        if (result.error === 'not_found') return c.json({ error: 'Not Found' }, 404)
        if (result.error === 'invalid_state') return c.json({ error: 'Action not allowed in the current status' }, 409)
        return c.json({ error: 'no_stock_candidate' }, 422)
      },
    )
    .post(
      '/units/:id/assets/:assetId/revoice',
      zValidator('param', z.object({ id: z.string().uuid(), assetId: z.string().uuid() })),
      async (c) => {
        if (!images) return c.json({ error: 'Media regeneration not configured' }, 501)
        const { id, assetId } = c.req.valid('param')
        const result = await images.revoice(id, assetId)
        if (result.ok) return c.json(result.asset)
        if (result.error === 'not_found') return c.json({ error: 'Not Found' }, 404)
        if (result.error === 'invalid_state') return c.json({ error: 'Action not allowed in the current status' }, 409)
        return c.json({ error: 'Neue Audiolänge passt nicht (3–5 Min.) oder Inhalt ungültig' }, 422)
      },
    )
