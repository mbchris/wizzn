import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { STUCK_AFTER_MS, WORKING_STATUSES, draftAudioSchema, draftWrittenSchema, isStuck, type UnitFormat, type UnitStatus } from '@wizzn/shared'
import type { Db } from '../db/client.js'
import { unit } from '../db/schema/index.js'
import { QUEUES, type QueueName } from '../jobs/queues.js'

export interface ResumePlan {
  /** Status the unit is put back into: the `from` status of the step that runs next */
  resetTo: UnitStatus
  queue: QueueName
}

/**
 * Where an orphaned unit picks up again. Each step's job moves the unit `from` → `working`, so resuming means
 * putting it back into the step's `from` status and enqueueing that step. A unit left in `drafting` whose draft is
 * complete (finished before the crash, or edited by an admin) only needs the check; otherwise it is drafted again.
 */
export function resumePlan(u: { status: UnitStatus; format: UnitFormat; contentJson: unknown }): ResumePlan | null {
  switch (u.status) {
    case 'researching':
      return { resetTo: 'queued', queue: QUEUES.research }
    case 'drafting': {
      const schema = u.format === 'written' ? draftWrittenSchema : draftAudioSchema
      return schema.safeParse(u.contentJson).success ? { resetTo: 'drafting', queue: QUEUES.check } : { resetTo: 'researching', queue: QUEUES.draft }
    }
    case 'checking':
      return { resetTo: 'drafting', queue: QUEUES.check }
    case 'rendering_media':
      return { resetTo: 'checking', queue: QUEUES.media }
    default:
      return null
  }
}

/**
 * Units that still have a pending or running pg-boss job. A unit can sit in a working status for a long time while
 * its next job waits behind others (one unit per step at a time), so age alone does not mean stuck.
 */
export async function liveJobUnitIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const res = await db.execute<{ id: string }>(sql`
    select distinct data->>'unitId' as id from pgboss.job
    where state in ('created', 'retry', 'active')
      and data->>'unitId' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  return new Set(res.rows.map((r) => r.id))
}

/** Stale working status and no live job: the job died (worker restart/crash) and nobody will move the unit on. */
export async function stuckIds(db: Db, rows: { id: string; status: UnitStatus; updatedAt: Date }[]): Promise<Set<string>> {
  const candidates = rows.filter((r) => isStuck(r.status, r.updatedAt)).map((r) => r.id)
  const live = await liveJobUnitIds(db, candidates)
  return new Set(candidates.filter((id) => !live.has(id)))
}

export async function isUnitStuck(db: Db, row: { id: string; status: UnitStatus; updatedAt: Date }): Promise<boolean> {
  return (await stuckIds(db, [row])).has(row.id)
}

export type ClaimResult = { result: 'ok'; queue: QueueName } | { result: 'not_found' | 'invalid_state' }

/** SQL guard: still in `status` and still stale, so a concurrent resume (admin click vs. worker sweep) wins only once. */
export const stillStuck = (id: string, status: UnitStatus) =>
  and(eq(unit.id, id), eq(unit.status, status), lt(unit.updatedAt, new Date(Date.now() - STUCK_AFTER_MS)))

/** Resets a stuck unit for its resume step; the caller enqueues `queue`. */
export async function claimResume(db: Db, id: string): Promise<ClaimResult> {
  const row = await db.query.unit.findFirst({ where: eq(unit.id, id), columns: { id: true, status: true, format: true, contentJson: true, updatedAt: true } })
  if (!row) return { result: 'not_found' }
  if (!(await isUnitStuck(db, row))) return { result: 'invalid_state' }
  const plan = resumePlan(row)
  if (!plan) return { result: 'invalid_state' }
  const updated = await db
    .update(unit)
    .set({ status: plan.resetTo, updatedAt: new Date(), failureReason: null })
    .where(stillStuck(id, row.status))
    .returning({ id: unit.id })
  return updated.length ? { result: 'ok', queue: plan.queue } : { result: 'invalid_state' }
}

export async function findStuckIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: unit.id, status: unit.status, updatedAt: unit.updatedAt })
    .from(unit)
    .where(and(inArray(unit.status, [...WORKING_STATUSES]), lt(unit.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))))
  return [...(await stuckIds(db, rows))]
}

/** Resumes every stuck unit; run by the worker on start and periodically. */
export async function sweepStuck(db: Db, enqueue: (queue: QueueName, unitId: string) => Promise<void>): Promise<string[]> {
  const resumed: string[] = []
  for (const id of await findStuckIds(db)) {
    const claim = await claimResume(db, id)
    if (claim.result !== 'ok') continue
    await enqueue(claim.queue, id)
    resumed.push(id)
  }
  return resumed
}
