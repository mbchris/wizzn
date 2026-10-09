<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FieldDto, UnitFormat } from '@wizzn/shared'
import { api, ensureSession } from 'src/api'
import SegmentedControl from 'components/SegmentedControl.vue'
import { usePlatform } from 'src/composables/usePlatform'

type FormatChoice = 'both' | UnitFormat

const router = useRouter()
const { pIcon } = usePlatform()
const step = ref<1 | 2 | 3>(1)
const fields = ref<FieldDto[]>([])
const fieldIds = ref<string[]>([])
const themeIds = ref<string[]>([])
const format = ref<FormatChoice>('both')
const error = ref('')
const saving = ref(false)

const EMOJI: Record<string, string> = { nutrition: '🥗', partnership: '💞', finance: '💶', sports: '🏃', psychology: '🧠' }
const chosenFields = computed(() => fields.value.filter((f) => fieldIds.value.includes(f.id)))

onMounted(async () => {
  try {
    const me = await ensureSession()
    fields.value = await api.fields()
    // Re-onboarding keeps previous choices
    fieldIds.value = [...new Set(me.interests.map((i) => i.fieldId))]
    themeIds.value = me.interests.flatMap((i) => (i.themeId ? [i.themeId] : []))
    if (me.formats.length === 1 && me.formats[0]) format.value = me.formats[0]
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
      formats: format.value === 'both' ? ['audio', 'written'] : [format.value],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
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
        <div class="row items-center q-mb-lg">
          <q-btn v-if="step > 1" flat round dense :icon="pIcon('back')" color="white" @click="step = (step - 1) as 1 | 2" />
          <q-space />
          <div class="wz-dots row q-gutter-xs"><span v-for="n in 3" :key="n" :class="{ on: n <= step }" /></div>
        </div>

        <template v-if="step === 1">
          <div class="wz-title">Worauf hast du Lust?</div>
          <div class="text-body1 q-mt-sm q-mb-lg" style="color: var(--wz-muted)">Wähle mindestens ein Gebiet. Du kannst das jederzeit ändern.</div>
          <div class="column q-gutter-md">
            <button v-for="f in fields" :key="f.id" type="button" class="wz-field-card" :class="[`wz-field-${f.slug}`, { selected: fieldIds.includes(f.id) }]" @click="fieldIds = toggle(fieldIds, f.id)">
              <span class="wz-emoji">{{ EMOJI[f.slug] ?? '✨' }}</span>
              <span class="col text-left">{{ f.nameDe }}</span>
              <q-icon v-if="fieldIds.includes(f.id)" :name="pIcon('check_circle')" size="26px" />
            </button>
          </div>
        </template>

        <template v-else-if="step === 2">
          <div class="wz-title">Was interessiert dich besonders?</div>
          <div class="text-body1 q-mt-sm q-mb-lg" style="color: var(--wz-muted)">Optional – diese Themen zeigen wir dir zuerst.</div>
          <div v-for="f in chosenFields" :key="f.id" class="q-mb-lg">
            <div class="text-weight-bold q-mb-sm">{{ EMOJI[f.slug] }} {{ f.nameDe }}</div>
            <div class="row q-gutter-sm">
              <button v-for="t in f.themes" :key="t.id" type="button" class="wz-chip" :class="{ on: themeIds.includes(t.id) }" @click="themeIds = toggle(themeIds, t.id)">{{ t.nameDe }}</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="wz-title">Wie lernst du am liebsten?</div>
          <div class="text-body1 q-mt-sm q-mb-lg" style="color: var(--wz-muted)">Hören für unterwegs, Slides zum schnellen Durchwischen.</div>
          <SegmentedControl
            v-model="format"
            :options="[
              { label: 'Beides', value: 'both' },
              { label: 'Hören', value: 'audio', icon: pIcon('headphones') },
              { label: 'Lesen', value: 'written', icon: pIcon('slides') },
            ]"
          />
        </template>

        <q-space />
        <div v-if="error" class="text-negative q-mb-sm">{{ error }}</div>
        <q-btn
          unelevated
          rounded
          no-caps
          size="lg"
          class="wz-cta full-width"
          :disable="fieldIds.length === 0"
          :loading="saving"
          :label="step < 3 ? 'Weiter' : 'Los geht’s'"
          @click="step < 3 ? (step = (step + 1) as 2 | 3) : finish()"
        />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped lang="scss">
.wz-onb { padding: calc(24px + var(--wz-safe-top)) 20px calc(24px + var(--wz-safe-bottom)); min-height: 100dvh; }
.wz-dots span { display: inline-block; width: 22px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.2); }
.wz-dots span.on { background: var(--wz-coral); }
.wz-field-card { display: flex; align-items: center; gap: 14px; border: 2px solid transparent; border-radius: 20px; padding: 16px 18px; font: inherit; font-weight: 800; font-size: 18px; color: #fff; background: rgba(255, 255, 255, 0.08); transition: transform 0.15s ease; }
.wz-field-card.selected { background: linear-gradient(135deg, var(--wz-a), var(--wz-b)); transform: scale(1.02); }
.wz-field-card:active { transform: scale(0.98); }
.wz-emoji { font-size: 28px; }
.wz-chip { border: 2px solid rgba(255, 255, 255, 0.25); border-radius: 999px; padding: 8px 14px; background: transparent; color: #fff; font: inherit; font-weight: 700; }
.wz-chip.on { background: #fff; color: var(--wz-bg); border-color: #fff; }
.wz-cta { background: var(--wz-coral); color: var(--wz-bg); font-weight: 900; }
</style>
