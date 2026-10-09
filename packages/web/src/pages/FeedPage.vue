<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { AudioUnit, FeedUnitDto, WrittenUnit } from '@wizzn/shared'
import { api, ApiError } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import AudioUnitView from 'components/AudioUnitView.vue'
import WrittenUnitView from 'components/WrittenUnitView.vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const { pIcon } = usePlatform()
const units = ref<FeedUnitDto[]>([])
const active = ref(0)
const loading = ref(false)
const exhausted = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
const prefetched = new Set<string>()

const isWritten = (u: FeedUnitDto): u is FeedUnitDto & { content: WrittenUnit } => u.content.format === 'written'
const asAudio = (u: FeedUnitDto) => u as FeedUnitDto & { content: AudioUnit }
/** Only the active card and its neighbours mount their content (keeps the WebView light) */
const mounted = (i: number): boolean => Math.abs(i - active.value) <= 1

async function loadMore(): Promise<void> {
  if (loading.value || exhausted.value) return
  loading.value = true
  error.value = ''
  try {
    const page = await api.feed(10)
    if (page.units.length === 0) exhausted.value = true
    const known = new Set(units.value.map((u) => u.id))
    units.value.push(...page.units.filter((u) => !known.has(u.id)))
    await nextTick()
    observeCards()
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await router.replace('/onboarding')
    else error.value = 'Feed konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

function prefetch(from: number): void {
  for (const u of units.value.slice(from + 1, from + 4)) {
    for (const url of Object.values(u.media)) {
      if (prefetched.has(url) || /\.(mp3|wav)$/.test(url)) continue
      prefetched.add(url)
      new Image().src = url
    }
  }
}

function observeCards(): void {
  scroller.value?.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => observer?.observe(el))
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        active.value = Number((e.target as HTMLElement).dataset.index)
        prefetch(active.value)
        if (active.value >= units.value.length - 3) void loadMore()
      }
    },
    { root: scroller.value, threshold: 0.6 },
  )
  void loadMore()
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <q-layout>
    <q-page-container>
      <div ref="scroller" class="wz-feed">
        <article v-for="(u, i) in units" :key="u.id" :data-index="i" class="wz-card wz-gradient" :class="`wz-field-${u.field.slug}`">
          <div class="wz-card-inner column no-wrap">
            <div class="row items-center q-mb-md">
              <span class="wz-pill">{{ u.field.nameDe }}</span>
              <span v-if="u.discovery" class="wz-pill q-ml-xs"><q-icon :name="pIcon('explore')" size="14px" />Entdecken</span>
              <q-space />
              <q-btn flat round dense color="white" :icon="pIcon('settings')" aria-label="Interessen ändern" @click="router.push('/onboarding')" />
            </div>
            <div class="wz-title q-mb-md">{{ u.title }}</div>
            <div class="col" style="min-height: 0">
              <template v-if="mounted(i)">
                <WrittenUnitView v-if="isWritten(u)" :unit="u" :active="i === active" />
                <AudioUnitView v-else :unit="asAudio(u)" :active="i === active" :preload="i === active + 1" />
              </template>
            </div>
          </div>
        </article>

        <section class="wz-card wz-end column flex-center text-center q-pa-xl">
          <template v-if="loading"><q-spinner-dots size="48px" color="white" /></template>
          <template v-else-if="error">
            <div class="text-h6 q-mb-md">{{ error }}</div>
            <q-btn rounded unelevated no-caps color="white" text-color="dark" :icon="pIcon('refresh')" label="Nochmal versuchen" @click="loadMore" />
          </template>
          <template v-else-if="exhausted">
            <div style="font-size: 48px">🌱</div>
            <div class="wz-title q-my-md">Du bist durch!</div>
            <div style="color: var(--wz-muted)">Neue Wissenshappen kommen bald. Oder wähle weitere Gebiete.</div>
            <q-btn class="q-mt-lg" rounded unelevated no-caps color="white" text-color="dark" label="Interessen ändern" @click="router.push('/onboarding')" />
          </template>
        </section>
      </div>
    </q-page-container>
  </q-layout>
</template>

<style scoped lang="scss">
.wz-feed { height: 100dvh; overflow-y: auto; scroll-snap-type: y mandatory; overscroll-behavior: contain; scrollbar-width: none; }
.wz-feed::-webkit-scrollbar { display: none; }
.wz-card { height: 100dvh; scroll-snap-align: start; scroll-snap-stop: always; position: relative; }
.wz-card-inner { height: 100%; padding: calc(16px + var(--wz-safe-top)) 20px calc(20px + var(--wz-safe-bottom)); }
.wz-end { background: var(--wz-bg); }
</style>
