export interface PageResult {
  ok: boolean
  status: number | null
  title: string
  text: string
}

export type PageFetcher = (url: string) => Promise<PageResult>

const MAX_TEXT = 6000

export function createPageFetcher(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): PageFetcher {
  return async (url) => {
    try {
      const res = await fetchFn(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'wizzn-research/1.0 (+https://wizzn.app)', accept: 'text/html' },
      })
      if (!res.ok) return { ok: false, status: res.status, title: '', text: '' }
      const html = await res.text()
      return { ok: true, status: res.status, title: extractTitle(html), text: htmlToText(html).slice(0, MAX_TEXT) }
    } catch {
      return { ok: false, status: null, title: '', text: '' }
    }
  }
}

export function extractTitle(html: string): string {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
}

/** Good-enough extraction for LLM context; no DOM dependency. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<(head|title|script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 30)
    .join('\n')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
}
