<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { exportFile, useQuasar } from 'quasar'
import { LEVELS, UNIT_STATUSES, contextFilename, formatContextFile, formatPushList, levelLabel, pushListFilename, unitFormatSchema, type BulkActionInput, type BulkResultDto, type BulkSkipReason, type ContextJob, type DuplicateGroupDto, type DuplicateReason, type Level, type UnitFormat, type UnitStatus, type UnitSummaryDto } from '@wizzn/shared'
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
/** Level (?level=1,2) and series key (?series=a,b); NO_SERIES stands for units without a series */
const NO_SERIES = '-'
const activeLevels = ref<Level[]>(listParam(route.query.level).map(Number).filter((l): l is Level => (LEVELS as readonly number[]).includes(l)))
const activeSeries = ref<string[]>(listParam(route.query.series))
/** q-select's clear button sets null; the filters always hold arrays */
const fieldsModel = computed({ get: () => activeFields.value, set: (v: string[] | null) => (activeFields.value = v ?? []) })
const formatsModel = computed({ get: () => activeFormats.value, set: (v: UnitFormat[] | null) => (activeFormats.value = v ?? []) })
const levelsModel = computed({ get: () => activeLevels.value, set: (v: Level[] | null) => (activeLevels.value = v ?? []) })
const seriesModel = computed({ get: () => activeSeries.value, set: (v: string[] | null) => (activeSeries.value = v ?? []) })
/** Duplicate filter (?dup=1): groups span all units, so their members may lie outside the loaded list */
const dupOnly = ref(route.query.dup === '1')
const dupGroups = ref<DuplicateGroupDto[]>([])
const REASON_LABEL: Record<DuplicateReason, string> = { series: 'Serie', subject: 'Thema' }
const dupInfo = computed(() => new Map(dupGroups.value.flatMap((g, i) => g.units.map((u) => [u.id, { group: i + 1, reasons: g.reasons.map((r) => REASON_LABEL[r]).join(' + ') }] as const))))
/** Rows the filters work on; group members take their polled state where the list has it */
const rows = computed(() => {
  if (!dupOnly.value) return units.value
  const polled = new Map(units.value.map((u) => [u.id, u]))
  return dupGroups.value.flatMap((g) => g.units.map((u) => polled.get(u.id) ?? u))
})
const levelOptions = LEVELS.map((l) => ({ label: levelLabel(l), value: l }))
const seriesOptions = computed(() => {
  // Like the categories: keys of the loaded units plus the active ones
  const keys = new Set([...rows.value.flatMap((u) => (u.series ? [u.series] : [])), ...activeSeries.value.filter((s) => s !== NO_SERIES)])
  return [{ label: 'ohne Serie', value: NO_SERIES }, ...[...keys].sort((a, b) => a.localeCompare(b, 'de')).map((key) => ({ label: key, value: key }))]
})
const UNIT_FORMATS = unitFormatSchema.options
const FORMAT_LABEL: Record<UnitFormat, string> = { written: 'Text', audio: 'Audio' }
const formatOptions = UNIT_FORMATS.map((f) => ({ label: FORMAT_LABEL[f], value: f }))
const fieldOptions = computed(() => {
  // Categories come from the loaded units; active ones stay selectable even when no unit matches
  const slugs = new Set([...rows.value.map((u) => u.fieldSlug), ...activeFields.value])
  return [...slugs].sort((a, b) => a.localeCompare(b, 'de')).map((slug) => ({ label: slug, value: slug }))
})
const norm = (t: string): string => t.toLocaleLowerCase('de').normalize('NFD').replace(/\p{Diacritic}/gu, '')
/** Everything except the status filter, so the chip counts reflect the other filters */
const baseFiltered = computed(() => {
  const words = norm((search.value ?? '').trim()).split(/\s+/).filter(Boolean)
  return rows.value.filter(
    (u) =>
      (!activeFields.value.length || activeFields.value.includes(u.fieldSlug)) &&
      (!activeFormats.value.length || activeFormats.value.includes(u.format)) &&
      (!activeLevels.value.length || activeLevels.value.includes(u.level)) &&
      (!activeSeries.value.length || activeSeries.value.includes(u.series ?? NO_SERIES)) &&
      (!words.length || words.every((w) => norm(`${u.title ?? ''} ${u.topic} ${u.series ?? ''}`).includes(w))),
  )
})
const statusCounts = computed(() => {
  const counts = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>
  for (const u of baseFiltered.value) counts[u.status]++
  return counts
})
const visibleUnits = computed(() => (activeStatuses.value.length ? baseFiltered.value.filter((u) => activeStatuses.value.includes(u.status)) : baseFiltered.value))
const filterActive = computed(() => !!(dupOnly.value || activeStatuses.value.length || activeFields.value.length || activeFormats.value.length || activeLevels.value.length || activeSeries.value.length || (search.value ?? '').trim()))
function toggleStatus(s: UnitStatus): void {
  activeStatuses.value = activeStatuses.value.includes(s) ? activeStatuses.value.filter((x) => x !== s) : [...activeStatuses.value, s]
}
function resetFilter(): void {
  activeStatuses.value = []
  activeFields.value = []
  activeFormats.value = []
  activeLevels.value = []
  activeSeries.value = []
  search.value = ''
  dupOnly.value = false
}

