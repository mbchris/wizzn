import { describe, expect, it, vi } from 'vitest'
import { createWebProvider } from '../../src/providers/research/web.js'
import type { SearchClient } from '../../src/providers/search.js'

const q = { brief: { fieldSlug: 'finance', fieldName: 'F', themeName: null, topic: 't', context: '', adviceDisclaimer: false }, de: 'ETF Sparplan', en: 'etf' }

describe('web provider', () => {
  it('searches the open web and drops shops, forums and social media', async () => {
    const search = vi.fn<SearchClient['search']>(async () => [
      { url: 'https://www.finanzfluss.de/etf', title: 'ETF', snippet: 's' },
      { url: 'https://www.amazon.de/x', title: 'Shop', snippet: '' },
      { url: 'https://www.gutefrage.net/x', title: 'Forum', snippet: '' },
      { url: 'https://m.youtube.com/x', title: 'Video', snippet: '' },
      { url: 'https://www.reddit.com/r/x', title: 'Reddit', snippet: '' },
    ])
    const out = await createWebProvider({ search }).find(q)
    expect(search).toHaveBeenCalledWith('ETF Sparplan', 8)
    expect(out).toEqual([{ url: 'https://www.finanzfluss.de/etf', title: 'ETF', snippet: 's', publisher: 'www.finanzfluss.de', tier: 4, provider: 'web' }])
  })
})
