# CC-licensed stock images — Design Spec

Status: draft for review · Date: 2026-10-10 · Issue: [#3](https://github.com/prj120/wizzn/issues/3)

## 1. Goal

Enrich units with CC-licensed stock images from Openverse and Wikimedia Commons, fetched automatically during unit generation. AI images become the fallback.

| Decision | Choice |
|---|---|
| Role of stock | Stock first, AI fallback per image slot |
| Formats | Written (slide images) + audio (timed images) |
| Allowed licenses | CC0, PDM, CC BY, CC BY-SA (any version). No NC (paywall = commercial), no ND |
| Provider order | Openverse → Wikimedia Commons → `ImageClient` (AI) |
| Storage | Download into `MediaStore`; no hotlinking |
| Attribution in app | ⓘ overlay on image → sheet with title, creator, license, source (TASL) |
| Admin control | Credit badge per image; swap to next stock image or AI image while `in_review` |
| AI provider | ImageRouter, `black-forest-labs/FLUX-2-klein-4b` via existing `IMAGE_PROVIDER=api` |

## 2. Architecture

```
media step ──► resolveImage(slot) ──► StockImageChain ──► Openverse ──┐
                    │                       │            └► Commons ──┤ candidates
                    │                       ▼                         │
                    │                 filter + LLM pick ◄─────────────┘
                    │                       │ hit                │ miss / error
                    ▼                       ▼                    ▼
               MediaStore.put ◄──── download (≤ 5 MB)      ImageClient.generate
                    │
                    ▼
        asset { path, origin, credit, stockQuery }
```

### New modules (`packages/api/src`)
| File | Purpose |
|---|---|
| `providers/stock-images/types.ts` | `StockImageClient`, `StockCandidate`, `StockSearchError` |
| `providers/stock-images/license.ts` | Normalise license codes/strings → `cc0 \| pdm \| by \| by-sa` + version + canonical URL; whitelist check |
| `providers/stock-images/openverse.ts` | Openverse adapter, optional OAuth client-credentials token (cached until expiry) |
| `providers/stock-images/commons.ts` | Commons adapter, `extmetadata` parsing, HTML stripping |
| `providers/stock-images/chain.ts` | Ordered fallback across adapters; errors/429/timeout → next adapter |
| `pipeline/images.ts` | `resolveImage`: chain → filter → LLM pick → download → store; AI fallback |

### Interfaces
```ts
interface StockCandidate {
  provider: 'openverse' | 'commons'
  providerId: string          // Openverse UUID / Commons page title
  title: string
  tags: string[]
  imageUrl: string            // downloadable URL (Commons: 1080 px thumb)
  width: number
  height: number
  mime: string
  credit: ImageCredit
}
interface StockImageClient { search(query: string, opts?: { limit?: number }): Promise<StockCandidate[]> }

interface ResolvedImage { path: string; origin: 'stock' | 'generated'; credit: ImageCredit | null; stockQuery: string | null }
resolveImage(slot: { prompt: string; query?: string }, exclude: Set<string>, deps, opts?: { skipPick?: boolean; forceGenerated?: boolean }): Promise<ResolvedImage>
```

## 3. Providers

### Openverse
- `GET https://api.openverse.org/v1/images/?q={query}&license=cc0,pdm,by,by-sa&mature=false&page_size=20`
- Auth: optional. `OPENVERSE_CLIENT_ID` + `OPENVERSE_CLIENT_SECRET` → `POST /v1/auth_tokens/token/` (client_credentials). Anonymous otherwise. Reason: anonymous quota is too small for batch generation.
- Mapping: `id → providerId`, `url → imageUrl`, `creator`, `creator_url`, `license`, `license_version`, `license_url`, `foreign_landing_url → sourceUrl`, `source → credit.provider` suffix (e.g. `openverse/flickr`).

### Wikimedia Commons
- `GET https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch={query} filetype:bitmap&gsrlimit=20&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1080`
- Header `User-Agent: ${STOCK_USER_AGENT}` (Wikimedia policy; required).
- Mapping: `thumburl → imageUrl`, `descriptionurl → sourceUrl`, `extmetadata.ObjectName → title`, `Artist` (HTML stripped) → `creator`, `LicenseShortName`/`License` → license, `LicenseUrl`.
- Drops entries whose license is not whitelisted or `AttributionRequired=true` with empty `Artist`.

### Chain
- Order from `STOCK_IMAGE_PROVIDERS` (csv, default `openverse,commons`; empty = stock disabled).
- Per adapter: 10 s timeout (`AbortSignal.timeout`). Any error, non-2xx or 0 usable results → next adapter. Errors are logged with provider + status, never thrown to the step.
- Returns the first non-empty candidate list.

## 4. Selection (`resolveImage`)

1. `query = slot.query ?? slot.prompt`. If stock disabled or `forceGenerated` → step 6.
2. Chain search.
3. Filter: license whitelisted; `min(width,height) ≥ 800` (Commons thumb: original ≥ 800); mime ∈ jpeg/png/webp; `provider:providerId ∉ exclude`.
4. Pick: top 8 → LLM `imagePickPrompt(prompt, candidates)` → `imagePickSchema = { index: number | null }`. `null` → step 6. `skipPick` (admin "next") → first candidate.
5. Download: `GET imageUrl`, reject content-type mismatch or > 5 MB (`content-length` and streamed byte count) → try next candidate (max 3 attempts), then step 6. Store via `media.put(unitId, bytes, extFor(mime))`. Add id to `exclude`.
6. Fallback: `images.generate(prompt)` → `{ origin: 'generated', credit: null }`.

- Media step resolves slots **sequentially** (shared `exclude` set; gentle on rate limits).
- Only AI fallback errors fail the unit (unchanged behaviour).

## 5. Draft changes (`packages/shared/src/pipeline.ts`, `prompts.ts`)

| Schema | Added field |
|---|---|
| `draftWrittenSchema.slides[]` | `imageQuery?: string` (2–40 chars, English) |
| `draftAudioSchema.images[]` | `query?: string` (2–40 chars, English) |

- Optional → existing drafts stay valid; missing query falls back to the German prompt.
- Prompt text: "imageQuery: 2–4 englische Suchbegriffe für ein passendes Stockfoto (konkretes Motiv, keine Abstrakta)".
- `PROMPT_VERSION` → `2026-10-10.1`.

## 6. Data model (migration `0004_stock_images`)

| Table.column | Type | Notes |
|---|---|---|
| `asset.origin` | enum `asset_origin` (`generated`, `stock`) | not null, default `generated` |
| `asset.credit` | jsonb | null for generated; validated by `imageCreditSchema` |
| `asset.stock_query` | text | query actually searched (`slot.query ?? slot.prompt`); reused by admin swap |
| `asset.prompt` | text | AI prompt of the slot; needed for admin "KI-Bild" (final `contentJson` drops draft prompts) |
| `asset.rejected_stock_ids` | jsonb `string[]` | not null, default `[]`; ids replaced by admin swaps |

```ts
// packages/shared/src/content.ts
imageCreditSchema = z.object({
  title: z.string(),
  creator: z.string().nullable(),
  creatorUrl: z.string().url().nullable(),
  license: z.enum(['cc0', 'pdm', 'by', 'by-sa']),
  licenseVersion: z.string().nullable(),
  licenseUrl: z.string().url(),
  sourceUrl: z.string().url(),
  provider: z.string(),        // 'openverse/flickr', 'commons'
  providerId: z.string(),
})
```

- `NewAsset` (pipeline store) gains `origin`, `credit`, `stockQuery`, `prompt`.
- New store method `updateAsset(assetId, patch)` for swaps. Asset id stays stable → `contentJson.imageId` untouched.

## 7. API

### Feed
- `FeedUnitDto.credits: Record<assetId, ImageCredit>` — stock assets only.
- `feed-repo.loadUnits` fills it from `asset.credit`.

### Admin
- `AdminUnitDto.assets[]` gains `origin`, `credit`, `stockQuery`.
- `POST /api/admin/units/:id/assets/:assetId/replace` body `{ mode: 'next-stock' | 'generated' }`
  - 409 unless unit `in_review`; 404 unless asset is an image of the unit.
  - `next-stock`: exclude = all stock ids used in the unit + `rejected_stock_ids` + current id; `skipPick: true`, via stock-only helper `resolveStockImage` (never generates). Old id appended to `rejected_stock_ids`. No hit → 422 `no_stock_candidate` (asset unchanged).
  - `generated`: `forceGenerated` with `asset.prompt`.
  - Synchronous (few seconds); returns updated asset DTO.
- Reason for sync over a job: single admin action, immediate feedback, no new queue.

## 8. AI provider (ImageRouter)

| Env | Value |
|---|---|
| `IMAGE_PROVIDER` | `api` |
| `IMAGE_BASE_URL` | `https://api.imagerouter.io/v1/openai` |
| `IMAGE_MODEL` | `black-forest-labs/FLUX-2-klein-4b` |
| `IMAGE_API_KEY` | ImageRouter key (Vaultwarden) |

`createApiImages` changes:
- Send `output_format: 'png'` (ImageRouter default is webp; current code labels bytes `image/png`).
- Send `response_format: 'b64_ephemeral'` when `IMAGE_EPHEMERAL=true` (default `true`) — no 30-day retention at ImageRouter; parse `b64_json` as before. Verify with one real call during implementation; fall back to `b64_json` if unsupported.
- Drop `n: 1` only if ImageRouter rejects it.

## 9. Mobile app (`packages/web`)

- `components/ImageCredit.vue`: props `credit: ImageCredit`. 24 px round ⓘ button, bottom-right, semi-transparent dark background. `@click.stop` + `@touchstart.stop` / `@pointerdown.stop` so slide swipe/tap handlers do not fire.
- Sheet: `q-dialog` with `:position="isIos ? 'bottom' : 'standard'"`. Rows: title; "von {creator}" (link if `creatorUrl`); license label (`CC BY-SA 4.0`, `CC0 1.0`, `Gemeinfrei`) linked to `licenseUrl`; "Quelle ansehen" → `sourceUrl`. External links open in system browser (existing link-out mechanism of the sources slide).
- `ICON_MAP.image_credit = { android: 'info', ios: 'ion-ios-information-circle-outline' }`.
- Used in `WrittenUnitView.vue` (slide image) and `AudioUnitView.vue` (frame), only when `unit.credits[imageId]` exists.
- `alt` = `credit.title` for stock images.
- License label helper `formatLicense(credit)` in `packages/shared` (used by app + admin).

## 10. Admin app (`packages/admin`)

- `UnitPreview.vue`: badge per image — `Stock · {provider} · {license}` or `KI`; tooltip with creator + source link.
- `UnitDetailPage.vue` (status `in_review`): per image buttons "Nächstes Stockbild" and "KI-Bild" → replace endpoint → refresh unit. 422 → notify "Kein weiteres Stockbild gefunden".

## 11. Config

| Env | Default | Purpose |
|---|---|---|
| `STOCK_IMAGE_PROVIDERS` | `openverse,commons` | Order; empty disables stock |
| `STOCK_USER_AGENT` | — | Required when `commons` enabled, e.g. `wizzn/1.0 (https://wizzn.app; ops@…)` |
| `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` | `''` | Optional OAuth for higher quota |
| `STOCK_MIN_EDGE_PX` | `800` | Minimum short edge |
| `STOCK_MAX_BYTES` | `5000000` | Download cap |
| `IMAGE_EPHEMERAL` | `true` | ImageRouter `b64_ephemeral` |

Env validation: `commons` in providers without `STOCK_USER_AGENT` → startup error. Added to `.env.api.template` (the env template in this repo).

## 12. Error handling

| Failure | Behaviour |
|---|---|
| Provider timeout / 4xx / 5xx / 429 | Log, next provider |
| No candidates / LLM pick `null` | AI fallback |
| LLM pick returns invalid JSON | AI fallback (logged) |
| Download too large / wrong type / HTTP error | Next candidate (≤ 3), then AI fallback |
| AI fallback fails | Unit → `failed` (unchanged) |
| Admin swap, no candidate | 422, asset unchanged |

## 13. Testing

| Area | Tests (vitest) |
|---|---|
| `license.ts` | Openverse codes, Commons strings (`CC BY-SA 4.0`, `CC0`, `Public domain`, `CC BY-NC 2.0` rejected) |
| `openverse.ts` | Fixture mapping, query params, token fetch + cache, non-2xx → `StockSearchError` |
| `commons.ts` | Fixture mapping, HTML stripping in `Artist`, non-whitelisted dropped, User-Agent header |
| `chain.ts` | Order, error → next, empty → next, all fail → `[]` |
| `images.ts` | Hit → stock asset; `null` pick → AI; oversize → next candidate; exclude respected; stock disabled → AI |
| `steps.test.ts` | Written + audio media step store `origin`/`credit`; sequential exclude across slots |
| `admin.test.ts` | Replace: 409 status guard, 404 foreign asset, `next-stock` excludes rejected ids, 422 on none, `generated` mode |
| `feed.test.ts` | `credits` contains only stock assets |
| `env.test.ts` | Commons without user agent → error |
| Web / admin | `vue-tsc`; manual check on iOS sim + Android emulator (ⓘ tap does not swipe) |

## 14. Out of scope

- Backfilling published units (possible later as a one-off script using `resolveImage`).
- `seed-samples.ts` (stays offline, generated images).
- Image resizing/transcoding (Commons thumbs at 1080 px; Openverse > 5 MB skipped).
- Candidate gallery in admin.
- Vision-based relevance scoring.
