# wizzn
du dumm. jetzt wizzn. dann schlau

Knowledge swipe feed for iOS/Android. Spec: `docs/superpowers/specs/2026-10-09-wizzn-design.md`.

## Local dev
```bash
corepack enable
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.template .env      # single env file for everything
pnpm db:generate && pnpm db:migrate && pnpm db:seed
ollama pull qwen3:8b        # dev LLM (or LLM_PROVIDER=gemini-cli, see below)
pnpm dev                    # api on :3000
pnpm dev:worker             # job worker
pnpm test
```

### Root scripts
| Command | What it does |
|---|---|
| `pnpm dev:all` | Full stack via `scripts/dev.sh`: Docker infra, TTS server (if `TTS_PROVIDER=piper\|chatterbox\|qwen`), migrate + seed + samples, Ollama, api, worker, admin, web. Ctrl+C stops processes; Docker keeps running. |
| `pnpm dev:all:android --no-seed` | Same, but the app runs on Android emulator/device (Android Studio) instead of the browser. --no-seed will not seed. Is faster if you don't need it. |
| `./scripts/dev.sh --fresh` | Force `pnpm install` + `db:generate` (combinable with `--android`). |
| `pnpm dev` / `dev:worker` | API on :3000 / job worker |
| `pnpm dev:web` | Web app (browser) |
| `pnpm dev:admin` | Admin on :9100 |
| `pnpm build` / `build:shared` | Build all packages / only `@wizzn/shared` |
| `pnpm test` / `typecheck` | Tests / typecheck across workspace |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:seed:samples` | Drizzle migrations + seeds (see below) |
| `pnpm setup:google` / `setup:apple` / `setup:apple:secret` / `setup:openverse` | Console/OAuth setup; `setup:apple:secret` generates `APPLE_CLIENT_SECRET` (ES256 JWT, valid 6 months — re-run before expiry) |
| `pnpm creds:pull` / `creds:push` / `creds:diff` | Wrappers for `./creds.sh` (see Credentials) |
| `pnpm tts:server` / `tts:voice` / `tts:entry` | Local TTS server (chatterbox\|qwen), Qwen designed-voice export, render one unit/text for listening — see [docs/tts.md](docs/tts.md) |
| `pnpm verify:m4` | Walks through M4 close-out: checks, API smoke test, browser/device checklists. Steps: `all\|auto\|db\|smoke\|browser\|device\|commit` |
| `pnpm coolify:env` / `coolify:push-delta` / `coolify:push-data` | Coolify env file / push local content + media to prod (see Deploy) |
| `pnpm devpack:load` / `devpack:build` | Load 100 prod units + media into the local DB / build a new pack from prod — see [docs/ops/media-storage.md](docs/ops/media-storage.md) |
| `pnpm storage:check` / `storage:migrate` | Verify the Garage bucket / copy the old prod media volume into it |

## Seed data & media
- `pnpm db:seed` — fields + themes from `packages/shared/src/fields.ts` (`FIELD_SEEDS`). Idempotent; also runs on container start.
- `pnpm db:seed:samples` — dev-only sample units from `packages/api/src/db/samples/<field>.json` — every topic as **both** a written and an audio unit (missing format derived: audio script split into slides, written slides expanded to a script via the configured LLM). Needs `db:seed` first; skips existing samples (topic + format). `scripts/dev.sh` runs both.
- Generated images/audio → `packages/api/media-data/<unitId>/<hash>.<ext>` (`MEDIA_DIR`, relative to `packages/api`). Served in dev by nginx at http://localhost:8081 (`docker-compose.dev.yml`).
- Prod: `MEDIA_DRIVER=s3` → Garage bucket on Coolify, nightly backup to Google Drive: [docs/ops/media-storage.md](docs/ops/media-storage.md).
- Realistic local data: `pnpm devpack:load` (100 prod units + media).
- Full reset: empty the DB **and** `packages/api/media-data/`.

### Reset the dev DB
No script yet; run from repo root. Media files in `packages/api/media-data` are not touched — delete them too for a fully clean state.
```bash
# Option A: empty the DB, keep the container
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U wizzn -d wizzn -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'

# Option B: recreate the volume (check name: docker volume ls | grep pgdata)
docker compose -f docker-compose.dev.yml rm -sf postgres
docker volume rm "$(basename "$PWD")_pgdata-dev"
docker compose -f docker-compose.dev.yml up -d postgres

