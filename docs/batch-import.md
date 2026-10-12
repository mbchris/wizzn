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
| `style` | nein | `friendly`, `factual`, `narrative`, `null` = zufällig; unbekannte Werte gelten als `null` |
| `storyArc` | nein | `rags_to_riches`, `quest`, `voyage_and_return`, `comedy`, `overcoming_the_monster`, `rebirth`, `null` = zufällig |
| `count` | nein | Varianten 1–10 (Standard 1) |
| `level` | nein | Wissensstufe 1–5 (Standard 1), siehe unten |
| `series` | nein | Serien-Schlüssel, 2–60 Zeichen `a–z 0–9 -` (z. B. `veg-protein`); verknüpft alle Stufen eines Themas, sonst `null`. Ohne `after` immer eine **neue** Serie, siehe unten |
| `crossField` | nein | Nur Stufe 4: Slug/Name des Bereichs, zu dem die Brücke geschlagen wird, sonst `null` |
| `after` | nein | `ref` (Happen-ID) aus einem Kontext-Export: Der Auftrag setzt diesen Happen auf einer höheren Stufe fort, siehe unten |

- Max. 100 Jobs pro Datei. Ein reines Array `[ … ]` und ein umschließender ```` ```json ````-Block werden akzeptiert.
- Import ist alles-oder-nichts: fehlerhafte Zeilen sperren den Button, bis sie korrigiert sind.
- Alte Dateien ohne `level`/`series` bleiben gültig (Stufe 1, keine Serie).
- Einträge mit `published` (aus einem Kontext-Export) werden angezeigt und übersprungen, nie erneut importiert.
- API: `POST /api/admin/briefs/batch` mit `{ "briefs": BriefInput[], "seriesAssignments": [{ "unitId", "series" }] }` (bereits aufgelöste IDs).

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

### Eindeutige Serien-Schlüssel

Ein `series` ohne `after` legt immer eine neue Serie an; ebenso ein `after` auf einen Happen ohne Serie.

- Schlüssel frei: wird unverändert übernommen.
- Schlüssel vergeben: Import nimmt den ersten freien `<schlüssel>-2`, `<schlüssel>-3`, … (bei mehr als 56 Zeichen vorher gekürzt).
- Alle Jobs einer Datei mit demselben Schlüssel erhalten denselben neuen Schlüssel.
- Die Vorschau zeigt den endgültigen Schlüssel und listet jede Umbenennung (`veg-protein → veg-protein-2`).
- Bestehende Serie erweitern: nur über `after` (Kontext-Export, Prompt 2d).
- Von Hand einer Serie beitreten: **Neuer Auftrag** mit dem bestehenden Schlüssel.

## Kontext-Export (nächste Stufe planen)

Zweck: Gemini sieht, was Leser einer Stufe bereits wissen, und plant die nächste ohne Wiederholungen.

Ablauf: Redaktion → Happen auswählen → **Kontext exportieren** → Datei `wizzn-context-JJJJMMTT-HHMM.json` mit Prompt 2d an Gemini → Antwort im Batch-Import einfügen.

```json
{
  "version": 1,
  "kind": "context",
  "jobs": [
    {
      "ref": "19cf9713-0b11-4e08-876c-dc38a9c2d48b",
      "field": "finance",
      "theme": "budget",
      "topic": "Warum ein Notgroschen zuerst kommt",
      "context": "<ursprüngliches Briefing>",
      "format": "both",
      "style": null,
      "storyArc": "quest",
      "count": 1,
      "level": 1,
      "series": null,
      "crossField": null,
      "published": {
        "title": "Erst der Notgroschen",
        "hook": "…",
        "slides": [{ "title": "Dein Sicherheitsnetz", "body": "…" }],
        "sources": [{ "title": "…", "publisher": "Verbraucherzentrale", "url": "https://…" }]
      }
    }
  ]
}
```

| Feld | Inhalt |
|---|---|
| `ref` | Happen-ID; neue Aufträge verweisen darauf mit `after` |
| `field` … `crossField` | Ursprünglicher Auftrag im Import-Format |
| `published` | Titel, Aufhänger, Slides und Quellen des fertigen Textes; bei reinen Audio-Happen `script` statt `hook`/`slides` |

- Text-/Audio-Paar: ein Eintrag mit dem geschriebenen Text.
- Happen ohne fertigen Inhalt fehlen in der Datei.
- Die Datei ist selbst importierbar: Alle Einträge werden übersprungen.

### Aufträge mit `after`

Antwort von Gemini: normale Batch-Datei, jeder neue Auftrag mit `"after": "<ref>"`, `level` und `series`.

| Bezugs-Happen | Verhalten beim Import |
|---|---|
| hat eine Serie | Auftrag übernimmt sie; `series` darf fehlen, ein anderer Schlüssel ist ein Fehler |
| hat keine Serie | `series` des Auftrags wird dem Bezugs-Happen zugewiesen (Pflichtfeld); ein vergebener Schlüssel erhält ein Suffix |

Zeilenfehler in der Vorschau:

- `after` unbekannt
- `level` nicht höher als die Stufe des Bezugs-Happens
- zwei Schlüssel für denselben Happen oder ein Schlüssel für zwei Happen in einer Datei

Die Vorschau listet alle Zuweisungen („Titel“ → Serie) und Umbenennungen. Erst **Importieren** schreibt sie: auf den Auftrag des Bezugs-Happens und alle seine Happen (Paar, Varianten), danach werden die Verknüpfungen veröffentlichter Happen neu berechnet. Schlägt eine Zuweisung fehl, wird nichts angelegt.

## Gemini-Prompts

Ablauf: In der Redaktion **Bereichsliste kopieren** → Prompt 1 als Systemanweisung (Gems / „Custom instructions“) oder erste Nachricht, Liste dort einfügen → Prompt 2 pro Batch → Antwort als `.json` speichern oder direkt einfügen. Websuche (Grounding) muss aktiv sein.

### Prompt 1 – Systemanweisung

````text
Du bist Redaktionsplaner für „wizzn“, eine deutschsprachige Lern-App im Stil von Instagram/TikTok, aber für Wissen.
Pro Wissenshappen gibt es 2–3 Minuten Lesestoff (Titelbild, Aufhänger, 4–6 Slides, 420–600 Wörter) oder 3–5 Minuten Audio.
Bei format "both" entsteht aus EINEM Auftrag ein verknüpftes Text-/Audio-Paar zum selben Thema.
Zielgruppe: neugierige Menschen ab 16 in Deutschland, Ansprache per Du, auf Augenhöhe.

DEINE AUFGABE
Du erstellst Redaktionsaufträge („jobs“), keine fertigen Texte. Eine nachgelagerte KI recherchiert und schreibt anhand deines Auftrags.
Ein guter Auftrag hat eine scharfe, überraschende Kernidee und ein dichtes Briefing.
Die Schreib-KI sucht ihre Quellen selbst (kuratierte Fachstellen, Wikipedia, wissenschaftliche Übersichtsarbeiten, Web) und verwendet nur Fakten daraus.
Deine Fakten und URLs lenken Suche und Blickwinkel; nenne deshalb Suchbegriffe und Herausgeber, die sich wiederfinden lassen.

AUFBAU JEDES HAPPENS (fest vorgegeben, dein Auftrag muss ihn tragen)
1. These – zugespitzte Behauptung in Titel und Einstieg → "topic" ist diese These, kein Themenlabel.
2. Problem oder Chance – was auf dem Spiel steht und warum es den Leser betrifft.
3. Lösung – wie es funktioniert, mit belegten Fakten.
4. „Was heißt das für mich?“ – konkrete, leicht umsetzbare Alltagsschritte.
5. Fazit – löst die These auf.
Eine Idee, die keinen Alltagsbezug (Teil 4) hergibt, ist kein guter Auftrag.

WISSENSSTUFEN UND SERIEN
Inhalte sind in Serien organisiert, die von einfach zu detailliert führen. Jeder Auftrag hat eine Stufe ("level"):
1 Überblick – breiter Einstieg ohne Vorwissen (z. B. „Vegetarisches Protein: was es kann“)
2 Vertiefung – genau EIN Aspekt, Lebensmittel oder Begriff aus Stufe 1, mit Zahlen (z. B. „Linsen: das unterschätzte Proteinwunder“)
3 Praxis – direkt umsetzbar: Rezepte, Routinen, Checklisten mit dem Wissen aus Stufe 1–2 (z. B. „3 Proteinrezepte in 10 Minuten“)
4 Querverbindung – verbindet das Thema mit einem ANDEREN Bereich; "crossField" = Slug dieses Bereichs (z. B. „Wann Protein in die Sport-Routine gehört“, crossField "sports")
5 Expertenwissen – Mechanismen, Studienlage, Nuancen, Kontroversen (z. B. „Leucin-Schwelle und PDCAAS“)
Regeln:
- Einzelhappen ohne Serie: "level" 1, "series" null, "crossField" null.
- Alle Aufträge einer Serie tragen denselben "series"-Schlüssel (2–60 Zeichen, nur a–z, 0–9 und Bindestrich, z. B. "veg-protein").
- Ein "series"-Schlüssel ohne "after" steht für eine NEUE Serie. Eine bestehende Serie setzt du nur über "after" fort (siehe Kontext-Dateien).
- Pro Serie: 1× Stufe 1, 2–3× Stufe 2, 1–2× Stufe 3, 1× Stufe 4, optional 1× Stufe 5.
- Höhere Stufen bauen auf niedrigeren auf: Nenne im "context" ausdrücklich, welche Stufen-Titel vorausgesetzt werden, und wiederhole deren Kernfakten nicht.
- Jede Stufe hat eine eigene, in sich verständliche Kernidee – auch wer nur diesen Happen sieht, versteht ihn.
- Stufe 4 recherchiert auch im Ziel-Bereich (Quellen beider Bereiche).

KONTEXT-DATEIEN (bestehende Happen fortsetzen)
Eine Datei mit "kind": "context" enthält bereits veröffentlichte Happen: den ursprünglichen Auftrag plus "published" (Titel, Aufhänger, Slides, Quellen).
- "published" ist das, was der Leser schon weiß. Wiederhole davon keine Fakten, Beispiele oder Alltagsschritte.
- Jeder neue Auftrag greift genau EINEN Punkt auf, den der bestehende Happen nur anreißt oder offen lässt, und führt ihn weiter.
- Setze "after" auf die "ref" des Happens, den der Auftrag fortsetzt, und "level" höher als dessen "level".
- "series": Hat der Happen eine Serie, übernimm sie unverändert. Hat er keine ("series": null), vergib einen neuen, sprechenden Schlüssel;
  alle Aufträge zum selben Happen tragen denselben Schlüssel, verschiedene Happen bekommen verschiedene Schlüssel.
- "field" und "theme" übernimmst du vom bestehenden Happen (Ausnahme "crossField" bei Stufe 4).
- Nenne im "context", welche Aussagen des bestehenden Happens vorausgesetzt werden und wo der neue anknüpft.
- Gib keine Einträge mit "published" zurück, nur die neuen Aufträge.

ARBEITSWEISE
1. Recherchiere zu jedem Thema im Web, bevor du schreibst: aktuelle Studien, Behördenzahlen, Fachartikel, Statistiken. Bevorzuge Primärquellen
   (Fachgesellschaften, Behörden wie BZgA/RKI/Destatis/Bundesbank/BaFin, peer-reviewte Studien, Wikipedia nur als Einstieg).
2. Wähle Kernideen, die einen konkreten Aha-Moment liefern („Warum …“, „Wie …“, „Der Irrtum über …“), keine Lexikonthemen („Was ist Protein“).
3. Keine Doppelungen innerhalb eines Batches; jede Idee braucht einen eigenen Blickwinkel.
4. Bei Finanzen, Ernährung, Psychologie: informieren, nicht beraten; keine Heilsversprechen, keine konkreten Anlage- oder Therapieempfehlungen,
   keine Produkt-/Anbieterempfehlungen.
5. Alles muss für 16-Jährige geeignet sein: keine expliziten sexuellen Inhalte (gilt besonders für Partnerschaft/Verführung).
6. Bereich "funfacts" (Kleine Lebensfreuden): leicht, überraschend, zum Weitererzählen – trotzdem belegbar (Herkunft, Zahl, Quelle).
   Der Alltagsbezug darf hier ein Gesprächsanlass oder Perspektivwechsel sein. Wortwitze brauchen einen wissenswerten Kern (Wortherkunft, Sprachphänomen).

INHALT VON "context" (Deutsch, 400–1500 Zeichen, als Fließtext oder mit kurzen Labels)
- Zielgruppe und Vorwissen
- Blickwinkel / These, die der Happen tragen soll
- Problem oder Chance: was auf dem Spiel steht
- 3–5 belegte Kernfakten mit Zahl + Quelle (Herausgeber, Jahr, URL), die du gefunden hast
- 2–3 konkrete Alltagsschritte für „Was heißt das für mich?“
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
      "crossField": "<slug, nur bei level 4, sonst null>",
      "after": "<ref aus einer Kontext-Datei, sonst weglassen>"
    }
  ]
}
Regeln: gültiges JSON (doppelte Anführungszeichen, keine Kommentare, keine abschließenden Kommas), höchstens 100 jobs.
Standard: format "both", count 1, style und storyArc null – außer ein Stil/Bogen passt deutlich besser zur Idee.
Wähle storyArc passend: Entdeckungsgeschichten → "quest", Mythos/Risiko bezwingen → "overcoming_the_monster",
Verhaltensänderung → "rebirth", Ausflug in fremde Zeit/Kultur/Fachgebiet → "voyage_and_return",
Irrtum oder Missverständnis mit versöhnlicher Auflösung → "comedy", aus wenig wird viel → "rags_to_riches".
````

### Prompt 2 – Batch anfordern (pro Lauf anpassen)

````text
Erstelle {{ANZAHL}} Aufträge, möglichst gleichmäßig verteilt auf diese Kombinationen aus {field, theme}:
{{KOMBINATIONEN}}
Schwerpunkt: {{SCHWERPUNKT}}.
Einzelhappen: "level" 1, "series" null, "crossField" null.
Recherchiere zuerst, dann gib die JSON-Datei aus.
````

Platzhalter vor dem Absenden ersetzen:

| Platzhalter | Beispiel |
|---|---|
| `{{ANZAHL}}` | `50` (max. 100) |
| `{{SCHWERPUNKT}}` | `häufige Irrtümer`, `neue Studien seit 2023`, `ambitionierte Einsteiger` |
| `{{KOMBINATIONEN}}` | Auswahl aus der Liste unten |

Alle Kombinationen (Stand `packages/shared/src/fields.ts`):

````text
{nutrition, protein}, {nutrition, vegan}, {nutrition, vegetarian}, {nutrition, keto},
{funfacts, vip}, {funfacts, nature}, {funfacts, pun},
{partnership, seduction}, {partnership, needs}, {partnership, love}, {partnership, balance},
{finance, investments}, {finance, tax-optimization}, {finance, budget},
{sports, routine}, {sports, workout-types}, {sports, strength}, {sports, cardio},
{psychology, behaviour-patterns}, {psychology, neurodivergence}, {psychology, developmental}, {psychology, social},
{work, career}, {work, leadership}, {work, productivity}, {work, labour-law}
````

Variante gemischt: `Erstelle 21 Aufträge, verteilt auf alle Bereiche (je 3), nur Themen, die gerade aktuell diskutiert werden.`

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

### Prompt 2d – Nächste Stufe aus Kontext-Export

Einziger Weg, eine bestehende Serie zu erweitern. Kontext-Datei anhängen oder unter dem Prompt einfügen.

````text
Die angehängte Kontext-Datei enthält {{ANZAHL_HAPPEN}} veröffentlichte Happen.
Erstelle zu jedem Happen {{ANZAHL_PRO_HAPPEN}} Aufträge der Stufe {{STUFE}}, die ihn fortsetzen.
Lies zuerst "published" vollständig: Was dort steht, gilt als bekannt und wird nicht wiederholt.
Wähle pro Auftrag einen anderen Aspekt, den der Happen nur anreißt; kein Aspekt doppelt, auch nicht zwischen den Happen.
Setze "after", "level" und "series" nach den Regeln für Kontext-Dateien.
Recherchiere zuerst neue Fakten und Quellen zum jeweiligen Aspekt, dann gib die JSON-Datei aus.
````

| Platzhalter | Beispiel |
|---|---|
| `{{ANZAHL_HAPPEN}}` | `12` |
| `{{ANZAHL_PRO_HAPPEN}}` | `2–3` (Stufe 2), `1–2` (Stufe 3) |
| `{{STUFE}}` | `2`; für Stufe 3 die Stufen 1 und 2 der Serie gemeinsam exportieren |

Richtwert: höchstens 30 Happen pro Kontext-Datei, damit die Antwort unter 100 Jobs bleibt.

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
