# Knowledge Stream: Levels, Links, Feedback, Saved, Search — Design

**Date:** 2026-10-11 · **Status:** draft for review · **Plan:** `docs/superpowers/plans/2026-10-11-knowledge-stream.md`

## Goal
Turn the feed from a round-robin of isolated units into a guided knowledge stream: users steer it with swipe feedback, content deepens over 5 levels, units are linked, bookmarks live on the server, and search shows an Instagram-style grid that never reveals catalogue size.

## Decisions (agreed)
- **Swipe:** edge overscroll. Written: swipe right past the last slide = *mehr davon*, swipe left on the cover = *weniger davon*. Audio: horizontal swipe anywhere on the card. 👍/👎 buttons as accessible fallback.
- **Linking:** editorial `series` + `level` from batch jobs, plus automatic `related` links computed on publish (same theme + keyword overlap).
- **Delivery:** spec + plan → review → implement with tests.

## 1. Content levels
| Level | Name (DE) | Purpose | Example (vegetarisches Protein) |
|---|---|---|---|
| 1 | Überblick | Broad intro, no prior knowledge | Vegetarisches Protein allgemein |
| 2 | Vertiefung | One specific item/aspect | Linsen, Tofu, Hüttenkäse im Detail |
| 3 | Praxis | Actionable how-to | 10-Minuten-Rezepte mit diesen Zutaten |
| 4 | Querverbindung | Link to another field | Wann Protein in die Sport-Routine passt |
| 5 | Expertenwissen | Studies, mechanisms, nuance | Leucin-Schwelle, PDCAAS, aktuelle Studienlage |

- `LEVELS = [1..5]`, `LEVEL_META` (name, prompt guidance) in `packages/shared/src/levels.ts`.
- `content_brief` and `unit` get `level smallint not null default 1` and `series text null` (slug, e.g. `veg-protein`). Unit copies from brief (denormalised for feed queries). Existing rows: level 1, no series → behave as today.
- Level 4 briefs may name a `crossField` (slug); the prompt then bridges to that field.

## 2. Content creation prompts
- `batchJobSchema` gains `level` (1–5, default 1), `series` (slug ≤ 60 chars, nullish), `crossField` (nullish). `briefInputSchema` likewise. Batch stays `version: 1` (fields are optional → old files still valid).
- `topicLine()` in `pipeline/prompts.ts` appends a level block: level name, target depth, what to assume as prior knowledge (content of lower levels in the series), and for L4 the bridge field. `PROMPT_VERSION` bumped.
- `docs/batch-import.md`: Prompt 1 explains the level ladder and asks Gemini to plan **series** (one L1 + 2–3 L2 + L3 + L4 + optional L5 per series, same `series` slug, `context` of higher levels references the lower ones). New Prompt 2b "Serie planen". Table documents new fields.
- Admin brief form + batch preview show level chip `L1 · Überblick` and series.

## 3. Unit links (knowledge graph)
- Table `unit_link(from_unit_id, to_unit_id, kind 'series'|'related', score real, PK(from,to))`, both directions stored.
- On publish (`store-db` publish path) `linkUnit(unitId)`:
  - **series:** all published units with same `series` and level ±1 (score 1.0 + small boost for level+1).
  - **related:** up to 5 published units sharing `theme_id` (or field if no theme) with token Jaccard over `title + topic` ≥ 0.12; score = Jaccard. Pure `scoreRelated()` in shared.
  - Pair siblings are never linked to each other.