# then
pnpm db:migrate && pnpm db:seed && pnpm db:seed:samples
```

## Content pipeline (local)
```bash
ollama serve & ollama pull qwen3:8b
# .env: ADMIN_EMAILS=you@example.com
pnpm dev            # api :3000
pnpm dev:worker     # pipeline worker
pnpm dev:admin      # admin http://localhost:9100 → "Konto anlegen" with an ADMIN_EMAILS address
```
LLM alternative: `npm i -g @google/gemini-cli`, run `gemini` once to log in, then `.env`: `LLM_PROVIDER=gemini-cli`, `LLM_MODEL=gemini-2.5-flash` (empty = CLI default). All LLM steps go through it; no Ollama needed.

LLM via Requesty router: `.env`: `LLM_PROVIDER=requesty`, `REQUESTY_API_KEY=…`, `LLM_MODEL=google/gemini-2.5-flash` (any Requesty `provider/model`). Same key enables `TTS_PROVIDER=requesty` (see [docs/tts.md](docs/tts.md)).
Check the LLM setup: `pnpm llm:check [topic]` prints the active backend and a mini sample unit (no DB writes).
Defaults: `TTS_PROVIDER=silent` (silent WAV of realistic length; natural German: `chatterbox` or `qwen`, see [docs/tts.md](docs/tts.md)), `IMAGE_PROVIDER=placeholder` (SVG).

### Audio (TTS) debugging

Every render is loudness-normalized to −16 LUFS / −1.5 dBTP (ffmpeg two-pass `loudnorm` in `packages/api/src/providers/transcode.ts`) before it's stored as MP3, since TTS engines output very quiet audio (~−40 LUFS).

To re-run only the audio step for one unit and inspect the files locally (DB untouched):

```bash
pnpm tts:entry <unitId> [outDir]                         # script from the unit's content_json
pnpm tts:entry --text "Some script…"                     # ad-hoc text
# add --fit to apply the pipeline's 3–5 min duration fitting (default: single render)
# add --provider <name> --url <…/synthesize> to A/B engines (docs/tts.md)
```

Writes `<outDir>/<id>.raw.wav` (straight from the TTS provider) and `<id>.mp3` (what the pipeline stores) to `./tts-debug/` by default and prints the loudness (LUFS / peak) of both. Uses the `TTS_*` settings from `.env`.

Re-render the audio of existing units (current TTS settings + normalization; updates asset, duration and image timings, deletes the old file):

```bash
pnpm audio:rerender                     # all audio units
pnpm audio:rerender -- <unitId> …       # only these
pnpm audio:rerender -- --dry-run        # list only
```

### Where the prompts live
- Content creation (written + audio drafts, editorial styles, story arcs, fact check, stock pick): `packages/api/src/pipeline/prompts.ts` — `draftWrittenPrompt`, `draftAudioPrompt`, `STYLE_GUIDE`, `ARC_GUIDE`, `checkPrompt`, `imagePickPrompt`. Bump `PROMPT_VERSION` when changing them.
- AI image style per category: `packages/api/src/providers/image.ts` — `IMAGE_STYLES` (keyed by field slug, e.g. `finance`, `sports`) + shared `IMAGE_BASE`; unknown fields use `DEFAULT_STYLE`.
- Output schemas / word limits: `packages/shared/src/pipeline.ts`.

### Stock images (CC-licensed)
Units get Openverse / Wikimedia Commons images first; the AI image provider is the fallback. Set in `.env` (see `.env.api.template`):
- `STOCK_IMAGE_PROVIDERS=openverse,commons` — order; empty disables stock.
- `STOCK_USER_AGENT` — required when `commons` is enabled (startup error otherwise), e.g. `wizzn/1.0 (https://wizzn.app; ops@wizzn.app)`.
- `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` — optional OAuth for higher Openverse quota. Register via `pnpm setup:openverse` (set `OPENVERSE_EMAIL` first, then click the verification email).
- `STOCK_MIN_EDGE_PX` (800) / `STOCK_MAX_BYTES` (5000000) — minimum shorter edge and max download size.

### Knowledge sources (issue #4)

Research queries reputable tiers first: 1 curated authorities per field (`packages/api/src/pipeline/source-registry.ts`), 2 German Wikipedia, 3 Europe PMC reviews (nutrition, sports, psychology), 4 open web (fallback only).
 
- `RESEARCH_PROVIDERS=curated,wikipedia,europepmc,web` — enabled providers; tier decides the order. Drop `web` to disable the open-web fallback.
- `RESEARCH_MIN_SOURCES` (2) — fewer usable tier 1–3 sources trigger the web fallback.
- `STOCK_USER_AGENT` — also required when `wikipedia` is enabled (Wikimedia API policy).

AI fallback via ImageRouter: `IMAGE_PROVIDER=api`, `IMAGE_BASE_URL=https://api.imagerouter.io/v1/openai`, `IMAGE_MODEL=black-forest-labs/FLUX-2-klein-4b`, `IMAGE_API_KEY`. `IMAGE_EPHEMERAL=true` (default) sends `b64_ephemeral` so ImageRouter keeps no copy for 30 days.

## Streaks, premium & sign-in (M4)
Rules live in `packages/shared/src/gamification.ts` (XP, levels, streak freezes, weekly goal, badges, daily cap).
```bash
# .env — see .env.template (FREE_DAILY_CAP, REVENUECAT_*, APPLE_*, GOOGLE_*)
(cd packages/web/src-capacitor && pnpm install --ignore-workspace)   # native plugins: RevenueCat, social login (synced by quasar dev)
cd packages/web && REVENUECAT_IOS_KEY=appl_... GOOGLE_WEB_CLIENT_ID=... GOOGLE_IOS_CLIENT_ID=... API_URL=http://<Mac-LAN-IP>:3000 pnpm dev:ios
```
- Purchases and Apple/Google sign-in only work in the native app; the browser shows the paywall and profile without them.
- RevenueCat: entitlement id `premium`, app user id = wizzn user id, webhook → `https://<api>/api/webhooks/revenuecat`.
- Test the cap quickly with `FREE_DAILY_CAP=1`.

## Credentials (Vaultwarden)
`./creds.sh` syncs `.env` with the Vaultwarden folder `app.fourki.wizzn` and key files (`secrets/*`, `setup-out/fcm-sender.json`, `google-services.json`) with `app.fourki.wizzn/files`. Needs `brew install bitwarden-cli jq`.
```bash
cp .creds.config.template .creds.config   # server + user, once
cp .env.template .env && ./creds.sh pull  # fresh checkout (pull merges into the template, keeps comments)
./creds.sh diff                           # what differs (key names only)
./creds.sh push                           # after changing .env or keys
```
Pull backs up overwritten files to `~/.config/wizzn-creds/backups`. Push never deletes vault entries.

## Deploy
Coolify → Docker Compose resource → `docker-compose.yml`. Container start runs migrations + seed.
Details: [docs/deploy-coolify.md](docs/deploy-coolify.md).

### Push local content to prod
Runs on the Mac over SSH (key passphrase asked once). Needs the local dev Postgres running and the Coolify app UUID (containers are `<service>-<uuid>`). Prod Postgres is a separate Coolify resource: pass `PG_CONTAINER=<db-resource-uuid>` (optional if it's the only `postgres:*` container on the VPS).

```bash
# Delta: insert-only, adds what prod doesn't have yet
pnpm coolify:push-delta -- root@<vps> <uuid> --dry-run                       # all published units: show what would change
pnpm coolify:push-delta -- root@<vps> <uuid> --units ~/Downloads/wizzn-push-<date>.txt   # only the exported selection
pnpm coolify:push-delta -- root@<vps> <uuid>

# Full overwrite: replaces prod DB (incl. users) + media; backs up prod DB to ~ on the VPS first
pnpm coolify:push-data -- root@<vps> <uuid>
```
- SSH user needs Docker access without root (one-time, as root on the VPS: `usermod -aG docker <user>`, then log in again).
- Optional `SSH_KEY=~/.ssh/<key>` if the key isn't in `~/.ssh/config` / agent.
- Delta pushes **published** units only: all of them, or with `--units <file>` exactly the listed ones. Create the file in the Redaktion: select rows → **Push-Liste exportieren** (one unit per line, id first; delete lines to narrow it down). Listed units that aren't published are skipped with a warning. A published written/audio pair partner that is neither in the list nor on prod is reported, not added.
- Delta sends the units' rows (`content_brief`, `unit`, `source`, `asset`, `check_report`, `unit_link` where both ends are on prod) plus `field`/`theme`, matched by slug. Users, auth, progress untouched. Links to units that only exist on prod: run `pnpm links:backfill` there.
- Delta uploads only media referenced by the pushed units, verifies them, then merges the rows; a failed upload leaves the prod DB untouched.
- Delta never updates or deletes: locally edited existing units and locally deleted media stay as they are on prod.
- Delta aborts when local and prod are on different migrations.
- Media target = what the prod api runs (`MEDIA_DRIVER` read from the container): `s3` → Garage bucket via `rclone` (`brew install rclone`), otherwise the Docker volume. `MEDIA_TARGET=s3|volume` overrides. S3 endpoint + keys come from `.env.production`, or another file via `ENV_PROD=<file>`.

## Store / console setup
Google + Apple resources: see `docs/setup-consoles.md` (`pnpm setup:google`, `pnpm setup:apple`).

## Android
`pnpm --filter @wizzn/web dev:android` / `build:android` / `cap:sync` run through `scripts/with-jdk21.sh`, which picks a JDK 21 automatically (Android Studio JBR or any installed 21; override with `WIZZN_JAVA_HOME`). Gradle 8.11 (Capacitor 7) fails on newer JDKs with "Unsupported class file major version". In Android Studio keep *Settings → Build Tools → Gradle → Gradle JDK* on the bundled JBR 21.
