export const UNIT_STATUSES = [
  'queued',
  'researching',
  'drafting',
  'checking',
  'rendering_media',
  'in_review',
  'published',
  'rejected',
  'failed',
] as const
export type UnitStatus = (typeof UNIT_STATUSES)[number]

const PIPELINE: readonly UnitStatus[] = ['queued', 'researching', 'drafting', 'checking', 'rendering_media', 'in_review']

/** Allowed transitions: forward one pipeline step, fail from any pipeline step, review outcome, requeue. */
export function canTransition(from: UnitStatus, to: UnitStatus): boolean {
  const i = PIPELINE.indexOf(from)
  if (from === 'in_review') return to === 'published' || to === 'rejected' || to === 'queued'
  if (from === 'failed' || from === 'rejected') return to === 'queued'
  // Published units can be regenerated; they leave the feed until re-approved
  if (from === 'published') return to === 'rejected' || to === 'queued'
  if (i >= 0) return to === 'failed' || PIPELINE[i + 1] === to
  return false
}

/** Statuses in which a pipeline worker owns the unit. */
export const WORKING_STATUSES = ['researching', 'drafting', 'checking', 'rendering_media'] as const satisfies readonly UnitStatus[]
export const isWorking = (status: UnitStatus): boolean => (WORKING_STATUSES as readonly UnitStatus[]).includes(status)

/**
 * Matches the pg-boss job expiry (15 min, retryLimit 0): a unit still "working" after this lost its job,
 * typically because the worker restarted (tsx watch) mid-step. Such units are safe for admins to take over.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000

export function isStuck(status: UnitStatus, updatedAt: Date | string, now: number = Date.now()): boolean {
  return isWorking(status) && now - new Date(updatedAt).getTime() > STUCK_AFTER_MS
}

/** Units a pipeline worker is currently processing must not be deleted under its feet; stuck ones may. */
export function canDelete(status: UnitStatus, stuck = false): boolean {
  return !isWorking(status) || stuck
}
