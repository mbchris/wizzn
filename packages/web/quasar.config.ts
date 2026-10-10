import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '#q-app/wrappers'

// Central env file: <repo root>/.env (already-set shell vars win)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// API_URL=auto (or unset): http://<current LAN IP>:<PORT> → works from browser, emulator and phone on the same Wi-Fi
function apiUrl(): string {
  const v = process.env.API_URL
  if (v && v !== 'auto') return v
  const ip = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address
  return `http://${ip ?? 'localhost'}:${process.env.PORT ?? 3000}`
}

export default defineConfig(() => ({
  css: ['app.scss'],
  // Dual icon sets (CLAUDE.md): Material on Android/Web, Ionicons v4 on iOS
  extras: ['material-icons', 'ionicons-v4'],
  build: {
    target: { browser: ['es2022', 'safari15', 'chrome115'] },
    vueRouterMode: 'hash',
    typescript: { strict: true, vueShim: true },
    env: {
      API_URL: apiUrl(),
      // M4: public SDK keys / OAuth client ids (not secrets)
      REVENUECAT_IOS_KEY: process.env.REVENUECAT_IOS_KEY ?? '',
      REVENUECAT_ANDROID_KEY: process.env.REVENUECAT_ANDROID_KEY ?? '',
      GOOGLE_WEB_CLIENT_ID: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
      GOOGLE_IOS_CLIENT_ID: process.env.GOOGLE_IOS_CLIENT_ID ?? '',
    },
  },
  devServer: { port: 9000, open: false },
  framework: {
    plugins: ['Notify'],
    config: { brand: { primary: '#6C4BF4', secondary: '#FF8A65', dark: '#14121C' }, dark: false },
  },
  capacitor: { hideSplashscreen: true },
}))
