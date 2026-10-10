import type { StockLicense } from '@wizzn/shared'

const PATTERN = /^(cc0|pdm|by-sa|by)(?:-(\d\.\d))?(?:-[a-z]{2,3}(?:-[a-z]+)?)?$/

/** Maps Openverse (`by-sa` + `4.0`) and Commons (`CC BY-SA 3.0 de`) license strings to the allowed set; NC/ND/unknown → null. */
export function parseLicense(raw: string, version?: string | null): { license: StockLicense; version: string | null } | null {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/^cc\s+/, '')
    .replace(/\s+/g, '-')
  if (norm === 'public-domain') return { license: 'pdm', version: null }
  if (norm.split('-').some((t) => t === 'nc' || t === 'nd')) return null
  const m = PATTERN.exec(norm)
  if (!m) return null
  return { license: m[1] as StockLicense, version: version?.trim() || m[2] || null }
}

export function licenseUrl(license: StockLicense, version: string | null): string {
  if (license === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/'
  if (license === 'pdm') return 'https://creativecommons.org/publicdomain/mark/1.0/'
  return `https://creativecommons.org/licenses/${license}/${version ?? '4.0'}/`
}
