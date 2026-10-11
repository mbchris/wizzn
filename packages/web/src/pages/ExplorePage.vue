<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { FieldDto, SearchTopicDto, UnitTileDto } from '@wizzn/shared'
import { api, ensureSession } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { useFeedFilter } from 'src/composables/useFeedFilter'
import { useHaptics } from 'src/composables/useHaptics'
import { fieldEmoji } from 'src/utils/fields'
import UnitGrid from 'components/UnitGrid.vue'

/** Tab 2 "Explore Topics": catalogue of the 5 core domains (LAYOUT.md §1) */
const router = useRouter()
const { pIcon, isIos } = usePlatform()
const haptics = useHaptics()
const { me } = useProgress()
const { fields, filter, stale, loadFields } = useFeedFilter()
const error = ref('')
const following = ref<string | null>(null)

const mine = computed(() => new Set(me.value?.interests.map((i) => i.fieldId) ?? []))

/* Search (spec: knowledge stream §6): Instagram-style grid, never a count or a full list */
const SEARCH_DEBOUNCE_MS = 300
const query = ref('')
const tiles = ref<UnitTileDto[]>([])
const topics = ref<SearchTopicDto[]>([])
const cursor = ref<string | null>(null)
const hasMore = ref(true)
const searching = ref(false)
const searchError = ref('')
const active = computed(() => query.value.trim().length >= 2)
let requestId = 0
let debounce: ReturnType<typeof setTimeout> | undefined

async function runSearch(reset: boolean): Promise<void> {
  if (!reset && (searching.value || !hasMore.value)) return
  const id = ++requestId
  searching.value = true
  searchError.value = ''
  try {
    const q = active.value ? query.value.trim() : ''
    const page = await api.search(q, reset ? null : cursor.value)
    // A newer query superseded this one while it was in flight
    if (id !== requestId) return
    if (reset) {
      tiles.value = []
      topics.value = page.topics
    }
    const known = new Set(tiles.value.map((t) => t.id))
    tiles.value.push(...page.items.filter((t) => !known.has(t.id)))
    cursor.value = page.cursor
    hasMore.value = page.cursor !== null
  } catch (e) {
    if (id !== requestId) return
    console.warn('search failed', e)
    searchError.value = 'Suche gerade nicht möglich.'
  } finally {
    if (id === requestId) searching.value = false
  }
}

watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => void runSearch(true), SEARCH_DEBOUNCE_MS)
})
onUnmounted(() => clearTimeout(debounce))

function openTile(t: UnitTileDto): void {
  haptics.light()
  void router.push(`/unit/${t.id}`)
}

function openTopic(t: SearchTopicDto): void {
  const f = fields.value.find((x) => x.id === t.fieldId)
  if (!f) return
  if (mine.value.has(f.id)) open(f)
  else void follow(f)
}

onMounted(async () => {
  try {
    const [m] = await Promise.all([me.value ? Promise.resolve(me.value) : ensureSession(), loadFields()])
    me.value = m
  } catch {
    error.value = 'Themen konnten nicht geladen werden.'
  }
  // "Für dich" grid below the field catalogue
  void runSearch(true)
})

function open(f: FieldDto): void {
  haptics.light()
  filter.value = f.slug
  void router.push('/feed')
}

async function follow(f: FieldDto): Promise<void> {
  const m = me.value
  if (!m) return
  following.value = f.id
  try {
    me.value = await api.saveInterests({
      fieldIds: [...mine.value, f.id],
      themeIds: m.interests.flatMap((i) => (i.themeId ? [i.themeId] : [])),
      formats: m.formats,
      timezone: m.timezone,
    })
    stale.value = true
    open(f)
  } catch {
    error.value = 'Konnte das Gebiet nicht hinzufügen. Versuch es noch einmal.'
  } finally {
    following.value = null
  }
}
</script>

