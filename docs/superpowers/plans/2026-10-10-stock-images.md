# CC-licensed Stock Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every unit image slot gets a CC-licensed stock image (Openverse → Commons) with stored attribution, falling back to an AI image; app shows credits, admin can swap.
**Architecture:** New `StockImageClient` port with Openverse/Commons adapters behind an ordered chain; `resolveImage` in the pipeline filters, lets the LLM pick, downloads into `MediaStore` and falls back to `ImageClient`. `asset` gains `origin`/`credit`/`stock_query`/`rejected_stock_ids`; feed and admin DTOs expose credits; admin swap reuses `resolveImage` through an `ImageReplacer` port.
**Tech Stack:** Hono + Zod + Drizzle (pg), pg-boss, vitest, Quasar 2 / Vue 3 / Capacitor 7.
**Spec:** `docs/superpowers/specs/2026-10-10-stock-images-design.md`
**Branch:** `issue-3-cc-licensed-stock-images` · Issue #3

## Global Constraints
- Allowed licenses: `cc0`, `pdm`, `by`, `by-sa` (any version). Everything else (NC, ND, unknown) is dropped.
- Provider order from `STOCK_IMAGE_PROVIDERS` (csv, default `openverse,commons`; empty = stock disabled).
- Provider timeout 10 s; stock errors never fail a unit — only AI fallback errors do.
- Filter: `min(width,height) ≥ STOCK_MIN_EDGE_PX` (800); mime ∈ `image/jpeg|image/png|image/webp`; download ≤ `STOCK_MAX_BYTES` (5 000 000); ≤ 3 download attempts per slot.
- LLM pick from top 8 candidates; `{ index: null }` → AI fallback.
- Slots resolved sequentially; one `exclude` set per unit keyed `${provider}:${providerId}`.
- Asset id is stable on swap; `contentJson` is never rewritten by a swap.
- Commons requests send `User-Agent: ${STOCK_USER_AGENT}`; `commons` enabled without it → env error.
- `PROMPT_VERSION = '2026-10-10.1'`.
- App UI: icon key `image_credit` → `{ android: 'info', ios: 'ion-ios-information-circle-outline' }`; sheet `:position="isIos ? 'bottom' : 'standard'"`; German copy: "von {creator}", "Quelle ansehen", PDM label "Gemeinfrei".
- Admin copy: badge `Stock · {provider} · {license}` / `KI`; buttons "Nächstes Stockbild", "KI-Bild"; 422 notice "Kein weiteres Stockbild gefunden".
- Conventional Commits, one commit per task (`.claude/rules/general-behavior.md`).

## Review Focus
- Openverse returns a `by-nc` / `by-nd` item although the query filters licenses → dropped by the whitelist (test in Task 3).
- Commons `Artist` is HTML (`<a href=…>Name</a>`, `<span>`) or missing; `LicenseShortName` variants like `CC BY-SA 3.0 de`, `Public domain`, `CC0` → plain-text creator or `null`, correct code + version (tests in Tasks 2 + 4).
- Download without `content-length` streams more than 5 MB, or returns `text/html` (expired thumb/redirect page) → next candidate, never stored (test in Task 6).
- Two slots of one unit hit the same top result → second slot gets a different image (test in Task 7).
- Units created before this change (assets without credit) → feed `credits` empty, app renders no ⓘ, admin shows `KI` badge (test in Task 10; manual in Tasks 11–12).

---

### Task 1: Shared schemas and DTOs

