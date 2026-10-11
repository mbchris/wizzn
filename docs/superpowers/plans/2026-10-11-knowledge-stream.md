# Knowledge Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.

**Goal:** Levels + series in briefs/prompts, unit links, more/less feedback with ranking and level gating, server-side saved units, Instagram-style search, unit viewer with continuation.
**Spec:** `docs/superpowers/specs/2026-10-11-knowledge-stream-design.md`
**Branch:** `feat/knowledge-stream`
**Stack:** Hono + Zod + Drizzle (pg), vitest, Quasar 2 / Vue 3 / Capacitor 7.

## Global Constraints
- Do **not** touch `IMPRESSION_COOLDOWN_DAYS`.
- Old batch files, briefs and units stay valid (new fields optional, defaults level 1 / series null).
- No endpoint returns a total count of units.
- Icons only via `ICON_MAP` + `pIcon`; iOS form sheets bottom; binary toggles `SegmentedControl`.
- German UI copy. Conventional Commits, one commit per task. TDD for every pure function and route.

## Tasks

### Task 1 — Shared: levels, schemas, ranking (TDD)
- [ ] `shared/src/levels.ts`: `LEVELS`, `Level`, `LEVEL_META`, `levelLabel()`.
- [ ] `batchJobSchema` + `briefInputSchema`: `level`, `series` (`/^[a-z0-9-]{2,60}$/`), `crossField`; `parseBatchFile` resolves `crossField` slug.
- [ ] `shared/src/feed.ts`: `UnitTileDto`, extend `FeedUnitDto`; `Affinity`, `scoreCandidate`, `rankCandidates`, `unlockedLevel`; `FeedCandidate` gains `themeId`, `series`, `level`.
- [ ] `shared/src/links.ts`: `tokens()`, `jaccard()`, `scoreRelated()`.
- [ ] Tests: batch parse with/without new fields; ranking order, drop ≤ −4; gating; jaccard.

### Task 2 — DB migration 0010
- [ ] `content_brief.level/series/cross_field_id`, `unit.level/series` + index `(status, series, level)`.
- [ ] Tables `unit_link`, `unit_feedback`, `saved_unit`.
- [ ] `pnpm --filter api db:generate`, review SQL, commit.

### Task 3 — Pipeline: level-aware prompts + copy to unit
- [ ] Brief → unit copies level/series (admin-repo create + batch).
- [ ] `BriefContext` gets `level`, `series`, `crossFieldName`, `seriesPrior` (titles of published lower-level units in series); `topicLine` level block; bump `PROMPT_VERSION`.
- [ ] Tests: prompt contains level guidance; L4 mentions bridge field.

### Task 4 — Linking
- [ ] `link-repo.ts`: `linkUnit(id)` (series + related), called after publish; `next(userId, unitId, formats, limit)`.
- [ ] Script `links:backfill`.
- [ ] Tests with fakes: series ordering, siblings excluded, related cap 5.

### Task 5 — API routes
- [ ] `GET /units/:id`, `GET /units/:id/next`, `POST /units/:id/feedback`.
- [ ] `GET/PUT/DELETE /me/saved`.
- [ ] `GET /search` (page 12, cap 5 pages, opaque base64 cursor, seeded shuffle within bands).
- [ ] Feed: `getCandidates` returns themeId/series/level, applies gating; route applies `rankCandidates` before `orderFeed`; DTO `level/series/saved`.
- [ ] Tests (app.test style): auth required, 404 unpublished, vote overwrite, saved paging, search never > 60 items & no count field, feed drops downvoted theme.

### Task 6 — Admin
- [ ] Brief form: level select (`L1 · Überblick`…), series input, cross-field select for L4.
- [ ] Batch preview: level/series columns.

### Task 7 — Web: UnitCard + swipe feedback
- [ ] Extract `components/UnitCard.vue` from FeedPage.
- [ ] `composables/useSwipeFeedback.ts`: edge overscroll on written track (cover ← = less, last slide → = more), anywhere on audio; 72 px threshold; card tilt + label overlay during drag.
- [ ] 👍/👎 buttons; ICON_MAP entries; feed splice/remove logic + toasts.

### Task 8 — Web: saved + search + viewer
- [ ] `useVault` server-backed + localStorage migration.
- [ ] `components/UnitGrid.vue` (3-col tiles, infinite scroll, no counts).
- [ ] `pages/SavedPage.vue` (`/saved`), entry from Streak tab + top bar.
- [ ] ExplorePage search bar, topic chips, grid; debounce 300 ms.
- [ ] `pages/UnitViewerPage.vue` (`/unit/:id`) vertical continuation via `/next`.

### Task 9 — Docs
- [ ] `docs/batch-import.md`: new fields table rows, level ladder in Prompt 1, Prompt 2b „Serie planen“, sample JSON with a 5-level series. (Keep the owner's uncommitted edits.)
- [ ] `docs/batch-import.sample.json` updated.

### Task 10 — Verification
- [ ] `pnpm -r typecheck`, `pnpm -r test`, web build.
- [ ] Manual: swipe on iOS sim + Android emulator (no false votes on slide swipes), search shows no counts, saved syncs across reinstall.
- [ ] requesting-code-review.
