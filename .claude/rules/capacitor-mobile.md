---
paths:
  - "packages/web/**/*.{ts,vue,json,xml}"
---

# Capacitor Mobile Rules (`Capacitor v7`)

## Configuration & Native Projects
- Store Capacitor configuration in `capacitor.config.ts`.
- Ensure platform sync command `pnpm cap sync` is run
  after updating native plugins or web build outputs.
- Keep `ios/` and `android/` native project metadata
  synchronized with app versioning.

## Native Plugins & Features
- Use official Capacitor v7 plugins (`@capacitor/core`,
  `@capacitor/camera`, `@capacitor/push-notifications`).
- Wrap native plugin invocations in platform checks
  (`Capacitor.isNativePlatform()`).
- Handle device safe areas using CSS env vars (`safe-area-inset-*`).