**Files:**
- Modify: `packages/shared/src/content.ts`, `packages/shared/src/pipeline.ts`, `packages/shared/src/feed.ts`, `packages/shared/src/admin.ts`
- Test: `packages/shared/test/content.test.ts`, `packages/shared/test/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `STOCK_LICENSES = ['cc0','pdm','by','by-sa'] as const`; `type StockLicense`
  - `imageCreditSchema` (spec §6 fields: `title, creator|null, creatorUrl|null, license, licenseVersion|null, licenseUrl, sourceUrl, provider, providerId`); `type ImageCredit`
  - `formatLicense(c: Pick<ImageCredit,'license'|'licenseVersion'>): string` → `'CC BY-SA 4.0'`, `'CC BY 2.0'`, `'CC0 1.0'`, `'Gemeinfrei'`; no version → `'CC BY'`
  - `imagePickSchema = z.object({ index: z.number().int().min(0).nullable() })`
  - `draftWrittenSchema.slides[].imageQuery?: string(2..40)`; `draftAudioSchema.images[].query?: string(2..40)`
  - `FeedUnitDto.credits: Record<string, ImageCredit>`
  - `UnitDetailDto.assets[]` + `origin: 'generated'|'stock'`, `credit: ImageCredit|null`, `stockQuery: string|null`
  - `replaceImageSchema = z.object({ mode: z.enum(['next-stock','generated']) })`; `type ReplaceImageMode`

- [ ] **Step 1: Write failing tests**
  - `formatLicense`: `{by-sa,'4.0'}→'CC BY-SA 4.0'`, `{cc0,'1.0'}→'CC0 1.0'`, `{pdm,null}→'Gemeinfrei'`, `{by,null}→'CC BY'`.
  - `imageCreditSchema` rejects `license:'by-nc'` and non-URL `licenseUrl`.
  - `draftWrittenSchema` accepts slides with and without `imageQuery`; rejects `imageQuery:'x'`.
  - `draftAudioSchema` accepts `images[].query` optional.
- [ ] **Step 2:** `pnpm --filter @wizzn/shared test` → FAIL (exports missing)
- [ ] **Step 3:** Implement the exports above (shared builds via `tsc`, re-exported from `index.ts`).
- [ ] **Step 4:** `pnpm --filter @wizzn/shared test && pnpm --filter @wizzn/shared build` → PASS
- [ ] **Step 5:** Commit `feat(shared): image credit schema and draft image queries`

---

### Task 2: Stock image types + license normalisation

**Files:**
- Create: `packages/api/src/providers/stock-images/types.ts`, `packages/api/src/providers/stock-images/license.ts`
- Test: `packages/api/test/providers/stock-license.test.ts`

**Interfaces:**
- Consumes: `ImageCredit`, `StockLicense` (Task 1)
- Produces:
  ```ts
  export interface StockCandidate { provider: 'openverse'|'commons'; providerId: string; title: string; tags: string[]; imageUrl: string; width: number; height: number; mime: string; credit: ImageCredit }
  export interface StockImageClient { readonly name: string; search(query: string, opts?: { limit?: number }): Promise<StockCandidate[]> }
  export class StockSearchError extends Error { constructor(provider: string, status: number | null, message: string) }
  export const stockKey = (c: Pick<StockCandidate,'provider'|'providerId'>) => `${c.provider}:${c.providerId}`
  export function parseLicense(raw: string, version?: string | null): { license: StockLicense; version: string | null } | null
  export function licenseUrl(license: StockLicense, version: string | null): string
  ```

- [ ] **Step 1: Write failing tests** for `parseLicense`:
  | input | expected |
  |---|---|
  | `('by-sa','4.0')` (Openverse) | `{by-sa,'4.0'}` |
  | `('cc0','1.0')` | `{cc0,'1.0'}` |
  | `('pdm','')` | `{pdm,null}` |
  | `('CC BY-SA 3.0 de')` | `{by-sa,'3.0'}` |
  | `('CC BY 2.0')` | `{by,'2.0'}` |
  | `('CC0')` | `{cc0,null}` |
  | `('Public domain')` | `{pdm,null}` |
  | `('by-nc','2.0')`, `('CC BY-NC-SA 4.0')`, `('CC BY-ND 4.0')`, `('GFDL')` | `null` |

  `licenseUrl('by-sa','4.0')` → `https://creativecommons.org/licenses/by-sa/4.0/`; `('cc0',null)` → `https://creativecommons.org/publicdomain/zero/1.0/`; `('pdm',null)` → `https://creativecommons.org/publicdomain/mark/1.0/`; `('by',null)` → `https://creativecommons.org/licenses/by/4.0/`.
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- stock-license` → FAIL
- [ ] **Step 3:** Implement. Normalise: lowercase, strip `cc `, spaces→`-`; match `^(cc0|pdm|by|by-sa)(?:-(\d\.\d))?` after removing jurisdiction suffix; `public-domain` → `pdm`; any `nc`/`nd` token → `null`.
- [ ] **Step 4:** Re-run → PASS
- [ ] **Step 5:** Commit `feat(api): stock image types and license parsing`

---

### Task 3: Openverse adapter

**Files:**
- Create: `packages/api/src/providers/stock-images/openverse.ts`, `packages/api/test/providers/fixtures/openverse-search.json`
- Test: `packages/api/test/providers/openverse.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces: `createOpenverseClient(cfg: { clientId?: string; clientSecret?: string; baseUrl?: string /* default https://api.openverse.org */; fetchFn?: typeof fetch; now?: () => number }): StockImageClient` (`name = 'openverse'`)

