<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FieldDto } from '@wizzn/shared'
import { api, ensureSession } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useProgress } from 'src/composables/useProgress'
import { useFeedFilter } from 'src/composables/useFeedFilter'
import { useHaptics } from 'src/composables/useHaptics'
import { fieldEmoji } from 'src/utils/fields'

/** Tab 2 "Explore Topics": catalogue of the 5 core domains (LAYOUT.md §1) */
const router = useRouter()
const { pIcon } = usePlatform()
const haptics = useHaptics()
const { me } = useProgress()
const { fields, filter, stale, loadFields } = useFeedFilter()
const error = ref('')
const following = ref<string | null>(null)

const mine = computed(() => new Set(me.value?.interests.map((i) => i.fieldId) ?? []))

onMounted(async () => {
  try {
    const [m] = await Promise.all([me.value ? Promise.resolve(me.value) : ensureSession(), loadFields()])
    me.value = m
  } catch {
    error.value = 'Themen konnten nicht geladen werden.'
  }
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
  </div>
</template>

<style scoped lang="scss">
.wz-sub { color: var(--wz-muted); margin: 0 0 20px; }
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
