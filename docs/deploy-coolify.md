# Deploying wizzn on Coolify

Stack: `api` (Hono, :3000) · `worker` · `admin` (SPA, nginx :80) · `media` (nginx :80, serves the `media` volume) · `postgres` · `searxng`.
Migrations + idempotent seed run on every `api` start.

## Automated (in the repo)
- `docker-compose.yml` is Coolify-ready: no `.env.api` file needed, every setting is a `${VAR}` Coolify can manage, required vars fail fast (`:?`), worker healthcheck disabled (it has no HTTP port), SearXNG secret from env.
- `pnpm coolify:env -- --domain <base-domain>` → `setup-out/coolify.env` (gitignored): deleted and rebuilt on every run from the root `.env`, with keys set in `.env.production` (gitignored) taking priority, derives URLs + CORS, warns about dev-only values and `.env` keys it doesn't copy. `POSTGRES_PASSWORD` / `BETTER_AUTH_SECRET` / `SEARXNG_SECRET` are generated once and carried over on reruns; `--fresh-secrets` regenerates them (breaks an existing DB volume + logs everyone out).

## Checklist

### Before
- [ ] Decide domains (default: `api.`, `admin.`, `media.<base-domain>`) and add DNS A/AAAA records → netcup VPS IP
- [ ] Hosted LLM: OpenAI-compatible endpoint for `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` (Ollama on the Mac is unreachable from the VPS)
- [ ] TTS: prod defaults to `silent`. For audio, host Piper/Chatterbox reachable from the VPS and set `TTS_PROVIDER` + `TTS_URL`
- [ ] Set `ADMIN_EMAILS` in the root `.env`
- [ ] Commit + push (Coolify builds from git)

### Coolify
- [ ] Server: netcup VPS added and validated; ≥ 4 GB RAM recommended (builds of api + admin)
- [ ] New Resource → Application → (private) GitHub repo, branch `main`, **Build Pack: Docker Compose**, compose file `/docker-compose.yml`
- [ ] Run `pnpm coolify:env -- --domain <base-domain>`; fix any ⚠ lines; paste `setup-out/coolify.env` into Environment Variables → Developer view
- [ ] Mark `API_PUBLIC_URL` as available at **build time** (baked into the admin SPA)
- [ ] Domains per service: `api` → `https://api.<d>:3000`, `admin` → `https://admin.<d>`, `media` → `https://media.<d>`; leave worker/postgres/searxng without domain
- [ ] Deploy; watch the `api` log for migrate → seed → listening

### After
- [ ] `curl https://api.<d>/health` returns OK
- [ ] Sign in to `https://admin.<d>` with an `ADMIN_EMAILS` account; generate one unit end to end (worker log, images/audio on `media.<d>`)
- [ ] Postgres backups: Coolify → postgres → Scheduled Backups (S3 target), or `pg_dump` cron; back up the `media` volume (restic)
- [ ] OAuth consoles: add `https://api.<d>` callback/origin URLs (Google, Apple Services ID) — see `docs/setup-consoles.md`
- [ ] RevenueCat webhook → `https://api.<d>/api/webhooks/revenuecat` with the `REVENUECAT_WEBHOOK_AUTH` header value
- [ ] Mobile builds: `API_URL=https://api.<d>` in the root `.env` before `cap sync` / store builds
- [ ] Enable auto-deploy on push (Coolify GitHub App / webhook)
- [ ] Calendar: `APPLE_CLIENT_SECRET` expires 6 months after `pnpm setup:apple:secret`
