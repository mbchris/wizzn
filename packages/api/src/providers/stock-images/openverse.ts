import { imageCreditSchema } from '@wizzn/shared'
import { licenseUrl, parseLicense } from './license.js'
import { StockSearchError, type StockCandidate, type StockImageClient } from './types.js'

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const TOKEN_MARGIN_MS = 60_000

export interface OpenverseConfig {
  clientId?: string
  clientSecret?: string
  baseUrl?: string
  fetchFn?: typeof fetch
  now?: () => number
}

interface OvResult {
  id?: string
  title?: string | null
  url?: string
  foreign_landing_url?: string
  creator?: string | null
  creator_url?: string | null
  license?: string
  license_version?: string | null
  license_url?: string | null
  source?: string | null
  provider?: string | null
  filetype?: string | null
  width?: number | null
  height?: number | null
  tags?: { name?: string }[] | null
}

export function createOpenverseClient(cfg: OpenverseConfig = {}): StockImageClient {
  const base = (cfg.baseUrl ?? 'https://api.openverse.org').replace(/\/$/, '')
  const fetchFn = cfg.fetchFn ?? fetch
  const now = cfg.now ?? Date.now
  let token: { value: string; expiresAt: number } | null = null

  async function getToken(): Promise<string | null> {
    if (!cfg.clientId || !cfg.clientSecret) return null
    if (token && now() < token.expiresAt - TOKEN_MARGIN_MS) return token.value
    const res = await fetchFn(`${base}/v1/auth_tokens/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
    })
    if (!res.ok) throw new StockSearchError('openverse', res.status, `Openverse token HTTP ${res.status}`)
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new StockSearchError('openverse', null, 'Openverse token response missing access_token')
    token = { value: body.access_token, expiresAt: now() + (body.expires_in ?? 0) * 1000 }
    return token.value
  }

  function toCandidate(r: OvResult): StockCandidate | null {
    if (!r.id || !r.url || !r.foreign_landing_url || !r.license) return null
    const parsed = parseLicense(r.license, r.license_version)
    if (!parsed) return null
    const mime = MIME[(r.filetype ?? '').toLowerCase()]
    if (!mime || !r.width || !r.height) return null
    const title = r.title ?? ''
    const credit = {
      title,
      creator: r.creator || null,
      creatorUrl: r.creator_url || null,
      license: parsed.license,
      licenseVersion: parsed.version,
      licenseUrl: r.license_url || licenseUrl(parsed.license, parsed.version),
      sourceUrl: r.foreign_landing_url,
      provider: `openverse/${r.source || r.provider || 'unknown'}`,
      providerId: r.id,
    }
    if (!imageCreditSchema.safeParse(credit).success) return null
    return {
      provider: 'openverse',
      providerId: r.id,
      title,
      tags: (r.tags ?? []).map((t) => t.name).filter((n): n is string => !!n),
      imageUrl: r.url,
      width: r.width,
      height: r.height,
      mime,
      credit,
    }
  }

  return {
    name: 'openverse',
    async search(query, opts) {
      const params = new URLSearchParams({
        q: query,
        license: 'cc0,pdm,by,by-sa',
        mature: 'false',
        page_size: String(opts?.limit ?? 20),
      })
      const headers: Record<string, string> = { accept: 'application/json' }
      const tok = await getToken()
      if (tok) headers.authorization = `Bearer ${tok}`
      // URLSearchParams encodes spaces as '+'; Openverse accepts both, but keep %20 for a stable URL
      const url = `${base}/v1/images/?${params.toString().replace(/\+/g, '%20')}`
      const res = await fetchFn(url, { headers })
      if (!res.ok) throw new StockSearchError('openverse', res.status, `Openverse search HTTP ${res.status}`)
      const body = (await res.json()) as { results?: OvResult[] }
      return (body.results ?? []).map(toCandidate).filter((c): c is StockCandidate => c !== null)
    },
  }
}
