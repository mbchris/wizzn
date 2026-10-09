import { defineRouter } from '#q-app/wrappers'
import { createRouter, createWebHistory } from 'vue-router'
import { authApi } from 'src/api'
import routes from './routes'

export default defineRouter(() => {
  const router = createRouter({ history: createWebHistory(process.env.VUE_ROUTER_BASE), routes })
  router.beforeEach(async (to) => {
    if (to.meta.public) return true
    const session = await authApi.session().catch(() => null)
    return session ? true : { path: '/login', query: { redirect: to.fullPath } }
  })
  return router
})
