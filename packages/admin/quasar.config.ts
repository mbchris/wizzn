import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '#q-app/wrappers'

// Central env file: <repo root>/.env (already-set shell vars win)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// Admin = desktop browser with cookie sessions → stay on localhost (a LAN-IP API would make cookies cross-site)
function apiUrl(): string {
  const v = process.env.API_URL
  return v && v !== 'auto' ? v : `http://localhost:${process.env.PORT ?? 3000}`
}

export default defineConfig(() => ({
  css: ['app.scss'],
  extras: ['material-icons', 'roboto-font'],
  build: {
    target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari15'] },
    vueRouterMode: 'history',
    typescript: { strict: true, vueShim: true },
    env: { API_URL: apiUrl() },
  },
  devServer: { port: 9100, open: false },
  framework: { plugins: ['Notify', 'Dialog'], config: { brand: { primary: '#6C4BF4', secondary: '#FF8A65' } } },
}))
