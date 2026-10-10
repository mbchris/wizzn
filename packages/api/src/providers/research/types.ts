import type { SourceTier } from '@wizzn/shared'
import type { BriefContext, ResearchProviderName } from '../../pipeline/prompts.js'

export interface ResearchQuery {
  brief: BriefContext
  /** German web/Wikipedia query */
  de: string
  /** English query for scholarly databases */
  en: string
}

export interface ResearchCandidate {
  url: string
  title: string
  snippet: string
  publisher: string
  tier: SourceTier
  provider: ResearchProviderName
  /** Full text when the API already returns it (Wikipedia extract, Europe PMC abstract); otherwise fetched later */
  text?: string
  /** 0–1 ranking hint inside a tier (Wikipedia badge, citations) */
  quality?: number
}

export interface ResearchProvider {
  name: ResearchProviderName
  tier: SourceTier
  find(q: ResearchQuery): Promise<ResearchCandidate[]>
}

export const RESEARCH_TIMEOUT_MS = 10_000
/** Longer units need more facts than the previous 6 000 chars */
export const EXCERPT_MAX = 8_000
