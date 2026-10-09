import { createHash } from 'node:crypto'

export interface ImageResult {
  data: Buffer
  contentType: 'image/svg+xml' | 'image/png'
}

export interface ImageClient {
  generate(prompt: string): Promise<ImageResult>
}

/** One house style for every unit (spec §4: fixed style prompt). */
export const IMAGE_STYLE =
  'Flache, freundliche Illustration, verspielt, weiche Pastellfarben, klare Formen, kein Text, quadratisch, heller Hintergrund.'

const PALETTE = ['#FFB5A7', '#B8E0D2', '#CDB4DB', '#FFE5A5', '#A2D2FF', '#C1E1C1']

export function createPlaceholderImages(): ImageClient {
  return {
    async generate(prompt) {
      const h = createHash('sha256').update(prompt).digest()
      const bg = PALETTE[h[0]! % PALETTE.length]!
      const fg = PALETTE[h[1]! % PALETTE.length]!
      const label = escapeXml(prompt.slice(0, 40))
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${bg}"/><circle cx="${128 + (h[2]! % 256)}" cy="${128 + (h[3]! % 256)}" r="${80 + (h[4]! % 80)}" fill="${fg}"/><text x="256" y="480" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#333">${label}</text></svg>`
      return { data: Buffer.from(svg), contentType: 'image/svg+xml' }
    },
  }
}

interface ImagesResponse {
  data?: { b64_json?: string }[]
}

/** OpenAI-compatible `/images/generations` endpoint. */
export function createApiImages(cfg: { baseUrl: string; model: string; apiKey: string; fetchFn?: typeof fetch }): ImageClient {
  const fetchFn = cfg.fetchFn ?? fetch
  return {
    async generate(prompt) {
      const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, prompt: `${prompt}. ${IMAGE_STYLE}`, size: '1024x1024', response_format: 'b64_json', n: 1 }),
      })
      if (!res.ok) throw new Error(`Image HTTP ${res.status}`)
      const b64 = ((await res.json()) as ImagesResponse).data?.[0]?.b64_json
      if (!b64) throw new Error('Image API returned no data')
      return { data: Buffer.from(b64, 'base64'), contentType: 'image/png' }
    },
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c)
}
