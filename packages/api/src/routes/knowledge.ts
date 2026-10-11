import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SAVED_PAGE_SIZE, feedbackInputSchema, searchQuerySchema, type FeedbackResult, type FeedUnitDto, type SearchResponse, type TilePage } from '@wizzn/shared'
import type { FeedRepo } from '../feed-repo.js'
import type { KnowledgeRepo, SavedCursor } from '../knowledge-repo.js'
import { requireUser } from '../middleware/require-user.js'
import { SEARCH_MAX_RESULTS, decodeCursor, matchTopics, pageOf, shuffleWithinBands } from '../search.js'
import type { AppVariables, AuthPort, Repos } from '../types.js'

const idParam = zValidator('param', z.object({ id: z.string().uuid() }))
/** Units shown right after a "mehr davon" */
const MORE_NEXT = 2
const MIN_QUERY = 2

const savedCursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() })
function decodeSavedCursor(raw: string | undefined): SavedCursor | null {
  if (!raw) return null
  try {
    return savedCursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString()))
  } catch {
    return null
  }
}
const encodeSavedCursor = (c: SavedCursor | null): string | null => (c ? Buffer.from(JSON.stringify(c)).toString('base64url') : null)

/** Loads DTOs in the given order, dropping ids that are not (or no longer) published */
async function inOrder(feed: FeedRepo, ids: string[], userId: string): Promise<FeedUnitDto[]> {
  const units = await feed.loadUnits(ids, userId)
  return ids.flatMap((id) => {
    const u = units.get(id)
    return u ? [{ ...u, discovery: false }] : []
  })
}

/** Unit viewer, continuation, more/less feedback, bookmarks and search (spec: knowledge stream) */
export const knowledgeRoutes = (auth: AuthPort, feed: FeedRepo, knowledge: KnowledgeRepo, repos: Repos) =>
  new Hono<{ Variables: AppVariables }>()
    .use('*', requireUser(auth))
    .get('/units/:id', idParam, async (c) => {
      const userId = c.get('user').id
      const [u] = await inOrder(feed, [c.req.valid('param').id], userId)
      return u ? c.json(u) : c.json({ error: 'Not Found' }, 404)
    })
    .get(
      '/units/:id/next',
      idParam,
      zValidator('query', z.object({ limit: z.coerce.number().int().min(1).max(10).default(3), exclude: z.string().max(2000).optional() })),
      async (c) => {
        const userId = c.get('user').id
        const { limit, exclude } = c.req.valid('query')
        const prefs = await feed.getPrefs(userId)
        const ids = await knowledge.nextIds(userId, c.req.valid('param').id, prefs.formats, limit, exclude?.split(',').filter(Boolean) ?? [])
        return c.json(await inOrder(feed, ids, userId))
      },
    )
    .post('/units/:id/feedback', idParam, zValidator('json', feedbackInputSchema), async (c) => {
      const userId = c.get('user').id
      const unitId = c.req.valid('param').id
      const { vote } = c.req.valid('json')
      if (!(await knowledge.vote(userId, unitId, vote))) return c.json({ error: 'Not Found' }, 404)
      if (vote === -1) return c.json({ next: [] } satisfies FeedbackResult)
      const prefs = await feed.getPrefs(userId)
      const ids = await knowledge.nextIds(userId, unitId, prefs.formats, MORE_NEXT)
      return c.json({ next: await inOrder(feed, ids, userId) } satisfies FeedbackResult)
    })
    .get('/me/saved', zValidator('query', z.object({ cursor: z.string().max(300).optional() })), async (c) => {
      const page = await knowledge.listSaved(c.get('user').id, SAVED_PAGE_SIZE, decodeSavedCursor(c.req.valid('query').cursor))
      return c.json({ items: page.tiles, cursor: encodeSavedCursor(page.next) } satisfies TilePage)
    })
    .put('/me/saved/:id', idParam, async (c) => {
      const ok = await knowledge.save(c.get('user').id, c.req.valid('param').id)
      return ok ? c.json({ saved: true }) : c.json({ error: 'Not Found' }, 404)
    })
    .delete('/me/saved/:id', idParam, async (c) => {
      await knowledge.unsave(c.get('user').id, c.req.valid('param').id)
      return c.json({ saved: false })
    })
    .get('/search', zValidator('query', searchQuerySchema), async (c) => {
      const userId = c.get('user').id
      const { q, cursor } = c.req.valid('query')
      const page = decodeCursor(cursor)
      const searching = q.length >= MIN_QUERY
      const ids = searching
        ? shuffleWithinBands(await knowledge.search(q, SEARCH_MAX_RESULTS), q.toLowerCase())
        : shuffleWithinBands((await knowledge.forYou(userId, SEARCH_MAX_RESULTS)).map((id) => ({ id, rank: 0 })), `${userId}:${new Date().toISOString().slice(0, 10)}`)
      const slice = pageOf(ids, page)
      const topics = searching && page === 0 ? matchTopics(await repos.listFields(), q) : []
      return c.json({ topics, items: await knowledge.tiles(slice.ids), cursor: slice.cursor } satisfies SearchResponse)
    })
