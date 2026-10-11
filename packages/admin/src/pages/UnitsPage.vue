<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { UNIT_STATUSES, unitFormatSchema, type BulkActionInput, type BulkResultDto, type BulkSkipReason, type UnitFormat, type UnitStatus, type UnitSummaryDto } from '@wizzn/shared'
import { api, errorMessage } from 'src/api'
import { STATUS_COLOR, STATUS_LABEL, stuckLabel } from 'src/status'

const router = useRouter()
const $q = useQuasar()
const route = useRoute()
const units = ref<UnitSummaryDto[]>([])
const error = ref('')
const selected = ref<UnitSummaryDto[]>([])
const busy = ref(false)
const selectedIds = computed(() => selected.value.map((u) => u.id))
let timer: ReturnType<typeof setInterval> | undefined

/** Status filter lives in the URL (?status=a,b) so it survives opening a unit and coming back; empty = all */
const parseStatuses = (q: unknown): UnitStatus[] =>
  typeof q === 'string' ? q.split(',').filter((s): s is UnitStatus => (UNIT_STATUSES as readonly string[]).includes(s)) : []
const activeStatuses = ref<UnitStatus[]>(parseStatuses(route.query.status))
const listParam = (q: unknown): string[] => (typeof q === 'string' && q ? q.split(',') : [])
/** Free text over title and core idea (?q=) */
const search = ref<string | null>(typeof route.query.q === 'string' ? route.query.q : '')
/** Category = field slug (?field=a,b), format (?format=written) */
const activeFields = ref<string[]>(listParam(route.query.field))
const activeFormats = ref<UnitFormat[]>(listParam(route.query.format).filter((f): f is UnitFormat => (UNIT_FORMATS as readonly string[]).includes(f)))
/** q-select's clear button sets null; the filters always hold arrays */
const fieldsModel = computed({ get: () => activeFields.value, set: (v: string[] | null) => (activeFields.value = v ?? []) })
const formatsModel = computed({ get: () => activeFormats.value, set: (v: UnitFormat[] | null) => (activeFormats.value = v ?? []) })
const UNIT_FORMATS = unitFormatSchema.options
const FORMAT_LABEL: Record<UnitFormat, string> = { written: 'Text', audio: 'Audio' }
const formatOptions = UNIT_FORMATS.map((f) => ({ label: FORMAT_LABEL[f], value: f }))
const fieldOptions = computed(() => {
  // Categories come from the loaded units; active ones stay selectable even when no unit matches
  const slugs = new Set([...units.value.map((u) => u.fieldSlug), ...activeFields.value])
  return [...slugs].sort((a, b) => a.localeCompare(b, 'de')).map((slug) => ({ label: slug, value: slug }))
})
const norm = (t: string): string => t.toLocaleLowerCase('de').normalize('NFD').replace(/\p{Diacritic}/gu, '')
/** Everything except the status filter, so the chip counts reflect the other filters */
const baseFiltered = computed(() => {
  const words = norm((search.value ?? '').trim()).split(/\s+/).filter(Boolean)
  return units.value.filter(
    (u) =>
      (!activeFields.value.length || activeFields.value.includes(u.fieldSlug)) &&
      (!activeFormats.value.length || activeFormats.value.includes(u.format)) &&
      (!words.length || words.every((w) => norm(`${u.title ?? ''} ${u.topic}`).includes(w))),
  )
})
const statusCounts = computed(() => {
  const counts = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>
  for (const u of baseFiltered.value) counts[u.status]++
  return counts
})
const visibleUnits = computed(() => (activeStatuses.value.length ? baseFiltered.value.filter((u) => activeStatuses.value.includes(u.status)) : baseFiltered.value))
const filterActive = computed(() => !!(activeStatuses.value.length || activeFields.value.length || activeFormats.value.length || (search.value ?? '').trim()))
function toggleStatus(s: UnitStatus): void {
  activeStatuses.value = activeStatuses.value.includes(s) ? activeStatuses.value.filter((x) => x !== s) : [...activeStatuses.value, s]
}
function resetFilter(): void {
  activeStatuses.value = []
  activeFields.value = []
  activeFormats.value = []
  search.value = ''
}

/** Sorting also lives in the URL (?sort=updated&desc=1) */
const SORTABLE = ['status', 'title', 'field', 'format', 'check', 'updated'] as const
type SortKey = (typeof SORTABLE)[number]
const initialSort = (SORTABLE as readonly string[]).includes(String(route.query.sort)) ? (route.query.sort as SortKey) : 'updated'
const pagination = ref({
  rowsPerPage: 50,
  sortBy: initialSort as string | null,
  descending: route.query.sort ? route.query.desc === '1' : true,
})
watch(
  [activeStatuses, activeFields, activeFormats, search, () => pagination.value.sortBy, () => pagination.value.descending],
  ([statuses, fields, formats, q, sortBy, desc]) => {
    const query = {
      ...route.query,
      status: statuses.length ? statuses.join(',') : undefined,
      field: fields.length ? fields.join(',') : undefined,
      format: formats.length ? formats.join(',') : undefined,
      q: (q ?? '').trim() || undefined,
      sort: sortBy ?? undefined,
      desc: sortBy ? (desc ? '1' : '0') : undefined,
    }
    void router.replace({ query })
  },
)
// Rows that are filtered out must not stay selected for bulk actions
watch(visibleUnits, (rows) => {
  const visible = new Set(rows.map((u) => u.id))
  if (selected.value.some((u) => !visible.has(u.id))) selected.value = selected.value.filter((u) => visible.has(u.id))
})

