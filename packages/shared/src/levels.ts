import { z } from 'zod'

/** Depth ladder of a series: content starts broad and deepens with every "mehr davon". */
export const LEVELS = [1, 2, 3, 4, 5] as const
export type Level = (typeof LEVELS)[number]
export const MAX_LEVEL: Level = 5
export const levelSchema = z.number().int().min(1).max(5).transform((n) => n as Level)

export interface LevelMeta {
  name: string
  /** Prompt guidance for the drafting LLM */
  guide: string
}

export const LEVEL_META: Record<Level, LevelMeta> = {
  1: { name: 'Überblick', guide: 'Breiter Einstieg ohne Vorwissen: Was ist das, warum ist es relevant, die 2–3 wichtigsten Grundfakten.' },
  2: { name: 'Vertiefung', guide: 'Fokus auf EINEN konkreten Aspekt, ein Lebensmittel, eine Methode oder einen Begriff aus dem Überblick – genauer und mit Zahlen.' },
  3: { name: 'Praxis', guide: 'Direkt umsetzbar: konkrete Schritte, Rezepte, Routinen oder Checklisten mit den Inhalten der vorigen Stufen.' },
  4: { name: 'Querverbindung', guide: 'Verbindet das Thema mit einem anderen Wissensbereich und zeigt, wann und wie beides zusammenspielt.' },
  5: { name: 'Expertenwissen', guide: 'Für Fortgeschrittene: Mechanismen, Studienlage, Nuancen, Kontroversen und Grenzen des Wissens.' },
}

export const levelLabel = (l: Level): string => `L${l} · ${LEVEL_META[l].name}`

/** Series key shared by all units of one topic ladder, e.g. "veg-protein" */
export const seriesSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Serie: 2–60 Zeichen a–z, 0–9, -')