/** Sorting also lives in the URL (?sort=updated&desc=1) */
const SORTABLE = ['dup', 'status', 'title', 'field', 'level', 'series', 'format', 'check', 'updated'] as const
type SortKey = (typeof SORTABLE)[number]
const initialSort = (SORTABLE as readonly string[]).includes(String(route.query.sort)) && (route.query.sort !== 'dup' || dupOnly.value) ? (route.query.sort as SortKey) : 'updated'
const pagination = ref({
  rowsPerPage: 50,
  sortBy: initialSort as string | null,
  descending: route.query.sort ? route.query.desc === '1' : true,
})
watch(
  [activeStatuses, activeFields, activeFormats, activeLevels, activeSeries, search, () => pagination.value.sortBy, () => pagination.value.descending, dupOnly],
  ([statuses, fields, formats, levels, series, q, sortBy, desc, dup]) => {
    const query = {
      ...route.query,
      status: statuses.length ? statuses.join(',') : undefined,
      field: fields.length ? fields.join(',') : undefined,
      format: formats.length ? formats.join(',') : undefined,
      level: levels.length ? levels.join(',') : undefined,
      series: series.length ? series.join(',') : undefined,
      q: (q ?? '').trim() || undefined,
      dup: dup ? '1' : undefined,
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
  { name: 'level', label: 'Stufe', field: 'level', align: 'left' as const, sortable: true, sort: (a: Level, b: Level) => a - b, format: (v: Level) => levelLabel(v) },
  // Units without a series sort after all keys
  { name: 'series', label: 'Serie', field: 'series', align: 'left' as const, sortable: true, sort: (a: string | null, b: string | null) => (a && b ? byText(a, b) : Number(!a) - Number(!b)), format: (v: string | null) => v ?? '–' },
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
/** Group members sit next to each other: the group column leads and sorts while the filter is on */
const tableColumns = computed(() =>
  dupOnly.value ? [{ name: 'dup', label: 'Duplikat', field: (u: UnitSummaryDto) => dupInfo.value.get(u.id)?.group ?? 0, align: 'left' as const, sortable: true, sort: (a: number, b: number) => a - b }, ...columns] : columns,
)
watch(dupOnly, (on) => {
  if (on) {
    void loadDuplicates()
    pagination.value = { ...pagination.value, sortBy: 'dup', descending: false }
  } else if (pagination.value.sortBy === 'dup') {
    pagination.value = { ...pagination.value, sortBy: 'updated', descending: true }
  }
})

/** Compares all units on the server, so it runs on demand and not with the status polling */
async function loadDuplicates(): Promise<void> {
  try {
    dupGroups.value = await api<DuplicateGroupDto[]>('/api/admin/units/duplicates')
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
  }
}

async function load(): Promise<void> {
  try {
    // Filtering happens client-side so every chip can show its count
    units.value = await api<UnitSummaryDto[]>('/api/admin/units')
    // Keep the selection across polling, minus rows that left the list
    const byId = new Map(rows.value.map((u) => [u.id, u]))
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
  approve: {
    title: 'Freigeben',
    message: (n) => `${n} Wissenshappen veröffentlichen? Nur Einträge „Zur Freigabe“ mit gültigem Inhalt werden freigegeben.`,
    done: 'freigegeben',
    color: 'positive',
  },
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
    await Promise.all([load(), loadDuplicates()])
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

/** List for `pnpm coolify:push-delta --units <file>`: pushes exactly these units to prod */
function exportPushList(): void {
  const now = new Date()
  const ok = exportFile(pushListFilename(now), formatPushList(selected.value, now), { mimeType: 'text/plain', encoding: 'utf-8' })
  if (ok !== true) $q.notify({ type: 'negative', message: 'Download vom Browser blockiert' })
}

/** Brief plus published text of the selection, as input for an LLM that plans the next level (docs/batch-import.md, Prompt 2d) */
async function exportContext(): Promise<void> {
  busy.value = true
  try {
    const jobs = await api<ContextJob[]>('/api/admin/units/context', { method: 'POST', body: { ids: selectedIds.value } })
    if (!jobs.length) {
      $q.notify({ type: 'warning', message: 'Keiner der ausgewählten Happen hat fertigen Inhalt' })
      return
    }
    const ok = exportFile(contextFilename(new Date()), formatContextFile(jobs), { mimeType: 'application/json', encoding: 'utf-8' })
    if (ok !== true) $q.notify({ type: 'negative', message: 'Download vom Browser blockiert' })
    else $q.notify({ type: 'positive', message: `${jobs.length} Happen als Kontext exportiert` })
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  void loadDuplicates()
  // Pipeline status changes in the background
  timer = setInterval(() => void load(), 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <q-page padding>
    <div class="row items-center q-gutter-md q-mb-md">
      <div class="text-h6">Wissenshappen</div>
      <q-input v-model="search" dense outlined clearable debounce="200" placeholder="Titel, Kernidee oder Serie suchen" style="min-width: 260px">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-select v-model="fieldsModel" :options="fieldOptions" multiple emit-value map-options use-chips dense outlined clearable label="Bereich" style="min-width: 180px" />
      <q-select v-model="formatsModel" :options="formatOptions" multiple emit-value map-options use-chips dense outlined clearable label="Format" style="min-width: 150px" />
      <q-select v-model="levelsModel" :options="levelOptions" multiple emit-value map-options use-chips dense outlined clearable label="Stufe" style="min-width: 150px" />
      <q-select v-model="seriesModel" :options="seriesOptions" multiple emit-value map-options use-chips dense outlined clearable label="Serie" style="min-width: 180px" />
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
      <q-separator vertical spaced />
      <q-chip clickable dense :outline="!dupOnly" color="brown" :text-color="dupOnly ? 'white' : undefined" :icon="dupOnly ? 'check' : 'content_copy'" :class="{ 'filter-chip--empty': !dupInfo.size && !dupOnly }" @click="dupOnly = !dupOnly">
        Duplikate
        <q-badge rounded class="q-ml-xs" :color="dupOnly ? 'white' : 'brown'" :text-color="dupOnly ? 'brown' : 'white'" :label="dupInfo.size" />
        <q-tooltip>Gleiches Format und gleiche Serie oder gleiches Thema (Titel und Kernidee)</q-tooltip>
      </q-chip>
      <q-btn flat dense no-caps icon="filter_alt_off" label="Alle Filter zurücksetzen" color="grey-8" class="q-ml-sm" :disable="!filterActive" @click="resetFilter" />
      <q-space />
      <div class="text-caption text-grey-7">{{ visibleUnits.length }} von {{ rows.length }}</div>
    </div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <q-banner v-if="selected.length" dense rounded class="bg-blue-1 q-mb-sm">
      <div class="row items-center q-gutter-sm">
        <div class="text-weight-medium">{{ selected.length }} ausgewählt</div>
        <q-space />
        <q-btn v-if="selected.some((u) => u.status === 'in_review')" flat color="positive" icon="done" label="Freigeben" :disable="busy" @click="confirmBulk('approve')" />
        <q-btn v-if="selected.some((u) => u.stuck)" flat icon="play_arrow" label="Fortsetzen" :disable="busy" @click="confirmBulk('resume')" />
        <q-btn v-if="selected.some((u) => u.status === 'published')" flat icon="lock" label="Sperren" :disable="busy" @click="confirmBulk('lock')" />
        <q-btn v-if="selected.some((u) => u.status === 'locked')" flat icon="lock_open" label="Entsperren" :disable="busy" @click="confirmBulk('unlock')" />
        <q-btn flat icon="file_download" label="Push-Liste exportieren" :disable="busy" @click="exportPushList">
          <q-tooltip>Auswahl als Datei für „pnpm coolify:push-delta --units“ speichern</q-tooltip>
        </q-btn>
        <q-btn flat icon="account_tree" label="Kontext exportieren" :disable="busy" @click="exportContext">
          <q-tooltip>Auftrag und Inhalt der Auswahl als JSON, damit Gemini die nächste Stufe planen kann</q-tooltip>
        </q-btn>
        <q-btn flat icon="replay" label="Neu generieren" :disable="busy" @click="confirmBulk('regenerate')" />
        <q-btn flat color="negative" icon="delete" label="Löschen" :disable="busy" @click="confirmBulk('delete')" />
        <q-btn flat round dense icon="close" :disable="busy" @click="selected = []"><q-tooltip>Auswahl aufheben</q-tooltip></q-btn>
      </div>
    </q-banner>
    <q-table
      v-model:selected="selected"
      v-model:pagination="pagination"
      :rows="visibleUnits"
      :columns="tableColumns"
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
      <template #body-cell-dup="props">
        <q-td :props="props">
          <div class="text-weight-medium">#{{ props.value }}</div>
          <div class="text-caption text-grey-7">{{ dupInfo.get(props.row.id)?.reasons }}</div>
        </q-td>
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
