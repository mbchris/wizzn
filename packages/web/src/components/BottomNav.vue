<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { usePlatform } from 'src/composables/usePlatform'
import { useHaptics } from 'src/composables/useHaptics'

const route = useRoute()
const router = useRouter()
const { pIcon, isIos } = usePlatform()
const haptics = useHaptics()

const tabs = [
  { to: '/feed', label: 'Stream', icon: 'tab_stream' },
  { to: '/explore', label: 'Entdecken', icon: 'tab_explore' },
  { to: '/progress', label: 'Streak', icon: 'tab_streak' },
] as const

const isActive = (to: string): boolean => route.path.startsWith(to)

function go(to: string): void {
  if (isActive(to)) return
  haptics.light()
  void router.push(to)
}
</script>

<template>
  <!-- iOS: UITabBar 49pt + blur · Android: M3 NavigationBar 80dp with pill indicator -->
  <nav class="wz-nav" :class="isIos ? 'is-ios' : 'is-android'" aria-label="Hauptnavigation">
    <button
      v-for="t in tabs"
      :key="t.to"
      type="button"
      class="wz-nav-item"
      :class="{ active: isActive(t.to) }"
      :aria-current="isActive(t.to) ? 'page' : undefined"
      @click="go(t.to)"
    >
      <span class="wz-nav-icon"><q-icon :name="pIcon(t.icon)" :size="isIos ? '26px' : '24px'" /></span>
      <span class="wz-nav-label">{{ t.label }}</span>
    </button>
  </nav>
</template>

<style scoped lang="scss">
.wz-nav { flex: none; display: flex; position: relative; z-index: 20; padding-bottom: var(--wz-safe-bottom); }
.wz-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 0; background: transparent; font: inherit; color: var(--wz-muted); cursor: pointer; position: relative; }
.wz-nav-item.active { color: var(--wz-ink); }

/* Android / Web — Material 3 */
.is-android { height: calc(var(--wz-nav-h) + var(--wz-safe-bottom)); background: #15181d; }
.is-android .wz-nav-item { gap: 4px; }
.is-android .wz-nav-icon { display: flex; align-items: center; justify-content: center; width: 64px; height: 32px; border-radius: 16px; transition: background 0.2s ease; }
.is-android .active .wz-nav-icon { background: rgba(0, 229, 153, 0.18); color: var(--wz-mint); }
.is-android .wz-nav-label { font-size: 12px; font-weight: 500; letter-spacing: 0.02em; }
.is-android .active .wz-nav-label { font-weight: 700; }

/* iOS — translucent tab bar, tinted active item, neon hairline */
.is-ios { height: calc(var(--wz-nav-h) + var(--wz-safe-bottom)); background: rgba(16, 18, 23, 0.72); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 0.5px solid rgba(255, 255, 255, 0.12); }
.is-ios .wz-nav-item { gap: 1px; padding-top: 2px; }
.is-ios .wz-nav-label { font-size: 10px; font-weight: 500; }
.is-ios .active { color: var(--wz-mint); }
.is-ios .active::before { content: ''; position: absolute; top: -0.5px; left: 22%; right: 22%; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #ff2d95, #60efff); box-shadow: 0 0 10px rgba(96, 239, 255, 0.6); }
</style>
