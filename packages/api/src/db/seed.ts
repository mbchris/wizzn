import { FIELD_SEEDS } from '@wizzn/shared'
import { loadEnv } from '../env.js'
import { createDb } from './client.js'
import { field, theme } from './schema/index.js'

// Idempotent: safe to run on every deploy
async function main(): Promise<void> {
  const { db, pool } = createDb(loadEnv().DATABASE_URL)
  for (const f of FIELD_SEEDS) {
    const [row] = await db
      .insert(field)
      .values({ slug: f.slug, nameDe: f.nameDe, adviceDisclaimer: f.adviceDisclaimer })
      .onConflictDoUpdate({ target: field.slug, set: { nameDe: f.nameDe, adviceDisclaimer: f.adviceDisclaimer } })
      .returning({ id: field.id })
    if (!row) throw new Error(`Seeding field ${f.slug} failed`)
    for (const t of f.themes) {
      await db
        .insert(theme)
        .values({ fieldId: row.id, slug: t.slug, nameDe: t.nameDe })
        .onConflictDoUpdate({ target: theme.slug, set: { nameDe: t.nameDe, fieldId: row.id } })
    }
  }
  await pool.end()
  console.log(`Seeded ${FIELD_SEEDS.length} fields`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