const STATUS_ORDER = Object.fromEntries(UNIT_STATUSES.map((s, i) => [s, i])) as Record<UnitStatus, number>
const byText = (a: string, b: string): number => a.localeCompare(b, 'de', { sensitivity: 'base' })
/** null (not yet checked) sorts after failed checks */
const CHECK_RANK = (v: boolean | null): number => (v === true ? 0 : v === false ? 1 : 2)
const columns = [
  { name: 'status', label: 'Status', field: 'status', align: 'left' as const, sortable: true, sort: (a: UnitStatus, b: UnitStatus) => STATUS_ORDER[a] - STATUS_ORDER[b] },
  {
    name: 'title',
    label: 'Titel / Kernidee',
    field: (u: UnitSummaryDto) => u.title ?? u.topic,
    align: 'left' as const,
    sortable: true,
    sort: byText,
  },
  { name: 'field', label: 'Bereich', field: 'fieldSlug', align: 'left' as const, sortable: true, sort: byText },
  { name: 'format', label: 'Format', field: 'format', align: 'left' as const, sortable: true, sort: byText },
  { name: 'check', label: 'KI-Check', field: 'checkPassed', align: 'left' as const, sortable: true, sort: (a: boolean | null, b: boolean | null) => CHECK_RANK(a) - CHECK_RANK(b) },
  {
    name: 'updated',
    label: 'Geändert',
    field: 'updatedAt',
    align: 'left' as const,
    sortable: true,
    sort: (a: string, b: string) => Date.parse(a) - Date.parse(b),
    format: (v: string) => new Date(v).toLocaleString('de-DE'),
  },
]

async function load(): Promise<void> {
  try {
    // Filtering happens client-side so every chip can show its count
    units.value = await api<UnitSummaryDto[]>('/api/admin/units')
    // Keep the selection across polling, minus rows that left the list
    const byId = new Map(units.value.map((u) => [u.id, u]))
    selected.value = selected.value.flatMap((u) => byId.get(u.id) ?? [])
    error.value = ''
  } catch (e) {
    error.value = errorMessage(e)
  }
}

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
  lock: {
    title: 'Sperren',
    message: (n) => `${n} Wissenshappen sperren? Sie verschwinden aus Feed, Suche und Merklisten, bis sie entsperrt werden. Statistiken der Nutzer bleiben erhalten. Nur veröffentlichte werden gesperrt.`,
    done: 'gesperrt',
    color: 'purple-7',
  },
  unlock: {
    title: 'Entsperren',
    message: (n) => `${n} gesperrte Wissenshappen wieder veröffentlichen?`,
    done: 'wieder veröffentlicht',
    color: 'positive',
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
      <q-input v-model="search" dense outlined clearable debounce="200" placeholder="Titel oder Kernidee suchen" style="min-width: 260px">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-select v-model="fieldsModel" :options="fieldOptions" multiple emit-value map-options use-chips dense outlined clearable label="Bereich" style="min-width: 180px" />
      <q-select v-model="formatsModel" :options="formatOptions" multiple emit-value map-options use-chips dense outlined clearable label="Format" style="min-width: 150px" />
      <q-space />
      <q-btn color="primary" icon="add" label="Neuer Auftrag" to="/briefs/new" />
    </div>
    <div class="row items-center q-gutter-xs q-mb-md">
      <q-chip
        v-for="s in UNIT_STATUSES"
        :key="s"
        clickable
        dense
        :outline="!activeStatuses.includes(s)"
        :color="STATUS_COLOR[s]"
        :text-color="activeStatuses.includes(s) ? 'white' : undefined"
        :icon="activeStatuses.includes(s) ? 'check' : undefined"
        :class="{ 'filter-chip--empty': !statusCounts[s] && !activeStatuses.includes(s) }"
        @click="toggleStatus(s)"
      >
        {{ STATUS_LABEL[s] }}
        <q-badge rounded class="q-ml-xs" :color="activeStatuses.includes(s) ? 'white' : STATUS_COLOR[s]" :text-color="activeStatuses.includes(s) ? STATUS_COLOR[s] : 'white'" :label="statusCounts[s]" />
      </q-chip>
      <q-btn flat dense no-caps icon="filter_alt_off" label="Alle Filter zurücksetzen" color="grey-8" class="q-ml-sm" :disable="!filterActive" @click="resetFilter" />
      <q-space />
      <div class="text-caption text-grey-7">{{ visibleUnits.length }} von {{ units.length }}</div>
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <q-banner v-if="selected.length" dense rounded class="bg-blue-1 q-mb-sm">
      <div class="row items-center q-gutter-sm">
        <div class="text-weight-medium">{{ selected.length }} ausgewählt</div>
        <q-space />
        <q-btn v-if="selected.some((u) => u.stuck)" flat icon="play_arrow" label="Fortsetzen" :disable="busy" @click="confirmBulk('resume')" />
        <q-btn v-if="selected.some((u) => u.status === 'published')" flat icon="lock" label="Sperren" :disable="busy" @click="confirmBulk('lock')" />
        <q-btn v-if="selected.some((u) => u.status === 'locked')" flat icon="lock_open" label="Entsperren" :disable="busy" @click="confirmBulk('unlock')" />
        <q-btn flat icon="replay" label="Neu generieren" :disable="busy" @click="confirmBulk('regenerate')" />
        <q-btn flat color="negative" icon="delete" label="Löschen" :disable="busy" @click="confirmBulk('delete')" />
        <q-btn flat round dense icon="close" :disable="busy" @click="selected = []"><q-tooltip>Auswahl aufheben</q-tooltip></q-btn>
      </div>
    </q-banner>
    <q-table
      v-model:selected="selected"
      v-model:pagination="pagination"
      :rows="visibleUnits"
      :columns="columns"
      row-key="id"
      selection="multiple"
      flat
      bordered
      :loading="busy"
      binary-state-sort
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

<style scoped>
.filter-chip--empty {
  opacity: 0.45;
}
</style>
