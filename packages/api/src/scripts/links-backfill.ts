import { eq } from 'drizzle-orm'
import { createDb } from '../db/client.js'
import { unit } from '../db/schema/index.js'
import { loadEnv } from '../env.js'
import { createKnowledgeRepo } from '../knowledge-repo.js'

/** Builds knowledge-graph links for every published unit (run once after migration 0010). */
const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const knowledge = createKnowledgeRepo(db, (p) => p)
const rows = await db.select({ id: unit.id }).from(unit).where(eq(unit.status, 'published'))
let failed = 0
for (const [i, r] of rows.entries()) {
  try {
    await knowledge.linkUnit(r.id)
  } catch (e) {
    failed++
    console.error(`[links] ${r.id}:`, e)
  }
  if ((i + 1) % 50 === 0) console.log(`[links] ${i + 1}/${rows.length}`)
}
console.log(`[links] done: ${rows.length - failed} linked, ${failed} failed`)
await pool.end()
