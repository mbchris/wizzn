<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FieldDto } from '@wizzn/shared'
import { api, ensureSession } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import { useFeedFilter } from 'src/composables/useFeedFilter'
import { fieldEmoji } from 'src/utils/fields'

const router = useRouter()
const { pIcon } = usePlatform()
const step = ref<1 | 2>(1)
const fields = ref<FieldDto[]>([])
const fieldIds = ref<string[]>([])
const themeIds = ref<string[]>([])
const error = ref('')
const saving = ref(false)

const { stale } = useFeedFilter()
/** Re-onboarding from the app (gear icon) can be dismissed */
const canClose = ref(false)
const chosenFields = computed(() => fields.value.filter((f) => fieldIds.value.includes(f.id)))

onMounted(async () => {
  try {
    const me = await ensureSession()
    fields.value = await api.fields()
    // Re-onboarding keeps previous choices
    fieldIds.value = [...new Set(me.interests.map((i) => i.fieldId))]
    canClose.value = me.interests.length > 0
    themeIds.value = me.interests.flatMap((i) => (i.themeId ? [i.themeId] : []))
  } catch {
    error.value = 'Keine Verbindung zum Server. Bitte später erneut versuchen.'
  }
})

const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

async function finish(): Promise<void> {
  saving.value = true
  try {
    await api.saveInterests({
      fieldIds: fieldIds.value,
      themeIds: themeIds.value.filter((t) => chosenFields.value.some((f) => f.themes.some((th) => th.id === t))),
      // Not user-selectable: the feed always mixes slides and audio
      formats: ['audio', 'written'],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    stale.value = true
    await router.replace('/feed')
  } catch {
    error.value = 'Speichern hat nicht geklappt. Versuch es noch einmal.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <q-layout>
    <q-page-container>
      <q-page class="wz-onb column no-wrap">
        <div class="row items-center q-mb-md">
          <q-btn v-if="step > 1" flat round dense :icon="pIcon('back')" color="white" aria-label="Zurück" @click="step = 1" />
          <q-btn v-else-if="canClose" flat round dense :icon="pIcon('close')" color="white" aria-label="Schließen" @click="router.replace('/feed')" />
          <q-space />
          <div class="wz-dots row q-gutter-xs"><span v-for="n in 2" :key="n" :class="{ on: n <= step }" /></div>
        </div>

        <template v-if="step === 1">
          <div class="wz-logo">wizzn</div>
          <div class="wz-title text-center">Wähle dein Wachstum</div>
          <div class="wz-lead text-center">Tausche Doomscrolling gegen Wissen. 3+ Gebiete empfohlen.</div>
          <div class="wz-pills">
            <button
              v-for="f in fields"
              :key="f.id"
              type="button"
              class="wz-pick"
              :class="[`wz-field-${f.slug}`, { selected: fieldIds.includes(f.id) }]"
              :aria-pressed="fieldIds.includes(f.id)"
              @click="fieldIds = toggle(fieldIds, f.id)"
            >
              <span class="wz-pick-emoji">{{ fieldEmoji(f.slug) }}</span>{{ f.nameDe }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="wz-title">Was interessiert dich besonders?</div>
          <div class="wz-lead">Optional – diese Themen zeigen wir dir zuerst.</div>
          <div v-for="f in chosenFields" :key="f.id" class="q-mb-lg" :class="`wz-field-${f.slug}`">
            <div class="text-weight-bold q-mb-sm">{{ fieldEmoji(f.slug) }} {{ f.nameDe }}</div>
            <div class="row q-gutter-sm">
              <button v-for="t in f.themes" :key="t.id" type="button" class="wz-chip" :class="{ on: themeIds.includes(t.id) }" :aria-pressed="themeIds.includes(t.id)" @click="themeIds = toggle(themeIds, t.id)">{{ t.nameDe }}</button>
            </div>
          </div>
        </template>


        <q-space />
        <div v-if="error" class="text-negative q-mb-sm">{{ error }}</div>
        <q-btn
          unelevated
          rounded
          no-caps
          size="lg"
          class="wz-cta full-width q-mt-lg"
          :disable="fieldIds.length === 0"
          :loading="saving"
          :label="step < 2 ? 'Weiter' : 'Starte deine Reise'"
          @click="step < 2 ? (step = 2) : finish()"
        />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped lang="scss">
.wz-onb { padding: calc(20px + var(--wz-safe-top)) 20px calc(24px + var(--wz-safe-bottom)); min-height: 100dvh; background: radial-gradient(90% 40% at 50% 0%, rgba(0, 229, 153, 0.12), transparent 70%), var(--wz-bg); }
.wz-dots span { display: inline-block; width: 22px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.16); }
.wz-dots span.on { background: var(--wz-brand); }
.wz-logo { text-align: center; font-family: var(--wz-font-display); font-weight: 900; font-size: 34px; letter-spacing: -0.02em; margin-bottom: 8px; background: linear-gradient(90deg, #00ff87, #60efff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.wz-lead { color: var(--wz-muted); font-size: 16px; margin: 8px 0 28px; }

/* Neon outlined category pills: gradient border via padding-box/border-box */
.wz-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; }
.wz-pick {
  display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 20px; border-radius: 999px; cursor: pointer;
  font: inherit; font-weight: 700; font-size: 17px; color: rgba(255, 255, 255, 0.75);
  border: 2px solid transparent;
  background: linear-gradient(var(--wz-bg), var(--wz-bg)) padding-box, linear-gradient(90deg, color-mix(in srgb, var(--wz-a) 45%, #333), color-mix(in srgb, var(--wz-c) 45%, #333)) border-box;
  transition: transform 0.15s ease, box-shadow 0.25s ease, color 0.2s;
}
.wz-pick.selected {
  color: #fff;
  background: linear-gradient(color-mix(in srgb, var(--wz-glow) 14%, var(--wz-bg)), color-mix(in srgb, var(--wz-glow) 14%, var(--wz-bg))) padding-box, linear-gradient(90deg, var(--wz-a), var(--wz-c)) border-box;
  box-shadow: 0 0 18px color-mix(in srgb, var(--wz-glow) 55%, transparent), inset 0 0 12px color-mix(in srgb, var(--wz-glow) 25%, transparent);
  transform: scale(1.03);
}
.wz-pick:active { transform: scale(0.97); }
.wz-pick-emoji { font-size: 22px; }

.wz-chip { min-height: 40px; border: 1.5px solid rgba(255, 255, 255, 0.22); border-radius: 999px; padding: 8px 14px; background: transparent; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.wz-chip.on { border-color: transparent; background: linear-gradient(90deg, var(--wz-a), var(--wz-c)); color: var(--wz-on-accent); box-shadow: 0 0 12px color-mix(in srgb, var(--wz-glow) 45%, transparent); }
</style>
