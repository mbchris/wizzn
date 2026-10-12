import { spawn } from 'node:child_process'
import type { ZodType } from 'zod'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmClient {
  readonly model: string
  /** Returns JSON validated against `schema`; one repair round-trip on invalid output. */
  chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T>
}

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  fetchFn?: typeof fetch
  temperature?: number
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[]
}

/** Sends a conversation, returns the raw model text. */
export type CompleteFn = (messages: ChatMessage[]) => Promise<string>

/** Works with Ollama (`/v1`) and any OpenAI-compatible provider. */
export function createLlmClient({ baseUrl, model, apiKey, fetchFn = fetch, temperature = 0.4 }: LlmConfig): LlmClient {
  async function complete(messages: ChatMessage[]): Promise<string> {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, response_format: { type: 'json_object' } }),
    })
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as ChatCompletion
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned no content')
    return content
  }
  return createJsonClient(model, complete)
}

export interface GeminiCliConfig {
  /** Empty = gemini-cli's default model */
  model: string
  /** Path/name of the gemini binary */
  bin?: string
  timeoutMs?: number
  /** Injectable for tests: runs the binary with args + stdin, resolves stdout */
  runFn?: (bin: string, args: string[], stdin: string, timeoutMs: number) => Promise<string>
}

/**
 * Uses the locally installed `gemini` CLI in headless mode (auth via its own login / GEMINI_API_KEY).
 * The CLI is single-turn, so the conversation is flattened into one prompt on stdin.
 */
export function createGeminiCliClient({ model, bin = 'gemini', timeoutMs = 300_000, runFn = runProcess }: GeminiCliConfig): LlmClient {
  async function complete(messages: ChatMessage[]): Promise<string> {
    const args = ['--output-format', 'json']
    if (model) args.push('-m', model)
    const stdout = await runFn(bin, args, flattenMessages(messages), timeoutMs)
    let content: string | undefined
    try {
      const body = JSON.parse(stdout) as { response?: string; error?: { message?: string } }
      if (body.error) throw new Error(`gemini-cli: ${body.error.message ?? 'unknown error'}`)
      // No `response` wrapper → CLI printed the model text itself
      content = typeof body.response === 'string' ? body.response : stdout
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('gemini-cli:')) throw e
      content = stdout // older CLI versions without --output-format json
    }
    if (!content?.trim()) throw new Error('LLM returned no content')
    return content
  }
  return createJsonClient(model || 'gemini-cli', complete)
}

export function flattenMessages(messages: ChatMessage[]): string {
  const label = { system: 'SYSTEM', user: 'USER', assistant: 'ASSISTANT' } as const
  return [
    ...messages.map((m) => `### ${label[m.role]}\n${m.content}`),
    '### ASSISTANT\nAntworte ausschließlich mit gültigem JSON, ohne Erklärungen oder Code-Fences.',
  ].join('\n\n')
}

function runProcess(bin: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`gemini-cli timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`gemini-cli failed to start (${bin}): ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`gemini-cli exited ${code}: ${(err || out).slice(0, 300)}`))
    })
    child.stdin.end(stdin)
  })
}

// A near miss (418 of 420 words) is usually fixed by the first repair; the second covers an overcorrection
const MAX_ATTEMPTS = 3

/** Shared JSON contract: validate against the schema, up to two repair round-trips. */
export function createJsonClient(model: string, complete: CompleteFn): LlmClient {
  return {
    model,
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
      let history = messages
      let lastError = ''
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const raw = await complete(history)
        const problem = validate(raw, schema)
        if (problem.ok) return problem.value
        lastError = problem.error
        history = [
          ...history,
          { role: 'assistant', content: raw },
          { role: 'user', content: `Die Antwort war ungültig: ${problem.error}. Antworte erneut, nur mit gültigem JSON im geforderten Format.` },
        ]
      }
      // Keep the zod issues: the message lands in unit.error and is the only clue in the admin UI
      throw new Error(`LLM output failed validation ${MAX_ATTEMPTS} times: ${lastError.slice(0, 500)}`)
    },
  }
}

function validate<T>(raw: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown
  try {
    // Some local models wrap JSON in ```json fences or <think> blocks
    json = JSON.parse(stripWrappers(raw))
  } catch {
    return { ok: false, error: 'kein gültiges JSON' }
  }
  const parsed = schema.safeParse(json)
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}

export function stripWrappers(raw: string): string {
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = noThink.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fence?.[1] ?? noThink).trim()
}
