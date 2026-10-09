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

## Deploy
Coolify → Docker Compose resource → `docker-compose.yml`. Container start runs migrations + seed.
