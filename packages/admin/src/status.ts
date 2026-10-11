import type { UnitStatus } from '@wizzn/shared'

export const STATUS_LABEL: Record<UnitStatus, string> = {
  queued: 'Wartet',
  researching: 'Recherche',
  drafting: 'Entwurf',
  checking: 'Prüfung',
  rendering_media: 'Medien',
  in_review: 'Zur Freigabe',
  published: 'Veröffentlicht',
  locked: 'Gesperrt',
  rejected: 'Abgelehnt',
  failed: 'Fehler',
}

export const STATUS_COLOR: Record<UnitStatus, string> = {
  queued: 'grey',
  researching: 'blue-5',
  drafting: 'blue-6',
  checking: 'blue-7',
  rendering_media: 'blue-8',
  in_review: 'orange',
  published: 'positive',
  locked: 'purple-7',
  rejected: 'grey-8',
  failed: 'negative',
}

/** Badge text for units whose pipeline job died (see STUCK_AFTER_MS) */
export function stuckLabel(updatedAt: string): string {
  const d = new Date(updatedAt)
  const sameDay = d.toDateString() === new Date().toDateString()
  return `hängt seit ${sameDay ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
}
