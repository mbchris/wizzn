import type { UnitStatus } from '@wizzn/shared'

export const STATUS_LABEL: Record<UnitStatus, string> = {
  queued: 'Wartet',
  researching: 'Recherche',
  drafting: 'Entwurf',
  checking: 'Prüfung',
  rendering_media: 'Medien',
  in_review: 'Zur Freigabe',
  published: 'Veröffentlicht',
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
  rejected: 'grey-8',
  failed: 'negative',
}
