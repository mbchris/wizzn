<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AudioUnit, FeedUnitDto, WrittenUnit } from '@wizzn/shared'
import { api, ApiError } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { useFeedFilter } from 'src/composables/useFeedFilter'
import { useVault } from 'src/composables/useVault'
import { useHaptics } from 'src/composables/useHaptics'
import { fieldEmoji } from 'src/utils/fields'
import AudioUnitView from 'components/AudioUnitView.vue'
import WrittenUnitView from 'components/WrittenUnitView.vue'
import AccountSheet from 'components/AccountSheet.vue'
import StreamTopBar from 'components/StreamTopBar.vue'

defineOptions({ name: 'FeedPage' })

const router = useRouter()
const { pIcon } = usePlatform()
const haptics = useHaptics()
const vault = useVault()
const { filter, stale, fields } = useFeedFilter()
const units = ref<FeedUnitDto[]>([])
const active = ref(0)
const pageActive = ref(true)
const loading = ref(false)
const exhausted = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
const prefetched = new Set<string>()
const { progress, me, capReached, lastRewards, refresh } = useProgress()
const accountOpen = ref(false)
const ACCOUNT_PROMPT_KEY = 'wizzn.accountPromptShown'

const filtered = computed(() => (filter.value ? units.value.filter((u) => u.field.slug === filter.value) : units.value))
/** After the cap, cards beyond the current one can no longer be completed, so the paywall follows directly */
const visibleUnits = computed(() => (capReached.value ? filtered.value.slice(0, active.value + 1) : filtered.value))
const filterName = computed(() => fields.value.find((f) => f.slug === filter.value)?.nameDe ?? '')

