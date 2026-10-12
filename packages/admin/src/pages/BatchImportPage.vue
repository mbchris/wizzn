<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { batchRefQuery, levelLabel, parseBatchFile, type BatchRefs, type BriefBatchResultDto, type FieldDto } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'

const $q = useQuasar()
const router = useRouter()
const fields = ref<FieldDto[]>([])
const text = ref('')
const file = ref<File | null>(null)
const saving = ref(false)

onMounted(async () => {
  fields.value = await api<FieldDto[]>('/api/fields')
})

/** Units behind "after" references and taken series keys; null while they are loading, which keeps those rows blocked */
const refs = ref<BatchRefs | null>(null)
const refQuery = computed(() => (text.value.trim() ? batchRefQuery(parseBatchFile(text.value, fields.value).rows) : { ids: [], series: [] }))
watch(
  () => JSON.stringify(refQuery.value),
  async (key) => {
    refs.value = null
    const query = refQuery.value
    if (!query.ids.length && !query.series.length) return
    try {
      const loaded = await api<BatchRefs>('/api/admin/briefs/batch/refs', { method: 'POST', body: query })
      // The file may have changed while the request was running
      if (key === JSON.stringify(refQuery.value)) refs.value = loaded
    } catch (e) {
      $q.notify({ type: 'negative', message: errorMessage(e) })
    }
  },
)

const parsed = computed(() => (text.value.trim() ? parseBatchFile(text.value, fields.value, refs.value) : null))
const rows = computed(() => parsed.value?.rows ?? [])
const assignments = computed(() => parsed.value?.assignments ?? [])
const renames = computed(() => parsed.value?.renames ?? [])
const skipped = computed(() => rows.value.filter((r) => r.skipped).length)
const invalid = computed(() => rows.value.filter((r) => r.errors.length).length)
const briefs = computed(() => rows.value.flatMap((r) => r.briefs))
const unitCount = computed(() => briefs.value.reduce((n, b) => n + b.count * (b.format ? 1 : 2), 0))
const canImport = computed(() => !!parsed.value && !parsed.value.fileError && briefs.value.length > 0 && invalid.value === 0)

const columns = [
  { name: 'nr', label: '#', field: (r: (typeof rows.value)[number]) => r.index + 1, align: 'left' as const },
  { name: 'field', label: 'Bereich / Thema', field: (r: (typeof rows.value)[number]) => [r.job?.field, r.job?.theme].filter(Boolean).join(' / '), align: 'left' as const },
  { name: 'topic', label: 'Kernidee', field: (r: (typeof rows.value)[number]) => r.job?.topic ?? '–', align: 'left' as const },
  { name: 'level', label: 'Stufe / Serie', field: (r: (typeof rows.value)[number]) => (r.job ? [levelLabel(r.job.level), r.briefs[0]?.series ?? r.job.series].filter(Boolean).join(' · ') : ''), align: 'left' as const },
  { name: 'after', label: 'Baut auf', field: (r: (typeof rows.value)[number]) => (r.after ? `${levelLabel(r.after.level)} · ${r.after.title}` : ''), align: 'left' as const },
  { name: 'format', label: 'Format', field: (r: (typeof rows.value)[number]) => r.job?.format ?? '', align: 'left' as const },
  { name: 'count', label: 'Varianten', field: (r: (typeof rows.value)[number]) => r.job?.count ?? '', align: 'right' as const },
  { name: 'status', label: 'Status', field: () => '', align: 'left' as const },
]

async function onFile(f: File | null): Promise<void> {
  if (f) text.value = await f.text()
}

/** Paste into the Gemini prompt so it only uses existing Bereiche/Themen. */
async function copyFieldList(): Promise<void> {
  const list = fields.value.map((f) => `- ${f.slug} (${f.nameDe}): ${f.themes.map((t) => `${t.slug} (${t.nameDe})`).join(', ') || '–'}`).join('\n')
  await navigator.clipboard.writeText(list)
  $q.notify({ type: 'positive', message: 'Bereichsliste kopiert' })
}

async function submit(): Promise<void> {
  saving.value = true
  try {
    const res = await api<BriefBatchResultDto>('/api/admin/briefs/batch', { method: 'POST', body: { briefs: briefs.value, seriesAssignments: assignments.value.map(({ unitId, series }) => ({ unitId, series })) } })
    const units = res.briefs.reduce((n, b) => n + b.unitIds.length, 0)
    $q.notify({ type: 'positive', message: `${res.briefs.length} Aufträge, ${units} Wissenshappen in Arbeit` })
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
    <q-card style="max-width: 1100px" class="q-mx-auto">
      <q-card-section class="row items-center">
        <div class="text-h6 col">Batch-Import</div>
        <q-btn flat icon="content_copy" label="Bereichsliste kopieren" :disable="!fields.length" @click="copyFieldList" />
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-file v-model="file" outlined accept=".json,application/json,text/plain" label="Batch-Datei (.json)" clearable @update:model-value="onFile">
          <template #prepend><q-icon name="upload_file" /></template>
        </q-file>
        <q-input v-model="text" outlined type="textarea" autogrow input-style="max-height: 240px; font-family: monospace; font-size: 12px" label="…oder JSON hier einfügen" />
        <q-banner v-if="parsed?.fileError" class="bg-negative text-white" rounded>{{ parsed.fileError }}</q-banner>
      </q-card-section>

      <q-card-section v-if="rows.length">
        <q-table flat dense :rows="rows" :columns="columns" row-key="index" :pagination="{ rowsPerPage: 0 }" hide-pagination>
          <template #body-cell-status="props">
            <q-td :props="props">
              <q-chip v-if="props.row.skipped" dense icon="visibility">Kontext – übersprungen</q-chip>
              <q-chip v-else-if="!props.row.errors.length" dense color="positive" text-color="white" icon="check">{{ props.row.briefs.length }} Auftr.</q-chip>
              <div v-for="err in props.row.errors" v-else :key="err" class="text-negative text-caption">{{ err }}</div>
            </q-td>
          </template>
        </q-table>
        <q-banner v-if="assignments.length" dense rounded class="bg-blue-1 q-mt-md">
          <div class="text-weight-medium">Beim Import erhalten diese bestehenden Happen eine Serie:</div>
          <div v-for="a in assignments" :key="a.unitId" class="text-caption">„{{ a.title }}“ → {{ a.series }}</div>
        </q-banner>
        <q-banner v-if="renames.length" dense rounded class="bg-amber-1 q-mt-md">
          <div class="text-weight-medium">Diese Serien-Schlüssel sind bereits vergeben und werden als neue Serie angelegt:</div>
          <div v-for="r in renames" :key="r.from" class="text-caption">{{ r.from }} → {{ r.to }}</div>
        </q-banner>
      </q-card-section>

      <q-card-actions v-if="rows.length" align="right" class="q-pa-md">
        <div class="text-caption q-mr-md" :class="invalid ? 'text-negative' : 'text-grey-7'">
          <template v-if="invalid">{{ invalid }} fehlerhafte Zeile(n) – bitte korrigieren</template>
          <template v-else>{{ briefs.length }} Aufträge → {{ unitCount }} Wissenshappen<template v-if="skipped"> · {{ skipped }} Kontext-Einträge übersprungen</template></template>
        </div>
        <q-btn color="primary" icon="playlist_add" label="Importieren" :disable="!canImport" :loading="saving" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-page>
</template>
