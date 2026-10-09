import { defineConfig } from '#q-app/wrappers'

export default defineConfig(() => ({
  css: ['app.scss'],
  extras: ['material-icons', 'roboto-font'],
  build: {
    target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari15'] },
    vueRouterMode: 'history',
    typescript: { strict: true, vueShim: true },
    env: { API_URL: process.env.API_URL ?? 'http://localhost:3000' },
  },
  devServer: { port: 9100, open: false },
  framework: { plugins: ['Notify', 'Dialog'], config: { brand: { primary: '#6C4BF4', secondary: '#FF8A65' } } },
}))
