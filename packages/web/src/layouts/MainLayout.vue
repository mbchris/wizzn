<script setup lang="ts">
import { ref, watch } from 'vue'
import BottomNav from 'components/BottomNav.vue'
import WeeklyShieldDialog from 'components/WeeklyShieldDialog.vue'
import { useProgress } from 'src/composables/useProgress'

const { lastRewards } = useProgress()
const shieldOpen = ref(false)

// LAYOUT.md "Dopamine Shield": celebrate the 5-unit weekly goal right after the unit that completes it
watch(lastRewards, (r) => {
  if (r?.weeklyGoalReached) setTimeout(() => (shieldOpen.value = true), 900)
})
</script>

<template>
  <div class="wz-shell">
    <main class="wz-main">
      <router-view v-slot="{ Component }">
        <!-- The feed stays alive across tabs: served units are not re-served, and playback position survives -->
        <keep-alive include="FeedPage"><component :is="Component" /></keep-alive>
      </router-view>
    </main>
    <BottomNav />
    <WeeklyShieldDialog v-model="shieldOpen" />
  </div>
</template>

<style lang="scss">
.wz-shell { height: 100dvh; display: flex; flex-direction: column; background: var(--wz-bg); }
.wz-main { flex: 1; min-height: 0; position: relative; overflow: hidden; }
/* Scrollable tab pages (Explore, Streak) */
.wz-tab-page { height: 100%; overflow-y: auto; padding: calc(20px + var(--wz-safe-top)) 16px 32px; overscroll-behavior: contain; }
</style>
