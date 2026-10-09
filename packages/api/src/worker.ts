import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { sendUnitJob, startBoss, type UnitJob } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { runStep, type PipelineDeps, type StepName } from './pipeline/steps.js'
import { createDbPipelineStore } from './pipeline/store-db.js'
import { createProviders } from './providers/index.js'

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const boss = await startBoss(env.DATABASE_URL)

const deps: PipelineDeps = {
  ...createProviders(env),
  store: createDbPipelineStore(db),
  enqueue: async (queue, unitId) => {
    await sendUnitJob(boss, queue, unitId)
  },
}

const STEP_BY_QUEUE: Record<string, StepName> = {
  [QUEUES.research]: 'research',
  [QUEUES.draft]: 'draft',
  [QUEUES.check]: 'check',
  [QUEUES.media]: 'media',
}

for (const [queue, step] of Object.entries(STEP_BY_QUEUE)) {
  // One unit at a time per step: keeps a local Ollama or a cheap API within limits
  await boss.work<UnitJob>(queue, { batchSize: 1 }, async ([job]) => {
    if (!job) return
    console.log(`[${step}] ${job.data.unitId}`)
    await runStep(step, job.data.unitId, deps)
  })
}
console.log(`wizzn worker started (llm: ${env.LLM_MODEL}, tts: ${env.TTS_PROVIDER}, images: ${env.IMAGE_PROVIDER})`)

const shutdown = (): void => {
  void boss
    .stop({ graceful: true })
    .then(() => pool.end())
    .then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
