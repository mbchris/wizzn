import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { briefInputSchema, rejectSchema, unitEditSchema, unitListQuerySchema } from '@wizzn/shared'
import { z } from 'zod'
import { requireAdmin } from '../middleware/require-admin.js'
import type { AdminActionResult, AdminRepo, AppVariables, AuthPort, JobQueue } from '../types.js'

const idParam = zValidator('param', z.object({ id: z.string().uuid() }))

function respond(c: Context, result: AdminActionResult) {
  if (result === 'ok') return c.json({ ok: true })
  if (result === 'not_found') return c.json({ error: 'Not Found' }, 404)
  if (result === 'invalid_content') return c.json({ error: 'Content does not match the unit schema' }, 400)
  return c.json({ error: 'Action not allowed in the current status' }, 409)
}

export const adminRoutes = (auth: AuthPort, adminEmails: string[], repo: AdminRepo, queue: JobQueue) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireAdmin(auth, adminEmails))
    .post('/briefs', zValidator('json', briefInputSchema), async (c) => {
      const created = await repo.createBrief(c.req.valid('json'), c.get('user').email)
      await Promise.all(created.unitIds.map((id) => queue.enqueueResearch(id)))
      return c.json(created, 201)
    })
    .get('/units', zValidator('query', unitListQuerySchema), async (c) => c.json(await repo.listUnits(c.req.valid('query'))))
    .get('/units/:id', idParam, async (c) => {
      const unit = await repo.getUnit(c.req.valid('param').id)
      return unit ? c.json(unit) : c.json({ error: 'Not Found' }, 404)
    })
    .put('/units/:id', idParam, zValidator('json', unitEditSchema), async (c) =>
      respond(c, await repo.editUnit(c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/units/:id/approve', idParam, async (c) => respond(c, await repo.approve(c.req.valid('param').id)))
    .post('/units/:id/reject', idParam, zValidator('json', rejectSchema), async (c) =>
      respond(c, await repo.reject(c.req.valid('param').id, c.req.valid('json').reason)),
    )
    .post('/units/:id/requeue', idParam, async (c) => {
      const id = c.req.valid('param').id
      const result = await repo.requeue(id)
      if (result === 'ok') await queue.enqueueResearch(id)
      return respond(c, result)
    })
