---
paths:
  - "**/*.{ts,json,yml,yaml,dockerfile,Dockerfile}"
---

# Monorepo & Tooling Rules

## Package Manager & Workspaces
- Use `pnpm` (v10) for dependency management and
  workspace orchestration.
- Define workspace packages under `packages/*`
  (e.g., `packages/api`, `packages/web`,
  `packages/shared`).
- Cross-package imports must use workspace syntax
  (`"workspace:*"`).

## TypeScript 5.8 Configuration
- Enable strict mode (`"strict": true`) across all
  packages.
- Do not use `any` types. Write explicit interfaces
  and generic types.
- Ensure root `tsconfig.json` defines base options
  and composite references.

## Runtime & Docker
- Target Node.js (>=20.0.0) runtime environment.
- Maintain production-ready `Dockerfile` and
  `docker-compose.yml` configurations.
- Store environment variables in `.env.example`
  templates and never commit raw secrets.
