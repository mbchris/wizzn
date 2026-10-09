---
description: >-
  Strict refactoring protocol ensuring tests
  prove behavior is preserved. Never refactor
  and add tests in the same commit.
applyTo: "**/*"
---

Refactor in this strict order:

1. Identify every function/method to change.
2. Audit existing test coverage (edge cases,
   branches).
3. Add missing tests (uncovered branches, edge
   cases, null/empty, error paths); run and pass
   them against current code.
4. Commit tests separately.
5. Refactor.
6. Run all tests; confirm they pass.
7. Commit the refactor.

Tests must pass before and after to prove
behavior is preserved.
