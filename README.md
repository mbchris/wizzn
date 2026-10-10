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
ollama pull qwen3:8b        # dev LLM
pnpm dev                    # api on :3000
pnpm dev:worker             # job worker
pnpm test
```

## Content pipeline (local)
```bash
ollama serve & ollama pull qwen3:8b
# .env: ADMIN_EMAILS=you@example.com
pnpm dev            # api :3000
pnpm dev:worker     # pipeline worker
pnpm dev:admin      # admin http://localhost:9100 → "Konto anlegen" with an ADMIN_EMAILS address
```
Defaults: `TTS_PROVIDER=silent` (silent WAV of realistic length), `IMAGE_PROVIDER=placeholder` (SVG).

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

## Store / console setup
Google + Apple resources: see `docs/setup-consoles.md` (`pnpm setup:google`, `pnpm setup:apple`).

## Android
`pnpm --filter @wizzn/web dev:android` / `build:android` / `cap:sync` run through `scripts/with-jdk21.sh`, which picks a JDK 21 automatically (Android Studio JBR or any installed 21; override with `WIZZN_JAVA_HOME`). Gradle 8.11 (Capacitor 7) fails on newer JDKs with "Unsupported class file major version". In Android Studio keep *Settings → Build Tools → Gradle → Gradle JDK* on the bundled JBR 21.
