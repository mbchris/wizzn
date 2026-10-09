import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('pages/LoginPage.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/units' },
      { path: 'units', component: () => import('pages/UnitsPage.vue') },
      { path: 'units/:id', component: () => import('pages/UnitDetailPage.vue'), props: true },
      { path: 'briefs/new', component: () => import('pages/NewBriefPage.vue') },
    ],
  },
  { path: '/:catchAll(.*)*', redirect: '/units' },
]

export default routes
