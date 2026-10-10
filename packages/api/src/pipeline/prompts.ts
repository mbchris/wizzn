import type { ChatMessage } from '../providers/llm.js'
import type { SearchResult } from '../providers/search.js'
import { AUDIO_SCRIPT_WORDS } from '@wizzn/shared'

/** Stored on every unit; bump when prompts change so units can be regenerated selectively. */
export const PROMPT_VERSION = '2026-10-09.1'

export interface BriefContext {
  fieldName: string
  themeName: string | null
  topic: string
  context: string
  adviceDisclaimer: boolean
}

export interface ResearchedSource {
  url: string
  title: string
  publisher: string
  excerpt: string
}

const SYSTEM = `Du schreibst für "wizzn", eine App mit kurzen Wissenshappen für Menschen ab 16 in Deutschland.
Ton: modern, freundlich, leicht verspielt, auf Augenhöhe, duzen. Fakten nur aus den gegebenen Quellen.
Keine expliziten sexuellen Inhalte, keine Heilsversprechen, keine konkreten Anlage- oder Therapieempfehlungen.
Antworte ausschließlich mit JSON.`

const topicLine = (b: BriefContext): string =>
  `Bereich: ${b.fieldName}${b.themeName ? ` / Thema: ${b.themeName}` : ''}\nAufhänger: ${b.topic}${b.context ? `\nKontext vom Redakteur: ${b.context}` : ''}`

export const searchQuery = (b: BriefContext): string => [b.topic, b.themeName, b.fieldName].filter(Boolean).join(' ')

export function sourcePickPrompt(b: BriefContext, results: SearchResult[]): ChatMessage[] {
  const list = results.map((r, i) => `[${i}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nWähle 1–3 seriöse, deutschsprachige Quellen (Behörden, Fachgesellschaften, Verbraucherzentralen, Fachmedien; keine Shops, Foren oder Werbung).\n\n${list}\n\nJSON: {"picks":[{"index":number,"publisher":"Name der Organisation"}]}`,
    },
  ]
}

const sourceBlock = (sources: ResearchedSource[]): string =>
  sources.map((s, i) => `[${i}] ${s.publisher}: ${s.title}\n${s.excerpt}`).join('\n\n')

export function draftWrittenPrompt(b: BriefContext, sources: ResearchedSource[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nQuellen:\n${sourceBlock(sources)}\n\nErstelle einen Wissenshappen aus 3–5 Slides. Jede Slide: kurzer Titel, Text mit höchstens 50 Wörtern, optional ein Bildmotiv (imagePrompt, ohne Text im Bild). Die Slides bauen aufeinander auf und schließen mit einem konkreten, alltagstauglichen Gedanken.\n\nJSON: {"title":string,"slides":[{"title":string,"body":string,"imagePrompt"?:string}]}`,
    },
  ]
}

export function draftAudioPrompt(b: BriefContext, sources: ResearchedSource[]): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nQuellen:\n${sourceBlock(sources)}\n\nSchreibe ein Sprechskript für 3–5 Minuten Audio (${AUDIO_SCRIPT_WORDS.min + 30}–${AUDIO_SCRIPT_WORDS.max - 50} Wörter), inspirierend und gut vorlesbar: kurze Sätze, keine Aufzählungszeichen, keine Abkürzungen, Zahlen ausgeschrieben. Dazu 1–3 Bildmotive mit Zeitpunkt als Anteil der Laufzeit (atFraction 0–0.9).\n\nJSON: {"title":string,"script":string,"images":[{"prompt":string,"atFraction":number}]}`,
    },
  ]
}

export function checkPrompt(content: string, sources: ResearchedSource[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'Du bist Faktenprüfer für eine Wissens-App (16+). Prüfe streng und antworte ausschließlich mit JSON.',
    },
    {
      role: 'user',
      content: `Quellen:\n${sourceBlock(sources)}\n\nInhalt:\n${content}\n\nListe jede überprüfbare Tatsachenbehauptung mit dem Index der stützenden Quelle (null, wenn keine Quelle sie stützt). Liste Probleme: falsche oder gefährliche Aussagen, Heilsversprechen, Anlageempfehlungen, unangemessene Inhalte für 16-Jährige (severity "high") sowie Stil- oder Längenprobleme (severity "low").\n\nJSON: {"claims":[{"text":string,"sourceIndex":number|null}],"issues":[{"severity":"low"|"high","message":string}]}`,
    },
  ]
}

export function imagePickPrompt(prompt: string, candidates: { title: string; tags: string[] }[]): ChatMessage[] {
  const list = candidates.map((c, i) => `[${i}] ${c.title} — ${c.tags.join(', ')}`).join('\n')
  return [
    { role: 'system', content: 'Du wählst passende Stockbilder für "wizzn", eine App mit kurzen Wissenshappen. Antworte ausschließlich mit JSON.' },
    {
      role: 'user',
      content: `Gesuchtes Motiv: ${prompt}\n\nKandidaten:\n${list}\n\nWähle das Bild, das am besten zum Motiv passt. JSON: {"index": number|null} — null wenn keines passt.`,
    },
  ]
}
