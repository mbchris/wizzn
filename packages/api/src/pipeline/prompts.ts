import type { ChatMessage } from '../providers/llm.js'
import type { ResearchCandidate } from '../providers/research/types.js'
import { AUDIO_SCRIPT_WORDS, WRITTEN_HOOK_MAX_WORDS, WRITTEN_SLIDE_WORDS, WRITTEN_WORDS, type Editorial, type EditorialStyle, type Level, type SourceTier, type StoryArc, LEVEL_META, MAX_LEVEL } from '@wizzn/shared'

/** Stored on every unit; bump when prompts change so units can be regenerated selectively. */
export const PROMPT_VERSION = '2026-10-13.2'

export interface BriefContext {
  /** Key into the curated source registry */
  fieldSlug: string
  fieldName: string
  themeName: string | null
  topic: string
  context: string
  adviceDisclaimer: boolean
  /** Explicit choice from the editor; null/undefined → picked at random per unit */
  style?: EditorialStyle | null
  arc?: StoryArc | null
  /** Knowledge-stream depth; missing → 1 */
  level?: Level
  series?: string | null
  /** Level 4: name of the field to bridge to */
  crossFieldName?: string | null
  /** Titles of published lower-level units of the same series (assumed known) */
  seriesPrior?: string[]
}

export interface ResearchedSource {
  url: string
  title: string
  publisher: string
  excerpt: string
  tier: SourceTier
  provider: ResearchProviderName
}

export type ResearchProviderName = 'curated' | 'wikipedia' | 'europepmc' | 'web'

const SYSTEM = `Du schreibst für "wizzn", eine App mit kurzen Wissenshappen für Menschen ab 16 in Deutschland.
Immer auf Augenhöhe und per Du; Stil und Erzählbogen gibt jeder Auftrag vor. Fakten nur aus den gegebenen Quellen.
Keine expliziten sexuellen Inhalte, keine Heilsversprechen, keine konkreten Anlage- oder Therapieempfehlungen.
Bezeichne den Beitrag nie über sein Medium (nicht „dieses Audio", „dieser Text", „dieser Post", „diese Folge"); schreib neutral, z. B. „Dieser Beitrag ersetzt keine persönliche Beratung" oder „Das hier ersetzt keine persönliche Beratung".
Antworte ausschließlich mit JSON.`

const STYLE_GUIDE: Record<EditorialStyle, string> = {
  friendly: `Freundlich-humorvoll: locker, mit Augenzwinkern, Alltagsbildern und kleinen Pointen. Humor würzt, er ersetzt nie die Fakten.
Beispiel-Ton: „Steuern. Du zahlst sie, wir zahlen sie. Das Finanzamt freut's, dein Konto eher nicht. Zeit, den gierigen Blick des Fiskus ein bisschen zu enttäuschen."`,
  factual: `Sachlich-faktenbasiert: klar, präzise, ruhig. Zahlen und Zusammenhänge stehen vorn, keine Gags, keine Übertreibungen.
Beispiel-Ton: „Steuern sind die Grundlage eines funktionierenden Gemeinwesens. Dennoch übersehen viele Menschen legale Möglichkeiten, ihre persönliche Steuerlast zu senken."`,
  narrative: `Erzählerisch-inspirierend: beginnt mit einer konkreten Person oder Szene, baut Spannung auf, macht Mut. Bildhafte Sprache, aber kein Kitsch.
Beispiel-Ton: „Lena starrt auf ihren ersten Steuerbescheid. 600 Euro Nachzahlung. Ein Jahr später bekommt sie 400 Euro zurück. Was hat sich geändert? Drei Belege und eine Stunde Zeit."`,
}

const ARC_GUIDE: Record<StoryArc, string> = {
  rags_to_riches: 'Vom Tellerwäscher zum Millionär: Ausgangslage klein oder mangelhaft, durch das Wissen wächst etwas Wertvolles.',
  quest: 'Die Suche: ein klares Ziel, Hindernisse auf dem Weg, das Wissen ist der Schlüssel zum Ziel.',
  voyage_and_return: 'Reise und Rückkehr: Ausflug in eine fremde Welt (andere Zeit, Kultur, Fachgebiet), Rückkehr mit neuer Sicht auf den eigenen Alltag.',
  comedy: 'Komödie: Missverständnis oder Irrtum sorgt für Verwirrung, die Auflösung klärt auf und endet versöhnlich.',
  overcoming_the_monster: 'Das Monster besiegen: ein konkreter Gegner (Mythos, Gewohnheit, Risiko) wird benannt und mit Wissen bezwungen.',
  rebirth: 'Wiedergeburt: eine festgefahrene Haltung oder Routine wird erkannt und durch eine bessere ersetzt.',
}

