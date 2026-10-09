import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/feed' },
  { path: '/onboarding', component: () => import('pages/OnboardingPage.vue') },
  { path: '/feed', component: () => import('pages/FeedPage.vue'), meta: { requiresInterests: true } },
  { path: '/:catchAll(.*)*', redirect: '/feed' },
]

export default routes
