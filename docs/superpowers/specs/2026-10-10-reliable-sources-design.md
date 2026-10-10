# Reliable knowledge sources & long-form written units — Design Spec

Status: draft for review · Date: 2026-10-10 · Issue: [#4](https://github.com/prj120/wizzn/issues/4)

## 1. Goal

Raise content quality by researching **high-reputation sources first**, and make written units long enough for **2–3 minutes of reading**, in the shape of a detailed Instagram post (head image + text).

| Decision | Choice |
|---|---|
| Source order | Tier 1 curated authorities per field → Tier 2 German Wikipedia (API) → Tier 3 Europe PMC reviews (nutrition, sports, psychology) → Tier 4 open web (fallback only) |
| Fallback rule | Open web is queried only if fewer than `RESEARCH_MIN_SOURCES` (2) usable sources were found in tiers 1–3 |
| Web-sourced units | Still generated; check report gets `trust: 'low'`, admin shows a warning badge. Not auto-failed |
| Written layout | Cover page (head image, title, hook) + 4–6 text slides |
| Written length | 420–600 words total (hook + slide bodies) ≈ 2–3 min at ~200 wpm (German, mobile) |
| Completion | Last page seen + dwell ≥ `writtenMinDwellSec(unit)` (30 % of estimated reading time, min 15 s) |
| Licensing | Facts only, own wording. Verbatim overlap ≥ 12 words with any source excerpt = high-severity issue |
| Audio | Benefits from the new research step; length/format unchanged |

Out of scope: admin UI to edit the source registry (code-reviewed list is enough for v1), Lift Wing / ORES quality scores, OpenAlex, paid APIs.

## 2. Research: candidate sources (findings)

| Source | Access | Cost / limits | Language | Fit | Verdict |
|---|---|---|---|---|---|
| **Curated authority domains** (DGE, BZfE, IQWiG/gesundheitsinformation.de, Verbraucherzentrale, BaFin, Bundesbank, Stiftung Warentest, …) | Existing SearXNG + domain allowlist; existing `fetchPage` | Free | DE | Highest reputation, consumer-oriented — ideal for wizzn tone | **Tier 1** |
| **German Wikipedia** — [Wikimedia APIs](https://www.mediawiki.org/wiki/Wikimedia_APIs), Action API `list=search` + `prop=extracts&explaintext` | REST/Action API, no key | Compliant User-Agent: ~200 req/min; unidentified: 10 req/min | DE | Broad coverage incl. partnership/psychology; quality badges *Exzellent*/*Lesenswert* via categories; text is CC BY-SA 4.0 (we only use facts, own wording) | **Tier 2** |
| **Europe PMC** REST `/search` | REST, no key | Free; polite use | EN (abstracts) | Systematic reviews & meta-analyses for nutrition, sports, psychology; `PUB_TYPE`, `HAS_ABSTRACT`, `citedByCount` filters | **Tier 3** (fields with scientific base) |
| OpenAlex | REST | Since 2026 usage-priced: $0.10/day without key, $1/day with free key; search = $1 / 1 000 calls | EN | Good metadata, abstracts as inverted index | Rejected: Europe PMC covers the need without metering |
| PubMed E-utilities | REST, optional key | 3 req/s (10 with key) | EN | Same corpus as Europe PMC, less convenient JSON | Rejected (duplicate) |
| Wikimedia Enterprise | REST | Free tier limited, paid beyond | — | Bulk/SLA, not needed at our volume | Rejected |
| Lift Wing article-quality model | REST | Free | — | Could score Wikipedia quality | Deferred: endpoint for `dewiki` not verified; badge categories + length suffice |

Verification notes: Wikimedia rate-limit classes and User-Agent format are from the published API access policy (2026); OpenAlex pricing from its authentication docs. Live calls to Wikipedia/Europe PMC could not be made from the design environment → Task 4/5 of the plan start with a recorded live fixture.

## 3. Architecture

```
research step
  │
  ├─ queryPlan (LLM) ──► { de: "…", en: "…" }
  │
  ├─ gather (parallel, 10 s timeout each, errors logged → [])
  │    ├─ CuratedProvider    tier 1  SearXNG "(site:a OR site:b …) {de}" → host ∈ registry[field]
  │    ├─ WikipediaProvider  tier 2  dewiki search → extracts (plain text) + badge
  │    └─ EuropePmcProvider  tier 3  only fields with scholarly=true; {en} + review filter
  │
  ├─ rank: tier asc → badge/citations → LLM pick 2–3 (prefers lower tier)
  ├─ materialise text: provider text if present, else fetchPage(url)
  ├─ usable < RESEARCH_MIN_SOURCES ? → WebProvider (tier 4, current SearXNG + blocklist) → pick → fetch
  └─ store.replaceSources(sources with tier + provider)
```

### New / changed modules (`packages/api/src`)
| File | Purpose |
|---|---|
| `providers/research/types.ts` | `ResearchProvider`, `ResearchCandidate`, `ResearchQuery`, `SourceTier` |
| `pipeline/source-registry.ts` | Per-field curated domains `{ host, publisher }[]` + `scholarly` flag |
| `providers/research/curated.ts` | SearXNG with `site:` filter, post-filter by registry host (robust if engine ignores `site:`) |
| `providers/research/wikipedia.ts` | dewiki Action API adapter; skips disambiguation + stubs (< 1 500 chars) |
| `providers/research/europepmc.ts` | Europe PMC adapter; abstract = text; URL `https://europepmc.org/article/{source}/{id}` |
| `providers/research/web.ts` | Existing open-web behaviour moved here + domain blocklist (shops, forums, social) |
| `pipeline/research.ts` | `researchSources(brief, deps)` orchestration (moved out of `steps.ts`) |
| `pipeline/overlap.ts` | `longestSharedRun(text, excerpts)` word n-gram overlap |

### Interfaces
```ts
type SourceTier = 1 | 2 | 3 | 4
interface ResearchQuery { brief: BriefContext; de: string; en: string }
interface ResearchCandidate {
  url: string; title: string; snippet: string; publisher: string
  tier: SourceTier; provider: 'curated' | 'wikipedia' | 'europepmc' | 'web'
  text?: string            // full text when the API already returns it
  quality?: number         // 0–1: Wikipedia badge, Europe PMC citations; ranking hint only
}
interface ResearchProvider { name: ResearchCandidate['provider']; tier: SourceTier; find(q: ResearchQuery): Promise<ResearchCandidate[]> }
researchSources(brief: BriefContext, deps): Promise<ResearchedSource[]>   // throws 'No usable sources' as today
```

## 4. Providers

### Curated (tier 1)
- Registry in code (`source-registry.ts`), reviewed via PR. Initial list (editor to confirm in review):

| Field | Hosts |
|---|---|
| nutrition | dge.de, bzfe.de, gesundheitsinformation.de, verbraucherzentrale.de, bfr.bund.de, mri.bund.de, gesund.bund.de |
| partnership | familienportal.de, profamilia.de, liebesleben.de, gesundheitsinformation.de |
| finance | verbraucherzentrale.de, test.de, finanztip.de, bafin.de, bundesbank.de, bundesfinanzministerium.de, deutsche-rentenversicherung.de |
| sports | dshs-koeln.de, dosb.de, dgsp.de, gesundheitsinformation.de, gesund.bund.de |
| psychology | gesundheitsinformation.de, neurologen-und-psychiater-im-netz.org, dgps.de, bptk.de, dgppn.de |

- Query: `({site:h1 OR site:h2 …}) {de}`; keep results whose host (or parent domain) is in the field list; publisher from registry.

### Wikipedia (tier 2)
- Search: `GET https://de.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch={de}&srlimit=5&srnamespace=0`
- Content: `action=query&prop=extracts|info|pageprops|categories&explaintext=1&inprop=url&clcategories=Kategorie:Wikipedia:Exzellent|Kategorie:Wikipedia:Lesenswert&titles=…` (batch ≤ 5 titles).
- Drop `pageprops.disambiguation`, extracts < 1 500 chars. `quality`: Exzellent 1.0, Lesenswert 0.8, else 0.5.
- `publisher: 'Wikipedia'`, `url: fullurl`, `text: extract.slice(0, EXCERPT_MAX)`.
- Header `User-Agent: ${STOCK_USER_AGENT}` (already Wikimedia-compliant; required when `wikipedia` enabled). Sequential, 2 calls per unit (search + content).

### Europe PMC (tier 3)
- Only for fields with `scholarly: true` (nutrition, sports, psychology).
- `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={en} AND (PUB_TYPE:"review" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis") AND HAS_ABSTRACT:y AND PUB_YEAR:[{now-10} TO {now}]&format=json&resultType=core&pageSize=8&sort=CITED desc`
- `text: abstractText` (HTML stripped), `publisher: journalTitle`, `quality: min(1, log10(citedByCount+1)/3)`.

### Web (tier 4)
- Current `createSearxngClient` call with `de` query. Blocklist hosts: amazon., ebay., reddit., gutefrage., facebook., instagram., tiktok., youtube., pinterest.
- Called only when tiers 1–3 yield < `RESEARCH_MIN_SOURCES` usable sources.

### Selection
1. Merge candidates, dedupe by URL, sort `tier asc, quality desc`, top 12 to the LLM.
2. `sourcePickPrompt` lists `[i] (Stufe {tier}) publisher — title — url`. Rule: "Wähle 2–3 Quellen, bevorzuge niedrige Stufen; Stufe 4 nur, wenn nichts anderes passt."
3. Materialise text, `EXCERPT_MAX = 8 000` chars (was 6 000; longer output needs more facts). Usable = ≥ 200 chars.

## 5. Written unit v2

### Draft schema (`draftWrittenSchema`)
```ts
{
  title: string(3..80),
  hook: string,                // ≤ 35 words, the "caption" under the head image
  cover: { imagePrompt: string(3..), imageQuery?: string(2..40) },
  slides: { title: string(1..80), body: string /* 60–120 words */, imagePrompt?, imageQuery? }[4..6]
} // refine: words(hook + bodies) ∈ WRITTEN_WORDS = { min: 420, max: 600 }; ≤ 2 slide images
```

### Final schema (`writtenUnitSchema`) — backward compatible
```ts
{
  format: 'written',
  cover?: { hook: string; imageId: string },   // absent on pre-#4 units
  slides: slideSchema[3..6],                    // body ≤ 120 words (was 60)
  sources: Source[1..3]
}
```

### Helpers (`packages/shared/src/feed.ts`)
- `writtenPageCount(u) = u.slides.length + (u.cover ? 1 : 0)`
- `writtenWordCount(u)`; `readingMinutes(u) = max(1, round(words / 200))`
- `writtenMinDwellSec(u) = max(WRITTEN_MIN_DWELL_SEC, round(words / 200 * 60 * 0.3))` → 500 words ⇒ 45 s; old units ⇒ 15 s.
- `isCompletion`: `slidesSeen >= writtenPageCount(content) && dwellSec >= writtenMinDwellSec(content)`.

### Prompt
- `draftWrittenPrompt`: cover + hook + 4–6 slides à 60–120 words, 420–600 words total, build-up from "why it matters" to concrete takeaway; "Formuliere eigenständig, übernimm keine Sätze wörtlich aus den Quellen."
- `PROMPT_VERSION` → `2026-10-11.1`.

### Media step
- Cover slot first, then slide slots → shared `exclude` set (distinct images). Cover image required (AI fallback as today).

### App (`WrittenUnitView.vue`)
- Page 0 = cover when present: image top ~55 % with `ImageCredit`, title, hook, chip "≈ {n} Min. Lesezeit".
- Header "Folie x von y" uses `writtenPageCount`; dots/progress likewise.
- Slide body already scrolls (`overflow-y: auto`); 120 words fit ~17 lines at 16 px on 360 px width.
- `CompleteButton` fill/wait uses `writtenMinDwellSec(unit.content)`.
- No new icons (cover uses existing `ImageCredit`); if a reading-time icon is added it gets an `ICON_MAP` entry (`schedule` / `ion-ios-time`).

### Admin
- `UnitPreview.vue`: render cover slide.
- Unit detail: source list shows tier chip (`Stufe 1 · kuratiert`, `Stufe 2 · Wikipedia`, `Stufe 3 · Studie`, `Stufe 4 · Web`) and trust badge from check report.

## 6. Quality check changes

`CheckReport` adds:
| Field | Rule |
|---|---|
| `trust: 'high' \| 'mixed' \| 'low'` | all sources tier ≤ 2 → high; any tier 3 and none tier 4 → high; any tier 4 with a tier ≤ 3 → mixed; only tier 4 → low |
| `maxVerbatimRun: number` | longest shared word run between draft text and any excerpt (lower-cased, punctuation stripped) |

- `maxVerbatimRun ≥ 12` adds a `high` issue "Wörtliche Übernahme aus Quelle" → `passed = false`.
- `trust` does not affect `passed` (product decision: flag, don't fail).

## 7. Data model (migration `0005_source_tier`)

| Table.column | Type | Notes |
|---|---|---|
| `source.tier` | smallint | not null, default 4 (existing rows = unknown/web) |
| `source.provider` | text | not null, default `'web'` |

`ResearchedSource` gains `tier`, `provider`; admin `UnitDetailDto.sources[]` exposes both. Feed `Source` DTO unchanged.

## 8. Configuration

| Env | Default | Notes |
|---|---|---|
| `RESEARCH_PROVIDERS` | `curated,wikipedia,europepmc,web` | csv; order irrelevant (tier decides); omit `web` to disable fallback |
| `RESEARCH_MIN_SOURCES` | `2` | below → web fallback; 0 usable → unit fails (unchanged) |
| `STOCK_USER_AGENT` | — | now also required when `wikipedia` is enabled |

## 9. Error handling

- Each provider: 10 s timeout, non-2xx/parse errors → logged `[research] {provider}: {status}` and `[]`. Never fails the step.
- Query-plan LLM failure → fall back to `{ de: searchQuery(brief), en: searchQuery(brief) }`.
- Step fails only when no usable source remains after the web fallback (existing message).
- Wikipedia 429 → honour `Retry-After` once (≤ 10 s), then `[]`.

## 10. Testing

| Level | What |
|---|---|
| shared unit | draft/final schema bounds & back-compat; `writtenPageCount`, `writtenMinDwellSec`, `isCompletion` for old and new units; `evaluateCheck` trust + verbatim |
| provider unit | fixture-based adapters (recorded live JSON): curated host filter incl. subdomains; Wikipedia disambiguation/stub drop, badge quality; Europe PMC mapping, HTML strip; web blocklist |
| research unit | tier ordering in prompt; fallback triggered only below threshold; provider error tolerated; query-plan failure fallback |
| steps | written unit end-to-end with fakes produces cover + slides + tiers stored |
| manual | generate 1 written unit per field; word count 420–600; read on iOS sim + Android + web; admin badges |

## 11. Success criteria

- ≥ 80 % of new units (sample: 2 per theme) cite at least one tier 1–2 source; ≤ 10 % use any tier 4 source.
- New written units: 420–600 words, cover image present, reading time shown 2–3 min.
- No regression: pre-#4 written units still render and complete with the old rules.
