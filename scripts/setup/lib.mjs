// Shared helpers for console setup scripts. No dependencies (Node >= 20).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const OUT_DIR = resolve(ROOT, 'setup-out')

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
