import { Hono } from 'hono'
import type { Repos } from '../types.js'

export const healthRoutes = (repos: Repos) =>
  new Hono()
    .get('/', (c) => c.json({ status: 'ok' }))
    .get('/ready', async (c) => {
      try {
        await repos.pingDb()
        return c.json({ status: 'ready' })
      } catch {
        return c.json({ status: 'db_unavailable' }, 503)
      }
    })
