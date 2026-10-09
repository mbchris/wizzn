# wizzn
du dumm. jetzt wizzn. dann schlau

Knowledge swipe feed for iOS/Android. Spec: `docs/superpowers/specs/2026-10-09-wizzn-design.md`.

## Local dev
```bash
corepack enable
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.api.template packages/api/.env
pnpm db:generate && pnpm db:migrate && pnpm db:seed
ollama pull qwen3:8b        # dev LLM
pnpm dev                    # api on :3000
pnpm dev:worker             # job worker
pnpm test
```

## Content pipeline (local)
```bash
ollama serve & ollama pull qwen3:8b
# packages/api/.env: ADMIN_EMAILS=you@example.com
pnpm dev            # api :3000
pnpm dev:worker     # pipeline worker
pnpm dev:admin      # admin http://localhost:9100 → "Konto anlegen" with an ADMIN_EMAILS address
```
Defaults: `TTS_PROVIDER=silent` (silent WAV of realistic length), `IMAGE_PROVIDER=placeholder` (SVG).

## Streaks, premium & sign-in (M4)
Rules live in `packages/shared/src/gamification.ts` (XP, levels, streak freezes, weekly goal, badges, daily cap).
```bash
# packages/api/.env — see .env.api.template (FREE_DAILY_CAP, REVENUECAT_*, APPLE_*, GOOGLE_*)
(cd packages/web/src-capacitor && pnpm install --ignore-workspace)   # native plugins: RevenueCat, social login (synced by quasar dev)
cd packages/web && REVENUECAT_IOS_KEY=appl_... GOOGLE_WEB_CLIENT_ID=... GOOGLE_IOS_CLIENT_ID=... API_URL=http://<Mac-LAN-IP>:3000 pnpm dev:ios
```
- Purchases and Apple/Google sign-in only work in the native app; the browser shows the paywall and profile without them.
- RevenueCat: entitlement id `premium`, app user id = wizzn user id, webhook → `https://<api>/api/webhooks/revenuecat`.
- Test the cap quickly with `FREE_DAILY_CAP=1`.

## Deploy
Coolify → Docker Compose resource → `docker-compose.yml`. Container start runs migrations + seed.

## Store / console setup
Google + Apple resources: see `docs/setup-consoles.md` (`pnpm setup:google`, `pnpm setup:apple`).
