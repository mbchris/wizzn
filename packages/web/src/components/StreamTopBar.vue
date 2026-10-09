<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { WEEKLY_GOAL } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { useFeedFilter } from 'src/composables/useFeedFilter'

const router = useRouter()
const { pIcon, isIos } = usePlatform()
const { progress, me } = useProgress()
const { filter, fields, loadFields } = useFeedFilter()

const done = computed(() => progress.value?.week.done ?? 0)
const goal = computed(() => progress.value?.week.goal ?? WEEKLY_GOAL)
/** Filter chips: the fields the user follows (all fields until the session is known) */
const chips = computed(() => {
  const mine = new Set(me.value?.interests.map((i) => i.fieldId) ?? [])
  return mine.size ? fields.value.filter((f) => mine.has(f.id)) : fields.value
})

// Counter pill pops whenever a unit is completed (LAYOUT.md §3 "Immediate Feedback")
const bump = ref(false)
watch(done, (n, o) => {
  if (n <= o) return
  bump.value = false
  requestAnimationFrame(() => (bump.value = true))
  setTimeout(() => (bump.value = false), 700)
})

onMounted(() => void loadFields().catch((e: unknown) => console.warn('fields load failed', e)))
</script>

<template>
  <header class="wz-topbar" :class="isIos ? 'is-ios' : 'is-android'">
    <button type="button" class="wz-units" :class="{ bump, full: done >= goal }" :aria-label="`${done} von ${goal} Einheiten diese Woche`" @click="router.push('/progress')">
      <span aria-hidden="true">🔥</span><b>{{ done }}/{{ goal }}</b>
    </button>
    <div class="wz-filters" role="tablist" aria-label="Gebiet filtern">
      <button type="button" role="tab" class="wz-chip all" :class="{ on: filter === null }" :aria-selected="filter === null" @click="filter = null">Alle</button>
      <button
        v-for="f in chips"
        :key="f.id"
        type="button"
        role="tab"
        class="wz-chip"
        :class="[`wz-field-${f.slug}`, { on: filter === f.slug }]"
        :aria-selected="filter === f.slug"
        @click="filter = filter === f.slug ? null : f.slug"
      >
        {{ f.nameDe }}
      </button>
    </div>
    <button type="button" class="wz-icon-btn" aria-label="Interessen &amp; Einstellungen" @click="router.push('/onboarding')">
      <q-icon :name="pIcon('gear')" size="22px" />
    </button>
  </header>
</template>

<style scoped lang="scss">
.wz-topbar { position: absolute; z-index: 10; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: var(--wz-safe-top) 6px 0 12px; height: calc(var(--wz-topbar-h) + var(--wz-safe-top)); }
/* iOS: ultra-thin material · Android: surface at elevation 1 */
.is-ios { background: rgba(11, 12, 16, 0.5); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border-bottom: 0.5px solid rgba(255, 255, 255, 0.1); }
.is-android { background: rgba(27, 30, 36, 0.94); box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04); }

.wz-units { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(255, 140, 50, 0.55); background: rgba(255, 120, 40, 0.14); color: #ffb067; font: inherit; font-size: 14px; cursor: pointer; }
.wz-units b { font-weight: 800; }
.wz-units.full { border-color: var(--wz-mint); background: rgba(0, 229, 153, 0.14); color: var(--wz-mint); }
.wz-units.bump { animation: wz-bump 0.6s cubic-bezier(0.3, 1.6, 0.5, 1); }
@keyframes wz-bump { 0% { transform: scale(1); } 40% { transform: scale(1.28); box-shadow: 0 0 18px rgba(255, 140, 50, 0.7); } 100% { transform: scale(1); } }

.wz-filters { flex: 1; min-width: 0; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; mask-image: linear-gradient(90deg, #000 85%, transparent); -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); padding-right: 16px; }
.wz-filters::-webkit-scrollbar { display: none; }
.wz-chip { flex: none; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: var(--wz-muted); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.wz-chip.on { background: linear-gradient(90deg, var(--wz-a), var(--wz-c)); color: var(--wz-on-accent); font-weight: 700; box-shadow: 0 0 14px color-mix(in srgb, var(--wz-glow) 45%, transparent); }
.wz-chip.all.on { background: #fff; color: #0b0c10; box-shadow: none; }
</style>
