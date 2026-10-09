---
name: pr-review-web
description: >-
  Reviews Pull Requests for Vue 3 frontend, Quasar UI,
  and Capacitor hybrid mobile changes.
---

# `pr-review-web`

Automates Pull Request reviews for frontend and mobile changes
in `packages/web/`.

## Workflow
1. Fetch PR diff for `packages/web/`.
2. Inspect Vue 3 SFC composition, prop definitions, and Quasar components.
3. Check for mobile responsiveness, Capacitor plugins, and Pinia usage.
4. Output structured review feedback with concrete code suggestions.
