---
description: >-
  Backend architecture guidelines for Hono,
  Drizzle ORM, PostgreSQL, Better Auth, Zod,
  Stripe, Nodemailer, and Marked utilities.
applyTo: "packages/api/**/*.{ts,json}"
---

# API Architecture Guidelines (`packages/api`)

## Core Tech Stack
- **Framework**: Hono with `@hono/node-server`.
- **Database & ORM**: PostgreSQL (`pg`) with
  Drizzle ORM & `drizzle-kit`.
- **Authentication**: Better Auth server.
- **Validation**: Zod with `@hono/zod-validator`.
- **Payments**: Stripe SDK (`stripe`).
- **Email**: Nodemailer (`nodemailer`).
- **Utilities**: `marked` for Markdown parsing.

## Layer Structure
- **Routes (`src/routes/`)**: Define HTTP routes using
  Hono instance. Validate inputs with
  `@hono/zod-validator`.
- **Services (`src/services/`)**: Implement business
  logic, Stripe payment flows, and email sending.
- **Database (`src/db/`)**: Export Drizzle schema,
  relational definitions, and DB connection pool.
- **Middleware (`src/middleware/`)**: Auth checks
  using Better Auth session validation, error
  handling, and logging.
