import { createHash } from 'node:crypto'

export interface ImageResult {
  data: Buffer
  contentType: 'image/svg+xml' | 'image/png'
}

export interface ImageClient {
  generate(prompt: string): Promise<ImageResult>
}

/** One house style for every unit (spec §4: fixed style prompt). */
/** Matches the app's dark neon UI (web/src/css/app.scss: --wz-bg, --wz-mint, --wz-cyan, --wz-brand). */
export const IMAGE_STYLE =
  'Modern flat vector illustration with subtle depth, clean geometric shapes, minimal and uncluttered, one clear central subject. ' +
  'Dark near-black background (#0b0c10, deep charcoal-navy), subject lit with vibrant neon accents: mint green (#00e599), ' +
  'electric cyan (#60efff) and a touch of soft violet (#c86dd7), smooth gradients between them and a soft glow around highlights. ' +
  'High contrast, moody, premium, sleek tech aesthetic like a dark-mode mobile app. ' +
  'No pastel colors, no white or light background, no photorealism, no text, no letters, no logos, no watermark. Square composition.'

/** Placeholder colors from the app theme: dark backgrounds, neon foregrounds. */
const BG_PALETTE = ['#0b0c10', '#12161a', '#1a1e25', '#0e1318']
const PALETTE = ['#00e599', '#60efff', '#c86dd7', '#00ff87', '#e94057', '#ff8a65']

export function createPlaceholderImages(): ImageClient {
  return {
    async generate(prompt) {
      const h = createHash('sha256').update(prompt).digest()
      const bg = BG_PALETTE[h[0]! % BG_PALETTE.length]!
      const fg = PALETTE[h[1]! % PALETTE.length]!
      const label = escapeXml(prompt.slice(0, 40))
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${bg}"/><circle cx="${128 + (h[2]! % 256)}" cy="${128 + (h[3]! % 256)}" r="${80 + (h[4]! % 80)}" fill="${fg}"/><text x="256" y="480" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#ffffff">${label}</text></svg>`
      return { data: Buffer.from(svg), contentType: 'image/svg+xml' }
    },
  }
}

interface ImagesResponse {
  data?: { b64_json?: string }[]
}

/** OpenAI-compatible `/images/generations` endpoint. */
export function createApiImages(cfg: { baseUrl: string; model: string; apiKey: string; ephemeral?: boolean; fetchFn?: typeof fetch }): ImageClient {
  const fetchFn = cfg.fetchFn ?? fetch
  // ImageRouter returns b64_ephemeral (no retention on their side); default mirrors env IMAGE_EPHEMERAL.
  const responseFormat = (cfg.ephemeral ?? true) ? 'b64_ephemeral' : 'b64_json'
  return {
    async generate(prompt) {
      const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, prompt: `${prompt}. ${IMAGE_STYLE}`, size: '1024x1024', response_format: responseFormat, output_format: 'png', n: 1 }),
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
