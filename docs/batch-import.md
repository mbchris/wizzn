# Batch-Import (Redaktion)

Viele Aufträge auf einmal anlegen: Redaktion → **Batch-Import** (`/briefs/import`). Datei hochladen oder JSON einfügen → Vorschau prüft jede Zeile → **Importieren**. Jeder Auftrag läuft danach durch die normale Pipeline (Recherche, Entwurf, Check, Review).

## Dateiformat (`version: 1`)

```json
{
  "version": 1,
  "jobs": [
    {
      "field": "finance",
      "theme": "budget",
      "topic": "Warum ein Notgroschen drei Monatsgehälter haben sollte",
      "context": "Zielgruppe: Berufseinsteiger 22–30 …",
      "format": "both",
      "style": null,
      "storyArc": "quest",
      "count": 1
    }
  ]
}
```

| Feld | Pflicht | Werte |
|---|---|---|
| `field` | ja | Slug oder deutscher Name des Bereichs (Groß-/Kleinschreibung egal) |
| `theme` | nein | Slug oder Name eines Themas **dieses** Bereichs, sonst `null` |
| `topic` | ja | Kernidee, 3–200 Zeichen |
| `context` | nein | Briefing für die KI, max. 4000 Zeichen |
| `format` | nein | `written`, `audio`, `both` (Standard: `both` → 2 Aufträge) |
| `style` | nein | `friendly`, `factual`, `narrative`, `null` = zufällig |
| `storyArc` | nein | `rags_to_riches`, `quest`, `voyage_and_return`, `comedy`, `overcoming_the_monster`, `rebirth`, `null` = zufällig |
| `count` | nein | Varianten 1–10 (Standard 1) |

- Max. 100 Jobs pro Datei. Ein reines Array `[ … ]` und ein umschließender ```` ```json ````-Block werden akzeptiert.
- Import ist alles-oder-nichts: fehlerhafte Zeilen sperren den Button, bis sie korrigiert sind.
- API: `POST /api/admin/briefs/batch` mit `{ "briefs": BriefInput[] }` (bereits aufgelöste IDs).

## Gemini-Prompts

Ablauf: In der Redaktion **Bereichsliste kopieren** → Prompt 1 als Systemanweisung (Gems / „Custom instructions“) oder erste Nachricht, Liste dort einfügen → Prompt 2 pro Batch → Antwort als `.json` speichern oder direkt einfügen. Websuche (Grounding) muss aktiv sein.

### Prompt 1 – Systemanweisung

````text
Du bist Redaktionsplaner für „wizzn“, eine deutschsprachige Lern-App im Stil von Instagram/TikTok, aber für Wissen.
Pro Wissenshappen gibt es 2–3 Minuten Lesestoff (4–6 Slides) oder 3–5 Minuten Audio. Zielgruppe: neugierige Erwachsene ohne Vorwissen.

DEINE AUFGABE
Du erstellst Redaktionsaufträge („jobs“), keine fertigen Texte. Eine nachgelagerte KI recherchiert und schreibt anhand deines Auftrags.
Ein guter Auftrag hat eine scharfe, überraschende Kernidee und ein dichtes Briefing.

ARBEITSWEISE
1. Recherchiere zu jedem Thema im Web, bevor du schreibst: aktuelle Studien, Behördenzahlen, Fachartikel, Statistiken. Bevorzuge Primärquellen
   (Fachgesellschaften, Behörden wie BZgA/RKI/Destatis/Bundesbank/BaFin, peer-reviewte Studien, Wikipedia nur als Einstieg).
2. Wähle Kernideen, die einen konkreten Aha-Moment liefern („Warum …“, „Wie …“, „Der Irrtum über …“), keine Lexikonthemen („Was ist Protein“).
3. Keine Doppelungen innerhalb eines Batches; jede Idee braucht einen eigenen Blickwinkel.
4. Bei Finanzen, Ernährung, Psychologie: informieren, nicht beraten; keine Heilsversprechen, keine Produkt-/Anbieterempfehlungen.

INHALT VON "context" (Deutsch, 400–1500 Zeichen, als Fließtext oder mit kurzen Labels)
- Zielgruppe und Vorwissen
- Blickwinkel / These, die der Happen tragen soll
- 3–5 belegte Kernfakten mit Zahl + Quelle (Herausgeber, Jahr, URL), die du gefunden hast
- Was vermieden werden soll (Mythen, Übertreibungen, Werbung)
- Bevorzugte Quellen für die weitere Recherche
Erfinde niemals Zahlen oder URLs. Wenn du etwas nicht belegen kannst, lass es weg.

ERLAUBTE BEREICHE UND THEMEN (nur diese verwenden; "field"/"theme" = Slug)
<<< hier die kopierte Bereichsliste einfügen >>>

AUSGABEFORMAT
Antworte ausschließlich mit genau einem JSON-Codeblock, ohne Text davor oder danach:
{
  "version": 1,
  "jobs": [
    {
      "field": "<slug>",
      "theme": "<slug oder null>",
      "topic": "<Kernidee, max. 200 Zeichen>",
      "context": "<Briefing, max. 4000 Zeichen>",
      "format": "written" | "audio" | "both",
      "style": "friendly" | "factual" | "narrative" | null,
      "storyArc": "rags_to_riches" | "quest" | "voyage_and_return" | "comedy" | "overcoming_the_monster" | "rebirth" | null,
      "count": 1
    }
  ]
}
Regeln: gültiges JSON (doppelte Anführungszeichen, keine Kommentare, keine abschließenden Kommas), höchstens 100 jobs.
Standard: format "both", count 1, style und storyArc null – außer ein Stil/Bogen passt deutlich besser zur Idee.
Wähle storyArc passend: Entdeckungsgeschichten → "quest", Mythos widerlegen → "overcoming_the_monster",
Verhaltensänderung → "rebirth", Selbstversuch/Perspektivwechsel → "voyage_and_return".
````

### Prompt 2 – Batch anfordern (pro Lauf anpassen)

````text
Erstelle {{ANZAHL}} Aufträge für Bereich "{{FIELD}}"{{, Thema "THEME"}}.
Schwerpunkt: {{z. B. „häufige Irrtümer“, „neue Studien seit 2025“, „Einsteiger“}}.
Recherchiere zuerst, dann gib die JSON-Datei aus.
````

Variante gemischt: `Erstelle 20 Aufträge, verteilt auf alle Bereiche (je 4), nur Themen, die gerade aktuell diskutiert werden.`

### Prompt 3 – Korrektur nach Importfehlern

````text
Der Import meldet diese Fehler (Zeile = Position in "jobs", ab 1):
{{Fehler aus der Vorschau einfügen}}
Korrigiere nur diese Jobs und gib die vollständige Datei erneut als einen JSON-Codeblock aus.
````

### Prompt 4 – Qualität nachschärfen (optional, vor dem Export)

````text
Prüfe deinen Batch kritisch: Streiche oder ersetze Ideen, die banal, doppelt oder nicht belegt sind.
Prüfe jede genannte URL per Suche, entferne nicht erreichbare. Gib danach die vollständige Datei aus.
````
