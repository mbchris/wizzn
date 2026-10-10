/**
 * Dev: re-runs ONLY the audio generation of one unit and writes the files locally — the DB is not touched.
 *
 *   pnpm --filter @wizzn/api tts:entry <unitId> [outDir]
 *   pnpm --filter @wizzn/api tts:entry --text "Some script…" [outDir]
 *   add --fit to apply the pipeline's 3–5 min duration fitting (default: one render at TTS_LENGTH_SCALE)
 *   add --provider <silent|piper|chatterbox|qwen> and/or --url <http://…/synthesize> to override TTS_PROVIDER / TTS_URL,
 *   e.g. to A/B two engines running on different ports (see `pnpm tts:server`)
 *
 * Writes <outDir>/<id>.raw.wav (straight from the TTS provider) and <id>.mp3 (what the pipeline stores),
 * and prints loudness for both. Default outDir: ./tts-debug
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { loadEnv } from '../env.js'
import { createTts } from '../providers/index.js'
import { splitIntoChunks, wavDurationSec } from '../providers/tts.js'
import { wavToMp3 } from '../providers/transcode.js'
import { createDb } from '../db/client.js'
import { unit } from '../db/schema/index.js'

const tStart = Date.now()
const args = process.argv.slice(2)
const fitIdx = args.indexOf('--fit')
const fit = fitIdx >= 0
if (fit) args.splice(fitIdx, 1)
function takeOpt(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const providerOpt = takeOpt('--provider')
const urlOpt = takeOpt('--url')
const textIdx = args.indexOf('--text')
const inlineText = textIdx >= 0 ? args.splice(textIdx, 2)[1] : undefined
const [unitId, outArg] = inlineText ? [undefined, args[0]] : args
if (!inlineText && !unitId) {
  console.error('Usage: tts-entry <unitId> [outDir]  |  tts-entry --text "…" [outDir]')
  process.exit(1)
}

const env = loadEnv()
const PROVIDERS = ['silent', 'piper', 'chatterbox', 'qwen'] as const
if (providerOpt && !(PROVIDERS as readonly string[]).includes(providerOpt)) {
  console.error(`--provider must be one of ${PROVIDERS.join(', ')}`)
  process.exit(1)
}
if (providerOpt) env.TTS_PROVIDER = providerOpt as (typeof PROVIDERS)[number]
if (urlOpt) env.TTS_URL = urlOpt
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

const tts = createTts(env, { fit })
const sec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

type ServerInfo = Record<string, unknown> & { stats?: Record<string, number> }
async function serverInfo(): Promise<ServerInfo | null> {
  if (env.TTS_PROVIDER !== 'chatterbox' && env.TTS_PROVIDER !== 'qwen') return null
  try {
    const res = await fetch(new URL('/info', env.TTS_URL), { signal: AbortSignal.timeout(3000) })
    return res.ok ? ((await res.json()) as ServerInfo) : null
  } catch {
    return null
  }
}

const info = await serverInfo()
console.log('── TTS settings')
console.log(`  provider      ${env.TTS_PROVIDER} @ ${env.TTS_URL}`)
if (env.TTS_PROVIDER === 'piper') console.log(`  voice         ${env.TTS_VOICE}`)
console.log(`  length_scale  ${env.TTS_LENGTH_SCALE}${fit ? '  (3–5 min fitting on: may re-render)' : '  (single render)'}`)
if (env.TTS_PROVIDER === 'chatterbox' || env.TTS_PROVIDER === 'qwen') {
  const max = env.TTS_PROVIDER === 'qwen' ? 500 : 280
  console.log(`  chunks        ${splitIntoChunks(script, max).length} × ≤${max} chars (${script.length} chars, ${script.split(/\s+/).length} words)`)
}
if (info) {
  const { stats: _stats, params, ...rest } = info
  for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined && v !== '') console.log(`  ${k.padEnd(13)} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  if (params) console.log(`  params        ${Object.entries(params as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(' ')}`)
} else if (env.TTS_PROVIDER === 'chatterbox' || env.TTS_PROVIDER === 'qwen') {
  console.warn(`  (server info unavailable — is \`pnpm tts:server ${env.TTS_PROVIDER}\` running?)`)
}

const t0 = Date.now()
const speech = await tts.synthesize(script)
const synthMs = Date.now() - t0
const outDir = resolve(outArg ?? 'tts-debug')
if (providerOpt) name = `${name}.${providerOpt}`
await mkdir(outDir, { recursive: true })
const rawPath = join(outDir, `${name}.raw.wav`)
await writeFile(rawPath, speech.audio)
const t1 = Date.now()
const mp3 = await wavToMp3(speech.audio)
const mp3Ms = Date.now() - t1
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

const after = await serverInfo()
const d = (k: string): number => (after?.stats?.[k] ?? 0) - (info?.stats?.[k] ?? 0)
console.log('── Runtime')
console.log(`  audio         ${sec(wavDurationMs(speech))}`)
console.log(`  synthesis     ${sec(synthMs)}  (RTF ${(synthMs / 1000 / Math.max(speech.durationSec, 1)).toFixed(2)} — <1 = faster than real time)`)
if (after?.stats) {
  console.log(`  server        ${d('requests')} requests, ${d('cache_hits')} from cache, ${d('generated')} generated in ${d('gen_sec').toFixed(1)}s`)
  if (d('cache_hits') > 0) console.log('  note          cached chunks make this run faster than a fresh render (cache: .<engine>/cache)')
}
console.log(`  mp3 + loudnorm ${sec(mp3Ms)}`)
console.log(`  total         ${sec(Date.now() - tStart)}`)

function wavDurationMs(s: { audio: Buffer }): number {
  return wavDurationSec(s.audio) * 1000
}
