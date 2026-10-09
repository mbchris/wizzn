---
name: review-web
description: >-
  Performs local code review on Vue 3 SFCs, Quasar v2
  components, Pinia state management, and Capacitor mobile logic.
---

# `review-web`

Analyzes local changes in `packages/web/` for Vue 3 best
practices, Quasar UI conventions, SCSS style consistency,
and mobile platform compatibility.

## Scope & Checks
- Verify `<script setup lang="ts">` usage.
- Audit Quasar UI component usage and responsive layout classes.
- Check Pinia store reactivity and state mutations.
- Ensure Capacitor native plugin API calls check `isNativePlatform()`.
- Confirm safe area padding handling for mobile devices.
