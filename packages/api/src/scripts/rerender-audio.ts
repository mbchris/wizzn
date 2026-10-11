/**
 * Dev/ops: re-renders the audio of existing audio units with the current TTS settings + loudness normalization,
 * stores the new MP3, updates the audio asset (path, duration) and the unit content (durationSec, image timings
 * scaled to the new length), then deletes the old file.
 *
 *   pnpm --filter @wizzn/api audio:rerender                 # all audio units that have an audio asset
 *   pnpm --filter @wizzn/api audio:rerender <unitId> …      # only these
 *   add --dry-run to list what would be re-rendered
 */
import { and, eq, inArray } from 'drizzle-orm'
import { audioUnitSchema } from '@wizzn/shared'
import { loadEnv } from '../env.js'
import { createProviders } from '../providers/index.js'
import { extFor } from '../providers/media-store.js'
import { wavToMp3 } from '../providers/transcode.js'
import { ttsGeneratorLabel, voiceFromGenerator } from '../providers/tts.js'
import { createDb } from '../db/client.js'
import { asset, unit } from '../db/schema/index.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const ids = args.filter((a) => !a.startsWith('--'))

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const { tts, media } = createProviders(env)

const rows = await db
  .select({ unitId: unit.id, title: unit.title, status: unit.status, contentJson: unit.contentJson, assetId: asset.id, path: asset.path, generator: asset.generator })
  .from(unit)
  .innerJoin(asset, and(eq(asset.unitId, unit.id), eq(asset.kind, 'audio')))
  .where(ids.length ? and(eq(unit.format, 'audio'), inArray(unit.id, ids)) : eq(unit.format, 'audio'))

console.log(`${rows.length} audio unit(s) · TTS ${env.TTS_PROVIDER}${dryRun ? ' · dry run' : ''}`)
let ok = 0
let failed = 0
for (const [i, row] of rows.entries()) {
  const label = `[${i + 1}/${rows.length}] ${row.unitId} "${row.title}" (${row.status})`
  const content = row.contentJson as { script?: string; durationSec?: number; images?: { imageId: string; showAtSec: number }[] } | null
  if (!content?.script) { console.warn(`${label} — no script, skipped`); continue }
  if (dryRun) { console.log(label); continue }
  try {
    // Keep the unit's voice when the engine is unchanged
    const voice = voiceFromGenerator(tts, row.generator)
    const speech = await tts.synthesize(content.script, voice ? { voice } : undefined)
    const mp3 = await wavToMp3(speech.audio)
    const path = mp3 ? await media.put(row.unitId, mp3, 'mp3') : await media.put(row.unitId, speech.audio, extFor(speech.contentType))
    const durationSec = speech.durationSec
    const oldSec = content.durationSec || durationSec
    const images = content.images?.map((img) => ({ ...img, showAtSec: Math.min(durationSec - 1, Math.round((img.showAtSec / oldSec) * durationSec)) }))
    const next = { ...content, durationSec, ...(images ? { images } : {}) }
    const check = audioUnitSchema.safeParse(next)
    if (!check.success) throw new Error(`content invalid after re-render: ${check.error.issues.map((x) => x.message).join('; ')}`)
    await db.transaction(async (tx) => {
      await tx.update(asset).set({ path, durationSec, generator: ttsGeneratorLabel(tts, speech.voice ?? voice) }).where(eq(asset.id, row.assetId))
      await tx.update(unit).set({ contentJson: next, updatedAt: new Date() }).where(eq(unit.id, row.unitId))
    })
    if (path !== row.path) await media.delete(row.path).catch((err) => console.warn(`${label} — old file not deleted: ${err instanceof Error ? err.message : err}`))
    console.log(`${label} — ${oldSec}s → ${durationSec}s`)
    ok++
  } catch (err) {
    console.error(`${label} — FAILED: ${err instanceof Error ? err.message : err}`)
    failed++
  }
}
if (!dryRun) console.log(`Done: ${ok} re-rendered, ${failed} failed`)
await pool.end()
process.exit(failed ? 1 : 0)
