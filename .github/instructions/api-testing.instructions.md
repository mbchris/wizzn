---
description: >-
  Testing guidelines for API routes, service
  layer, Drizzle database transactions, and
  mocking external services (Stripe, Nodemailer).
applyTo: "packages/api/**/*.test.ts"
---

# API Testing Guidelines

## Framework & Setup
- Use `vitest` for API unit and integration testing.
- Test route handlers using Hono's `app.request()`.

## Database Test Isolation
- Run integration tests against a PostgreSQL test instance.
- Wrap tests in transaction rollbacks or clear tables
  between test suites.

## Service Mocks
- Mock Stripe API calls using test SDK keys or Vitest
  spies (`vi.spyOn`).
- Mock Nodemailer transport to prevent actual email
  dispatch during automated test runs.
