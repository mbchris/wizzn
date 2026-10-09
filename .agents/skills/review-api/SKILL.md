---
name: review-api
description: >-
  Performs local code review on Hono API endpoints,
  Drizzle ORM queries, Zod validations, and Node.js
  backend architecture.
---

# `review-api`

Analyzes local changes in `packages/api/` for code
quality, security vulnerabilities, typed validation,
and database query efficiency.

## Scope & Checks
- Verify `@hono/zod-validator` usage on all inputs.
- Ensure proper error handling and HTTP status codes.
- Audit Drizzle ORM queries for missing indexes or
  N+1 query problems.
- Confirm Better Auth middleware protection on private routes.
- Validate Stripe webhook signature checking.