- [ ] **Step 1: Write failing tests** (fixture: 4 results — `by-sa 4.0` from `flickr`, `cc0`, `by-nc 2.0`, one with `creator: null`):
  - request URL contains `q=healthy%20breakfast`, `license=cc0%2Cpdm%2Cby%2Cby-sa`, `mature=false`, `page_size=20`
  - maps result 1 to `{ provider:'openverse', providerId:id, imageUrl:url, credit:{ provider:'openverse/flickr', sourceUrl:foreign_landing_url, license:'by-sa', licenseVersion:'4.0', creator, creatorUrl:creator_url } }`
  - `by-nc` item dropped (Review Focus); `creator:null` → `credit.creator === null`
  - `filetype:'jpg'` → `mime:'image/jpeg'`; missing width/height → item dropped
  - with `clientId/secret`: first call POSTs `/v1/auth_tokens/token/` (form `grant_type=client_credentials`), search sends `Authorization: Bearer tok`; second search within `expires_in` reuses token (1 token call total)
  - HTTP 429 → rejects with `StockSearchError` (`status: 429`)
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- openverse` → FAIL
- [ ] **Step 3:** Implement. Refresh token 60 s before expiry.
- [ ] **Step 4:** Re-run → PASS
- [ ] **Step 5:** Commit `feat(api): openverse stock image client`

---

### Task 4: Wikimedia Commons adapter

**Files:**
- Create: `packages/api/src/providers/stock-images/commons.ts`, `packages/api/test/providers/fixtures/commons-search.json`
- Test: `packages/api/test/providers/commons.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces: `createCommonsClient(cfg: { userAgent: string; baseUrl?: string /* https://commons.wikimedia.org/w/api.php */; fetchFn?: typeof fetch }): StockImageClient` (`name = 'commons'`)

- [ ] **Step 1: Write failing tests** (fixture `query.pages` with 4 files: `CC BY-SA 3.0 de` + `Artist: '<a href="//commons.wikimedia.org/wiki/User:Foo">Foo</a>'`; `CC0` with missing `Artist`; `CC BY-NC 2.0`; `Public domain` + `Artist: '<span class="fn">Bar &amp; Baz</span>'`):
  - URL params: `action=query`, `generator=search`, `gsrnamespace=6`, `gsrsearch=<q> filetype:bitmap`, `gsrlimit=20`, `prop=imageinfo`, `iiprop=url|size|mime|extmetadata`, `iiurlwidth=1080`, `format=json`, `origin` absent
  - header `user-agent` equals cfg value
  - file 1 → `imageUrl: thumburl`, `width/height` = original size, `credit.creator: 'Foo'`, `credit.license:'by-sa'`, `licenseVersion:'3.0'`, `sourceUrl: descriptionurl`, `title` from `ObjectName` (fallback: page title without `File:` and extension), `providerId: page title`
  - file 2 → `creator: null`; file 3 dropped; file 4 → `creator: 'Bar & Baz'`, `license:'pdm'`
  - response without `query` → `[]`; HTTP 503 → `StockSearchError`
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- commons` → FAIL
- [ ] **Step 3:** Implement; strip tags with a regex and decode `&amp; &lt; &gt; &quot; &#39;`; `licenseUrl` from `extmetadata.LicenseUrl` else `licenseUrl()`.
- [ ] **Step 4:** Re-run → PASS
- [ ] **Step 5:** Commit `feat(api): wikimedia commons stock image client`

---

### Task 5: Chain, env and provider wiring

