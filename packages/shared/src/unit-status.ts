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

/** Units a pipeline worker is currently processing must not be deleted under its feet. */
export function canDelete(status: UnitStatus): boolean {
  return !['researching', 'drafting', 'checking', 'rendering_media'].includes(status)
}
