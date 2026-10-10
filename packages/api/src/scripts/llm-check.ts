/**
 * Dev: smoke-tests the configured LLM — prints which backend is used and generates a mini sample unit to stdout.
 * Nothing is written to the DB.
 *
 *   pnpm llm:check [topic]
 */
import { z } from 'zod'
import { loadEnv } from '../env.js'
import { createLlm } from '../providers/index.js'

const topic = process.argv.slice(2).join(' ') || 'Warum ist der Himmel blau?'
const env = loadEnv()

const backend =
  env.LLM_PROVIDER === 'gemini-cli'
    ? `gemini-cli · bin ${env.GEMINI_CLI_BIN} · model ${env.LLM_MODEL || '(CLI default)'}`
    : `openai-compatible · ${env.LLM_BASE_URL} · model ${env.LLM_MODEL}`
console.log(`LLM: ${backend}`)
console.log(`Topic: ${topic}\n`)

const sample = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  facts: z.array(z.string().min(1)).min(2).max(4),
  quiz: z.object({ question: z.string(), answer: z.string() }),
})

const started = Date.now()
try {
  const out = await createLlm(env).chatJson(
    [
      { role: 'system', content: 'Du erstellst kurze Wissens-Häppchen auf Deutsch. Antworte nur mit JSON.' },
      {
        role: 'user',
        content: `Thema: ${topic}\nFormat: {"title": string, "hook": string (1 Satz), "facts": string[] (2–4 kurze Fakten), "quiz": {"question": string, "answer": string}}`,
      },
    ],
    sample,
  )
  console.log(`# ${out.title}\n\n${out.hook}\n`)
  for (const f of out.facts) console.log(`• ${f}`)
  console.log(`\nQuiz: ${out.quiz.question}\n→ ${out.quiz.answer}`)
  console.log(`\n✓ OK in ${((Date.now() - started) / 1000).toFixed(1)} s`)
} catch (e) {
  console.error(`✗ LLM failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