**Files:**
- Create: `packages/api/src/providers/stock-images/chain.ts`
- Modify: `packages/api/src/env.ts`, `packages/api/src/providers/index.ts`, `.env.template`
- Test: `packages/api/test/providers/stock-chain.test.ts`, `packages/api/test/env.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4
- Produces:
  - `createStockChain(clients: StockImageClient[], opts?: { timeoutMs?: number /* 10_000 */; log?: (msg: string) => void }): StockImageClient` (`name = 'chain'`)
  - env: `STOCK_IMAGE_PROVIDERS` (csv of `openverse|commons`, default `'openverse,commons'`), `STOCK_USER_AGENT` (default `''`), `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` (default `''`), `STOCK_MIN_EDGE_PX` (int, 800), `STOCK_MAX_BYTES` (int, 5_000_000), `IMAGE_EPHEMERAL` (bool, true)
  - `createProviders(env).stock: StockImageClient | null` (null when list empty)

- [ ] **Step 1: Write failing tests**
  - chain: first client returns 2 → result has 2, second not called; first throws `StockSearchError` → second's results; first returns `[]` → second's results; all fail → `[]` and `log` called per failure; first never resolves → aborted after `timeoutMs` (use 20 ms), second used
  - env: `STOCK_IMAGE_PROVIDERS='openverse,commons'` + empty `STOCK_USER_AGENT` → `loadEnv` throws mentioning `STOCK_USER_AGENT`; `'openverse'` alone → ok; `''` → `[]`; `'foo'` → error
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- stock-chain env` → FAIL
- [ ] **Step 3:** Implement (env cross-field check via `superRefine`). Add vars with comments to `.env.template`, incl. ImageRouter block from spec §8 (commented).
- [ ] **Step 4:** Re-run → PASS; `pnpm --filter @wizzn/api typecheck` → clean
- [ ] **Step 5:** Commit `feat(api): stock image chain and config`

---

### Task 6: Asset schema migration + store

**Files:**
- Modify: `packages/api/src/db/schema/content.ts`, `packages/api/src/pipeline/store.ts`, `packages/api/src/pipeline/store-db.ts`, `packages/api/test/pipeline/fake-store.ts`
- Create: `packages/api/drizzle/0004_stock_images.sql` (generated) + snapshot

**Interfaces:**
- Produces:
  - pg enum `asset_origin('generated','stock')`; columns per spec §6 (`origin` not null default `generated`, `credit` jsonb null, `stock_query` text null, `prompt` text null, `rejected_stock_ids` jsonb not null default `'[]'`)
  - `NewAsset` += `origin?: 'generated'|'stock'`, `credit?: ImageCredit|null`, `stockQuery?: string|null`, `prompt?: string|null` (AI prompt of the slot; final `contentJson` no longer holds draft prompts, admin "KI-Bild" needs it)
  - `PipelineStore` +=
    - `getAsset(assetId: string): Promise<(NewAsset & { id: string; unitId: string; rejectedStockIds: string[] }) | null>`
    - `listAssets(unitId: string): Promise<(NewAsset & { id: string; rejectedStockIds: string[] })[]>`
    - `updateAsset(assetId: string, patch: { path: string; origin: 'generated'|'stock'; credit: ImageCredit|null; stockQuery: string|null; rejectedStockIds?: string[] }): Promise<void>`
  - `FakeStore` implements the same

- [ ] **Step 1:** Edit Drizzle schema; `pnpm db:generate` → rename output to `0004_stock_images.sql`; check SQL has the enum, 5 columns, defaults.
- [ ] **Step 2:** `docker compose -f docker-compose.dev.yml up -d && pnpm db:migrate` → applies cleanly on existing dev DB (old rows get `generated`, `[]`).
- [ ] **Step 3:** Extend `store.ts` interface, `store-db.ts` (`replaceAssets` persists new fields), `FakeStore`.
- [ ] **Step 4:** `pnpm --filter @wizzn/api test && pnpm --filter @wizzn/api typecheck` → PASS (existing tests untouched)
- [ ] **Step 5:** Commit `feat(api): asset origin and image credit columns`

---

### Task 7: `resolveImage`

**Files:**
- Create: `packages/api/src/pipeline/images.ts`
- Modify: `packages/api/src/pipeline/prompts.ts` (add `imagePickPrompt`)
- Test: `packages/api/test/pipeline/images.test.ts`

