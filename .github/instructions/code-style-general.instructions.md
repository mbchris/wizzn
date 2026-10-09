---
description: >-
  Language-agnostic code style rules. Clean code
  principles enforced across all file types.
applyTo: "**/*"
---

- Prefer clear, maintainable code over clever
  code; keep changes small and scoped.
- Use descriptive, intention-revealing names;
  avoid single-letter names outside trivial
  loops.
- Write small, single-purpose functions; prefer
  early returns over deep nesting.
- Keep structure top-down; separate pure logic
  from side effects.
- Extract magic numbers/strings/flags into
  constants, enums, config, or types.
- Handle errors explicitly; never swallow
  failures.
- Use established libraries for common concerns
  (mapping, serialization, validation); don't
  reimplement what a dependency already solves.
- Reuse and extend existing project helpers over
  adding new use-case-specific code — but only
  when the extension fits naturally without
  degrading or bloating the original.
- Comment only to explain *why*, not *what*.
- Write focused, deterministic tests for new
  behavior and bug fixes.
