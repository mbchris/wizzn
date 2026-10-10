import type { ImageCredit } from '@wizzn/shared'

export interface StockCandidate {
  provider: 'openverse' | 'commons'
  providerId: string
  title: string
  tags: string[]
  imageUrl: string
  width: number
  height: number
  mime: string
  credit: ImageCredit
}

export interface StockImageClient {
  readonly name: string
  /** `accept`: optional caller filter; the chain skips a provider whose results it rejects entirely. Adapters may ignore it. */
  search(query: string, opts?: { limit?: number; accept?: (c: StockCandidate) => boolean }): Promise<StockCandidate[]>
}

export class StockSearchError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'StockSearchError'
  }
}

export const stockKey = (c: Pick<StockCandidate, 'provider' | 'providerId'>) => `${c.provider}:${c.providerId}`

/**
 * Stock key for a stored credit. Credits may carry a sub-source (Openverse: 'openverse/flickr'),
 * candidates only the adapter name, so the key uses the part before the first '/'.
 */
export const creditStockKey = (c: Pick<ImageCredit, 'provider' | 'providerId'>) =>
  stockKey({ provider: c.provider.split('/')[0] as StockCandidate['provider'], providerId: c.providerId })
