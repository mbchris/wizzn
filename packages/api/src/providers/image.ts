import { createHash } from 'node:crypto'

export interface ImageResult {
  data: Buffer
  contentType: 'image/svg+xml' | 'image/png'
}

export interface ImageClient {
  /** `field` is the category slug (e.g. finance) and picks the visual style */
  generate(prompt: string, opts?: { field?: string | null }): Promise<ImageResult>
}

/** Shared rules for every category: polished editorial look, never childish or cartoonish. */
const IMAGE_BASE =
  'High-end editorial image, like a premium magazine or brand campaign. Refined, grown-up and believable, one clear subject, ' +
  'shallow depth of field, thoughtful composition, natural color grading. ' +
  'Not cartoonish, not childish, no clip art, no flat vector, no pastel kids-book style. ' +
  'No text, no letters, no numbers, no logos, no watermark. Square composition.'

/** Per category (field slug) mood, so a finance post doesn't look like a nutrition post. */
export const IMAGE_STYLES: Record<string, string> = {
  partnership:
    'Intimate, personal lifestyle photography: warm golden-hour or soft window light, real people in candid, tender moments, ' +
    'close framing, genuine emotion, cozy homes and everyday places, warm earthy tones.',
  finance:
    'Sophisticated private-banking aesthetic: clean modern architecture, glass, marble and brushed metal, calm order, ' +
    'deep navy, slate and subtle gold accents, crisp even light, trustworthy and composed corporate photography.',
  sports:
    'Dynamic sports photography: athletes in motion, peak action, sweat and determination, dramatic directional light, ' +
    'high contrast and saturated punchy colors, low angles, freeze-frame energy like a sportswear campaign.',
  nutrition:
    'Bright, joyful food and lifestyle photography: fresh colorful whole foods, sunlight, happy people enjoying meals together, ' +
    'appetizing close-ups, natural textures, vibrant greens and warm tones, feel-good and wholesome.',
  psychology:
    'Calm, reflective fine-art photography: thoughtful people in quiet moments, soft diffused light, gentle negative space, ' +
    'muted natural palette with one warm accent, contemplative and empathetic mood.',
}

const DEFAULT_STYLE = 'Clean, modern editorial photography with natural light and a calm, confident mood.'

export function imageStyleFor(field?: string | null): string {
  return `${(field && IMAGE_STYLES[field]) || DEFAULT_STYLE} ${IMAGE_BASE}`
}

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
    async generate(prompt, opts) {
      const res = await fetchFn(`${cfg.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, prompt: `${prompt}. ${imageStyleFor(opts?.field)}`, size: '1024x1024', response_format: responseFormat, output_format: 'png', n: 1 }),
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
