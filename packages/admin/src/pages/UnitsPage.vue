<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { UNIT_STATUSES, type UnitStatus, type UnitSummaryDto } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'
import { STATUS_COLOR, STATUS_LABEL } from 'src/status'

const router = useRouter()
const route = useRoute()
const units = ref<UnitSummaryDto[]>([])
// `?status=` (empty) shows all units, e.g. right after creating a brief
const status = ref<UnitStatus | null>(route.query.status === '' ? null : 'in_review')
const error = ref('')
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
    error.value = ''
  } catch (e) {
    error.value = errorMessage(e)
  }
}

watch(status, load)
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
    <q-table :rows="units" :columns="columns" row-key="id" flat bordered :pagination="{ rowsPerPage: 50 }" @row-click="(_e, row) => router.push(`/units/${row.id}`)">
      <template #body-cell-status="props">
        <q-td :props="props"><q-badge :color="STATUS_COLOR[props.row.status as UnitStatus]" :label="STATUS_LABEL[props.row.status as UnitStatus]" /></q-td>
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