**Interfaces:**
- Consumes: `StockImageClient`, `stockKey` (Task 2), `ImageClient`, `MediaStore`, `LlmClient`, `imagePickSchema` (Task 1)
- Produces:
  ```ts
  export interface ImageDeps { stock: StockImageClient | null; images: ImageClient; media: MediaStore; llm: LlmClient; fetchFn?: typeof fetch; minEdgePx: number; maxBytes: number; log?: (m: string) => void }
  export interface ImageSlot { prompt: string; query?: string }
  export interface ResolvedImage { path: string; origin: 'stock'|'generated'; credit: ImageCredit|null; stockQuery: string|null; key: string|null }
  export function resolveImage(unitId: string, slot: ImageSlot, exclude: Set<string>, deps: ImageDeps, opts?: { skipPick?: boolean; forceGenerated?: boolean }): Promise<ResolvedImage>
  export function imagePickPrompt(prompt: string, candidates: { title: string; tags: string[] }[]): ChatMessage[]  // in prompts.ts
  ```
  On stock hit, `resolveImage` adds `key` to `exclude`.

- [ ] **Step 1: Write failing tests** (fake stock, fake LLM with scripted `chatJson`, fake `fetchFn`, in-memory media):
  - hit: LLM `{index:1}` → stored bytes of candidate 1, `origin:'stock'`, `credit` = candidate credit, `stockQuery` = `slot.query`, key added to `exclude`
  - `slot.query` missing → stock searched with `slot.prompt`
  - filter: candidates with short edge 600, `image/gif`, or key in `exclude` never shown to LLM (assert prompt candidate count)
  - LLM `{index:null}` → `images.generate(prompt)` called, `origin:'generated'`, `credit:null`, `stockQuery:null`
  - LLM throws → generated fallback
  - `stock: null` → generated, stock not called; `forceGenerated` → generated
  - `skipPick` → LLM not called, first filtered candidate used
  - download `content-type: text/html` → next candidate (Review Focus)
  - download without `content-length`, streamed body 6 MB with `maxBytes 5_000_000` → next candidate (Review Focus)
  - 3 failed downloads → generated fallback; 4th candidate not fetched
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- images` → FAIL
- [ ] **Step 3:** Implement. Pick prompt (German system line, candidates as `[i] title — tags`), asks for `{"index": number|null}` "null wenn keines passt". Read body via `res.body` reader, abort when over `maxBytes`. Extension via `extFor(mime)`.
- [ ] **Step 4:** Re-run → PASS
- [ ] **Step 5:** Commit `feat(api): resolve stock images with ai fallback`

---

### Task 8: Media step + draft prompts

**Files:**
- Modify: `packages/api/src/pipeline/steps.ts`, `packages/api/src/pipeline/prompts.ts`, `packages/api/src/worker.ts`, `packages/api/src/providers/media-store.ts` (`image/jpeg`→`jpg`, `image/webp`→`webp`)
- Test: `packages/api/test/pipeline/steps.test.ts`

**Interfaces:**
- Consumes: Task 7
- Produces: `PipelineDeps` += `stock: StockImageClient | null`, `stockConfig: { minEdgePx: number; maxBytes: number }`, `fetchFn?: typeof fetch`. `storeImage` removed.

- [ ] **Step 1: Write failing tests**
  - written unit, 3 slides with `imagePrompt` + `imageQuery`, stock fake returns the same top candidate for every query plus others → 3 assets, all `origin:'stock'`, 3 distinct `credit.providerId` (Review Focus); `imageId`s in content map to those assets
  - audio unit, stock disabled → images `origin:'generated'`, audio asset unchanged
  - stock search for slide 2 throws → slide 2 generated, unit reaches `in_review`
  - `draftWrittenPrompt` text contains `imageQuery`; `PROMPT_VERSION === '2026-10-10.1'`
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- steps` → FAIL
- [ ] **Step 3:** Implement: sequential `for…of` over slots with one `exclude` set; pass `origin/credit/stockQuery/prompt` to `replaceAssets`. Prompt additions: written JSON shape `"imagePrompt"?:string,"imageQuery"?:string`; audio images `{"prompt":string,"query":string,"atFraction":number}`; instruction "imageQuery/query: 2–4 englische Suchbegriffe für ein passendes Stockfoto (konkretes Motiv, keine Abstrakta)". Worker passes `providers.stock` and env stock config.
- [ ] **Step 4:** `pnpm --filter @wizzn/api test && pnpm --filter @wizzn/api typecheck` → PASS
- [ ] **Step 5:** Commit `feat(api): stock images in media step`