function promptShownBefore(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

// Spec §2: account prompt after the first completed unit (needed to keep a streak)
watch(lastRewards, (r) => {
  if (!r?.newBadges.includes('first_unit') || !me.value?.isAnonymous || promptShownBefore()) return
  try {
    localStorage.setItem(ACCOUNT_PROMPT_KEY, '1')
  } catch {
    // storage unavailable: the prompt may show again next session
  }
  setTimeout(() => (accountOpen.value = true), 1200)
})

const isWritten = (u: FeedUnitDto): u is FeedUnitDto & { content: WrittenUnit } => u.content.format === 'written'
const asAudio = (u: FeedUnitDto) => u as FeedUnitDto & { content: AudioUnit }
/** Only the active card and its neighbours mount their content (keeps the WebView light) */
const mounted = (i: number): boolean => Math.abs(i - active.value) <= 1

async function loadMore(): Promise<void> {
  if (loading.value || exhausted.value || capReached.value) return
  loading.value = true
  error.value = ''
  try {
    const page = await api.feed(10)
    if (page.cap.reached) capReached.value = true
    else if (page.units.length === 0) exhausted.value = true
    const known = new Set(units.value.map((u) => u.id))
    const first = units.value.length === 0
    units.value.push(...page.units.filter((u) => !known.has(u.id)))
    // Chrome re-snaps to the previously snapped element (the end card) when content is inserted above it
    if (first && units.value.length) {
      await nextTick()
      scroller.value?.scrollTo({ top: 0 })
      active.value = 0
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await router.replace('/onboarding')
    else error.value = 'Feed konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

// A field filter can leave few matching cards: keep pulling pages (bounded) until there is something ahead
let autoLoads = 0
watch([() => filtered.value.length, loading], ([n, busy]) => {
  if (busy || !filter.value || exhausted.value || capReached.value || error.value) return
  if (n < active.value + 3 && autoLoads < 4) {
    autoLoads++
    void loadMore()
  }
})
watch(filter, () => {
  // A pending reload (interests changed) runs on activation instead
  if (stale.value) return
  autoLoads = 0
  active.value = 0
  scroller.value?.scrollTo({ top: 0 })
  if (filtered.value.length < 3) void loadMore()
})

function prefetch(from: number): void {
  for (const u of visibleUnits.value.slice(from + 1, from + 4)) {
    for (const url of Object.values(u.media)) {
      if (prefetched.has(url) || /\.(mp3|wav|m4a)$/.test(url)) continue
      prefetched.add(url)
      new Image().src = url
    }
  }
}

function observeCards(): void {
  observer?.disconnect()
  scroller.value?.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => observer?.observe(el))
}
watch(() => visibleUnits.value.map((u) => u.id).join(), () => void nextTick(observeCards))

// Snap feedback: haptic tick as a new unit settles (LAYOUT.md §4)
watch(active, (n, o) => {
  if (n !== o) haptics.snap()
})

/* Double-tap "Save to Brain" (LAYOUT.md §3) */
interface Brain { key: number; unit: string; x: number; y: number }
const brains = ref<Brain[]>([])
let lastTap = { t: 0, x: 0, y: 0 }
let brainKey = 0

function onTap(e: PointerEvent, unitId: string): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, a, [role="slider"], audio')) return
  const now = performance.now()
  const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40
  if (now - lastTap.t < 320 && near) {
    lastTap = { t: 0, x: 0, y: 0 }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const b = { key: ++brainKey, unit: unitId, x: e.clientX - box.left, y: e.clientY - box.top }
    brains.value.push(b)
    setTimeout(() => (brains.value = brains.value.filter((x) => x.key !== b.key)), 900)
    vault.save(unitId)
    haptics.light()
    return
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY }
}

function toggleSave(unitId: string): void {
  vault.toggle(unitId)
  haptics.light()
}

function reset(): void {
  autoLoads = 0
  units.value = []
  active.value = 0
  exhausted.value = false
  error.value = ''
  capReached.value = false
  savedTop = 0
  scroller.value?.scrollTo({ top: 0 })
  void loadMore()
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        active.value = Number((e.target as HTMLElement).dataset.index)
        prefetch(active.value)
        if (active.value >= visibleUnits.value.length - 3) void loadMore()
      }
    },
    { root: scroller.value, threshold: 0.6 },
  )
  // The server re-reports the cap with every page; a purchase or a new day must not stay blocked by stale state
  capReached.value = false
  stale.value = false
  void loadMore()
  refresh().catch((e: unknown) => console.warn('progress load failed', e))
})
// Keep-alive detaches the DOM, which drops the scroll position: restore the unit the user was on
let savedTop = 0
onActivated(() => {
  pageActive.value = true
  if (stale.value) {
    stale.value = false
    reset()
  } else if (savedTop) scroller.value?.scrollTo({ top: savedTop })
})
// onDeactivated runs after the DOM is detached (scrollTop already 0), so track it while scrolling
const trackScroll = (): void => void (savedTop = scroller.value?.scrollTop ?? savedTop)
onDeactivated(() => (pageActive.value = false))
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="wz-stream">
    <StreamTopBar />
    <div ref="scroller" class="wz-feed" @scroll.passive="trackScroll">
      <article
        v-for="(u, i) in visibleUnits"
        :key="u.id"
        :data-index="i"
        class="wz-card"
        :class="[`wz-field-${u.field.slug}`, { 'is-active': i === active }]"
        @pointerup="onTap($event, u.id)"
      >
        <div class="wz-card-inner">
          <div class="wz-card-head">
            <span class="wz-tag">
              <span aria-hidden="true">{{ fieldEmoji(u.field.slug) }}</span>{{ u.field.nameDe }}
              <template v-if="u.discovery"><span class="wz-dot">•</span>Entdecken</template>
            </span>
            <button
              type="button"
              class="wz-icon-btn wz-save"
              :class="{ saved: vault.isSaved(u.id) }"
              :aria-pressed="vault.isSaved(u.id)"
              aria-label="Im Gehirn speichern"
              @click="toggleSave(u.id)"
            >
              <q-icon :name="vault.isSaved(u.id) ? pIcon('bookmark_filled') : pIcon('bookmark')" size="24px" />
            </button>
          </div>
          <h2 class="wz-title wz-unit-title" :class="{ compact: isWritten(u) }">{{ u.title }}</h2>
          <div class="wz-unit-body">
            <template v-if="mounted(i)">
              <WrittenUnitView v-if="isWritten(u)" :unit="u" :active="pageActive && i === active" />
              <AudioUnitView v-else :unit="asAudio(u)" :active="pageActive && i === active" :preload="i === active + 1" />
            </template>
          </div>
        </div>
        <span v-for="b in brains.filter((x) => x.unit === u.id)" :key="b.key" class="wz-brain" :style="{ left: `${b.x}px`, top: `${b.y}px` }" aria-hidden="true">🧠</span>
      </article>

      <section class="wz-card wz-end">
        <div class="wz-end-inner">
          <template v-if="capReached">
            <div class="wz-end-emoji">🌙</div>
            <div class="wz-title">Für heute geschafft!</div>
            <p>Du hast deine {{ progress?.cap.limit ?? 3 }} Gratis-Einheiten für heute gelernt. Morgen geht’s weiter – oder du lernst mit Premium ohne Limit.</p>
            <q-btn class="wz-cta" rounded unelevated no-caps size="lg" label="Premium entdecken ✨" @click="router.push('/premium')" />
            <q-btn flat no-caps color="white" label="Meinen Fortschritt ansehen" @click="router.push('/progress')" />
          </template>
          <template v-else-if="loading"><q-spinner-dots size="48px" color="white" /></template>
          <template v-else-if="error">
            <div class="text-h6">{{ error }}</div>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" :icon="pIcon('refresh')" label="Nochmal versuchen" @click="loadMore" />
          </template>
          <template v-else-if="filter && !filtered.length">
            <div class="wz-end-emoji">🔎</div>
            <div class="wz-title">Gerade nichts Neues in {{ filterName }}</div>
            <p>Schau später wieder vorbei oder lerne quer durch alle Gebiete.</p>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" label="Alle zeigen" @click="filter = null" />
          </template>
          <template v-else-if="exhausted">
            <div class="wz-end-emoji">🌱</div>
            <div class="wz-title">Du bist durch!</div>
            <p>Neue Wissenshappen kommen bald. Oder entdecke weitere Gebiete.</p>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" label="Themen entdecken" @click="router.push('/explore')" />
          </template>
        </div>
      </section>
    </div>
    <AccountSheet v-model="accountOpen" reason="streak" />
  </div>
