/**
 * Dev-only: publishes the hand-written sample units in src/db/samples/*.json, each topic as BOTH a written and an audio unit.
 * The missing format is derived: audio scripts are split into slides; written samples are expanded into a script by the LLM.
 * Media comes from the configured providers (placeholder SVG / silent WAV by default).
 * Idempotent: briefs are matched by topic + format + createdBy, existing ones are skipped.
 * Run: pnpm db:seed:samples   (never runs in the production container)
 */
import { readFile, readdir } from 'node:fs/promises'
import { and, eq, isNotNull } from 'drizzle-orm'
import { AUDIO_SCRIPT_WORDS, draftAudioSchema, scheduleImages, slideSchema, sourceSchema, unitContentSchema } from '@wizzn/shared'
import { z } from 'zod'
import { loadEnv } from '../env.js'
import { createProviders } from '../providers/index.js'
import { extFor } from '../providers/media-store.js'
import { wavToMp3 } from '../providers/transcode.js'
import { createDb } from './client.js'
import { asset, contentBrief, field, source, theme, unit } from './schema/index.js'

const CREATED_BY = 'seed:samples'
const samplesDir = new URL('./samples/', import.meta.url)

const base = z.object({
  theme: z.string().nullable(),
  topic: z.string().min(3),
  sources: z.array(sourceSchema).min(1).max(3),
})
// Samples are short pre-#4 units (no cover); draftWrittenSchema now requires the long form, so they keep their own shape
const legacyWrittenSample = z.object({
  title: z.string().min(3).max(80),
  slides: z
    .array(slideSchema.omit({ imageId: true }).extend({ imagePrompt: z.string().min(3).optional() }))
    .min(3)
    .max(5),
})
const sampleSchema = z.union([base.extend({ format: z.literal('written') }).merge(legacyWrittenSample), base.extend({ format: z.literal('audio') }).merge(draftAudioSchema)])
type Sample = z.infer<typeof sampleSchema>

const env = loadEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const { images, tts, media, llm } = createProviders(env)

async function storeImage(unitId: string, prompt: string, fieldSlug: string): Promise<string> {
  const img = await images.generate(prompt, { field: fieldSlug })
  return media.put(unitId, img.data, extFor(img.contentType))
}

type WrittenSample = Extract<Sample, { format: 'written' }>
type AudioSample = Extract<Sample, { format: 'audio' }>

const SLIDE_MAX_WORDS = 110

