# M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Runnable monorepo with API, worker, DB schema, anonymous auth and Coolify-ready Docker setup.
**Architecture:** pnpm workspace; `@wizzn/shared` holds Zod content schemas; `@wizzn/api` is a Hono app built from injected ports (`AuthPort`, `Repos`) so routes are testable without Postgres.
**Tech Stack:** Node 22, TypeScript 5.8 strict, Hono 4, Drizzle 0.44 + pg, Better Auth 1.3 (anonymous plugin), pg-boss 10, Vitest 3.
**Spec:** `docs/superpowers/specs/2026-10-09-wizzn-design.md`

## Global Constraints
- Node >= 20, pnpm 10, no `any`.
- Unit content: written 3–5 slides, body ≤ 60 words, 1–3 sources; audio 180–300 s, 1–3 images within duration.
- 5 launch fields: nutrition, partnership, finance, sports, psychology (German names).
- Secrets only via `.env.api` / Coolify env.

## Review Focus
- Interests with themes from an unselected field → theme ignored (repos.saveInterests).
- Interests PUT with empty fields or unknown format → 400 (tested).
- DB down → `/health/ready` 503, `/health` still 200 (tested).
- Seed re-run → no duplicates (upsert on slug).
- Container start on empty DB → migrate + seed before serving.

---

### Task 1: Workspace + shared schemas — DONE (code written, not yet executed)
**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/shared/src/{content,unit-status,fields,api,index}.ts`, `packages/shared/test/*.test.ts`
**Produces:** `writtenUnitSchema`, `audioUnitSchema`, `unitContentSchema`, `canTransition(from, to)`, `FIELD_SEEDS`, `interestsInputSchema`, `FieldDto`, `MeDto`.
- [ ] `pnpm install`
- [ ] `pnpm --filter @wizzn/shared test` → all pass

### Task 2: DB schema, client, migrations, seed
**Files:** `packages/api/src/db/{schema/*,client,seed,migrate}.ts`, `drizzle.config.ts`
**Produces:** `createDb(url) → { db, pool }`, tables per spec §8 (+ Better Auth tables, `user_profile`).
- [ ] `docker compose -f docker-compose.dev.yml up -d postgres`
- [ ] `cp .env.api.template packages/api/.env && pnpm db:generate` → `packages/api/drizzle/0000_*.sql` created
- [ ] `pnpm db:migrate && pnpm db:seed` twice → "Seeded 5 fields", no error on 2nd run
- [ ] Commit `drizzle/` folder

### Task 3: API app + auth
**Files:** `packages/api/src/{app,auth,types,repos,server,env}.ts`, `routes/*`, `middleware/require-user.ts`, `test/*`
**Produces:** `createApp({ auth, repos, corsOrigins })`; routes `GET /health`, `GET /health/ready`, `GET|POST /api/auth/*`, `GET /api/fields`, `GET /api/me`, `PUT /api/me/interests`.
- [ ] `pnpm --filter @wizzn/api test` → all pass
- [ ] `pnpm dev`, then `curl -X POST localhost:3000/api/auth/sign-in/anonymous -H 'Content-Type: application/json' -H 'Origin: http://localhost:9000' -d '{}' -c c.txt` → 200 with user
- [ ] `curl -b c.txt localhost:3000/api/me` → `isAnonymous: true`
- [ ] `pnpm typecheck` → no errors

### Task 4: Worker + Docker/Coolify
**Files:** `packages/api/src/worker.ts`, `src/jobs/queues.ts`, `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `deploy/*`
- [ ] `pnpm dev:worker` → logs 4 queues
- [ ] `docker compose build && POSTGRES_PASSWORD=x docker compose up` → api healthy, worker started
- [ ] Coolify: new resource from repo, compose file `docker-compose.yml`, domains for `api` (:3000) and `media` (:80), set env vars from `.env.api.template`

## Next plans
| Plan | Scope |
|---|---|
| M2 | Provider ports (LLM, search, TTS, image, media), pipeline jobs, `packages/admin` |
| M3 | `packages/web` Quasar + Capacitor: onboarding, swipe feed, players, completion API |
| M4 | Streak/XP/badges, RevenueCat webhook, daily cap, Apple/Google sign-in |
| M5 | Push reminders, offline audio, store submission |
