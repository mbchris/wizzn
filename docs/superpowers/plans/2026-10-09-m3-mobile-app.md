# M3 Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Anonymous user onboards, swipes a vertical feed of published units, completes written and audio units.
**Architecture:** Feed ordering and completion rules are pure functions in `@wizzn/shared` (tested); API routes use a `FeedRepo` port; Quasar SPA in `packages/web` runs in the browser and in Capacitor (bearer token auth, hash routing).
**Tech Stack:** M2 stack + Better Auth `bearer` plugin, Capacitor 7 (`src-capacitor`).
**Spec:** `docs/superpowers/specs/2026-10-09-wizzn-design.md` §2, §6

## Global Constraints
- Feed: published, user formats, not completed, not served in 14 days; round-robin over selected fields; every 5th slot from an unselected field; 10 per page.
- Completion: written = all slides + ≥ 15 s dwell; audio = ≥ 90 % listened (seeking does not count). One completion per user and unit.
- Local date in the user's time zone (fallback Europe/Berlin).
- Icons via `usePlatform().pIcon` + `ICON_MAP` (CLAUDE.md); segmented control for exclusive choices.

## Review Focus
- Selected fields run out → feed fills with discovery units, then shows the end card (tested in shared).
- Completion sent twice → counted once (tested).
- Completion near midnight → date in the user's zone (tested).
- Token expired/invalid → app silently creates a new anonymous session (`ensureSession`).
- Feed before onboarding → 409 → app redirects to onboarding (tested + client).

---

### Task 1: Shared feed rules — code written
`packages/shared/src/feed.ts`: `orderFeed`, `isCompletion`, `completionInputSchema`, `FeedUnitDto`.
- [ ] `pnpm --filter @wizzn/shared test` → pass

### Task 2: Feed + completion API — code written
`src/feed-repo.ts`, `src/routes/feed.ts`, `src/local-date.ts`; `GET /api/feed?limit=`, `POST /api/units/:id/complete`; unique index `completion_user_unit_uq`; Better Auth `bearer()`.
- [ ] `pnpm db:generate && pnpm db:migrate` → migration with the unique index
- [ ] `pnpm --filter @wizzn/api test` → pass

### Task 3: Mobile app — code written
`packages/web`: onboarding (fields → themes → formats), feed (scroll-snap, only active ±1 card mounted, image prefetch for next 3, load more 3 before the end), written player (horizontal slides, dwell timer), audio player (timed images, seek bar, pauses when swiped away), source links + advice disclaimer.
- [ ] `pnpm install && pnpm --filter @wizzn/web typecheck`
- [ ] `pnpm dev:web` → http://localhost:9000 in Chrome device mode: onboarding → feed → complete one written + one audio unit → "Geschafft! 🎉"
- [ ] Capacitor: `cd packages/web && pnpm exec quasar mode add capacitor` (keeps existing `src-capacitor`), then `pnpm dev:ios` with `API_URL=http://<Mac-LAN-IP>:3000` and `MEDIA_PUBLIC_URL=http://<Mac-LAN-IP>:8081`
