import { createHash } from 'node:crypto'

export interface ImageResult {
  data: Buffer
  contentType: 'image/svg+xml' | 'image/png'
}

export interface ImageClient {
  /** Model label stored on generated image assets and shown in the admin UI */
  readonly name: string
  /** `field` is the category slug (e.g. finance) and picks the visual style */
  generate(prompt: string, opts?: { field?: string | null }): Promise<ImageResult>
}

/** Shared rules for every category: illustrated, never photorealistic (AI images must not pass as photos). */
const IMAGE_BASE =
  'Illustration only, clearly drawn by hand or designed digitally. NOT photorealistic: no photo, no photograph, no camera look, ' +
  'no 3D render, no realistic skin or lighting, no lens effects or depth of field. ' +
  'Grown-up, polished editorial quality, one clear idea, generous negative space. ' +
  'No text, no letters, no numbers, no logos, no watermark. Square composition.'

/** Illustration genres the categories map to (see IMAGE_STYLES). */
export const ILLUSTRATION_STYLES = {
  schematic:
    'Schematic explainer view: clean isometric or cross-section diagram, flat shapes with thin even outlines, ' +
    'arrows and simple icons that show how the thing works, limited calm palette with one accent color, technical-drawing clarity.',
  memphis:
    'Corporate Memphis flat illustration: friendly stylised people with simplified oversized limbs and small heads, ' +
    'flat solid color fills, no outlines or gradients, bold geometric shapes, cheerful but tasteful palette.',
  editorial:
    'Editorial magazine illustration: conceptual visual metaphor, textured gouache or risograph look, ' +
    'muted sophisticated palette with one strong accent, like an illustration in The New Yorker or The Economist.',
  cartoon:
    'Political-cartoon style ink drawing: confident pen lines with cross-hatching, light watercolor wash, ' +
    'a clear symbolic scene with a gentle satirical twist, thoughtful rather than silly.',
  caricature:
    'Restrained caricature: expressive pen-and-ink figures with mildly exaggerated proportions and gestures, ' +
    'flat color wash, warm and respectful, gently humorous but never goofy or grotesque. No real or famous persons.',
} as const

export type IllustrationStyle = keyof typeof ILLUSTRATION_STYLES

/** Per category (field slug) illustration genre plus mood, so a finance post doesn't look like a nutrition post. */
export const IMAGE_STYLES: Record<string, string> = {
  partnership: `${ILLUSTRATION_STYLES.editorial} Mood: warm, tender, intimate; earthy reds and ochres.`,
  finance: `${ILLUSTRATION_STYLES.schematic} Mood: trustworthy and composed; navy, slate and a subtle gold accent.`,
  sports: `${ILLUSTRATION_STYLES.caricature} Mood: dynamic, energetic, motion lines; punchy saturated colors.`,
  nutrition: `${ILLUSTRATION_STYLES.memphis} Mood: bright, fresh, joyful; vibrant greens and warm tones.`,
  psychology: `${ILLUSTRATION_STYLES.cartoon} Mood: calm, reflective, empathetic; muted palette with one warm accent.`,
  funfacts: `${ILLUSTRATION_STYLES.cartoon} Mood: playful, curious, surprising; bright candy colors.`,
  work: `${ILLUSTRATION_STYLES.editorial} Mood: focused, capable, collegial; cool blues with a warm orange accent.`,
}

/** Unknown categories: schematic explainer, the most neutral genre for knowledge content. */
const DEFAULT_STYLE = `${ILLUSTRATION_STYLES.schematic} Mood: calm and confident.`

export function imageStyleFor(field?: string | null): string {
  return `${(field && IMAGE_STYLES[field]) || DEFAULT_STYLE} ${IMAGE_BASE}`
}

/** Placeholder colors from the app theme: dark backgrounds, neon foregrounds. */
const BG_PALETTE = ['#0b0c10', '#12161a', '#1a1e25', '#0e1318']
const PALETTE = ['#00e599', '#60efff', '#c86dd7', '#00ff87', '#e94057', '#ff8a65']

export function createPlaceholderImages(): ImageClient {
  return {
    name: 'placeholder (dev)',
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
    name: cfg.model,
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