</template>

<style scoped lang="scss">
.wz-stream { position: relative; height: 100%; }
.wz-feed { height: 100%; overflow-y: auto; scroll-snap-type: y mandatory; overscroll-behavior: contain; scrollbar-width: none; }
.wz-feed::-webkit-scrollbar { display: none; }

.wz-card {
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  position: relative;
  overflow: hidden;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  /* Category tone + a soft glow from the top, like a lit stage */
  background:
    radial-gradient(120% 55% at 50% 0%, color-mix(in srgb, var(--wz-glow) 20%, transparent), transparent 65%),
    radial-gradient(90% 40% at 50% 100%, color-mix(in srgb, var(--wz-b) 10%, transparent), transparent 70%),
    var(--wz-field-bg);
}
.wz-card-inner { height: 100%; display: flex; flex-direction: column; padding: calc(var(--wz-topbar-h) + var(--wz-safe-top) + 10px) 20px 14px; }
/* Card-snap bounce: incoming unit overshoots ~4px, then settles (spring-like cubic-bezier) */
.wz-card.is-active .wz-card-inner { animation: wz-snap 0.55s cubic-bezier(0.25, 1.4, 0.45, 1); }
@keyframes wz-snap { 0% { transform: translateY(14px); opacity: 0.6; } 60% { transform: translateY(-4px); opacity: 1; } 100% { transform: translateY(0); } }

.wz-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 -10px 4px 0; }
.wz-dot { opacity: 0.6; margin: 0 2px; }
.wz-save { color: rgba(255, 255, 255, 0.85); }
.wz-save.saved { color: var(--wz-glow); filter: drop-shadow(0 0 6px var(--wz-glow)); }
.wz-unit-title { margin: 0 0 8px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wz-unit-title.compact { font-size: 18px; font-weight: 700; color: rgba(255, 255, 255, 0.82); -webkit-line-clamp: 2; }
.wz-unit-body { flex: 1; min-height: 0; }

.wz-brain { position: absolute; z-index: 5; font-size: 84px; line-height: 1; pointer-events: none; transform: translate(-50%, -50%); filter: drop-shadow(0 0 18px #ff2d95) drop-shadow(0 0 30px #60efff); animation: wz-brain 0.9s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
@keyframes wz-brain { 0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0; } 25% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; } 60% { transform: translate(-50%, -60%) scale(1); opacity: 1; } 100% { transform: translate(-50%, -130%) scale(0.9); opacity: 0; } }

.wz-end { background: var(--wz-bg); }
.wz-end-inner { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 32px; }
.wz-end-inner p { margin: 0; color: var(--wz-muted); max-width: 320px; }
.wz-end-emoji { font-size: 52px; }
</style>