/** Audio → written: sentence-aligned chunks of ≤110 words become 3–5 slides; image prompts go on the first slides. */
function toWritten(a: AudioSample): WrittenSample {
  const sentences = a.script.match(/[^.!?]+[.!?]+["»“”]?\s*/g) ?? [a.script]
  const chunks: string[] = []
  let cur = ''
  for (const sen of sentences) {
    const next = (cur + sen).trim()
    if (cur && next.split(/\s+/).length > SLIDE_MAX_WORDS) {
      chunks.push(cur.trim())
      cur = sen
    } else cur = cur + sen
  }
  if (cur.trim()) chunks.push(cur.trim())
  // Schema allows 3–5 slides: merge the shortest neighbours while too many (stays ≤120 words in practice)
  while (chunks.length > 5) {
    let i = 0
    for (let j = 1; j < chunks.length - 1; j++) if (chunks[j]!.length + chunks[j + 1]!.length < chunks[i]!.length + chunks[i + 1]!.length) i = j
    chunks.splice(i, 2, `${chunks[i]} ${chunks[i + 1]}`)
  }
  const slides = chunks.map((body, i) => ({
    title: i === 0 ? a.title : `${a.title} – Teil ${i + 1}`.slice(0, 80),
    body,
    ...(a.images[i] ? { imagePrompt: a.images[i]!.prompt } : {}),
  }))
  return {
    format: 'written',
    theme: a.theme,
    topic: a.topic,
    sources: a.sources,
    title: a.title,
    slides,
  }
}

/** Written → audio: the short slides are expanded into a 3–5 min script by the configured LLM. */
const SCRIPT_TARGET_WORDS = Math.round((AUDIO_SCRIPT_WORDS.min + AUDIO_SCRIPT_WORDS.max) / 2) + 20 // ~580: an undershoot still lands in range
const AUDIO_ATTEMPTS = 3

/** The ~90-word samples must grow ~6×; models undershoot, so retry with a fresh conversation before giving up. */
async function toAudio(w: WrittenSample): Promise<AudioSample> {
  let last: unknown
  for (let i = 0; i < AUDIO_ATTEMPTS; i++) {
    try {
      return await expandToAudio(w)
    } catch (err) {
      last = err
      console.warn(`  ↻ [audio] ${w.title}: attempt ${i + 1}/${AUDIO_ATTEMPTS} failed — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }
  throw last
}

async function expandToAudio(w: WrittenSample): Promise<AudioSample> {
  const text = w.slides.map((sl) => `${sl.title}: ${sl.body}`).join('\n\n')
  const prompts = w.slides.flatMap((sl) => (sl.imagePrompt ? [sl.imagePrompt] : []))
  const draft = await llm.chatJson(
    [
      {
        role: 'system',
        content: 'Du schreibst deutschsprachige Wissens-Audios. Antworte nur mit JSON.',
      },
      {
        role: 'user',
        content:
          `Thema: ${w.topic}\n\nVorlage:\n${text}\n\nMache daraus ein gut vorlesbares Sprechskript für 3–5 Minuten, etwa ${SCRIPT_TARGET_WORDS} Wörter (Pflicht: mindestens ${AUDIO_SCRIPT_WORDS.min + 50}, höchstens ${AUDIO_SCRIPT_WORDS.max - 50}).\n` +
          'Die Vorlage ist nur eine Kurzfassung und viel zu kurz: Gliedere das Skript in sechs Absätze mit je etwa neunzig Wörtern – Einstieg mit Alltagsbeispiel, dann jeden Punkt der Vorlage ausführlich mit Beispiel und Begründung erklären, am Ende eine Zusammenfassung mit konkretem Tipp. ' +
          'Kurze Sätze, keine Aufzählungszeichen, keine Abkürzungen, Zahlen ausgeschrieben. Keine neuen Zahlen oder Studien erfinden; erweitere durch Erklärungen und Beispiele.\n' +
          `Dazu 1–3 Bildmotive (prompt) mit Zeitpunkt als Anteil der Laufzeit (atFraction 0–0.9).${prompts.length ? ` Nutze diese Motive: ${prompts.join(' | ')}` : ''}\n\n` +
          'JSON: {"title":string,"script":string,"images":[{"prompt":string,"atFraction":number}]}',
      },
    ],
    draftAudioSchema,
  )
  return {
    format: 'audio',
    theme: w.theme,
    topic: w.topic,
    sources: w.sources,
    title: w.title,
    script: draft.script,
    images: draft.images.map(({ prompt, atFraction }) => ({ prompt, atFraction })),
  }
}

async function insertSample(fieldSlug: string, s: Sample, pairId: string): Promise<'created' | 'skipped'> {
  const f = await db.query.field.findFirst({
    where: eq(field.slug, fieldSlug),
  })
  if (!f) throw new Error(`Field ${fieldSlug} missing — run pnpm db:seed first`)
  const t = s.theme ? await db.query.theme.findFirst({ where: eq(theme.slug, s.theme) }) : undefined
  if (s.theme && !t) throw new Error(`Theme ${s.theme} missing`)
  const existing = await db.query.contentBrief.findFirst({
    where: and(eq(contentBrief.topic, s.topic), eq(contentBrief.format, s.format), eq(contentBrief.createdBy, CREATED_BY)),
  })
  if (existing) return 'skipped'

  await db.transaction(async (tx) => {
    const [brief] = await tx
      .insert(contentBrief)
      .values({
        fieldId: f.id,
        themeId: t?.id ?? null,
        topic: s.topic,
        context: 'Handgeschriebenes Beispiel',
        format: s.format,
        count: 1,
        createdBy: CREATED_BY,
      })
      .returning({ id: contentBrief.id })
    const [u] = await tx
      .insert(unit)
      .values({
        briefId: brief!.id,
        fieldId: f.id,
        themeId: t?.id ?? null,
        format: s.format,
        pairId,
        status: 'queued',
        title: s.title,
        promptVersion: 'sample-v1',
        model: 'handwritten',
      })
      .returning({ id: unit.id })
    const unitId = u!.id
    await tx.insert(source).values(
      s.sources.map((src, position) => ({
        unitId,
        position,
        ...src,
        excerpt: '',
      })),
    )

    let content: unknown
    if (s.format === 'written') {
      const prompts = s.slides.flatMap((sl) => (sl.imagePrompt ? [sl.imagePrompt] : []))
      const paths = await Promise.all(prompts.map((p) => storeImage(unitId, p, fieldSlug)))
      const rows = paths.length
        ? await tx
            .insert(asset)
            .values(
              paths.map((path, position) => ({
                unitId,
                position,
                kind: 'image' as const,
                path,
              })),
            )
            .returning({ id: asset.id, position: asset.position })
        : []
      const ids = rows.sort((a, b) => a.position - b.position).map((r) => r.id)
      let next = 0
      content = {
        format: 'written',
        slides: s.slides.map(({ title, body, imagePrompt }) => ({
          title,
          body,
          ...(imagePrompt ? { imageId: ids[next++] } : {}),
        })),
        sources: s.sources,
      }
    } else {
      const speech = await tts.synthesize(s.script)
      const mp3 = await wavToMp3(speech.audio)
      const audioPath = mp3 ? await media.put(unitId, mp3, 'mp3') : await media.put(unitId, speech.audio, extFor(speech.contentType))
      const imgPaths = await Promise.all(s.images.map((i) => storeImage(unitId, i.prompt, fieldSlug)))
      const rows = await tx
        .insert(asset)
        .values([
          {
            unitId,
            position: 0,
            kind: 'audio' as const,
            path: audioPath,
            durationSec: speech.durationSec,
          },
          ...imgPaths.map((path, i) => ({
            unitId,
            position: i + 1,
            kind: 'image' as const,
            path,
          })),
        ])
        .returning({ id: asset.id, position: asset.position })
      const [audio, ...imgs] = rows.sort((a, b) => a.position - b.position)
      const at = scheduleImages(
        speech.durationSec,
        s.images.map((i) => i.atFraction),
      )
      content = {
        format: 'audio',
        script: s.script,
        durationSec: speech.durationSec,
        audioId: audio!.id,
        images: imgs.map((img, i) => ({
          imageId: img.id,
          showAtSec: at[i] ?? 0,
        })),
        sources: s.sources,
      }
    }
    const parsed = unitContentSchema.parse(content)
    await tx
      .update(unit)
      .set({
        contentJson: parsed,
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(unit.id, unitId))
  })
  return 'created'
}

/** Reuses the pairId of an already seeded variant so a re-run that adds the missing one links it */
async function existingPairId(topic: string): Promise<string> {
  const [row] = await db
    .select({ pairId: unit.pairId })
    .from(unit)
    .innerJoin(contentBrief, eq(contentBrief.id, unit.briefId))
    .where(and(eq(contentBrief.topic, topic), eq(contentBrief.createdBy, CREATED_BY), isNotNull(unit.pairId)))
    .limit(1)
  return row?.pairId ?? crypto.randomUUID()
}

async function main(): Promise<void> {
  const files = (await readdir(samplesDir)).filter((f) => f.endsWith('.json')).sort()
  let created = 0
  let skipped = 0
  const failed: string[] = []
  for (const file of files) {
    const fieldSlug = file.replace(/\.json$/, '')
    const samples = z.array(sampleSchema).parse(JSON.parse(await readFile(new URL(file, samplesDir), 'utf8')))
    for (const original of samples) {
      // Both variants share a pairId: the feed shows one of them, completing either counts for the topic
      const pairId = await existingPairId(original.topic)
      for (const format of ['written', 'audio'] as const) {
        const s = original
        // One unit failing (e.g. TTS) must not stop the others; it rolls back and is retried on the next run
        try {
          const seeded = await db.query.contentBrief.findFirst({ where: and(eq(contentBrief.topic, s.topic), eq(contentBrief.format, format), eq(contentBrief.createdBy, CREATED_BY)) })
          if (seeded) {
            skipped++
            console.log(`= [${fieldSlug}/${format}] ${s.title}`)
            continue
          }
          const variant: Sample = format === original.format ? original : format === 'written' ? toWritten(original as AudioSample) : await toAudio(original as WrittenSample)
          const r = await insertSample(fieldSlug, variant, pairId)
          if (r === 'created') created++
          else skipped++
          console.log(`${r === 'created' ? '+' : '='} [${fieldSlug}/${format}] ${s.title}`)
        } catch (err) {
          failed.push(`[${fieldSlug}/${format}] ${s.title}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
          console.error(`✗ [${fieldSlug}/${format}] ${s.title}`, err)
        }
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
