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

## Deploy
Coolify → Docker Compose resource → `docker-compose.yml`. Container start runs migrations + seed.

## Store / console setup
Google + Apple resources: see `docs/setup-consoles.md` (`pnpm setup:google`, `pnpm setup:apple`).
