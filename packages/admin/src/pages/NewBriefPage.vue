<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import type { FieldDto, UnitFormat } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'

const $q = useQuasar()
const router = useRouter()
const fields = ref<FieldDto[]>([])
const fieldId = ref<string | null>(null)
const themeId = ref<string | null>(null)
const topic = ref('')
const context = ref('')
const format = ref<UnitFormat>('written')
const count = ref(1)
const saving = ref(false)

const fieldOptions = computed(() => fields.value.map((f) => ({ label: f.nameDe, value: f.id })))
const themeOptions = computed(() => fields.value.find((f) => f.id === fieldId.value)?.themes.map((t) => ({ label: t.nameDe, value: t.id })) ?? [])
watch(fieldId, () => (themeId.value = null))

onMounted(async () => {
  fields.value = await api<FieldDto[]>('/api/fields')
})

async function submit(): Promise<void> {
  if (!fieldId.value) return
  saving.value = true
  try {
    const res = await api<{ unitIds: string[] }>('/api/admin/briefs', {
      method: 'POST',
      body: { fieldId: fieldId.value, themeId: themeId.value, topic: topic.value, context: context.value, format: format.value, count: count.value },
    })
    $q.notify({ type: 'positive', message: `${res.unitIds.length} Wissenshappen in Arbeit` })
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
          <div class="row items-center q-col-gutter-md">
            <div class="col-auto">
              <div class="text-caption text-grey-7">Format</div>
              <q-btn-toggle v-model="format" no-caps :options="[{ label: 'Slides', value: 'written', icon: 'view_carousel' }, { label: 'Audio', value: 'audio', icon: 'headphones' }]" />
            </div>
            <div class="col">
              <div class="text-caption text-grey-7">Anzahl Varianten: {{ count }}</div>
              <q-slider v-model="count" :min="1" :max="10" markers />
            </div>
          </div>
          <q-btn type="submit" color="primary" label="Generieren" icon="auto_awesome" :loading="saving" />
        </q-form>
      </q-card-section>
    </q-card>
  </q-page>
</template>