/** Uniform pick, seeded by the caller's RNG so tests stay deterministic. */
export function pickEditorial(b: Pick<BriefContext, 'style' | 'arc'>, random: () => number = Math.random): Editorial {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(random() * xs.length))] as T
  return { style: b.style ?? pick(Object.keys(STYLE_GUIDE) as EditorialStyle[]), arc: b.arc ?? pick(Object.keys(ARC_GUIDE) as StoryArc[]) }
}

/** The five-part structure every unit follows, framed by the chosen style and plot. */
const editorialBlock = (e: Editorial, parts: string): string => `Redaktionelle Vorgaben:
Stil: ${STYLE_GUIDE[e.style]}
Erzählbogen: ${ARC_GUIDE[e.arc]} Der Bogen trägt den ganzen Beitrag, nenne ihn aber nie beim Namen.
Aufbau (immer in dieser Reihenfolge):
1. These: Titel und Einstieg stellen eine klare, zugespitzte Behauptung auf.
2. Problem oder Chance: halb-detaillierter Blick darauf, was auf dem Spiel steht und warum es dich betrifft.
3. Lösung: halb-detaillierter Blick darauf, wie es funktioniert, mit Fakten aus den Quellen.
4. Was heißt das für mich? Konkrete, leicht umsetzbare Schritte für den Alltag.
5. Fazit: kurze Zusammenfassung des Ergebnisses, löst die These auf.
${parts}`

/** AI images are always illustrations (style comes from the image provider); the motif must suit a drawing. */
const IMAGE_MOTIF_RULE =
  'imagePrompt/prompt beschreibt auf Englisch ein Illustrationsmotiv (Symbol, Szene oder Schaubild, das die Kernidee zeigt), niemals ein Foto: keine Begriffe wie photo, realistic, camera; keine echten oder berühmten Personen.'

/** Depth guidance for the knowledge stream: content deepens from L1 (overview) to L5 (expert). */
export function levelBlock(b: BriefContext): string {
  const level = b.level ?? 1
  const meta = LEVEL_META[level]
  const lines = [`Wissensstufe: ${level} von ${MAX_LEVEL} – ${meta.name}. ${meta.guide}`]
  if (level === 4 && b.crossFieldName) lines.push(`Schlage die Brücke zum Bereich „${b.crossFieldName}“.`)
  if (b.seriesPrior?.length) lines.push(`Bereits bekannt aus früheren Stufen (nicht wiederholen, darauf aufbauen): ${b.seriesPrior.map((t) => `„${t}“`).join(', ')}.`)
  else if (level > 1) lines.push('Setze Grundwissen der vorigen Stufen voraus, erkläre nur kurz nötige Begriffe.')
  return lines.join('\n')
}

const topicLine = (b: BriefContext): string =>
  `Bereich: ${b.fieldName}${b.themeName ? ` / Thema: ${b.themeName}` : ''}\nAufhänger: ${b.topic}${b.context ? `\nKontext vom Redakteur: ${b.context}` : ''}\n${levelBlock(b)}`

export const searchQuery = (b: BriefContext): string => [b.topic, b.themeName, b.fieldName].filter(Boolean).join(' ')

export function queryPlanPrompt(b: BriefContext): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nFormuliere zwei kurze Suchanfragen (3–6 Begriffe): "de" für deutsche Fachseiten und Wikipedia, "en" für englische wissenschaftliche Datenbanken (Fachbegriffe, keine Füllwörter).\n\nJSON: {"de":string,"en":string}`,
    },
  ]
}

/** Candidates arrive sorted by tier; the label lets the LLM prefer reputable sources (issue #4). */
export function sourcePickPrompt(b: BriefContext, candidates: ResearchCandidate[]): ChatMessage[] {
  const list = candidates.map((c, i) => `[${i}] (Stufe ${c.tier}) ${c.publisher} — ${c.title} — ${c.url}\n${c.snippet}`).join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nWähle 2–3 seriöse Quellen, die zum Aufhänger passen. Stufe 1 = kuratierte Fachstellen, 2 = Wikipedia, 3 = wissenschaftliche Übersichtsarbeiten, 4 = offenes Web. Bevorzuge niedrige Stufen; Stufe 4 nur, wenn nichts anderes passt. Keine Shops, Foren oder Werbung.\n\n${list}\n\nJSON: {"picks":[{"index":number,"publisher":"Name der Organisation"}]}`,
    },
  ]
}

