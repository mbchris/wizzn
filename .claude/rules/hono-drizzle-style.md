---
paths:
  - "packages/api/**/*.ts"
---

# Hono & Drizzle Code Style Rules

## Hono Route Handlers & Zod Validation
- Always validate request parameters, query, and
  body using `@hono/zod-validator` middleware (`zValidator`).
- Return typed JSON responses using `c.json()`.
- Use HTTP status codes consistently (`200 OK`,
  `201 Created`, `400 Bad Request`, `401 Unauthorized`,
  `404 Not Found`, `500 Internal Error`).

## Drizzle ORM Schema & Database Access
- Define table schemas in `src/db/schema/` using
  Drizzle column builders (`pgTable`, `text`, `timestamp`).
- Export relations using `relations()` builder.
- Keep raw SQL queries to a minimum; prefer Drizzle's
  type-safe query builder (`db.query.*` or `db.select()`).
- Always run database migrations via `drizzle-kit`.

## Authentication & Authorization
- Use Better Auth helpers to retrieve user sessions
  from context (`c.get('user')`).
- Protect private endpoints with auth middleware.
