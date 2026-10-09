<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import type { UnitDetailDto } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'
import UnitPreview from 'components/UnitPreview.vue'
import { STATUS_COLOR, STATUS_LABEL } from 'src/status'

const props = defineProps<{ id: string }>()
const $q = useQuasar()
const unit = ref<UnitDetailDto | null>(null)
const title = ref('')
const json = ref('')
const busy = ref(false)

const assetUrls = computed(() => Object.fromEntries((unit.value?.assets ?? []).map((a) => [a.id, a.url])))
const editable = computed(() => unit.value?.status === 'in_review')
const previewContent = computed<unknown>(() => {
  try {
    return JSON.parse(json.value)
  } catch {
    return null
  }
})

async function load(): Promise<void> {
  unit.value = await api<UnitDetailDto>(`/api/admin/units/${props.id}`)
  title.value = unit.value.title ?? ''
  json.value = JSON.stringify(unit.value.contentJson, null, 2)
}

async function act(label: string, fn: () => Promise<unknown>): Promise<void> {
  busy.value = true
  try {
    await fn()
    $q.notify({ type: 'positive', message: label })
    await load()
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
  } finally {
    busy.value = false
  }
}

const save = () => act('Gespeichert', () => api(`/api/admin/units/${props.id}`, { method: 'PUT', body: { title: title.value, contentJson: previewContent.value } }))
const approve = () => act('Veröffentlicht', () => api(`/api/admin/units/${props.id}/approve`, { method: 'POST' }))
const requeue = () => act('Neu in der Pipeline', () => api(`/api/admin/units/${props.id}/requeue`, { method: 'POST' }))
function reject(): void {
  $q.dialog({ title: 'Ablehnen', message: 'Begründung', prompt: { model: '', type: 'text' }, cancel: true }).onOk((reason: string) => {
    void act('Abgelehnt', () => api(`/api/admin/units/${props.id}/reject`, { method: 'POST', body: { reason } }))
  })
}

onMounted(load)
</script>

<template>
  <q-page padding>
    <div v-if="unit" class="row q-col-gutter-lg">
      <div class="col-auto">
        <UnitPreview :title="title" :content="previewContent" :asset-urls="assetUrls" />
      </div>
      <div class="col column q-gutter-md">
        <div class="row items-center q-gutter-sm">
          <q-badge :color="STATUS_COLOR[unit.status]" :label="STATUS_LABEL[unit.status]" class="text-subtitle2" />
          <div class="text-caption text-grey-7">{{ unit.fieldSlug }} · {{ unit.format }} · {{ unit.model }} · Prompt {{ unit.promptVersion }}</div>
          <q-space />
          <q-btn color="positive" icon="done" label="Freigeben" :disable="!editable || busy" @click="approve" />
          <q-btn color="negative" flat icon="block" label="Ablehnen" :disable="!editable || busy" @click="reject" />
          <q-btn flat icon="replay" label="Neu generieren" :disable="busy || !['in_review', 'failed', 'rejected'].includes(unit.status)" @click="requeue" />
        </div>
        <q-banner v-if="unit.failureReason" class="bg-red-1 text-negative">{{ unit.failureReason }}</q-banner>

        <q-card v-if="unit.checkReport" flat bordered>
          <q-card-section class="row items-center">
            <q-icon :name="unit.checkReport.passed ? 'verified' : 'warning'" :color="unit.checkReport.passed ? 'positive' : 'orange'" size="md" class="q-mr-sm" />
            <div class="text-subtitle1">KI-Check {{ unit.checkReport.passed ? 'bestanden' : 'mit Hinweisen' }}</div>
          </q-card-section>
          <q-list dense separator>
            <q-item v-for="(c, i) in unit.checkReport.claims" :key="'c' + i">
              <q-item-section avatar><q-icon :name="c.sourceIndex === null ? 'help' : 'link'" :color="c.sourceIndex === null ? 'negative' : 'positive'" /></q-item-section>
              <q-item-section>{{ c.text }}</q-item-section>
              <q-item-section side>{{ c.sourceIndex === null ? 'ohne Quelle' : `Quelle [${c.sourceIndex}]` }}</q-item-section>
            </q-item>
            <q-item v-for="(issue, i) in unit.checkReport.issues" :key="'i' + i">
              <q-item-section avatar><q-icon name="report" :color="issue.severity === 'high' ? 'negative' : 'orange'" /></q-item-section>
              <q-item-section>{{ issue.message }}</q-item-section>
            </q-item>
            <q-item v-for="l in unit.checkReport.links.filter((x) => !x.ok)" :key="l.url">
              <q-item-section avatar><q-icon name="link_off" color="negative" /></q-item-section>
              <q-item-section>Link nicht erreichbar ({{ l.status ?? 'Timeout' }}): {{ l.url }}</q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card flat bordered>
          <q-card-section class="text-subtitle1">Quellen</q-card-section>
          <q-list dense>
            <q-item v-for="(s, i) in unit.sources" :key="s.url" clickable tag="a" :href="s.url" target="_blank">
              <q-item-section avatar>[{{ i }}]</q-item-section>
              <q-item-section>
                <q-item-label>{{ s.publisher }}</q-item-label>
                <q-item-label caption>{{ s.title }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card flat bordered>
          <q-card-section class="q-gutter-sm">
            <q-input v-model="title" outlined dense label="Titel" :disable="!editable" />
            <q-input v-model="json" outlined type="textarea" input-class="mono" rows="18" label="Inhalt (JSON)" :disable="!editable" :error="previewContent === null" error-message="Kein gültiges JSON" />
            <q-btn color="primary" icon="save" label="Speichern" :disable="!editable || busy || previewContent === null" @click="save" />
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div v-else class="flex flex-center q-pa-xl"><q-spinner size="lg" color="primary" /></div>
  </q-page>
</template>