const sourceBlock = (sources: ResearchedSource[]): string =>
  sources.map((s, i) => `[${i}] ${s.publisher}: ${s.title}\n${s.excerpt}`).join('\n\n')

export function draftWrittenPrompt(b: BriefContext, sources: ResearchedSource[], e: Editorial = pickEditorial(b)): ChatMessage[] {
  const parts = 'Zuordnung: title + hook = These; Slides in der Reihenfolge Problem/Chance (1–2 Slides) → Lösung (1–2 Slides) → Was heißt das für mich? (1 Slide) → Fazit (1 Slide, kürzer). Slide-Titel sind eigene kleine Überschriften, keine Gliederungswörter wie „Problem" oder „Fazit".'
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nQuellen:\n${sourceBlock(sources)}\n\nErstelle einen ausführlichen Wissensbeitrag wie ein detaillierter Instagram-Post, ${WRITTEN_WORDS.min + 30}–${WRITTEN_WORDS.max - 50} Wörter insgesamt (2–3 Minuten Lesezeit):\n- cover: Titelbild als Bildmotiv (imagePrompt, ohne Text im Bild; ${IMAGE_MOTIF_RULE}) und imageQuery: ein String mit 2–4 englischen Suchbegriffen für ein passendes Stockfoto, höchstens 40 Zeichen (konkretes Motiv, keine Abstrakta).\n- hook: Aufhänger unter dem Titelbild, höchstens ${WRITTEN_HOOK_MAX_WORDS} Wörter, macht neugierig.\n- slides: 4–6 Slides, je ein kurzer Titel und ${WRITTEN_SLIDE_WORDS.min}–${WRITTEN_SLIDE_WORDS.max} Wörter Text. Höchstens 2 Slides mit Bild (imagePrompt + imageQuery wie oben); Slides ohne Bild lassen beide Felder weg (nicht null).\n${editorialBlock(e, parts)}\nFormuliere eigenständig, übernimm keine Sätze wörtlich aus den Quellen.\n\nJSON: {"title":string,"hook":string,"cover":{"imagePrompt":string,"imageQuery":string},"slides":[{"title":string,"body":string,"imagePrompt"?:string,"imageQuery"?:string}]}`,
    },
  ]
}

export function draftAudioPrompt(b: BriefContext, sources: ResearchedSource[], e: Editorial = pickEditorial(b)): ChatMessage[] {
  const parts = 'Im Skript fließen die fünf Teile ohne Zwischenüberschriften ineinander; der erste Satz ist die These, der letzte Absatz das Fazit.'
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${topicLine(b)}\n\nQuellen:\n${sourceBlock(sources)}\n\nSchreibe ein Sprechskript für 3–5 Minuten Audio (${AUDIO_SCRIPT_WORDS.min + 30}–${AUDIO_SCRIPT_WORDS.max - 50} Wörter), gut vorlesbar: kurze Sätze, keine Aufzählungszeichen, keine Abkürzungen, Zahlen ausgeschrieben.\n\n${editorialBlock(e, parts)}\n\nDazu 1–3 Bildmotive mit Zeitpunkt als Anteil der Laufzeit (atFraction 0–0.9); ${IMAGE_MOTIF_RULE} query: ein String mit 2–4 englischen Suchbegriffen für ein passendes Stockfoto, höchstens 40 Zeichen (konkretes Motiv, keine Abstrakta).\n\nJSON: {"title":string,"script":string,"images":[{"prompt":string,"query":string,"atFraction":number}]}`,
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
      content: `Quellen:\n${sourceBlock(sources)}\n\nInhalt:\n${content}\n\nListe jede überprüfbare Tatsachenbehauptung mit dem Index der stützenden Quelle (null, wenn keine Quelle sie stützt). Liste Probleme: falsche oder gefährliche Aussagen, Heilsversprechen, Anlageempfehlungen, unangemessene Inhalte für 16-Jährige (severity "high") sowie Stil- oder Längenprobleme (severity "low"), auch wenn einer der fünf Teile fehlt: These, Problem/Chance, Lösung, Was heißt das für mich?, Fazit.\n\nJSON: {"claims":[{"text":string,"sourceIndex":number|null}],"issues":[{"severity":"low"|"high","message":string}]}`,
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
