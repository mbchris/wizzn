<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Notify } from 'quasar'
import type { FeedbackVote, FeedUnitDto } from '@wizzn/shared'
import { api, ApiError, ensureSession } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useVault } from 'src/composables/useVault'
import { useHaptics } from 'src/composables/useHaptics'
import { useVariantSwap } from 'src/composables/useVariantSwap'
import UnitCard from 'components/UnitCard.vue'

/**
 * Opens a unit from search or "Mein Gehirn" and continues through the knowledge graph:
 * every further swipe follows its links (series level+1, siblings, related) instead of the general feed.
 */
const route = useRoute()
const router = useRouter()
const { pIcon } = usePlatform()
const vault = useVault()
const haptics = useHaptics()
const units = ref<FeedUnitDto[]>([])
const active = ref(0)
const { swap } = useVariantSwap(units)
const loading = ref(false)
const ended = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
const CONTINUE_BATCH = 3

function add(list: FeedUnitDto[], at = units.value.length): void {
  const known = new Set(units.value.map((u) => u.id))
  const fresh = list.filter((u) => !known.has(u.id))
  units.value.splice(at, 0, ...fresh)
  vault.seed(fresh)
  // Chrome re-snaps to the previously snapped element (the end card) when content is inserted above it
  if (active.value === 0 && fresh.length) void nextTick(() => scroller.value?.scrollTo({ top: 0 }))
}

async function start(id: string): Promise<void> {
  units.value = []
  active.value = 0
  ended.value = false
  error.value = ''
  loading.value = true
  try {
    await ensureSession()
    add([await api.unit(id)])
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 404 ? 'Diesen Wissenshappen gibt es nicht mehr.' : 'Konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
  await continueStream()
}

async function continueStream(): Promise<void> {
  const last = units.value.at(-1)
  if (loading.value || ended.value || !last) return
  loading.value = true
  try {
    const more = await api.next(last.id, CONTINUE_BATCH, units.value.map((u) => u.id))
    if (!more.length) ended.value = true
    add(more)
  } catch (e) {
    console.warn('continuation failed', e)
  } finally {
    loading.value = false
  }
}

async function onVote(unit: FeedUnitDto, vote: FeedbackVote): Promise<void> {
  const at = units.value.findIndex((u) => u.id === unit.id)
  try {
    const { next } = await api.feedback(unit.id, vote)
    if (vote === 1) add(next, at + 1)
    else if (unit.series) units.value = units.value.filter((u, i) => i <= at || u.series !== unit.series)
    Notify.create({ message: vote === 1 ? 'Mehr davon ✨' : 'Weniger davon – verstanden', color: vote === 1 ? 'positive' : 'grey-8', position: 'top', timeout: 1200 })
  } catch (e) {
    console.warn('feedback failed', e)
    Notify.create({ message: 'Feedback konnte nicht gespeichert werden.', color: 'negative', position: 'top', timeout: 1800 })
  }
}

function observeCards(): void {
  observer?.disconnect()
  scroller.value?.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => observer?.observe(el))
}
watch(() => units.value.map((u) => u.id).join(), () => void nextTick(observeCards))
watch(active, (n, o) => n !== o && haptics.snap())
watch(() => route.params.id, (id) => typeof id === 'string' && void start(id))

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        active.value = Number((e.target as HTMLElement).dataset.index)
        if (active.value >= units.value.length - 2) void continueStream()
      }
    },
    { root: scroller.value, threshold: 0.6 },
  )
  void start(String(route.params.id))
})
onUnmounted(() => observer?.disconnect())

function close(): void {
  if (window.history.state?.back) router.back()
  else void router.replace('/explore')
}
</script>

<template>
  <div class="wz-viewer">
    <q-btn class="wz-viewer-back" flat round color="white" :icon="pIcon('back')" aria-label="Zurück" @click="close" />
    <div ref="scroller" class="wz-feed">
      <UnitCard
        v-for="(u, i) in units"
        :key="u.id"
        :unit="u"
        :index="i"
        :active="i === active"
        :mount-content="Math.abs(i - active) <= 1"
        :preload="i === active + 1"
        @vote="onVote(u, $event)"
        @swap="swap(u)"
      />
      <section class="wz-end">
        <div class="wz-end-inner">
          <q-spinner-dots v-if="loading" size="48px" color="white" />
          <template v-else-if="error">
            <div class="wz-end-emoji">🫥</div>
            <div class="wz-title">{{ error }}</div>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" label="Zurück" @click="close" />
          </template>
          <template v-else-if="ended">
            <div class="wz-end-emoji">🧭</div>
            <div class="wz-title">Ende dieses Pfads</div>
            <p>Hier geht’s gerade nicht tiefer. Dein Stream hat noch mehr für dich.</p>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" label="Zum Stream" @click="router.push('/feed')" />
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wz-viewer { position: relative; height: 100dvh; background: var(--wz-bg); }
.wz-viewer-back { position: absolute; z-index: 30; top: calc(var(--wz-safe-top) + 6px); left: 6px; background: rgba(0, 0, 0, 0.28); }
.wz-feed { height: 100%; overflow-y: auto; scroll-snap-type: y mandatory; overscroll-behavior: contain; scrollbar-width: none; }
.wz-feed::-webkit-scrollbar { display: none; }
/* The viewer has no top bar: the card head starts below the back button */
.wz-feed :deep(.wz-card-inner) { padding-top: calc(var(--wz-safe-top) + 56px); }
.wz-end { height: 100%; scroll-snap-align: start; background: var(--wz-bg); }
.wz-end-inner { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 32px; }
.wz-end-inner p { margin: 0; color: var(--wz-muted); max-width: 320px; }
.wz-end-emoji { font-size: 52px; }
</style>
