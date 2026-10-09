---
paths:
  - "packages/web/**/*.{vue,ts,json}"
---

# Vue 3 & Quasar Architecture Guidelines (`packages/web`)

## Core Tech Stack
- **Framework**: Vue 3 (Composition API, `<script setup lang="ts">`).
- **UI Toolkit**: Quasar Framework (v2) with Vite (`@quasar/app-vite`).
- **Styling**: SCSS + Quasar CSS utility classes.
- **State Management**: Pinia (`defineStore`).
- **Routing**: Vue Router 4 (`createRouter`).
- **Mobile Build**: Capacitor (v7) for iOS and Android.
- **Auth Client**: Better Auth client.

## Directory Layout
- **Components (`src/components/`)**: Reusable UI elements
  using Quasar components (`QBtn`, `QCard`, `QInput`).
- **Pages (`src/pages/`)**: Route-level views.
- **Layouts (`src/layouts/`)**: Page structural wrappers
  (`QLayout`, `QHeader`, `QPageContainer`).
- **Stores (`src/stores/`)**: Pinia store definitions for
  global application state and auth session state.
- **Router (`src/router/`)**: Route definitions and auth guards.
