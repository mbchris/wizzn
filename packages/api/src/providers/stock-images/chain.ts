import { StockSearchError, type StockCandidate, type StockImageClient } from './types.js'

export interface StockChainOptions {
  timeoutMs?: number
  log?: (msg: string) => void
}

/**
 * Tries clients in order; the first non-empty result wins. Any error (including raw
 * TypeError/SyntaxError from adapters) or timeout is logged and the next client is tried.
 * Adapters take no AbortSignal, so the timeout is a race: a hung request is abandoned, not cancelled.
 */
export function createStockChain(clients: StockImageClient[], opts: StockChainOptions = {}): StockImageClient {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  return {
    name: 'chain',
    async search(query, searchOpts) {
      for (const client of clients) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
          })
          const found: StockCandidate[] = await Promise.race([client.search(query, searchOpts), timeout])
          if (found.length > 0) return found
        } catch (err) {
          const status = err instanceof StockSearchError ? err.status : null
          const reason = err instanceof Error ? err.message : String(err)
          log(`stock provider ${client.name} failed${status != null ? ` (status ${status})` : ''}: ${reason}`)
        } finally {
          clearTimeout(timer)
        }
      }
      return []
    },
  }
}
