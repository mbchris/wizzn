// One queue per pipeline step (spec §4); handlers are added in M2.
export const QUEUES = {
  research: 'unit.research',
  draft: 'unit.draft',
  check: 'unit.check',
  media: 'unit.media',
} as const
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]
