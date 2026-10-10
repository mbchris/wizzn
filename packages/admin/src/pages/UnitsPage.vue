<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { UNIT_STATUSES, type BulkActionInput, type BulkResultDto, type BulkSkipReason, type UnitStatus, type UnitSummaryDto } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'
import { STATUS_COLOR, STATUS_LABEL, stuckLabel } from 'src/status'

const router = useRouter()
const $q = useQuasar()
const route = useRoute()
const units = ref<UnitSummaryDto[]>([])
// `?status=` (empty) shows all units, e.g. right after creating a brief
const status = ref<UnitStatus | null>(route.query.status === '' ? null : 'in_review')
const error = ref('')
const selected = ref<UnitSummaryDto[]>([])
const busy = ref(false)
const selectedIds = computed(() => selected.value.map((u) => u.id))
let timer: ReturnType<typeof setInterval> | undefined

const statusOptions = UNIT_STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s }))
const columns = [
  { name: 'status', label: 'Status', field: 'status', align: 'left' as const },
  { name: 'title', label: 'Titel / Kernidee', field: 'title', align: 'left' as const },
  { name: 'field', label: 'Bereich', field: 'fieldSlug', align: 'left' as const },
  { name: 'format', label: 'Format', field: 'format', align: 'left' as const },
  { name: 'check', label: 'KI-Check', field: 'checkPassed', align: 'left' as const },
  { name: 'updated', label: 'Geändert', field: 'updatedAt', align: 'left' as const, format: (v: string) => new Date(v).toLocaleString('de-DE') },
]

async function load(): Promise<void> {
  try {
    units.value = await api<UnitSummaryDto[]>(`/api/admin/units${status.value ? `?status=${status.value}` : ''}`)
    // Keep the selection across polling, minus rows that left the list
    const byId = new Map(units.value.map((u) => [u.id, u]))
    selected.value = selected.value.flatMap((u) => byId.get(u.id) ?? [])
    error.value = ''
  } catch (e) {
    error.value = errorMessage(e)
  }
}

watch(status, () => {
  selected.value = []
  void load()
})

const SKIP_LABEL: Record<BulkSkipReason, string> = {
  not_found: 'nicht gefunden',
  invalid_state: 'Status passt nicht',
  has_history: 'hat Nutzerverlauf',
}
const ACTION_TEXT: Record<BulkActionInput['action'], { title: string; message: (n: number) => string; done: string; color: string }> = {
  resume: {
    title: 'Fortsetzen',
    message: (n) => `${n} Wissenshappen beim unterbrochenen Schritt fortsetzen? Nur hängende Einträge werden fortgesetzt.`,
    done: 'fortgesetzt',
    color: 'primary',
  },
  regenerate: {
    title: 'Neu generieren',
    message: (n) => `${n} Wissenshappen mit dem aktuellen Auftrag und den aktuellen Prompts neu erstellen? Veröffentlichte werden bis zur erneuten Freigabe aus dem Feed genommen.`,
    done: 'neu in der Pipeline',
    color: 'primary',
  },
  delete: {
    title: 'Löschen',
    message: (n) => `${n} Wissenshappen endgültig löschen? Bereits gesehene oder abgeschlossene werden übersprungen.`,
    done: 'gelöscht',
    color: 'negative',
  },
}

function summarize(action: BulkActionInput['action'], res: BulkResultDto): string {
  const counts = new Map<BulkSkipReason, number>()
  for (const s of res.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
  const skipped = [...counts].map(([reason, n]) => `${n} ${SKIP_LABEL[reason]}`).join(', ')
  return `${res.done.length} ${ACTION_TEXT[action].done}${skipped ? ` · übersprungen: ${skipped}` : ''}`
}

async function runBulk(action: BulkActionInput['action']): Promise<void> {
  busy.value = true
  try {
    const res = await api<BulkResultDto>('/api/admin/units/bulk', { method: 'POST', body: { action, ids: selectedIds.value } satisfies BulkActionInput })
    $q.notify({ type: res.skipped.length ? 'warning' : 'positive', message: summarize(action, res) })
    selected.value = selected.value.filter((u) => !res.done.includes(u.id))
    await load()
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
  } finally {
    busy.value = false
  }
}

function confirmBulk(action: BulkActionInput['action']): void {
  const t = ACTION_TEXT[action]
  $q.dialog({
    title: t.title,
    message: t.message(selected.value.length),
    ok: { label: t.title, color: t.color },
    cancel: { label: 'Abbrechen', flat: true },
  }).onOk(() => void runBulk(action))
}
onMounted(() => {
  void load()
  // Pipeline status changes in the background
  timer = setInterval(() => void load(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <q-page padding>
    <div class="row items-center q-gutter-md q-mb-md">
      <div class="text-h6">Wissenshappen</div>
      <q-select v-model="status" :options="statusOptions" emit-value map-options clearable dense outlined label="Status" style="min-width: 200px" />
      <q-space />
      <q-btn color="primary" icon="add" label="Neuer Auftrag" to="/briefs/new" />
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <q-banner v-if="selected.length" dense rounded class="bg-blue-1 q-mb-sm">
      <div class="row items-center q-gutter-sm">
        <div class="text-weight-medium">{{ selected.length }} ausgewählt</div>
        <q-space />
        <q-btn v-if="selected.some((u) => u.stuck)" flat icon="play_arrow" label="Fortsetzen" :disable="busy" @click="confirmBulk('resume')" />
        <q-btn flat icon="replay" label="Neu generieren" :disable="busy" @click="confirmBulk('regenerate')" />
        <q-btn flat color="negative" icon="delete" label="Löschen" :disable="busy" @click="confirmBulk('delete')" />
        <q-btn flat round dense icon="close" :disable="busy" @click="selected = []"><q-tooltip>Auswahl aufheben</q-tooltip></q-btn>
      </div>
    </q-banner>
    <q-table
      v-model:selected="selected"
      :rows="units"
      :columns="columns"
      row-key="id"
      selection="multiple"
      flat
      bordered
      :loading="busy"
      :pagination="{ rowsPerPage: 50 }"
      @row-click="(_e, row) => router.push(`/units/${row.id}`)"
    >
      <!-- Row click opens the unit; the checkbox must not bubble into it -->
      <template #body-selection="scope">
        <div @click.stop><q-checkbox v-model="scope.selected" dense /></div>
      </template>
      <template #body-cell-status="props">
        <q-td :props="props">
          <q-badge :color="STATUS_COLOR[props.row.status as UnitStatus]" :label="STATUS_LABEL[props.row.status as UnitStatus]" />
          <div v-if="props.row.stuck" class="text-caption text-deep-orange">{{ stuckLabel(props.row.updatedAt) }}</div>
        </q-td>
      </template>
      <template #body-cell-title="props">
        <q-td :props="props">
          <div class="text-weight-medium">{{ props.row.title ?? '—' }}</div>
          <div class="text-caption text-grey-7">{{ props.row.topic }}</div>
          <div v-if="props.row.failureReason" class="text-caption text-negative">{{ props.row.failureReason }}</div>
        </q-td>
      </template>
      <template #body-cell-check="props">
        <q-td :props="props">
          <q-icon v-if="props.row.checkPassed === true" name="check_circle" color="positive" size="sm" />
          <q-icon v-else-if="props.row.checkPassed === false" name="warning" color="orange" size="sm" />
          <span v-else class="text-grey">–</span>
        </q-td>
      </template>
    </q-table>
  </q-page>
</template>
