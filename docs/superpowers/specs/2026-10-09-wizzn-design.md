# wizzn — Design Spec v1

Status: draft for review · Date: 2026-10-09 · Source: ABOUT.md + interview

## 1. Product Brief

| Aspect | Decision |
|---|---|
| Goal | Replace doom scrolling with short knowledge units in a swipe feed |
| Audience | 16+, DACH, German first (no parental consent needed under German GDPR rules) |
| 6-month target | Public App Store + Play Store launch |
| Business model | Freemium subscription |
| Free tier | Daily unit cap (default 3/day, configurable) |
| Premium | Unlimited units, offline audio, streak freezes, journeys (post-v1) |
| Launch content | ~50 published units per field → ~250 units |
| Team | 3 developers, side project |

### Fields (launch)
| Field | Themes |
|---|---|
| Nutrition | protein, vegan, vegetarian, keto, … |
| Partnership | seduction, needs, love, balance |
| Finance | investments, tax optimization, budget self-control |
| Sports | routine building, workout types, strength, cardio |
| Psychology | behaviour patterns, neurodivergence, developmental, social |

### Unit formats
| Format | Shape | Completion rule |
|---|---|---|
| Audio | 3–5 min narration, 1–3 images timed to the script | ≥ 90 % played |
| Written | 3–5 slides, link-out to the source | Last slide reached + ≥ 15 s dwell |

### Content policy
- Finance/nutrition/psychology units: show a "no professional advice" note.
- Partnership: respectful, non-explicit (keeps the store age rating at 16+/17+).
- Every factual claim must be backed by a cited source; every link is checked for reachability.

### Out of scope (v1)
Friends, leaderboards, sharing, quizzes, learned recommendations, languages other than German, multiple editor roles.

## 2. User Experience

- **Onboarding (anonymous):** pick fields → pick themes (optional) → pick formats (audio/written/both) → feed.
- **Feed:** full-screen vertical swipe, one unit per screen, next 3 units prefetched.
- **Account prompt:** shown after the first completed unit and before purchase; needed to keep a streak or subscribe.
- **Profile:** streak, weekly goal ring (5 units/week), XP/level, badges, interests, subscription.
- **Paywall:** shown when the daily cap is hit; premium perks listed.
- **Style:** modern, friendly, playful; platform conventions per CLAUDE.md (icons, iOS bottom sheets).

## 3. Architecture

Decision: Stack A — reuse the existing repo conventions (Quasar/Vue/Capacitor + Hono/Drizzle), so the team stays on one TypeScript stack.

```
netcup VPS (Coolify, Traefik TLS)
├─ api       Hono + Zod + Drizzle, Better Auth
├─ worker    same image, other entrypoint; pg-boss jobs
├─ admin     Quasar SPA (nginx)
├─ media     nginx, static files from volume `media`
├─ postgres  Coolify-managed, daily backups
├─ searxng   self-hosted metasearch for research
└─ piper     German TTS HTTP service
External: LLM API (OpenAI-compatible), image API, RevenueCat, FCM/APNs
```

### Monorepo
| Package | Content |
|---|---|
| `packages/api` | HTTP API (`src/server.ts`) + worker (`src/worker.ts`) |
| `packages/web` | Quasar + Capacitor mobile app |
| `packages/admin` | Quasar SPA for content ops |
| `packages/shared` | Zod schemas (unit content, DTOs), shared types |

### Provider abstraction
Every AI dependency sits behind an interface and is selected by env vars, so the same code runs locally and in production.

| Concern | Interface | Dev (MacBook M5 Pro) | Prod (VPS) |
|---|---|---|---|
| Text LLM | `LlmClient` (OpenAI-compatible chat + JSON mode) | Ollama via `http://host.docker.internal:11434/v1` | Cheap hosted model; the VPS has no GPU |
| Web research | `SearchClient` | SearXNG container | SearXNG container |
| TTS | `TtsClient` | Piper container | Piper container (swap to paid TTS if quality is insufficient) |
| Images | `ImageClient` | Placeholder SVG generator | Cheap image API, fixed style prompt |
| Storage | `MediaStore` (`local` \| `s3`) | Local folder | Volume `media` behind the `media` container |

Env: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `SEARCH_URL`, `TTS_URL`, `TTS_VOICE`, `IMAGE_PROVIDER`, `MEDIA_DRIVER`, `MEDIA_PUBLIC_URL`.

Production model choice: run the same 10 sample briefs on the 2–3 cheapest candidates and pick by German quality per cost. Prompts are versioned and stored with each unit.

## 4. Content Pipeline

States: `queued → researching → drafting → checking → rendering_media → in_review → published | rejected | failed`

| Step | Job | Output |
|---|---|---|
| Brief | Admin enters field, theme, topic, context, format, count | `content_brief` |
| Research | SearXNG query → fetch + extract text → LLM picks 1–3 sources (per-field domain allowlist preferred) | `sources` with extracted excerpts |
| Draft | LLM, strict JSON schema from `packages/shared` | slides or script + image prompts |
| Self-check | Second LLM pass: claims vs. excerpts, tone, safety, length; HTTP check on links | `check_report` (unsupported claims flagged) |
| Media | ImageClient for 1–3 images; Piper renders audio (audio units) | files in MediaStore |
| Review | Human approves, edits inline or regenerates one step | `published` / `rejected` |

