# M2 Content Pipeline + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin enters a brief → worker researches, drafts, self-checks and renders media → unit lands in review → admin approves.
**Architecture:** Provider ports (`LlmClient`, `SearchClient`, `PageFetcher`, `TtsClient`, `ImageClient`, `MediaStore`) chosen by env; pipeline steps (`runStep`) depend only on ports + `PipelineStore`, so they are tested with fakes; pg-boss queue per step; status changes are compare-and-set.
**Tech Stack:** M1 stack + Quasar 2 (app-vite 2) for `packages/admin`, ffmpeg in the API image.
**Spec:** `docs/superpowers/specs/2026-10-09-wizzn-design.md` §3–5

## Global Constraints
- Status flow: `queued → researching → drafting → checking → rendering_media → in_review → published | rejected`; any step → `failed`.
- Audio script 420–700 words; written slides ≤ 60 words; 1–3 sources; images ≤ 3.
- Approve only content that passes `unitContentSchema`.
- Admin = non-anonymous account whose email is in `ADMIN_EMAILS` (case-insensitive).
- Prompts versioned (`PROMPT_VERSION`), stored per unit with the model name.

## Review Focus
- Duplicate job for the same step → no-op (tested).
- No reachable source → unit `failed` with reason, no next job (tested).
- Unsupported claim → check fails but unit still reaches review (tested).
- LLM returns fenced/`<think>` or invalid JSON → stripped / one repair retry (tested).
- Approve with invalid content → 400; actions in wrong status → 409 (tested).

---

### Task 1: Shared pipeline schemas — code written
`packages/shared/src/{pipeline,admin}.ts`: `draftWrittenSchema`, `draftAudioSchema`, `sourcePickSchema`, `llmCheckSchema`, `evaluateCheck`, `scheduleImages`, `briefInputSchema`, `unitEditSchema`, DTOs.
- [ ] `pnpm --filter @wizzn/shared test` → pass

### Task 2: Providers — code written
`packages/api/src/providers/*`. Env: `TTS_PROVIDER` (silent|piper), `IMAGE_PROVIDER` (placeholder|api) + `IMAGE_BASE_URL/MODEL/API_KEY`.
- [ ] `pnpm --filter @wizzn/api test -- providers` → pass

### Task 3: Pipeline steps + worker — code written
`src/pipeline/{prompts,store,store-db,steps}.ts`, `src/jobs/boss.ts`, `src/worker.ts`. Schema change: `source.position`, `asset.position`.
- [ ] `pnpm db:generate && pnpm db:migrate` → new migration `0001_*`
- [ ] `pnpm --filter @wizzn/api test -- pipeline` → pass

### Task 4: Admin API — code written
`src/routes/admin.ts`, `src/admin-repo.ts`, `src/middleware/require-admin.ts`. Routes under `/api/admin`: `POST /briefs`, `GET /units`, `GET|PUT /units/:id`, `POST /units/:id/{approve,reject,requeue}`.
- [ ] `pnpm --filter @wizzn/api test -- admin` → pass

### Task 5: Admin SPA — code written
`packages/admin` (port 9100): login/sign-up, unit list (5 s refresh), new brief, unit detail (phone preview, check report, sources, JSON edit, approve/reject/requeue). `Dockerfile.admin`, compose service `admin` (build arg `API_PUBLIC_URL`).
- [ ] `pnpm install && pnpm --filter @wizzn/admin typecheck`
- [ ] End-to-end on the Mac (see README "Content pipeline")
