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
  if (from === 'published') return to === 'rejected'
  if (i >= 0) return to === 'failed' || PIPELINE[i + 1] === to
  return false
}
