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

  return {
    model,
    async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
      let history = messages
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await complete(history)
        const problem = validate(raw, schema)
        if (problem.ok) return problem.value
        history = [
          ...history,
          { role: 'assistant', content: raw },
          { role: 'user', content: `Die Antwort war ungültig: ${problem.error}. Antworte erneut, nur mit gültigem JSON im geforderten Format.` },
        ]
      }
      throw new Error('LLM output failed validation twice')
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
