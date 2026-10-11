<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Notify } from 'quasar'
import type { FeedbackVote, FeedUnitDto } from '@wizzn/shared'
import { api, ApiError } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { useFeedFilter } from 'src/composables/useFeedFilter'
import { useVault } from 'src/composables/useVault'
import { useHaptics } from 'src/composables/useHaptics'
import UnitCard from 'components/UnitCard.vue'
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
    vault.seed(page.units)
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

/* Knowledge stream: "mehr davon" pulls linked units in right behind the current card, "weniger davon" skips its series */
function scrollToCard(i: number): void {
  const el = scroller.value
  el?.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' })
}

async function onVote(unit: FeedUnitDto, vote: FeedbackVote): Promise<void> {
  const at = units.value.findIndex((u) => u.id === unit.id)
  if (at < 0) return
  try {
    const { next } = await api.feedback(unit.id, vote)
    if (vote === 1) {
      const known = new Set(units.value.map((u) => u.id))
      const fresh = next.filter((u) => !known.has(u.id))
      units.value.splice(at + 1, 0, ...fresh)
      vault.seed(fresh)
    } else if (unit.series) {
      units.value = units.value.filter((u, i) => i <= at || u.series !== unit.series)
    }
    Notify.create({ message: vote === 1 ? 'Mehr davon ✨' : 'Weniger davon – verstanden', color: vote === 1 ? 'positive' : 'grey-8', position: 'top', timeout: 1200 })
  } catch (e) {
    console.warn('feedback failed', e)
    Notify.create({ message: 'Feedback konnte nicht gespeichert werden.', color: 'negative', position: 'top', timeout: 1800 })
    return
  }
  await nextTick()
  const pos = visibleUnits.value.findIndex((u) => u.id === unit.id)
  if (pos >= 0) scrollToCard(pos + 1)
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
      <UnitCard
        v-for="(u, i) in visibleUnits"
        :key="u.id"
        :unit="u"
        :index="i"
        :active="pageActive && i === active"
        :mount-content="mounted(i)"
        :preload="i === active + 1"
        @vote="onVote(u, $event)"
      />

      <section class="wz-end">
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
/* End card shares the snap behaviour of UnitCard */
.wz-end { height: 100%; scroll-snap-align: start; scroll-snap-stop: always; position: relative; overflow: hidden; }
.wz-end { background: var(--wz-bg); }
.wz-end-inner { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 32px; }
.wz-end-inner p { margin: 0; color: var(--wz-muted); max-width: 320px; }
.wz-end-emoji { font-size: 52px; }
</style>
