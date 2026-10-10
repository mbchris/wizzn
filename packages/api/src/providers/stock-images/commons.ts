import { imageCreditSchema } from '@wizzn/shared'
import { licenseUrl, parseLicense } from './license.js'
import { StockSearchError, type StockCandidate, type StockImageClient } from './types.js'

const MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface CommonsConfig {
  userAgent: string
  baseUrl?: string
  fetchFn?: typeof fetch
}

type Meta = Record<string, { value?: string } | undefined>

interface CommonsPage {
  title?: string
  index?: number
  imageinfo?: {
    thumburl?: string
    url?: string
    descriptionurl?: string
    width?: number
    height?: number
    mime?: string
    extmetadata?: Meta
  }[]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

function toText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)
    .replace(/\s+/g, ' ')
    .trim()
}

function artistUrl(html: string): string | null {
  const href = /<a\s[^>]*href="([^"]+)"/i.exec(html)?.[1]
  if (!href) return null
  const abs = href.startsWith('//') ? `https:${href}` : href
  return /^https?:\/\//i.test(abs) ? abs : null
}

export function createCommonsClient(cfg: CommonsConfig): StockImageClient {
  const base = cfg.baseUrl ?? 'https://commons.wikimedia.org/w/api.php'
  const fetchFn = cfg.fetchFn ?? fetch

  function toCandidate(page: CommonsPage): StockCandidate | null {
    const info = page.imageinfo?.[0]
    const meta = info?.extmetadata
    if (!page.title || !info || !meta) return null
    if (!info.thumburl || !info.descriptionurl || !info.width || !info.height) return null
    if (!info.mime || !MIME.has(info.mime)) return null
    const parsed = parseLicense(meta.LicenseShortName?.value ?? '')
    if (!parsed) return null
    const artistHtml = meta.Artist?.value ?? ''
    const creator = toText(artistHtml) || null
    if (!creator && meta.AttributionRequired?.value === 'true') return null
    const title =
      toText(meta.ObjectName?.value ?? '') || page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '')
    const credit = {
      title,
      creator,
      creatorUrl: creator ? artistUrl(artistHtml) : null,
      license: parsed.license,
      licenseVersion: parsed.version,
      licenseUrl: meta.LicenseUrl?.value || licenseUrl(parsed.license, parsed.version),
      sourceUrl: info.descriptionurl,
      provider: 'commons',
      providerId: page.title,
    }
    let checked = imageCreditSchema.safeParse(credit)
    if (!checked.success) checked = imageCreditSchema.safeParse({ ...credit, creatorUrl: null })
    if (!checked.success) return null
    return {
      provider: 'commons',
      providerId: page.title,
      title,
      tags: [],
      imageUrl: info.thumburl,
      width: info.width,
      height: info.height,
      mime: info.mime,
      credit: checked.data,
    }
  }

  return {
    name: 'commons',
    async search(query, opts) {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: `${query} filetype:bitmap`,
        gsrlimit: String(opts?.limit ?? 20),
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '1080',
        format: 'json',
      })
      const res = await fetchFn(`${base}?${params.toString()}`, {
        headers: { accept: 'application/json', 'user-agent': cfg.userAgent },
      })
      if (!res.ok) throw new StockSearchError('commons', res.status, `Commons search HTTP ${res.status}`)
      const body = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } }
      return Object.values(body.query?.pages ?? {})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(toCandidate)
        .filter((c): c is StockCandidate => c !== null)
    },
  }
}
