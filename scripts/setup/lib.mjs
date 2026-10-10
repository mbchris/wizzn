// Shared helpers for console setup scripts. No dependencies (Node >= 20).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const OUT_DIR = resolve(ROOT, 'setup-out')

// Load <repo root>/.env regardless of the cwd the script was started from
const ENV_FILE = resolve(ROOT, '.env')
if (!existsSync(ENV_FILE)) {
  console.error(`\x1b[1;31m✗ ${ENV_FILE} not found.\x1b[0m Create it: cp .env.template .env  (then fill in values)`)
  process.exit(1)
}
process.loadEnvFile(ENV_FILE)
process.chdir(ROOT)

export const info = (m) => console.log(`\x1b[1;35m▶ ${m}\x1b[0m`)
export const ok = (m) => console.log(`\x1b[1;32m✓ ${m}\x1b[0m`)
export const warn = (m) => console.log(`\x1b[1;33m! ${m}\x1b[0m`)
export const todo = []
export const manual = (m) => todo.push(m)

export function need(...names) {
  const missing = names.filter((n) => !process.env[n])
  if (missing.length) {
    console.error(`\x1b[1;31m✗ Missing in .env: ${missing.join(', ')}\x1b[0m`)
    process.exit(1)
  }
}

export function writeOut(name, content) {
  mkdirSync(OUT_DIR, { recursive: true })
  const p = resolve(OUT_DIR, name)
  writeFileSync(p, content)
  ok(`wrote setup-out/${name}`)
  return p
}

export function printManual(title) {
  if (!todo.length) return ok(`${title}: nothing left to do by hand`)
  console.log(`\n\x1b[1;33m── ${title}: manual steps left ──\x1b[0m`)
  todo.forEach((t, i) => console.log(`${i + 1}. ${t}`))
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Set KEY=value in <repo root>/.env (replace the existing line or append). */
export function upsertEnv(vars) {
  let text = readFileSync(ENV_FILE, 'utf8')
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null || v === '') continue
    const line = `${k}=${v}`
    const re = new RegExp(`^${k}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`
    ok(`.env: ${k} set`)
  }
  writeFileSync(ENV_FILE, text)
}
