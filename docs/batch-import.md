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
      "count": 1,
      "level": 1,
      "series": "notgroschen",
      "crossField": null
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
| `level` | nein | Wissensstufe 1–5 (Standard 1), siehe unten |
| `series` | nein | Serien-Schlüssel, 2–60 Zeichen `a–z 0–9 -` (z. B. `veg-protein`); verknüpft alle Stufen eines Themas, sonst `null` |
| `crossField` | nein | Nur Stufe 4: Slug/Name des Bereichs, zu dem die Brücke geschlagen wird, sonst `null` |

- Max. 100 Jobs pro Datei. Ein reines Array `[ … ]` und ein umschließender ```` ```json ````-Block werden akzeptiert.
- Import ist alles-oder-nichts: fehlerhafte Zeilen sperren den Button, bis sie korrigiert sind.
- Alte Dateien ohne `level`/`series` bleiben gültig (Stufe 1, keine Serie).
- API: `POST /api/admin/briefs/batch` mit `{ "briefs": BriefInput[] }` (bereits aufgelöste IDs).

## Wissensstufen & Serien

Inhalte starten einfach und werden detaillierter, sobald Nutzer „Mehr davon“ wischen. Eine **Serie** bündelt alle Stufen eines Themas; Stufe *n+1* erscheint im Stream erst nach „Mehr davon“ auf Stufe *n*. Veröffentlichte Happen einer Serie werden automatisch verknüpft (Stufe ±1), dazu passende Happen desselben Themas („verwandt“). Die Schreib-KI kennt die Titel der bereits veröffentlichten niedrigeren Stufen und baut darauf auf.

| Stufe | Name | Inhalt | Beispiel Serie `veg-protein` |
|---|---|---|---|
| 1 | Überblick | Breiter Einstieg ohne Vorwissen | Vegetarisches Protein allgemein |
| 2 | Vertiefung | EIN konkreter Aspekt / Lebensmittel / Begriff | Linsen, Tofu oder Hüttenkäse im Detail |
| 3 | Praxis | Direkt umsetzbar: Rezepte, Routinen, Checklisten | Schnelle Rezepte mit diesen Zutaten |
| 4 | Querverbindung | Brücke zu einem anderen Bereich (`crossField`) | Wann vegetarisches Protein in die Sport-Routine gehört |
| 5 | Expertenwissen | Mechanismen, Studienlage, Nuancen, Grenzen | Leucin-Schwelle, PDCAAS, aktuelle Studien |

Faustregel pro Serie: 1× Stufe 1, 2–3× Stufe 2, 1–2× Stufe 3, 1× Stufe 4, optional 1× Stufe 5 – alle mit demselben `series`.

## Gemini-Prompts

Ablauf: In der Redaktion **Bereichsliste kopieren** → Prompt 1 als Systemanweisung (Gems / „Custom instructions“) oder erste Nachricht, Liste dort einfügen → Prompt 2 pro Batch → Antwort als `.json` speichern oder direkt einfügen. Websuche (Grounding) muss aktiv sein.

### Prompt 1 – Systemanweisung

````text
Du bist Redaktionsplaner für „wizzn“, eine deutschsprachige Lern-App im Stil von Instagram/TikTok, aber für Wissen.
Pro Wissenshappen gibt es 2–3 Minuten Lesestoff (4–6 Slides) oder 3–5 Minuten Audio. Zielgruppe: neugierige Erwachsene ohne Vorwissen.

DEINE AUFGABE
Du erstellst Redaktionsaufträge („jobs“), keine fertigen Texte. Eine nachgelagerte KI recherchiert und schreibt anhand deines Auftrags.
Ein guter Auftrag hat eine scharfe, überraschende Kernidee und ein dichtes Briefing.

WISSENSSTUFEN UND SERIEN
Inhalte sind in Serien organisiert, die von einfach zu detailliert führen. Jeder Auftrag hat eine Stufe ("level"):
1 Überblick – breiter Einstieg ohne Vorwissen (z. B. „Vegetarisches Protein: was es kann“)
2 Vertiefung – genau EIN Aspekt, Lebensmittel oder Begriff aus Stufe 1, mit Zahlen (z. B. „Linsen: das unterschätzte Proteinwunder“)
3 Praxis – direkt umsetzbar: Rezepte, Routinen, Checklisten mit dem Wissen aus Stufe 1–2 (z. B. „3 Proteinrezepte in 10 Minuten“)
4 Querverbindung – verbindet das Thema mit einem ANDEREN Bereich; "crossField" = Slug dieses Bereichs (z. B. „Wann Protein in die Sport-Routine gehört“, crossField "sports")
5 Expertenwissen – Mechanismen, Studienlage, Nuancen, Kontroversen (z. B. „Leucin-Schwelle und PDCAAS“)
Regeln:
- Alle Aufträge einer Serie tragen denselben "series"-Schlüssel (kurz, kleingeschrieben, Bindestriche, z. B. "veg-protein").
- Pro Serie: 1× Stufe 1, 2–3× Stufe 2, 1–2× Stufe 3, 1× Stufe 4, optional 1× Stufe 5.
- Höhere Stufen bauen auf niedrigeren auf: Nenne im "context" ausdrücklich, welche Stufen-Titel vorausgesetzt werden, und wiederhole deren Kernfakten nicht.
- Jede Stufe hat eine eigene, in sich verständliche Kernidee – auch wer nur diesen Happen sieht, versteht ihn.
- Stufe 4 recherchiert auch im Ziel-Bereich (Quellen beider Bereiche).

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
- Ab Stufe 2: welche Inhalte früherer Stufen vorausgesetzt werden
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
      "count": 1,
      "level": 1 | 2 | 3 | 4 | 5,
      "series": "<serien-schluessel oder null>",
      "crossField": "<slug, nur bei level 4, sonst null>"
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
Erstelle {{ANZAHL}} Aufträge für die Bereiche {{COMBINATIONS}} (besthened jeweils aus {$field, $theme} )
Schwerpunkt: {{z. B. "häufige Irrtümer“, "neue Studien seit 2023“, ", "ambitionierter Einsteiger"}}.
Recherchiere zuerst, dann gib die JSON-Datei aus.


{{ANZAHL}}  = 50
{{COMBINATIONS}} = {nutrition, protein}, {nutrition, vegan}, {nutrition, vegetarian}, {nutrition, keto},
{funfacts, vip}, {funfacts, nature}, {funfacts, pun},
{partnership, seduction}, {partnership, needs}, {partnership, love}, {partnership, balance},
{finance, investments}, {finance, tax-optimization}, {finance, budget},
{sports, routine}, {sports, workout-types}, {sports, strength}, {sports, cardio},
{psychology, behaviour-patterns}, {psychology, neurodivergence}, {psychology, developmental}, {psychology, social}

````

Variante gemischt: `Erstelle 20 Aufträge, verteilt auf alle Bereiche (je 4), nur Themen, die gerade aktuell diskutiert werden.`

### Prompt 2b – Serie planen (Stufe 1–5)

````text
Plane {{ANZAHL_SERIEN}} Serien für {{COMBINATIONS}}.
Jede Serie führt von Stufe 1 (Überblick) bis Stufe 4 (Querverbindung), wo sinnvoll bis Stufe 5 (Expertenwissen):
1× Stufe 1, 2–3× Stufe 2, 1–2× Stufe 3, 1× Stufe 4 mit "crossField", optional 1× Stufe 5.
Gleicher "series"-Schlüssel für alle Aufträge einer Serie; im "context" höherer Stufen die vorausgesetzten Titel der niedrigeren nennen.
Recherchiere zuerst, dann gib die JSON-Datei aus.

Beispiel: {nutrition, vegetarian} → series "veg-protein":
L1 „Vegetarisches Protein: Was es wirklich kann“ · L2 „Linsen“, „Tofu“, „Hüttenkäse“ · L3 „Drei Proteinrezepte in 10 Minuten“
· L4 „Wann Protein in deine Sport-Routine gehört“ (crossField "sports") · L5 „Leucin-Schwelle und Proteinqualität (PDCAAS)“
````

### Prompt 2c – Serie vertiefen (bestehende Serie erweitern)

````text
Für die Serie "{{SERIES}}" ({{FIELD}}/{{THEME}}) gibt es bereits diese Happen: {{TITEL_MIT_STUFEN}}.
Ergänze {{ANZAHL}} Aufträge für die Stufen {{STUFEN}}, die darauf aufbauen und nichts wiederholen. Gleicher "series"-Schlüssel.
````

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
