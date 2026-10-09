---
description: >-
  Code style rules for Vue 3 SFCs, TypeScript props/emits,
  Quasar components, SCSS modules, and Pinia stores.
applyTo: "packages/web/**/*.{vue,ts,scss}"
---

# Vue 3 & Quasar Code Style Rules

## Single File Components (SFCs)
- Use `<script setup lang="ts">` for all Vue components.
- Order SFC tags: `<script setup>`, `<template>`, `<style lang="scss">`.
- Define props using `defineProps<{ ... }>()` type-only declarations.
- Emits must use `defineEmits<{ ... }>()`.

## UI & Styling
- Prefer standard Quasar components (`q-btn`, `q-input`, `q-dialog`)
  over raw HTML where applicable.
- Leverage Quasar flex/grid utilities (`row`, `col`, `q-pa-md`, `q-gutter-sm`).
- Write scoped SCSS (`<style lang="scss" scoped>`) for custom component styles.

## State Management & Better Auth
- Use Pinia setup syntax (`defineStore('name', () => { ... })`).
- Initialize Better Auth client in a boot plugin (`src/boot/auth.ts`).
- Handle loading states and reactive errors cleanly in template.
