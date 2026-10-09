import PgBoss from 'pg-boss'
import { loadEnv } from './env.js'
import { QUEUES } from './jobs/queues.js'

const env = loadEnv()
const boss = new PgBoss(env.DATABASE_URL)
boss.on('error', (err: Error) => console.error('pg-boss', err))

await boss.start()
for (const name of Object.values(QUEUES)) await boss.createQueue(name)
console.log(`wizzn worker started, queues: ${Object.values(QUEUES).join(', ')}`)

const shutdown = (): void => {
  void boss.stop({ graceful: true }).then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