- Script `links:backfill` for existing units.
- `GET /api/units/:id/next?limit=3` → ordered continuation: series level+1, then same level siblings, then related; filtered like the feed (published, user's formats, one per pair, not completed). Returns `FeedUnitDto[]`.

## 4. More / less feedback & algorithm
- Table `unit_feedback(user_id, unit_id, vote smallint (+1|-1), created_at, PK(user_id, unit_id))`; re-voting overwrites.
- `POST /api/units/:id/feedback {vote: 1|-1}` → `{ next: FeedUnitDto[] }` (for +1: `next` endpoint result, limit 2; for −1: `[]`).
- **Client, immediate:** +1 splices `next` units directly after the current card (dedupe), haptic + toast „Mehr davon ✨“, auto-scroll to next card. −1 removes queued cards of the same series (and same theme, if no series) ahead of the cursor, toast „Weniger davon“, auto-scroll.
- **Server, durable** — `getAffinity(userId)` from the last 200 votes: weights per `series`, `theme`, `field` (series ±3, theme ±2, field ±1, decaying by age: ×0.5 after 14 days).
- **Level gating:** per series, user's unlocked level = 1 + max level voted +1 in that series (cap 5). Feed candidates with `series` and `level > unlocked` are excluded; units without series are unaffected.
- **Ranking:** pure `rankCandidates(cands, affinity)` in `shared/feed.ts`, applied before `orderFeed`: score = affinity(series)+affinity(theme)+affinity(field) + preferred-theme bonus; stable sort within field queues; candidates with score ≤ −4 dropped. `orderFeed`'s discovery slot is unchanged.
- `IMPRESSION_COOLDOWN_DAYS` is **not** touched (owner TODO).

## 5. Saved (bookmarks)
- Table `saved_unit(user_id, unit_id, saved_at, PK)`.
- `GET /api/me/saved?cursor=` (page 18, newest first, opaque cursor) → `{ items: UnitTileDto[], cursor: string|null }`; `PUT /api/me/saved/:id`, `DELETE /api/me/saved/:id`.
- `useVault` becomes server-backed with optimistic updates; one-time migration of the localStorage ids on first load, then the key is removed.
- New page `/saved` „Mein Gehirn“: 3-column tile grid (cover image, field tint, title overlay). Entry points: Streak tab header button and StreamTopBar menu. Tap → unit viewer.

## 6. Search (Instagram-style)
- `GET /api/search?q=&cursor=` (q 2–80 chars) → `{ topics: {fieldSlug, themeSlug|null, nameDe}[] (≤ 4), items: UnitTileDto[], cursor: string|null }`.
- Matching: `ILIKE` on unit title, brief topic, theme/field names (German, accent-insensitive via `lower()`), ranked title > topic > theme. Only published units, one per pair.
- **Size hiding:** never a total; page size 12; opaque cursor; hard cap 5 pages (60 tiles) → cursor null afterwards; ordering mixed with a per-query seeded shuffle within score bands so results feel curated.
- Empty `q`: „Für dich“ grid = top affinity themes' units (same shape).
- Explore tab: search field at top (iOS: rounded search bar; Android: M3 search bar). Typing (300 ms debounce) replaces the field cards with topic chips (tap = focus feed / follow) + masonry-like tile grid with infinite scroll. Tap → unit viewer.

## 7. Unit viewer (continuation)
- Route `/unit/:id` (full-screen, outside tabs, back button). Vertical snap feed seeded with the unit, then `GET /units/:id/next` pages → consistent continuation through the knowledge graph. Reuses the feed card (extracted to `UnitCard.vue`) incl. swipe feedback, save, completion.
- `GET /api/units/:id` → `FeedUnitDto` (published only).

## Shared DTO
```ts
interface UnitTileDto { id: string; title: string; format: UnitFormat; field: { slug: string; nameDe: string }; level: Level; image: string | null }
```
`FeedUnitDto` gains `level`, `series: string | null`, `saved: boolean`.

## Platform/UI rules (CLAUDE.md)
New `ICON_MAP` keys: `more_like` (thumb_up / ion-ios-thumbs-up), `less_like` (thumb_down / ion-ios-thumbs-down), `search` (search / ion-ios-search), `saved_grid` (collections_bookmark / ion-ios-bookmarks), `level` (stairs / ion-ios-trending-up). Bookmark keeps existing keys.

## Out of scope
Embedding-based similarity, push for new series levels, admin graph visualisation, changing the impression cooldown.

## Risks
- Overscroll detection inside a native-scrolling `scroll-snap` track: use `scrollend` + pointer delta at the track edges; threshold 72 px; must not fire on normal slide swipes (tested on iOS WebView + Android).
- Level gating can starve a series-heavy feed → gating only filters; `orderFeed` fills from other fields/discovery as today.
