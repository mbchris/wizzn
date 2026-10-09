/**
 * Dev-only: publishes the hand-written sample units in src/db/samples/*.json (5 written + 5 audio per field).
 * Media comes from the configured providers (placeholder SVG / silent WAV by default).
 * Idempotent: briefs are matched by topic + createdBy, existing ones are skipped.
 * Run: pnpm db:seed:samples   (never runs in the production container)
 */
import { readFile, readdir } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { draftAudioSchema, draftWrittenSchema, scheduleImages, sourceSchema, unitContentSchema } from '@wizzn/shared'
import { z } from 'zod'
import { loadEnv } from '../env.js'
import { createProviders } from '../providers/index.js'
import { extFor } from '../providers/media-store.js'
import { wavToMp3 } from '../providers/transcode.js'
import { createDb } from './client.js'
import { asset, contentBrief, field, source, theme, unit } from './schema/index.js'

const CREATED_BY = 'seed:samples'
const samplesDir = new URL('./samples/', import.meta.url)

const base = z.object({ theme: z.string().nullable(), topic: z.string().min(3), sources: z.array(sourceSchema).min(1).max(3) })
const sampleSchema = z.union([
  base.extend({ format: z.literal('written') }).merge(draftWrittenSchema),
  base.extend({ format: z.literal('audio') }).merge(draftAudioSchema),
])
type Sample = z.infer<typeof sampleSchema>

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const { images, tts, media } = createProviders(env)

async function storeImage(unitId: string, prompt: string): Promise<string> {
  const img = await images.generate(prompt)
  return media.put(unitId, img.data, extFor(img.contentType))
}

async function insertSample(fieldSlug: string, s: Sample): Promise<'created' | 'skipped'> {
  const f = await db.query.field.findFirst({ where: eq(field.slug, fieldSlug) })
  if (!f) throw new Error(`Field ${fieldSlug} missing — run pnpm db:seed first`)
  const t = s.theme ? await db.query.theme.findFirst({ where: eq(theme.slug, s.theme) }) : undefined
  if (s.theme && !t) throw new Error(`Theme ${s.theme} missing`)
  const existing = await db.query.contentBrief.findFirst({ where: and(eq(contentBrief.topic, s.topic), eq(contentBrief.createdBy, CREATED_BY)) })
  if (existing) return 'skipped'

  await db.transaction(async (tx) => {
    const [brief] = await tx
      .insert(contentBrief)
      .values({ fieldId: f.id, themeId: t?.id ?? null, topic: s.topic, context: 'Handgeschriebenes Beispiel', format: s.format, count: 1, createdBy: CREATED_BY })
      .returning({ id: contentBrief.id })
    const [u] = await tx
      .insert(unit)
      .values({ briefId: brief!.id, fieldId: f.id, themeId: t?.id ?? null, format: s.format, status: 'queued', title: s.title, promptVersion: 'sample-v1', model: 'handwritten' })
      .returning({ id: unit.id })
    const unitId = u!.id
    await tx.insert(source).values(s.sources.map((src, position) => ({ unitId, position, ...src, excerpt: '' })))

    let content: unknown
    if (s.format === 'written') {
      const prompts = s.slides.flatMap((sl) => (sl.imagePrompt ? [sl.imagePrompt] : []))
      const paths = await Promise.all(prompts.map((p) => storeImage(unitId, p)))
      const rows = paths.length
        ? await tx.insert(asset).values(paths.map((path, position) => ({ unitId, position, kind: 'image' as const, path }))).returning({ id: asset.id, position: asset.position })
        : []
      const ids = rows.sort((a, b) => a.position - b.position).map((r) => r.id)
      let next = 0
      content = {
        format: 'written',
        slides: s.slides.map(({ title, body, imagePrompt }) => ({ title, body, ...(imagePrompt ? { imageId: ids[next++] } : {}) })),
        sources: s.sources,
      }
    } else {
      const speech = await tts.synthesize(s.script)
      const mp3 = await wavToMp3(speech.audio)
      const audioPath = mp3 ? await media.put(unitId, mp3, 'mp3') : await media.put(unitId, speech.audio, extFor(speech.contentType))
      const imgPaths = await Promise.all(s.images.map((i) => storeImage(unitId, i.prompt)))
      const rows = await tx
        .insert(asset)
        .values([
          { unitId, position: 0, kind: 'audio' as const, path: audioPath, durationSec: speech.durationSec },
          ...imgPaths.map((path, i) => ({ unitId, position: i + 1, kind: 'image' as const, path })),
        ])
        .returning({ id: asset.id, position: asset.position })
      const [audio, ...imgs] = rows.sort((a, b) => a.position - b.position)
      const at = scheduleImages(speech.durationSec, s.images.map((i) => i.atFraction))
      content = {
        format: 'audio',
        script: s.script,
        durationSec: speech.durationSec,
        audioId: audio!.id,
        images: imgs.map((img, i) => ({ imageId: img.id, showAtSec: at[i] ?? 0 })),
        sources: s.sources,
      }
    }
    const parsed = unitContentSchema.parse(content)
    await tx.update(unit).set({ contentJson: parsed, status: 'published', publishedAt: new Date(), updatedAt: new Date() }).where(eq(unit.id, unitId))
  })
  return 'created'
}

async function main(): Promise<void> {
  const files = (await readdir(samplesDir)).filter((f) => f.endsWith('.json')).sort()
  let created = 0
  let skipped = 0
  const failed: string[] = []
  for (const file of files) {
    const fieldSlug = file.replace(/\.json$/, '')
    const samples = z.array(sampleSchema).parse(JSON.parse(await readFile(new URL(file, samplesDir), 'utf8')))
    for (const s of samples) {
      // One unit failing (e.g. TTS) must not stop the others; it rolls back and is retried on the next run
      try {
        const r = await insertSample(fieldSlug, s)
        if (r === 'created') created++
        else skipped++
        console.log(`${r === 'created' ? '+' : '='} [${fieldSlug}/${s.format}] ${s.title}`)
      } catch (err) {
        failed.push(`[${fieldSlug}/${s.format}] ${s.title}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
        console.error(`✗ [${fieldSlug}/${s.format}] ${s.title}`, err)
      }
    }
  }
  console.log(`Sample units: ${created} created, ${skipped} already present, ${failed.length} failed`)
  for (const f of failed) console.log(`  ✗ ${f}`)
  await pool.end()
}

main().catch(async (err: unknown) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