<template>
  <div class="wz-tab-page">
    <h1 class="wz-title q-mt-none q-mb-xs">Themen entdecken</h1>
    <q-input
      v-model="query"
      class="wz-search q-mb-md"
      :class="isIos ? 'is-ios' : 'is-android'"
      dark
      dense
      borderless
      clearable
      placeholder="Interessen suchen – z. B. Protein, ETF, Schlaf"
      input-class="wz-search-input"
      aria-label="Interessen suchen"
    >
      <template #prepend><q-icon :name="pIcon('search')" size="20px" /></template>
    </q-input>

    <template v-if="active">
      <div v-if="topics.length" class="wz-topic-chips">
        <button v-for="t in topics" :key="`${t.fieldId}:${t.themeId}`" type="button" class="wz-chip-topic" :class="`wz-field-${t.fieldSlug}`" @click="openTopic(t)">
          <span aria-hidden="true">{{ fieldEmoji(t.fieldSlug) }}</span>{{ t.nameDe }}
          <q-icon v-if="!mine.has(t.fieldId)" :name="pIcon('add')" size="16px" />
        </button>
      </div>
      <div v-if="searchError" class="wz-glass q-pa-md q-mb-md">{{ searchError }}</div>
      <div v-else-if="!searching && !tiles.length" class="wz-no-hits">
        <div class="wz-no-hits-emoji">🔭</div>
        <p>Dazu haben wir noch nichts. Probier einen anderen Begriff.</p>
      </div>
      <UnitGrid :items="tiles" :loading="searching" :has-more="hasMore" @more="runSearch(false)" @open="openTile" />
    </template>

    <template v-else>
    <p class="wz-sub">Tippe auf ein Gebiet, um deinen Stream darauf zu fokussieren.</p>

    <div v-if="error" class="wz-glass q-pa-md q-mb-md">{{ error }}</div>
    <div v-if="!fields.length && !error" class="flex flex-center q-pa-xl"><q-spinner-dots size="40px" color="white" /></div>

    <div class="wz-grid">
      <article v-for="f in fields" :key="f.id" class="wz-topic" :class="`wz-field-${f.slug}`">
        <button type="button" class="wz-topic-main" :disabled="!mine.has(f.id)" @click="open(f)">
          <span class="wz-topic-emoji">{{ fieldEmoji(f.slug) }}</span>
          <span class="wz-topic-name">{{ f.nameDe }}</span>
          <span class="wz-topic-themes">{{ f.themes.slice(0, 4).map((t) => t.nameDe).join(' · ') }}</span>
        </button>
        <div class="wz-topic-foot">
          <span v-if="mine.has(f.id)" class="wz-following"><q-icon :name="pIcon('check')" size="16px" />Folge ich</span>
          <q-btn v-else unelevated rounded dense no-caps class="wz-follow" :loading="following === f.id" :icon="pIcon('add')" label="Folgen" @click="follow(f)" />
        </div>
      </article>
    </div>

    <q-btn flat rounded no-caps color="white" class="full-width q-mt-lg" :icon="pIcon('settings')" label="Themen anpassen" @click="router.push('/onboarding')" />

    <template v-if="tiles.length">
      <h2 class="wz-for-you">Für dich</h2>
      <UnitGrid :items="tiles" :loading="searching" :has-more="hasMore" @more="runSearch(false)" @open="openTile" />
    </template>
    </template>
  </div>
</template>

<style scoped lang="scss">
.wz-sub { color: var(--wz-muted); margin: 0 0 20px; }
.wz-search { padding: 0 12px; background: var(--wz-surface-2); border: 1px solid var(--wz-line); }
/* iOS: rounded UISearchBar · Android: M3 search bar (full pill, taller) */
.wz-search.is-ios { border-radius: 10px; }
.wz-search.is-android { border-radius: 28px; padding: 4px 16px; }
.wz-topic-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.wz-chip-topic { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1.5px solid color-mix(in srgb, var(--wz-glow) 60%, transparent); background: color-mix(in srgb, var(--wz-glow) 12%, transparent); color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.wz-no-hits { text-align: center; color: var(--wz-muted); padding: 32px 16px; }
.wz-no-hits-emoji { font-size: 44px; }
.wz-for-you { font-family: var(--wz-font-display); font-size: 18px; font-weight: 800; margin: 28px 0 12px; }
.wz-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.wz-topic { position: relative; display: flex; flex-direction: column; border-radius: 22px; min-height: 168px; overflow: hidden; border: 1.5px solid color-mix(in srgb, var(--wz-glow) 55%, transparent); background: radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--wz-a) 28%, transparent), transparent 60%), radial-gradient(100% 80% at 100% 100%, color-mix(in srgb, var(--wz-c) 18%, transparent), transparent 60%), var(--wz-field-bg); box-shadow: 0 0 18px color-mix(in srgb, var(--wz-glow) 18%, transparent); }
.wz-topic:last-child:nth-child(odd) { grid-column: 1 / -1; min-height: 132px; }
.wz-topic-main { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px 16px 4px; border: 0; background: transparent; color: #fff; font: inherit; text-align: left; cursor: pointer; }
.wz-topic-main:disabled { cursor: default; color: #fff; }
.wz-topic-emoji { font-size: 34px; line-height: 1; margin-bottom: 6px; }
.wz-topic-name { font-family: var(--wz-font-display); font-weight: 800; font-size: 18px; }
.wz-topic-themes { font-size: 12px; line-height: 1.35; color: var(--wz-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wz-topic-foot { padding: 6px 12px 12px 16px; }
.wz-following { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; color: var(--wz-glow); }
.wz-follow { background: linear-gradient(90deg, var(--wz-a), var(--wz-c)); color: var(--wz-on-accent); font-weight: 700; padding: 2px 12px; }
</style>
