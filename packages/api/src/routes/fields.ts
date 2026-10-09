import { Hono } from 'hono'
import type { Repos } from '../types.js'

export const fieldRoutes = (repos: Repos) => new Hono().get('/', async (c) => c.json(await repos.listFields()))
