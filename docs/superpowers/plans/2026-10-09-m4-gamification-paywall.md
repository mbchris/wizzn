# M4 Gamification, Paywall & Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Completing units builds a streak, XP/levels, badges and the weekly goal; free users hit a daily cap and see the paywall; premium is bought via RevenueCat; anonymous users can keep their progress by signing in with Apple or Google.
**Architecture:** All rules are pure functions in `@wizzn/shared/gamification` (tested). `ProgressRepo` inserts the completion and applies its effects in one transaction (streak row locked `FOR UPDATE`). RevenueCat is the only writer of `entitlement` (webhook + post-purchase refresh); the API decides access. Better Auth social providers accept native id tokens; the anonymous plugin's `onLinkAccount` moves progress to the new account.
**Tech Stack:** M3 stack + `@revenuecat/purchases-capacitor`, `@capgo/capacitor-social-login` (both in `src-capacitor`, reached via the Capacitor bridge — the web package has no new npm deps).
**Spec:** `docs/superpowers/specs/2026-10-09-wizzn-design.md` §1, §2, §7, §9

## Global Constraints
- Streak: a local day counts with ≥ 1 first-time completion; premium gets 2 freezes per calendar month, applied automatically for missed days, no rollover.
- XP: 10 per unit, +5 for the first unit of the local day, +50 when the 5th unit of the week (Mon–Sun) is completed. Levels from `LEVEL_THRESHOLDS`, +600 XP per level after the table.
- Badges: `first_unit`, `streak_7`, `streak_30`, `all_fields`, `audio_10`, `written_10`.
- Daily cap: `FREE_DAILY_CAP` (default 3) first-time completions per local day for free users. Feed returns `{ units: [], cap.reached: true }`, completion returns 402 `daily_cap`.
- Premium = `entitlement.active_until > now`. RevenueCat entitlement id `premium`; RevenueCat app user id = wizzn user id.
- Purchase requires a non-anonymous account (spec §2). Apple sign-in shown first on iOS.

## Review Focus
- Same unit completed twice / concurrently → one completion, one set of XP (unique index + streak row lock).
- 5th unit of the week → bonus once; 6th → none (tested).
- Missed day: free → reset to 1; premium with freezes → bridged (tested); month change refills (tested).
- Cap reached → feed serves nothing and records no impressions; completion → 402; premium → unlimited (tested).
- Webhook: wrong/missing secret → 401; unknown user → 200 `applied:false` (no retry storm); TRANSFER moves the entitlement (tested).
- Webhook router is registered before the `/api` user routers (their `use('*')` auth middleware would otherwise answer 401).
- Anonymous → Apple/Google: progress moves when the target account has none; an existing account keeps its own (`transferUserData`).

---

### Task 1: Shared gamification rules — done
`packages/shared/src/gamification.ts`: `advanceStreak`, `viewStreak`, `levelFor`, `earnedBadges`, `completionEffects`, `dailyCap`, `weekStart`, DTOs (`ProgressDto`, `CompletionRewardsDto`, `PremiumDto`). `FeedResponse.cap`, `CompletionResult.rewards`, `MeDto.email`.
- [x] `test/gamification.test.ts` — 22 cases pass

### Task 2: API — done
`src/progress-repo.ts`, `src/revenuecat.ts`, `src/routes/{feed,progress,webhooks}.ts`, `src/auth.ts` (Apple/Google + `onLinkAccount`), env `FREE_DAILY_CAP`, `REVENUECAT_*`, `APPLE_*`, `GOOGLE_*`. Migration `0002_m4_streak_freezes` (`streak.freezes_month`). `FeedRepo.insertCompletion` moved into `ProgressRepo.recordCompletion` (it must share the rewards transaction).
- `GET /api/me/progress`, `POST /api/me/subscription/refresh`, `POST /api/webhooks/revenuecat`
- [x] API typecheck clean; 54 API tests pass (`feed.test.ts`, `revenuecat.test.ts`)
- [ ] `pnpm db:migrate` against Postgres → `streak.freezes_month` exists; `pnpm db:generate` → "No schema changes"
- [ ] Manual SQL check: complete 5 units across 2 days with `FREE_DAILY_CAP=10` → `xp_ledger` has `unit`/`first_of_day`/`weekly_goal` rows, `streak.current = 2`

### Task 3: App — done
`ProfilePage` (streak, weekly ring, level, badges, premium, account), `PremiumPage` (perks, packages, buy, restore), `AccountSheet` (Apple/Google), feed header streak chip + profile, paywall card after the cap, reward toasts, account prompt after the first unit. `src/native/{capacitor,purchases,socialLogin}.ts`.
- [x] `vue-tsc --noEmit` clean
- [ ] `pnpm dev:web` with `FREE_DAILY_CAP=1`: complete a unit → toast "+15 XP · 🔥 1 Tag" → swipe → paywall card; profile shows 1/5 week, Level 1, 🌱 badge

### Task 4: Store setup + device test (manual)
- [ ] `cd packages/web/src-capacitor && pnpm install --ignore-workspace` (verify plugin majors match Capacitor 7: `npm view @revenuecat/purchases-capacitor peerDependencies`)
- [ ] Xcode: capability "Sign in with Apple" + "In-App Purchase"; Google: iOS URL scheme (reversed iOS client id) in `Info.plist`
- [ ] RevenueCat: project, entitlement `premium`, offering "default" (monthly + annual), webhook URL + Authorization value = `REVENUECAT_WEBHOOK_AUTH`
- [ ] Device: anonymous → 1 unit → account prompt → Apple sign-in → profile keeps streak/XP; sandbox purchase → premium active, cap gone
- [ ] Google on iOS: id token audience is the iOS client id → it must be in `GOOGLE_CLIENT_IDS`
- [ ] Before store submission (M5): in-app account deletion (Apple requirement once sign-in exists), terms/privacy links on the paywall
