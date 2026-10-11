<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { LEVELS, levelLabel, type BriefBatchResultDto, type EditorialStyle, type FieldDto, type Level, type StoryArc } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'

const $q = useQuasar()
const router = useRouter()
const fields = ref<FieldDto[]>([])
const fieldId = ref<string | null>(null)
const themeId = ref<string | null>(null)
const topic = ref('')
const context = ref('')
const count = ref(1)
// null = random per variant
const style = ref<EditorialStyle | null>(null)
const storyArc = ref<StoryArc | null>(null)
const styleOptions: { label: string; value: EditorialStyle }[] = [
  { label: 'Freundlich-humorvoll', value: 'friendly' },
  { label: 'Sachlich-faktenbasiert', value: 'factual' },
  { label: 'Erzählerisch-inspirierend', value: 'narrative' },
]
const arcOptions: { label: string; value: StoryArc }[] = [
  { label: 'Vom Tellerwäscher zum Millionär', value: 'rags_to_riches' },
  { label: 'Die Suche', value: 'quest' },
  { label: 'Reise und Rückkehr', value: 'voyage_and_return' },
  { label: 'Komödie', value: 'comedy' },
  { label: 'Das Monster besiegen', value: 'overcoming_the_monster' },
  { label: 'Wiedergeburt', value: 'rebirth' },
]
// Knowledge stream: depth 1–5 inside a series; L4 bridges to another field
const level = ref<Level>(1)
const series = ref('')
const crossFieldId = ref<string | null>(null)
const levelOptions = LEVELS.map((l) => ({ label: levelLabel(l), value: l }))
const saving = ref(false)

const fieldOptions = computed(() => fields.value.map((f) => ({ label: f.nameDe, value: f.id })))
const crossFieldOptions = computed(() => fieldOptions.value.filter((f) => f.value !== fieldId.value))
const themeOptions = computed(() => fields.value.find((f) => f.id === fieldId.value)?.themes.map((t) => ({ label: t.nameDe, value: t.id })) ?? [])
watch(fieldId, () => (themeId.value = null))

onMounted(async () => {
  fields.value = await api<FieldDto[]>('/api/fields')
})

async function submit(): Promise<void> {
  if (!fieldId.value) return
  saving.value = true
  try {
    // briefInputSchema requires a format: one brief per format, so each variant yields slides and audio
    const base = { fieldId: fieldId.value, themeId: themeId.value, topic: topic.value, context: context.value, style: style.value, storyArc: storyArc.value, count: count.value,
      level: level.value, series: series.value.trim().toLowerCase() || null, crossFieldId: level.value === 4 ? crossFieldId.value : null }
    const res = await api<BriefBatchResultDto>('/api/admin/briefs/batch', {
      method: 'POST',
      body: { briefs: [{ ...base, format: 'written' }, { ...base, format: 'audio' }] },
    })
    $q.notify({ type: 'positive', message: `${res.briefs.reduce((n, b) => n + b.unitIds.length, 0)} Wissenshappen in Arbeit` })
    await router.push('/units?status=')
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <q-page padding>
    <q-card style="max-width: 720px" class="q-mx-auto">
      <q-card-section class="text-h6">Neuer Auftrag</q-card-section>
      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="submit">
          <div class="row q-col-gutter-md">
            <q-select v-model="fieldId" class="col-6" :options="fieldOptions" emit-value map-options outlined label="Bereich *" :rules="[(v) => !!v || 'Pflichtfeld']" />
            <q-select v-model="themeId" class="col-6" :options="themeOptions" emit-value map-options outlined clearable label="Thema (optional)" :disable="!fieldId" />
          </div>
          <q-input v-model="topic" outlined label="Kernidee *" hint="z. B. „Warum ein Notgroschen drei Monatsgehälter haben sollte“" :rules="[(v) => v.length >= 3 || 'Mindestens 3 Zeichen']" />
          <q-input v-model="context" outlined type="textarea" autogrow label="Kontext für die KI" hint="Zielgruppe, Blickwinkel, was vermieden werden soll, bevorzugte Quellen" />
          <div class="row q-col-gutter-md">
            <q-select v-model="style" class="col-6" :options="styleOptions" emit-value map-options outlined clearable label="Stil" hint="Leer = zufällig je Variante" />
            <q-select v-model="storyArc" class="col-6" :options="arcOptions" emit-value map-options outlined clearable label="Erzählbogen" hint="Leer = zufällig je Variante" />
          </div>
          <div class="row q-col-gutter-md">
            <q-select v-model="level" class="col-4" :options="levelOptions" emit-value map-options outlined label="Wissensstufe" />
            <q-input v-model="series" class="col-4" outlined label="Serie (optional)" hint="z. B. veg-protein – verknüpft alle Stufen" :rules="[(v) => !v || /^[a-z0-9][a-z0-9-]{1,59}$/i.test(v.trim()) || '2–60 Zeichen a–z, 0–9, -']" />
            <q-select v-model="crossFieldId" class="col-4" :options="crossFieldOptions" emit-value map-options outlined clearable label="Querbereich" hint="Nur Stufe 4" :disable="level !== 4" />
          </div>
          <div class="row items-center q-col-gutter-md">
            <div class="col">
              <div class="text-caption text-grey-7">Anzahl Varianten: {{ count }} – je Variante entstehen Slides und Audio ({{ count * 2 }} Wissenshappen)</div>
              <q-slider v-model="count" :min="1" :max="10" markers />
            </div>
          </div>
          <q-btn type="submit" color="primary" label="Generieren" icon="auto_awesome" :loading="saving" />
        </q-form>
      </q-card-section>
    </q-card>
  </q-page>
</template>