---

### Task 9: ImageRouter compatibility in `createApiImages`

**Files:**
- Modify: `packages/api/src/providers/image.ts`, `packages/api/src/providers/index.ts`
- Test: `packages/api/test/providers/providers.test.ts`

**Interfaces:**
- Produces: `createApiImages(cfg: { baseUrl; model; apiKey; ephemeral?: boolean; fetchFn? })`

- [ ] **Step 1: Write failing tests:** request body has `output_format:'png'`; `ephemeral:true` → `response_format:'b64_ephemeral'`, `false` → `'b64_json'`; response `data[0].b64_json` decoded in both cases.
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- providers` → FAIL
- [ ] **Step 3:** Implement; `index.ts` passes `env.IMAGE_EPHEMERAL`.
- [ ] **Step 4:** Re-run → PASS
- [ ] **Step 5: Live check** (needs `IMAGE_API_KEY` from Vaultwarden):
  ```bash
  curl -s https://api.imagerouter.io/v1/openai/images/generations -H "Authorization: Bearer $IMAGE_API_KEY" -H 'content-type: application/json' \
    -d '{"model":"black-forest-labs/FLUX-2-klein-4b","prompt":"a bowl of oatmeal with berries","response_format":"b64_ephemeral","output_format":"png","size":"1024x1024"}' | jq '.data[0] | keys'
  ```
  Expected: `["b64_json"]`. If not → set `IMAGE_EPHEMERAL` default `false`, note in commit body.
- [ ] **Step 6:** Commit `fix(api): imagerouter-compatible image generation`

---

### Task 10: Feed credits + admin image replace API

**Files:**
- Create: `packages/api/src/pipeline/replace-image.ts`
- Modify: `packages/api/src/feed-repo.ts`, `packages/api/src/admin-repo.ts`, `packages/api/src/types.ts`, `packages/api/src/routes/admin.ts`, `packages/api/src/app.ts`, `packages/api/src/server.ts`
- Test: `packages/api/test/feed.test.ts`, `packages/api/test/admin.test.ts`, `packages/api/test/pipeline/replace-image.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 6, 7
- Produces:
  ```ts
  export type ReplaceImageResult = { ok: true; asset: UnitDetailDto['assets'][number] } | { ok: false; error: 'not_found' | 'invalid_state' | 'no_stock_candidate' }
  export interface ImageReplacer { replace(unitId: string, assetId: string, mode: ReplaceImageMode): Promise<ReplaceImageResult> }
  export function createImageReplacer(deps: { store: PipelineStore; image: ImageDeps; mediaUrl: (p: string) => string }): ImageReplacer
  ```
  `AppDeps.admin` += `images?: ImageReplacer`. Route `POST /api/admin/units/:id/assets/:assetId/replace` (body `replaceImageSchema`) → 200 `asset` | 404 | 409 | 422 `{ error: 'no_stock_candidate' }` | 501 when `images` not configured.

- [ ] **Step 1: Write failing tests**
  - replace-image: unit not `in_review` → `invalid_state`; asset of other unit or `kind:'audio'` → `not_found`
  - `next-stock`: exclude contains all unit stock keys + `rejectedStockIds` + current key; `skipPick:true`; old key appended to `rejectedStockIds`; asset id unchanged; `query` = asset `stockQuery` ?? slot prompt
  - `next-stock` with stock returning only excluded items → `no_stock_candidate`, store unchanged
  - `generated`: uses `asset.prompt`; result `origin:'generated'`, `credit:null`; asset without `prompt` (pre-migration) → `generate(credit?.title ?? stockQuery)`; neither → `not_found`
  - admin route: 200 passes body through; 422 maps; non-admin → 403 (existing guard)
  - feed: unit with one stock asset (credit) and one generated asset → `credits` has only the stock asset id; unit with no credits → `credits: {}` (Review Focus)
