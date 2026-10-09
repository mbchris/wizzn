import PgBoss from 'pg-boss'
import { QUEUES, type QueueName } from './queues.js'

export interface UnitJob {
  unitId: string
}

export async function startBoss(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl)
  boss.on('error', (err: Error) => console.error('pg-boss', err))
  await boss.start()
  for (const name of Object.values(QUEUES)) await boss.createQueue(name)
  return boss
}

// Duplicate jobs are harmless: steps use compare-and-set status transitions
export const sendUnitJob = (boss: PgBoss, queue: QueueName, unitId: string): Promise<string | null> =>
  boss.send(queue, { unitId } satisfies UnitJob, { expireInSeconds: 15 * 60, retryLimit: 0 })
