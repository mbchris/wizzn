import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/onboarding', component: () => import('pages/OnboardingPage.vue') },
  { path: '/premium', component: () => import('pages/PremiumPage.vue') },
  {
    // Root tabs (LAYOUT.md §1): Stream · Explore Topics · Streak
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    meta: { requiresInterests: true },
    children: [
      { path: '', redirect: '/feed' },
      { path: 'feed', component: () => import('pages/FeedPage.vue') },
      { path: 'explore', component: () => import('pages/ExplorePage.vue') },
      { path: 'progress', component: () => import('pages/ProfilePage.vue') },
    ],
  },
  { path: '/profile', redirect: '/progress' },
  { path: '/:catchAll(.*)*', redirect: '/feed' },
]

export default routes
