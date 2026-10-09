import { defineRouter } from '#q-app/wrappers'
import { createRouter, createWebHashHistory } from 'vue-router'
import { ensureSession } from 'src/api'
import routes from './routes'

export default defineRouter(() => {
  // Hash history: works from capacitor://localhost without server rewrites
  const router = createRouter({ history: createWebHashHistory(), routes })
  router.beforeEach(async (to) => {
    if (!to.meta.requiresInterests) return true
    try {
      const me = await ensureSession()
      return me.interests.length ? true : '/onboarding'
    } catch {
      // API unreachable: let the page show its error state
      return true
    }
  })
  return router
})