- Each step is an idempotent pg-boss job with retries; a failed step can be rerun without repeating earlier ones.
- Reason for pg-boss: the queue runs in Postgres, so no Redis container is needed.

### Unit content schema (`packages/shared`)
```ts
WrittenUnit = { slides: { title: string; body: string /* ≤ 60 words */; imageId?: string }[]; sources: Source[] }
AudioUnit   = { script: string; durationSec: number; audioId: string; images: { imageId: string; showAtSec: number }[]; sources: Source[] }
Source      = { url: string; title: string; publisher: string }
```

## 5. Admin App

- Single role `admin` (3 developers).
- Screens: brief form (batch generation), pipeline monitor, review queue, unit editor, field/theme management.
- Review shows a mobile-frame preview, the check report (flagged claims highlighted) and the sources.

## 6. Feed Logic (rule-based)

1. Candidates: published units in the user's fields/themes and formats, not completed and not served in the last 14 days.
2. Order: round-robin across the selected fields; every 5th slot comes from an unselected field for variety.
3. Pagination: cursor-based, 10 units per page; the client prefetches the media of the next 3.
4. Cap: the server counts completions per local day; free users get the paywall after the cap.

## 7. Gamification

| Element | Rule |
|---|---|
| Streak | Day counts with ≥ 1 completed unit in the user's time zone |
| Streak freeze | Premium: 2/month, applied automatically |
| Weekly goal | 5 units Mon–Sun; +50 XP bonus |
| XP | 10 per unit, +5 for the first unit of the day |
| Levels | Threshold table in config |
| Badges | First unit, 7/30-day streak, all 5 fields tried, 10 audio units, 10 written units |

- All rules are computed server-side from `completion_event` (append-only); XP is a ledger table.

## 8. Data Model (core)

| Table | Key columns |
|---|---|
| `user` | id, is_anonymous, timezone, push_token, reminder_time |
| `user_interest` | user_id, field_id, theme_id?, formats |
| `field` / `theme` | id, slug, name_de |
| `content_brief` | id, field_id, theme_id, topic, context, format, status |
| `unit` | id, brief_id, format, status, title, content_json, prompt_version, model, published_at |
| `source` | id, unit_id, url, title, publisher, excerpt, last_checked_at |
| `asset` | id, unit_id, kind (image/audio), path, duration_sec |
| `check_report` | unit_id, report_json, passed |
| `completion_event` | user_id, unit_id, completed_at, local_date |
| `feed_impression` | user_id, unit_id, served_at |
| `streak` | user_id, current, longest, last_local_date, freezes_left |
| `xp_ledger` | user_id, amount, reason, created_at |
| `user_badge` | user_id, badge_key, earned_at |
| `entitlement` | user_id, product_id, active_until, source (RevenueCat) |

## 9. Auth, Payments, Notifications

- **Better Auth:** anonymous session on first launch, later linked to Sign in with Apple / Google / email. Apple sign-in is mandatory on iOS once Google sign-in is offered.
- **Subscriptions:** RevenueCat SDK in the app; RevenueCat webhook → `entitlement`. The API decides access.
- **Push:** Capacitor push plugin + FCM (APNs via FCM). Worker cron: streak-at-risk reminder at the user's `reminder_time`.
- **Audio:** native audio plugin for lock-screen and background playback; offline downloads for premium users.

## 10. Operations & Compliance

- **Deploy:** Coolify docker-compose from the repo; `main` → production, preview branch optional.
- **Backups:** Coolify Postgres backups + restic for volume `media` to off-site storage.
- **Risk:** a single VPS is a single point of failure; acceptable for v1, keep restore steps documented.
- **GDPR:** data hosted in Germany, privacy policy, in-app account deletion (required by Apple), data export on request.
- **Analytics:** own `completion_event` / `feed_impression` tables in v1; PostHog EU later if needed.

## 11. Milestones

| # | Scope |
|---|---|
| M1 | Monorepo, Docker/Coolify, Postgres + Drizzle, Better Auth (anonymous), shared schemas |
| M2 | Provider interfaces, pipeline jobs, admin app (brief → review → publish) |
| M3 | Mobile onboarding, swipe feed, written + audio players, completion tracking |
| M4 | Streak/XP/badges/weekly goal, paywall + RevenueCat, daily cap |
| M5 | Push reminders, offline audio, polish, store assets + submission; content to ~250 units in parallel from M2 |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Swipe feed smoothness in Capacitor | Virtualize to 3 mounted slides, CSS scroll-snap, prefetch; prototype in M3 week 1 |
| Piper German voice too robotic | `TtsClient` swap to a paid TTS; decide after 5 sample units |
| Local model ≠ prod model quality | Prompt/eval set of 10 briefs runs against both |
| Store review (AI content, subscriptions) | Human-approved content, clear subscription terms, restore purchases |

## 13. Open Decisions

| Item | Default |
|---|---|
| Production LLM | Chosen via 10-brief eval |
| Image provider | Cheapest API with consistent illustration style |
| Free daily cap | 3 units/day |
| Domain / bundle id | `app.wizzn` (to confirm) |
| Repo docs still name "bandstr" (CLAUDE.md, AGENTS.md) | Rename in M1 |
