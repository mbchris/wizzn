# AGENTS.md — AI Coding Agent Conventions

> Guidelines for AI agents working on the **wizzn** monorepo.

## Tech Stack

| Layer | Technology |
|---|---|
| Web App | Quasar + Vue 3 + TypeScript (`packages/web`) |
| API | Hono + TypeScript (`packages/api`) |
| Language | TypeScript (strict) |
| Styles | SCSS (Quasar app) |
| Deployment | Docker + docker-compose |
| Package manager | pnpm workspaces |

## Project Structure

```
├── package.json
├── pnpm-workspace.yaml
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.api.template
├── .env.web.template
│
├── packages/
│   ├── api/                 # Hono API server
│   ├── web/                 # Quasar web/mobile app
│   └── shared/              # Shared types/utilities
│
├── docs/
│   ├── superpowers/specs/   # Design specs
│   ├── superpowers/plans/   # Milestone implementation plans (M1–M5)
│   └── backlog/bugfixing.md
│
├── scripts/
│   ├── sync-backlog.sh      # GitHub Issues & Projects sync
│   └── setup-capacitor.ps1
│
└── .github/workflows/
    └── sync-backlog.yml     # Auto-sync on push
```

## Coding Standards

1. **TypeScript strictness** — keep strict typing; avoid `any` unless unavoidable
2. **Vue style** — use Composition API and `<script setup lang="ts">` in Vue files
3. **Quasar app conventions** — follow existing structure in `packages/web/src/*` (boot files, stores, pages)
4. **API conventions** — keep route handlers under `packages/api/src/routes/*`; preserve middleware chain

## Iteration Workflow

The command is "implement". Ask the user which iteration to be implemented and show the available ones.

1. **Read** the assigned task from `docs/superpowers/plans/*-mN-*.md`
2. **Implement** the feature, checking off acceptance criteria as you go
3. **Tick off** the feature in the backlog once it is implemented
4. **Commit** with message format: `feat(iter-N): description — closes #N`
5. The `closes #N` reference auto-closes the GitHub Issue

## Bugfix Workflow

When "bugfix" is requested, check the backlog in `docs/backlog/bugfixing.md` and fix the mentioned task-id, or show all ones not ticked off. Query the user to select the corresponding one.
Fixed bugs need to be ticked off.

## Running Locally

```bash
# Install workspace dependencies
pnpm install

# Copy environment templates
cp .env.api.template .env.api
cp .env.web.template .env.web

# Run API + Web in dev mode
pnpm dev
```

## Environment

Credentials and API keys must not be committed.
Use `.env.api` and `.env.web` (copied from templates) for local development.

## Execution of external commands

Executing commands can get stuck. Try to execute them, but if nothing happens within 30 seconds, ask the user to run them manually and provide copy-pasteable scripts.

# Database scripts

Always make sure that the database can be set up from scratch. 
Update the scripts accordingly.
Update the readme and "wizzn container shell" information accordingly

# GitHub issue sync

Whenever a spec is being written, write the spec back to either the mentioned GitHub issue - if not GitHub issue is mentioned, create a new one in https://github.com/prj120/wizzn/issues