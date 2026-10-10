# Reliable Sources & Long-form Written Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research queries curated authorities → German Wikipedia → Europe PMC before the open web; written units become cover + 4–6 slides with 420–600 words (2–3 min).
**Architecture:** New `ResearchProvider` port with curated/wikipedia/europepmc/web adapters, orchestrated by `pipeline/research.ts` (tiered gather → LLM pick → web fallback below threshold). `source` gains `tier`/`provider`. Written draft/final schemas get a cover; shared helpers derive page count, reading time and min dwell; check report adds `trust` and verbatim-overlap.
**Tech Stack:** Hono + Zod + Drizzle (pg), pg-boss, vitest, Quasar 2 / Vue 3 / Capacitor 7.
**Spec:** `docs/superpowers/specs/2026-10-10-reliable-sources-design.md`
**Branch:** `issue-4-reliable-sources` · Issue #4

## Global Constraints
- Tiers: 1 curated, 2 wikipedia, 3 europepmc (fields with `scholarly: true` only), 4 web. Web only when tiers 1–3 yield `< RESEARCH_MIN_SOURCES` (2) usable sources.
- Provider timeout 10 s; provider errors log `[research] {provider}: …` and return `[]`; they never fail the step.
- Sources per unit: 1–3 (unchanged `sourceSchema` bounds). Usable = text ≥ 200 chars. `EXCERPT_MAX = 8000`.
- Wikipedia requests send `User-Agent: ${STOCK_USER_AGENT}`; `wikipedia` enabled without it → env error.
- Written draft: hook ≤ 35 words, 4–6 slides, body 60–120 words, total (hook + bodies) 420–600 words, ≤ 2 slide images, cover image required.
- Written final: `cover?` optional, slides 3–6, body ≤ 120 words — pre-#4 units must still validate, render and complete.
- `writtenMinDwellSec = max(15, round(words/200*60*0.3))`; reading time `max(1, round(words/200))` min.
- Verbatim run ≥ 12 words → high issue "Wörtliche Übernahme aus Quelle". `trust` never changes `passed`.
- `PROMPT_VERSION = '2026-10-11.1'`.
- Do **not** touch `IMPRESSION_COOLDOWN_DAYS` in `packages/shared/src/feed.ts` (owner's TODO — ask first).
- App UI follows CLAUDE.md: any new icon via `ICON_MAP` + `pIcon`; German copy: "≈ {n} Min. Lesezeit", "Folie x von y".
- Admin copy: tier chips `Stufe 1 · kuratiert`, `Stufe 2 · Wikipedia`, `Stufe 3 · Studie`, `Stufe 4 · Web`; trust badge `Quellenlage: hoch|gemischt|niedrig`.
- Conventional Commits, one commit per task.

## Review Focus
- SearXNG ignores `site:` for some engines → curated provider still returns only registry hosts (post-filter; test in Task 3).
- `www.` and subdomains (`www.verbraucherzentrale.de`, `ernaehrung.verbraucherzentrale.de`) match `verbraucherzentrale.de`; `notdge.de` must not match `dge.de` (Task 3).
- Wikipedia disambiguation page or stub ranked first → dropped (Task 4).
- Europe PMC abstract contains `<h4>`/`<sup>` markup → stripped (Task 5).
- All tiers 1–3 down → web fallback, unit still produced with `trust: 'low'` (Task 7).
- Old written unit (no cover, 15 s dwell) completes exactly as before (Task 2 + Task 10).
- LLM returns 650 words → draft schema rejects → step fails with clear message (Task 1, Task 8).

---

### Task 1: Shared schemas and helpers

**Files:**
- Modify: `packages/shared/src/pipeline.ts`, `packages/shared/src/content.ts`, `packages/shared/src/feed.ts`, `packages/shared/src/admin.ts`
- Test: `packages/shared/test/pipeline.test.ts`, `packages/shared/test/content.test.ts`, `packages/shared/test/feed.test.ts`

**Interfaces (produces):**
- `WRITTEN_WORDS = { min: 420, max: 600 } as const`
- `draftWrittenSchema` v2 per spec §5 (`hook`, `cover{imagePrompt,imageQuery?}`, `slides[4..6]` body 60–120 words, total refine, ≤ 2 slide images)
- `writtenUnitSchema`: `cover?: { hook, imageId }`, slides `3..6`, body ≤ 120 words
- `writtenPageCount`, `writtenWordCount`, `readingMinutes`, `writtenMinDwellSec` (feed.ts); `isCompletion` uses them
- `SourceTier = 1|2|3|4`; `CheckReport` + `trust`, `maxVerbatimRun`; `evaluateCheck(llm, links, { tiers, maxVerbatimRun })`
- `UnitDetailDto.sources[]` + `tier`, `provider`

- [ ] **Step 1: Write failing tests**
  - Draft: 5 slides × 90 words + 30-word hook passes; 3 slides fails; 650 total fails; slide body 130 fails; 3 slide images fails.
  - Final: pre-#4 fixture (3 slides, no cover) passes; with cover passes; 7 slides fails.
  - `writtenMinDwellSec`: 500 words → 45; old 3×50 words → 15. `writtenPageCount` with cover = slides + 1.
  - `isCompletion`: new unit needs `slidesSeen = slides+1` and 45 s; old unit 15 s / slides.length.
  - `evaluateCheck`: tiers `[1,2]`→high, `[3]`→high, `[2,4]`→mixed, `[4]`→low; `maxVerbatimRun 12` → high issue + `passed=false`; `trust:'low'` alone keeps `passed=true`.
- [ ] **Step 2:** `pnpm --filter @wizzn/shared test` → FAIL
- [ ] **Step 3:** Implement; re-export from `index.ts`; leave `IMPRESSION_COOLDOWN_DAYS` untouched.
- [ ] **Step 4:** `pnpm --filter @wizzn/shared test && pnpm --filter @wizzn/shared build` → PASS
- [ ] **Step 5:** Commit `feat(shared): long-form written schema, reading helpers, source trust`

### Task 2: Migration + store (`source.tier`, `source.provider`)

**Files:**
- Modify: `packages/api/src/db/schema/content.ts`, `packages/api/src/pipeline/store.ts`, `packages/api/src/pipeline/store-db.ts`, `packages/api/src/pipeline/prompts.ts` (`ResearchedSource` + `tier`, `provider`), `packages/api/test/pipeline/fake-store.ts`
- Create: `packages/api/drizzle/0005_source_tier.sql` (via `drizzle-kit generate --name source_tier`)

- [ ] **Step 1:** Add columns `tier smallint not null default 4`, `provider text not null default 'web'`.
- [ ] **Step 2:** `pnpm --filter @wizzn/api drizzle-kit generate --name source_tier`; review SQL (only two `ALTER TABLE … ADD COLUMN`).
- [ ] **Step 3:** `replaceSources`/`getSources` persist + return tier/provider; fake store mirrors.
- [ ] **Step 4:** Admin repo maps tier/provider into `UnitDetailDto.sources`.
- [ ] **Step 5:** `pnpm --filter @wizzn/api test` → PASS (existing tests updated for the new fields)
- [ ] **Step 6:** Commit `feat(api): store source tier and provider`

### Task 3: Research types, source registry, curated provider

**Files:**
- Create: `packages/api/src/providers/research/types.ts`, `packages/api/src/pipeline/source-registry.ts`, `packages/api/src/providers/research/curated.ts`
- Test: `packages/api/test/providers/research-curated.test.ts`

**Interfaces (produces):** `ResearchProvider`, `ResearchCandidate`, `ResearchQuery` (spec §3); `SOURCE_REGISTRY: Record<fieldSlug, { scholarly: boolean; hosts: { host: string; publisher: string }[] }>`; `hostMatches(url, host)`; `createCuratedProvider(search: SearchClient)`.

- [ ] **Step 0 (spike, throwaway):** against local SearXNG (`docker compose -f docker-compose.dev.yml up searxng`) run `(site:dge.de OR site:bzfe.de) Protein Bedarf`; note in the PR whether results are restricted. Post-filter is required either way.
- [ ] **Step 1: Write failing tests** — fake `SearchClient` returning mixed hosts: keeps `www.dge.de/...`, `ernaehrung.verbraucherzentrale.de/...`; drops `notdge.de`, `amazon.de`; publisher taken from registry; tier 1; unknown field slug → `[]`; query contains `site:` for each host.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement registry with hosts from spec §4 and `brief.fieldSlug` (add `fieldSlug` to `BriefContext` + `store-db.getUnit` join).
- [ ] **Step 4:** `pnpm --filter @wizzn/api test` → PASS
- [ ] **Step 5:** Commit `feat(api): curated source registry and provider`

### Task 4: Wikipedia provider

**Files:**
- Create: `packages/api/src/providers/research/wikipedia.ts`, `packages/api/test/providers/fixtures/wikipedia-search.json`, `…/wikipedia-extracts.json`
- Test: `packages/api/test/providers/research-wikipedia.test.ts`

- [ ] **Step 0:** Record fixtures live (machine with network): `curl -A "$STOCK_USER_AGENT" 'https://de.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=Protein%20Muskelaufbau&srlimit=5&srnamespace=0'` and the extracts call from spec §4 for the returned titles. Trim to ≤ 20 KB.
- [ ] **Step 1: Write failing tests** — UA header sent; disambiguation and < 1 500-char extracts dropped; `Exzellent` → quality 1.0, `Lesenswert` 0.8, else 0.5; `text` capped at 8 000; `url = fullurl`; HTTP 429 with `Retry-After: 1` retried once; 500 → `[]`.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement `createWikipediaProvider({ userAgent, fetchFn })` (2 requests, `AbortSignal.timeout(10_000)`).
- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** Commit `feat(api): German Wikipedia research provider`

### Task 5: Europe PMC provider

**Files:**
- Create: `packages/api/src/providers/research/europepmc.ts`, `packages/api/test/providers/fixtures/europepmc-search.json`
- Test: `packages/api/test/providers/research-europepmc.test.ts`

- [ ] **Step 0:** Record fixture live with the spec §4 query (`en = "protein intake muscle hypertrophy"`).
- [ ] **Step 1: Write failing tests** — query string contains review filter, `HAS_ABSTRACT:y`, `PUB_YEAR:[{y-10} TO {y}]` (inject clock); mapping title/journalTitle/abstract; HTML stripped; URL `https://europepmc.org/article/MED/{pmid}`; `quality` from `citedByCount`; items without abstract dropped; non-scholarly field → no HTTP call.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement `createEuropePmcProvider({ fetchFn, now })`.
- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** Commit `feat(api): Europe PMC research provider`

### Task 6: Web provider, env, wiring

**Files:**
- Create: `packages/api/src/providers/research/web.ts`
- Modify: `packages/api/src/env.ts`, `packages/api/src/providers/index.ts`, `.env.example` / `README.md` env section
- Test: `packages/api/test/providers/research-web.test.ts`, `packages/api/test/env.test.ts`, `packages/api/test/providers/providers.test.ts`

- [ ] **Step 1: Write failing tests** — blocklist drops shop/forum/social hosts; tier 4; env: `RESEARCH_PROVIDERS` csv enum default `curated,wikipedia,europepmc,web`; `RESEARCH_MIN_SOURCES` int ≥ 0 default 2; `wikipedia` without `STOCK_USER_AGENT` → issue; `createProviders` returns `research: ResearchProvider[]` honouring the csv.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm --filter @wizzn/api test` → PASS
- [ ] **Step 5:** Commit `feat(api): web research provider and research env`

### Task 7: Query plan + research orchestration

**Files:**
- Create: `packages/api/src/pipeline/research.ts`
- Modify: `packages/api/src/pipeline/prompts.ts` (`queryPlanPrompt`, `sourcePickPrompt` with tiers), `packages/shared/src/pipeline.ts` (`queryPlanSchema = { de, en }`, `sourcePickSchema` picks 1–3 unchanged), `packages/api/src/pipeline/steps.ts` (`research` delegates; `PipelineDeps.research`, `researchMinSources`), `packages/api/src/worker.ts`
- Test: `packages/api/test/pipeline/research.test.ts`, update `steps.test.ts`

- [ ] **Step 1: Write failing tests**
  - Candidates from 3 fake providers sorted tier asc/quality desc, deduped by URL, ≤ 12 sent to pick prompt with `(Stufe n)` labels.
  - Provider throwing / hanging (fake timer) → ignored.
  - Candidate with `text` → no `fetchPage` call; without → fetched; < 200 chars → unusable.
  - 2 usable from tiers 1–3 → web provider **not** called; 1 usable → web called, merged, re-picked, stored tier 4.
  - Query-plan LLM error → fallback `searchQuery(brief)` for both languages.
  - Nothing usable → throws `No usable sources (all picks unreachable or empty)`.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement `researchSources`; `steps.research` becomes `store.replaceSources(unit.id, await researchSources(unit.brief, deps))`.
- [ ] **Step 4:** `pnpm --filter @wizzn/api test` → PASS
- [ ] **Step 5:** Commit `feat(api): tiered research with web fallback`

### Task 8: Long-form draft prompt + media cover slot

**Files:**
- Modify: `packages/api/src/pipeline/prompts.ts` (`draftWrittenPrompt`, `PROMPT_VERSION`), `packages/api/src/pipeline/steps.ts` (`media` written branch, `draftText`)
- Test: `packages/api/test/pipeline/steps.test.ts`

- [ ] **Step 1: Write failing tests** — fake LLM returns v2 draft → media resolves cover slot first then slide slots (distinct via exclude), final content has `cover.imageId` and validates; `draftText` includes hook; prompt mentions 420–600 words and "keine Sätze wörtlich".
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement; JSON shape in prompt: `{"title","hook","cover":{"imagePrompt","imageQuery"},"slides":[{"title","body","imagePrompt"?,"imageQuery"?}]}`.
- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** Commit `feat(api): cover + long-form written drafts`

### Task 9: Check — verbatim overlap + trust

**Files:**
- Create: `packages/api/src/pipeline/overlap.ts`
- Modify: `packages/api/src/pipeline/steps.ts` (`check`)
- Test: `packages/api/test/pipeline/overlap.test.ts`, `steps.test.ts`

- [ ] **Step 1: Write failing tests** — `longestSharedRun` ignores case/punctuation/umlaut-normalised whitespace; 12-word copied sentence → 12; disjoint → small; check step passes tiers + run into `evaluateCheck`.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement with word-shingle `Set` per excerpt (O(n·k), excerpts ≤ 8 000 chars).
- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** Commit `feat(api): verbatim overlap and source trust in check report`

### Task 10: Feed completion uses new helpers

**Files:**
- Modify: `packages/api/src/routes/feed.ts` (only caller of `isCompletion`); verify the client payload in `useCompletion`
- Test: `packages/api/test/feed.test.ts`

- [ ] **Step 1: Write failing tests** — new unit: `slidesSeen = slides` (no cover counted) → `not_enough_progress`; `slides+1` and 45 s → completed; old unit unchanged.
- [ ] **Step 2–4:** FAIL → wire → PASS
- [ ] **Step 5:** Commit `feat(api): page-count based written completion`

### Task 11: App — cover page and reading time

**Files:**
- Modify: `packages/web/src/components/WrittenUnitView.vue`, `packages/web/src/utils/platformIcons.ts` (only if a time icon is used: `reading_time: { android: 'schedule', ios: 'ion-ios-time' }`)

- [ ] **Step 1:** Render cover as page 0 when `content.cover` (image ~55 % height + `ImageCredit`, title, hook, chip "≈ {n} Min. Lesezeit").
- [ ] **Step 2:** Page count, dots, progress, `maxSeen`, `CompleteButton` fill/wait from shared helpers.
- [ ] **Step 3:** `pnpm --filter @wizzn/web build` + `vue-tsc` → PASS
- [ ] **Step 4:** Manual: seeded new + old unit on web (375×812), iOS simulator, Android emulator; 120-word slide scrolls inside slide without breaking horizontal swipe.
- [ ] **Step 5:** Commit `feat(web): cover page and reading time for written units`

### Task 12: Admin — tiers, trust, cover preview

**Files:**
- Modify: `packages/admin/src/components/UnitPreview.vue`, `packages/admin/src/pages/UnitDetailPage.vue`

- [ ] **Step 1:** Preview renders cover slide first.
- [ ] **Step 2:** Sources list shows tier chip; check panel shows trust badge and verbatim issue.
- [ ] **Step 3:** `pnpm --filter @wizzn/admin build` → PASS; manual check with a seeded unit.
- [ ] **Step 4:** Commit `feat(admin): source tier and trust badges`

### Task 13: Seeds, docs, verification

**Files:**
- Modify: `packages/api/src/db/seed-samples.ts` (one v2 written sample), `README.md`/`docs` env table, `ABOUT.md` (written content now "cover + 4–6 slides, 2–3 min")

- [ ] **Step 1:** Update sample + docs.
- [ ] **Step 2:** `pnpm -r test && pnpm -r build` → PASS
- [ ] **Step 3:** Generate 2 written units per field locally; record word count, tiers used, trust in the PR description; success criteria from spec §11.
- [ ] **Step 4:** Commit `docs: reliable sources and long-form written units`
