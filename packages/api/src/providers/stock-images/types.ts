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
  search(query: string, opts?: { limit?: number }): Promise<StockCandidate[]>
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
