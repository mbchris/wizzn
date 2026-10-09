import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests run against shared sources, so no prior build of @wizzn/shared is needed
export default defineConfig({
  resolve: { alias: { '@wizzn/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
})