- [ ] **Step 2:** `pnpm --filter @wizzn/api test -- replace-image admin feed` → FAIL
- [ ] **Step 3:** Implement `createImageReplacer`, admin DTO fields (`origin`, `credit`, `stockQuery`), feed `credits`, route; wire in `server.ts` with `createProviders(env)` (API process now needs stock/image/LLM env, already shared via `.env`).
- [ ] **Step 4:** Re-run → PASS; full `pnpm --filter @wizzn/api test` → PASS
- [ ] **Step 5:** Commit `feat(api): image credits in feed and admin image replace`

---

### Task 11: App — `ImageCredit` overlay

**Files:**
- Create: `packages/web/src/components/ImageCredit.vue`
- Modify: `packages/web/src/components/WrittenUnitView.vue`, `packages/web/src/components/AudioUnitView.vue`, `packages/web/src/utils/platformIcons.ts`

**Interfaces:**
- Consumes: `ImageCredit`, `formatLicense`, `FeedUnitDto.credits` (Task 1)
- Produces: `<ImageCredit :credit="unit.credits[imageId]" />` — renders nothing when `credit` undefined.

- [ ] **Step 1:** Add `image_credit` to `ICON_MAP`.
- [ ] **Step 2:** Implement component per spec §9 (stop `click`, `pointerdown`, `touchstart` propagation; links via the same open-external helper `SourceFooter.vue` uses).
- [ ] **Step 3:** Mount in both views inside the image container (`position: relative`); set `alt` from `credit.title`.
- [ ] **Step 4:** `pnpm --filter @wizzn/web typecheck` → clean
- [ ] **Step 5: Manual:** `pnpm --filter @wizzn/web dev` against a dev API with one stock unit and one old unit: ⓘ visible only on stock images; tap opens sheet (bottom on iOS sim, centered on Android emulator) and does not advance the slide; links open externally; old unit shows no ⓘ.
- [ ] **Step 6:** Commit `feat(web): image credit overlay`

---

### Task 12: Admin — credit badge + swap buttons

**Files:**
- Modify: `packages/admin/src/components/UnitPreview.vue`, `packages/admin/src/pages/UnitDetailPage.vue`, `packages/admin/src/api.ts`

**Interfaces:**
- Consumes: `UnitDetailDto.assets[].origin/credit`, replace route (Task 10)
- Produces: `api.replaceImage(unitId: string, assetId: string, mode: ReplaceImageMode): Promise<UnitDetailDto['assets'][number]>`

- [ ] **Step 1:** `UnitPreview` prop `assets: UnitDetailDto['assets']` (replaces `assetUrls`; derive URL map inside). Badge + tooltip per spec §10.
- [ ] **Step 2:** `UnitDetailPage`: buttons per image when `status === 'in_review'`, loading state per asset, refresh unit on success, `Notify` on 422 with fixed copy.
- [ ] **Step 3:** `pnpm --filter @wizzn/admin typecheck` → clean
- [ ] **Step 4: Manual:** swap twice on one image → two different stock images, never back to the first; "KI-Bild" → `KI` badge; buttons hidden after approve.
- [ ] **Step 5:** Commit `feat(admin): image credits and swap actions`

---

### Task 13: End-to-end verification + docs

**Files:**
- Modify: `README.md` (Content pipeline section: stock env vars, ImageRouter), `docs/superpowers/specs/2026-10-10-stock-images-design.md` (only if implementation deviated)

- [ ] **Step 1:** `.env`: `STOCK_IMAGE_PROVIDERS=openverse,commons`, `STOCK_USER_AGENT=wizzn/1.0 (…)`, ImageRouter vars. Run api + worker + admin; create 1 written + 1 audio brief (nutrition).
- [ ] **Step 2:** Expected: both reach `in_review`; DB `select origin, credit->>'provider', credit->>'license' from asset where kind='image'` shows ≥ 1 stock row; no license outside whitelist.
- [ ] **Step 3:** Set `STOCK_IMAGE_PROVIDERS=` → new brief gets only `generated` images.
- [ ] **Step 4:** `pnpm typecheck && pnpm test` → all green.
- [ ] **Step 5:** Commit `docs: stock image configuration`; open PR "feat: CC-licensed stock images (#3)", body `Closes #3`.
