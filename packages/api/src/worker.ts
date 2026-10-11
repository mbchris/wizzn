import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { sendUnitJob, startBoss, type UnitJob } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { sweepStuck } from './pipeline/recover.js'
import { runStep, type PipelineDeps, type StepName } from './pipeline/steps.js'
import { createDbPipelineStore } from './pipeline/store-db.js'
import { createProviders } from './providers/index.js'

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const boss = await startBoss(env.DATABASE_URL)

const deps: PipelineDeps = {
  ...createProviders(env),
  stockConfig: { minEdgePx: env.STOCK_MIN_EDGE_PX, maxBytes: env.STOCK_MAX_BYTES },
  researchMinSources: env.RESEARCH_MIN_SOURCES,
  store: createDbPipelineStore(db),
  enqueue: async (queue, unitId) => {
    await sendUnitJob(boss, queue, unitId)
  },
}

/** Error → printable text: strips NUL/control chars and binary noise, caps length. */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '')
  return clean.length > 2000 ? `${clean.slice(0, 2000)}…` : clean
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
    try {
      await runStep(step, job.data.unitId, deps)
    } catch (err) {
      console.error(`[${step}] ${job.data.unitId} failed:`, sanitizeError(err))
      // pg-boss stores the error as JSONB; raw bytes (\u0000) in it make Postgres reject the write and crash the worker.
      throw new Error(sanitizeError(err))
    }
  })
}
console.log(`wizzn worker started (llm: ${env.LLM_PROVIDER}/${env.LLM_MODEL || 'default'}, tts: ${env.TTS_PROVIDER}, images: ${env.IMAGE_PROVIDER})`)

// A restart (tsx watch, crash, deploy) kills in-flight steps; their jobs expire without moving the unit on.
// Resume such units from the interrupted step instead of leaving them stuck.
const sweep = (): void => {
  void sweepStuck(db, deps.enqueue)
    .then((ids) => ids.length && console.log(`[recover] resumed ${ids.length} stuck unit(s): ${ids.join(', ')}`))
    .catch((err: unknown) => console.error('[recover]', err))
}
sweep()
const sweepTimer = setInterval(sweep, 5 * 60 * 1000)

const shutdown = (): void => {
  clearInterval(sweepTimer)
  void boss
    .stop({ graceful: true })
    .then(() => pool.end())
    .then(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
