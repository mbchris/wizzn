import { defineConfig } from '#q-app/wrappers'

export default defineConfig(() => ({
  css: ['app.scss'],
  // Dual icon sets (CLAUDE.md): Material on Android/Web, Ionicons v4 on iOS
  extras: ['material-icons', 'ionicons-v4'],
  build: {
    target: { browser: ['es2022', 'safari15', 'chrome115'] },
    vueRouterMode: 'hash',
    typescript: { strict: true, vueShim: true },
    env: { API_URL: process.env.API_URL ?? 'http://localhost:3000' },
  },
  devServer: { port: 9000, open: false },
  framework: {
    plugins: ['Notify'],
    config: { brand: { primary: '#6C4BF4', secondary: '#FF8A65', dark: '#14121C' }, dark: false },
  },
  capacitor: { hideSplashscreen: true },
}))
