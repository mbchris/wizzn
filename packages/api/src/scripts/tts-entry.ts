/**
 * Dev: re-runs ONLY the audio generation of one unit and writes the files locally — the DB is not touched.
 *
 *   pnpm --filter @wizzn/api tts:entry <unitId> [outDir]
 *   pnpm --filter @wizzn/api tts:entry --text "Some script…" [outDir]
 *
 * Writes <outDir>/<id>.raw.wav (straight from the TTS provider) and <id>.mp3 (what the pipeline stores),
 * and prints loudness for both. Default outDir: ./tts-debug
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { loadEnv } from '../env.js'
import { createProviders } from '../providers/index.js'
import { wavToMp3 } from '../providers/transcode.js'
import { createDb } from '../db/client.js'
import { unit } from '../db/schema/index.js'

const args = process.argv.slice(2)
const textIdx = args.indexOf('--text')
const inlineText = textIdx >= 0 ? args.splice(textIdx, 2)[1] : undefined
const [unitId, outArg] = inlineText ? [undefined, args[0]] : args
if (!inlineText && !unitId) {
  console.error('Usage: tts-entry <unitId> [outDir]  |  tts-entry --text "…" [outDir]')
  process.exit(1)
}

const env = loadEnv()
let script = inlineText
let name = 'text'
if (!script) {
  const { db, pool } = createDb(env.DATABASE_URL)
  const [row] = await db.select({ id: unit.id, format: unit.format, title: unit.title, contentJson: unit.contentJson }).from(unit).where(eq(unit.id, unitId!))
  await pool.end()
  if (!row) throw new Error(`Unit ${unitId} not found`)
  script = (row.contentJson as { script?: string } | null)?.script
  if (!script) throw new Error(`Unit ${unitId} (${row.format}) has no script in content_json`)
  name = row.id
  console.log(`Unit "${row.title}" — ${script.split(/\s+/).length} words`)
}

const { tts } = createProviders(env)
console.log(`TTS provider: ${env.TTS_PROVIDER} @ ${env.TTS_URL}`)
const t0 = Date.now()
const speech = await tts.synthesize(script)
console.log(`Synthesized ${speech.durationSec}s in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const outDir = resolve(outArg ?? 'tts-debug')
await mkdir(outDir, { recursive: true })
const rawPath = join(outDir, `${name}.raw.wav`)
await writeFile(rawPath, speech.audio)
const mp3 = await wavToMp3(speech.audio)
const mp3Path = join(outDir, `${name}.mp3`)
if (mp3) await writeFile(mp3Path, mp3)
else console.warn('ffmpeg unavailable — no MP3 written')

function loudness(path: string): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' })
  const s = r.stderr ?? ''
  const i = s.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()
  const p = s.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()
  return `${i ?? '?'}  ${p ?? ''}`.replace(/\s+/g, ' ')
}
console.log(`raw  ${rawPath}\n     ${loudness(rawPath)}`)
if (mp3) console.log(`mp3  ${mp3Path}\n     ${loudness(mp3Path)}`)
