<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { formatLicense, type ReplaceImageMode, type UnitDetailDto, type UnitLogDto, type UnitStatus } from '@wizzn/shared'
import { api, ApiError, errorMessage, replaceImage, revoiceAudio } from 'src/api'
import UnitPreview from 'components/UnitPreview.vue'
import { STATUS_COLOR, STATUS_LABEL, stuckLabel } from 'src/status'

const props = defineProps<{ id: string }>()
const $q = useQuasar()
const unit = ref<UnitDetailDto | null>(null)
const title = ref('')
const json = ref('')
const busy = ref(false)

const swapping = ref<Record<string, boolean>>({})
const images = computed(() => (unit.value?.assets ?? []).filter((a) => a.kind === 'image'))
const audio = computed(() => (unit.value?.assets ?? []).find((a) => a.kind === 'audio') ?? null)
/** Research providers with source counts, e.g. "wikipedia ×2 · web ×1" */
const researchProviders = computed(() => {
  const counts = new Map<string, number>()
  for (const s of unit.value?.sources ?? []) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1)
  return [...counts].map(([p, n]) => `${p} ×${n}`).join(' · ')
})
function imageOrigin(img: Pick<UnitDetailDto['assets'][number], 'credit' | 'generator'>): string {
  return img.credit ? `Stock · ${img.credit.provider} · ${formatLicense(img.credit)}` : `KI · ${img.generator ?? 'Modell unbekannt'}`
}
/** Editable AI prompt per image asset; seeded from the stored prompt */
const prompts = ref<Record<string, string>>({})
/** Display name per image asset: written units start with the cover ("Titelbild"), then "Bild 1", "Bild 2" … */
const imageLabels = computed<Record<string, string>>(() => {
  const written = unit.value?.format === 'written'
  return Object.fromEntries(images.value.map((img, i) => [img.id, written && i === 0 ? 'Titelbild' : `Bild ${written ? i : i + 1}`]))
})
const imageLabel = (id: string): string => imageLabels.value[id] ?? 'Bild'
/** Asset shown large in the preview dialog */
const zoomId = ref<string | null>(null)
const zoomIndex = computed(() => images.value.findIndex((a) => a.id === zoomId.value))
const zoomed = computed(() => images.value[zoomIndex.value] ?? null)
function zoomStep(delta: number): void {
  const n = images.value.length
  if (n && zoomIndex.value >= 0) zoomId.value = images.value[(zoomIndex.value + delta + n) % n]!.id
}
/** ← / → flip through the images while the large view is open (not while typing a prompt) */
function onZoomKey(e: KeyboardEvent): void {
  if (!zoomed.value || (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return
  if (e.key === 'ArrowLeft') zoomStep(-1)
  if (e.key === 'ArrowRight') zoomStep(1)
}
const mediaBusy = computed(() => busy.value || Object.values(swapping.value).some(Boolean))
/** Unsaved edits would be overwritten by load(), and re-voicing reads the saved script */
const dirty = computed(() => !!unit.value && (title.value !== (unit.value.title ?? '') || json.value !== JSON.stringify(unit.value.contentJson, null, 2)))
const fmtSec = (s: number | null): string => (s === null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const reviewable = computed(() => unit.value?.status === 'in_review')
/** Single media assets can be recreated in review and after publishing (API: MEDIA_EDITABLE) */
const locked = computed(() => unit.value?.status === 'locked')
const mediaEditable = computed(() => unit.value?.status === 'in_review' || unit.value?.status === 'published' || locked.value)
const isPublished = computed(() => unit.value?.status === 'published')
const stuck = computed(() => !!unit.value?.stuck)
/** A stuck draft can be fixed by hand and then resumed (check → media → review) */
const draftEditable = computed(() => stuck.value && unit.value?.status === 'drafting')
/** Locked units are edited while hidden from the feed (API: editUnit) */
const editable = computed(() => reviewable.value || draftEditable.value || locked.value)
/** Issue #4: source tiers and the derived trust level */
const TIER_LABEL: Record<number, string> = { 1: 'Stufe 1 · kuratiert', 2: 'Stufe 2 · Wikipedia', 3: 'Stufe 3 · Studie', 4: 'Stufe 4 · Web' }
const TIER_COLOR: Record<number, string> = { 1: 'positive', 2: 'primary', 3: 'teal', 4: 'orange' }
const TRUST: Record<string, { label: string; color: string }> = {
  high: { label: 'Quellenlage: hoch', color: 'positive' },
  mixed: { label: 'Quellenlage: gemischt', color: 'orange' },
  low: { label: 'Quellenlage: niedrig', color: 'negative' },
}
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
  prompts.value = Object.fromEntries(unit.value.assets.filter((a) => a.kind === 'image').map((a) => [a.id, a.prompt ?? a.stockQuery ?? '']))
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

/** Media actions reload the unit, so unsaved JSON/title edits would be lost: ask first */
function ask(title: string, message: string, ok: string, color: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false
    $q.dialog({ title, message, ok: { label: ok, color }, cancel: { label: 'Abbrechen', flat: true } })
      .onOk(() => ((answered = true), resolve(true)))
      .onDismiss(() => !answered && resolve(false))
  })
}
/** Published units: a swapped asset replaces the live one immediately */
async function confirmDiscard(what = 'Medien'): Promise<boolean> {
  if (dirty.value && !(await ask('Ungespeicherte Änderungen', 'Titel/Inhalt wurden geändert, aber nicht gespeichert. Verwerfen und fortfahren?', 'Verwerfen', 'negative'))) return false
  if (isPublished.value && !(await ask(`${what} neu erstellen`, `Der Wissenshappen ist veröffentlicht – das neue Ergebnis ersetzt ${what} sofort im Feed, ohne erneute Freigabe.`, 'Neu erstellen', 'primary'))) return false
  return true
}

async function swapOne(assetId: string, mode: ReplaceImageMode): Promise<boolean> {
  swapping.value[assetId] = true
  try {
    const prompt = mode === 'generated' ? prompts.value[assetId]?.trim() : undefined
    await replaceImage(props.id, assetId, mode, prompt && prompt.length >= 3 ? prompt : undefined)
    return true
  } catch (e) {
    const message = e instanceof ApiError && e.status === 422 ? 'Kein weiteres Stockbild gefunden' : errorMessage(e)
    $q.notify({ type: e instanceof ApiError && e.status === 422 ? 'warning' : 'negative', message })
    return false
  } finally {
    swapping.value[assetId] = false
  }
}

async function swap(assetId: string, mode: ReplaceImageMode): Promise<void> {
  if (!(await confirmDiscard(imageLabel(assetId)))) return
  if (await swapOne(assetId, mode)) $q.notify({ type: 'positive', message: `${imageLabel(assetId)} neu erstellt` })
  await load()
}

/** Sequential so the provider is not hammered and every failure is reported */
async function regenerateAllImages(): Promise<void> {
  if (!(await confirmDiscard('alle Bilder'))) return
  let ok = 0
  for (const img of images.value) if (await swapOne(img.id, 'generated')) ok++
  await load()
  $q.notify({ type: ok === images.value.length ? 'positive' : 'warning', message: `${ok}/${images.value.length} Bilder neu generiert` })
}

async function revoiceOne(): Promise<boolean> {
  const a = audio.value
  if (!a) return false
  swapping.value[a.id] = true
  try {
    await revoiceAudio(props.id, a.id)
    return true
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) })
    return false
  } finally {
    swapping.value[a.id] = false
  }
}

async function revoice(): Promise<void> {
  if (!(await confirmDiscard('das Audio'))) return
  if (await revoiceOne()) $q.notify({ type: 'positive', message: 'Audio neu vertont' })
  await load()
}

async function regenerateAllMedia(): Promise<void> {
  if (!(await confirmDiscard('alle Medien'))) return
  const voiced = audio.value ? await revoiceOne() : false
  let ok = 0
  for (const img of images.value) if (await swapOne(img.id, 'generated')) ok++
  await load()
  $q.notify({ type: 'info', message: `Medien neu: ${audio.value ? `Audio ${voiced ? 'ok' : 'fehlgeschlagen'}, ` : ''}${ok}/${images.value.length} Bilder` })
}

const save = () => act('Gespeichert', () => api(`/api/admin/units/${props.id}`, { method: 'PUT', body: { title: title.value, contentJson: previewContent.value } }))
const approve = () => act('Veröffentlicht', () => api(`/api/admin/units/${props.id}/approve`, { method: 'POST' }))
const REGENERATABLE = ['in_review', 'failed', 'rejected', 'published', 'locked'] as const
const canRegenerate = computed(() => !!unit.value && (stuck.value || (REGENERATABLE as readonly string[]).includes(unit.value.status)))
function lock(): void {
  $q.dialog({
    title: 'Sperren',
    message: 'Der Wissenshappen verschwindet aus Feed, Suche und Merklisten, bleibt aber in den Statistiken der Nutzer (abgeschlossen, XP, Serien). Danach kannst du Text und Medien bearbeiten und ihn wieder entsperren.',
    ok: { label: 'Sperren', color: 'purple-7' },
    cancel: { label: 'Abbrechen', flat: true },
  }).onOk(() => void act('Gesperrt', () => api(`/api/admin/units/${props.id}/lock`, { method: 'POST' })))
}
async function unlock(): Promise<void> {
  if (dirty.value && !(await ask('Ungespeicherte Änderungen', 'Titel/Inhalt wurden geändert, aber nicht gespeichert. Ohne diese Änderungen wieder veröffentlichen?', 'Ohne Änderungen veröffentlichen', 'primary'))) return
  await act('Wieder veröffentlicht', () => api(`/api/admin/units/${props.id}/unlock`, { method: 'POST' }))
}
const resume = () => act('Wird fortgesetzt', () => api(`/api/admin/units/${props.id}/resume`, { method: 'POST' }))
const doRequeue = () => act('Neu in der Pipeline', () => api(`/api/admin/units/${props.id}/requeue`, { method: 'POST' }))
const doRedraft = () => act('Text wird neu geschrieben', () => api(`/api/admin/units/${props.id}/redraft`, { method: 'POST' }))
const unpublishNote = computed(() => (unit.value?.status === 'published' ? ' Der Wissenshappen wird dabei aus dem Feed genommen und muss danach erneut freigegeben werden.' : ''))
function requeue(): void {
  $q.dialog({
    title: 'Alles neu generieren',
    message: `Recherche, Text, Prüfung und alle Medien werden mit dem aktuellen Auftrag und den aktuellen Prompts neu erstellt.${unpublishNote.value}`,
    ok: { label: 'Alles neu', color: 'primary' },
    cancel: { label: 'Abbrechen', flat: true },
  }).onOk(() => void doRequeue())
}
function redraft(): void {
  $q.dialog({
    title: 'Nur Text neu schreiben',
    message: `Die Quellen bleiben, Text wird neu geschrieben, danach laufen Prüfung, Bilder und Audio erneut.${unpublishNote.value}`,
    ok: { label: 'Text neu', color: 'primary' },
    cancel: { label: 'Abbrechen', flat: true },
  }).onOk(() => void doRedraft())
}
const canRedraft = computed(() => canRegenerate.value && unit.value?.sources.length !== 0)
function reject(): void {
  $q.dialog({ title: 'Ablehnen', message: 'Begründung', prompt: { model: '', type: 'text' }, cancel: true }).onOk((reason: string) => {
    void act('Abgelehnt', () => api(`/api/admin/units/${props.id}/reject`, { method: 'POST', body: { reason } }))
  })
}

/** Pipeline still running (or waiting): show the live protocol and keep polling */
const WORKING: readonly UnitStatus[] = ['queued', 'researching', 'drafting', 'checking', 'rendering_media']
const inProgress = computed(() => !!unit.value && WORKING.includes(unit.value.status) && !stuck.value)
/** The protocol stays visible for unfinished units: running, stuck or failed */
const showLog = computed(() => !!unit.value && (inProgress.value || stuck.value || unit.value.status === 'failed'))
const logs = ref<UnitLogDto[]>([])
const logBox = ref<HTMLElement | null>(null)
const LOG_COLOR: Record<UnitLogDto['level'], string> = { info: 'text-grey-9', warn: 'text-orange-9', error: 'text-negative' }
const STEP_ICON: Record<string, string> = { research: 'travel_explore', draft: 'edit_note', check: 'fact_check', media: 'perm_media' }
const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

async function loadLogs(): Promise<void> {
  const after = logs.value.at(-1)?.id
  try {
    const fresh = await api<UnitLogDto[]>(`/api/admin/units/${props.id}/logs${after !== undefined ? `?after=${after}` : ''}`)
    if (!fresh.length) return
    const box = logBox.value
    const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 24
    logs.value = [...logs.value, ...fresh].slice(-1000)
    // Follow the tail unless the reader scrolled up
    if (atBottom) void nextTick(() => logBox.value && (logBox.value.scrollTop = logBox.value.scrollHeight))
  } catch {
    // Polling retries on the next tick
  }
}

let poll: ReturnType<typeof setInterval> | undefined
function stopPolling(): void {
  clearInterval(poll)
  poll = undefined
}
async function tick(): Promise<void> {
  await loadLogs()
  // Unsaved edits are only possible on stuck drafts, which are not polled
  if (!dirty.value) await load().catch(() => {})
}
watch(
  inProgress,
  (running) => {
    if (running && !poll) poll = setInterval(() => void tick(), 2000)
    if (!running) stopPolling()
  },
)

onMounted(async () => {
  await load()
  await loadLogs()
})
watch(zoomed, (z, prev) => {
  if (z && !prev) window.addEventListener('keydown', onZoomKey)
  if (!z && prev) window.removeEventListener('keydown', onZoomKey)
})
onUnmounted(() => {
  stopPolling()
  window.removeEventListener('keydown', onZoomKey)
})
</script>

<template>
  <q-page padding>
    <div v-if="unit" class="row q-col-gutter-lg">
      <div class="col-auto">
        <UnitPreview :title="title" :content="previewContent" :assets="unit.assets" :labels="imageLabels" @zoom="(id) => (zoomId = id)" />
      </div>
      <div class="col column q-gutter-md">
        <div class="row items-center q-gutter-sm">
          <q-badge :color="STATUS_COLOR[unit.status]" :label="STATUS_LABEL[unit.status]" class="text-subtitle2" />
          <div class="text-caption text-grey-7">{{ unit.fieldSlug }} · {{ unit.format }} · {{ unit.model }} · Prompt {{ unit.promptVersion }}</div>
          <q-badge v-if="stuck" color="deep-orange" outline :label="stuckLabel(unit.updatedAt)" />
          <q-space />
          <q-btn v-if="stuck" color="primary" icon="play_arrow" label="Fortsetzen" :disable="busy" @click="resume">
            <q-tooltip>Den unterbrochenen Schritt erneut ausführen{{ draftEditable ? ' – ein vollständiger Entwurf (auch bearbeitet) wird geprüft und vertont/bebildert' : '' }}</q-tooltip>
          </q-btn>
          <q-btn v-if="locked" color="positive" icon="lock_open" label="Entsperren" :disable="busy" @click="unlock">
            <q-tooltip>Wieder veröffentlichen – gespeicherte Änderungen gehen live</q-tooltip>
          </q-btn>
          <q-btn v-else color="positive" icon="done" label="Freigeben" :disable="!reviewable || busy" @click="approve" />
          <q-btn v-if="isPublished" flat color="purple-7" icon="lock" label="Sperren" :disable="busy" @click="lock">
            <q-tooltip>Aus dem Feed nehmen, um ihn zu bearbeiten</q-tooltip>
          </q-btn>
          <q-btn color="negative" flat icon="block" label="Ablehnen" :disable="!(reviewable || stuck) || busy" @click="reject" />
          <q-btn-dropdown flat icon="replay" label="Neu generieren" :disable="busy || !canRegenerate">
            <q-list>
              <q-item v-close-popup clickable :disable="!canRedraft" @click="redraft">
                <q-item-section avatar><q-icon name="edit_note" /></q-item-section>
                <q-item-section>
                  <q-item-label>Nur Text</q-item-label>
                  <q-item-label caption>Quellen behalten, Text + Medien neu</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-close-popup clickable @click="requeue">
                <q-item-section avatar><q-icon name="restart_alt" /></q-item-section>
                <q-item-section>
                  <q-item-label>Alles</q-item-label>
                  <q-item-label caption>Recherche, Text und Medien neu</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-banner v-if="unit.failureReason" class="bg-red-1 text-negative">{{ unit.failureReason }}</q-banner>
        <q-banner v-if="locked" class="bg-purple-1">
          <template #avatar><q-icon name="lock" color="purple-7" /></template>
          Gesperrt: für Nutzer nicht sichtbar (Feed, Suche, Merklisten), zählt aber weiter in ihren Statistiken. Text und Medien
          können bearbeitet bzw. einzeln neu erstellt werden – speichern, dann „Entsperren“.
        </q-banner>
        <q-banner v-if="stuck" class="bg-orange-1">
          Der Pipeline-Job dieses Wissenshappens ist abgebrochen (z. B. Worker-Neustart). Der Worker setzt hängende Einträge
          automatisch fort; du kannst ihn auch selbst fortsetzen, neu generieren oder ablehnen (Löschen über die Liste).
          <template v-if="draftEditable"> Der Entwurf kann unten bearbeitet werden – speichern, dann „Fortsetzen“. Freigeben ist erst nach Prüfung und Medien möglich.</template>
        </q-banner>

        <q-card v-if="showLog" flat bordered>
          <q-card-section class="row items-center q-pb-sm">
            <q-spinner-dots v-if="inProgress" color="primary" size="sm" class="q-mr-sm" />
            <q-icon v-else name="receipt_long" size="sm" class="q-mr-sm" />
            <div class="text-subtitle1">Erstellungsprotokoll</div>
            <q-space />
            <div class="text-caption text-grey-7">{{ inProgress ? `live · ${STATUS_LABEL[unit.status]}` : STATUS_LABEL[unit.status] }}</div>
          </q-card-section>
          <div ref="logBox" class="unit-log q-px-md q-pb-md">
            <div v-if="!logs.length" class="text-grey-7">{{ unit.status === 'queued' ? 'Wartet auf einen freien Worker …' : 'Noch keine Einträge.' }}</div>
            <div v-for="l in logs" :key="l.id" class="row no-wrap items-start q-gutter-x-sm" :class="LOG_COLOR[l.level]">
              <span class="text-grey-6">{{ fmtTime(l.at) }}</span>
              <q-icon :name="l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : (l.step && STEP_ICON[l.step]) || 'person'" size="14px" class="q-mt-xs" />
              <span class="col">{{ l.message }}</span>
            </div>
          </div>
        </q-card>

        <q-card v-if="unit.checkReport" flat bordered>
          <q-card-section class="row items-center">
            <q-icon :name="unit.checkReport.passed ? 'verified' : 'warning'" :color="unit.checkReport.passed ? 'positive' : 'orange'" size="md" class="q-mr-sm" />
            <div class="text-subtitle1">KI-Check {{ unit.checkReport.passed ? 'bestanden' : 'mit Hinweisen' }}</div>
            <q-space />
            <q-badge v-if="unit.checkReport.trust" :color="TRUST[unit.checkReport.trust]!.color" :label="TRUST[unit.checkReport.trust]!.label" />
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
          <q-card-section class="text-subtitle1 q-pb-none">Herkunft</q-card-section>
          <q-list dense>
            <q-item>
              <q-item-section avatar><q-icon name="notes" /></q-item-section>
              <q-item-section>Text</q-item-section>
              <q-item-section side>{{ unit.model ?? '–' }}{{ unit.promptVersion ? ` · Prompt ${unit.promptVersion}` : '' }}</q-item-section>
            </q-item>
            <q-item>
              <q-item-section avatar><q-icon name="travel_explore" /></q-item-section>
              <q-item-section>Recherche</q-item-section>
              <q-item-section side>{{ researchProviders || '–' }}</q-item-section>
            </q-item>
            <q-item v-if="audio">
              <q-item-section avatar><q-icon name="graphic_eq" /></q-item-section>
              <q-item-section>Audio</q-item-section>
              <q-item-section side>{{ audio.generator ?? 'unbekannt' }}</q-item-section>
            </q-item>
            <q-item v-for="img in images" :key="'o' + img.id" clickable @click="zoomId = img.id">
              <q-item-section avatar><q-icon :name="img.credit ? 'photo_library' : 'auto_fix_high'" /></q-item-section>
              <q-item-section>
                <div class="row items-center no-wrap q-gutter-x-sm">
                  <q-img :src="img.url" width="28px" ratio="1" class="rounded-borders" />
                  <span>{{ imageLabel(img.id) }}</span>
                </div>
              </q-item-section>
              <q-item-section side>{{ imageOrigin(img) }}</q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card v-if="mediaEditable && (images.length || audio)" flat bordered>
          <q-card-section class="row items-center q-gutter-sm">
            <div class="text-subtitle1">Medien</div>
            <q-badge v-if="isPublished" outline color="orange" label="live – Änderungen sofort im Feed" />
            <q-space />
            <q-btn v-if="images.length" flat dense color="primary" icon="image" label="Alle Bilder neu (KI)" :disable="mediaBusy" @click="regenerateAllImages" />
            <q-btn v-if="audio && images.length" flat dense color="primary" icon="auto_awesome" label="Alle Medien neu" :disable="mediaBusy" @click="regenerateAllMedia" />
          </q-card-section>
          <q-list separator>
            <q-item v-if="audio">
              <q-item-section avatar><q-icon name="graphic_eq" size="md" color="primary" /></q-item-section>
              <q-item-section>
                <q-item-label>Audio · {{ fmtSec(audio.durationSec) }} · {{ audio.generator ?? 'Engine unbekannt' }}</q-item-label>
                <audio :key="audio.url" :src="audio.url" controls preload="none" class="full-width q-mt-xs" />
                <q-item-label caption>Neu vertonen nutzt das gespeicherte Skript – Änderungen vorher speichern.</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense color="primary" icon="record_voice_over" label="Neu vertonen" :loading="swapping[audio.id]" :disable="mediaBusy" @click="revoice" />
              </q-item-section>
            </q-item>
            <q-item v-for="img in images" :key="img.id" class="items-start">
              <q-item-section avatar>
                <q-img :src="img.url" width="96px" ratio="1" class="rounded-borders cursor-pointer" @click="zoomId = img.id">
                  <div class="absolute-bottom text-caption text-center q-pa-none">{{ imageLabel(img.id) }}</div>
                  <q-tooltip>Groß anzeigen</q-tooltip>
                </q-img>
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  <span class="text-weight-medium">{{ imageLabel(img.id) }}</span> ·
                  {{ imageOrigin(img) }}
                </q-item-label>
                <q-item-label v-if="img.stockQuery" caption>Stock-Suche: {{ img.stockQuery }}</q-item-label>
                <q-input v-model="prompts[img.id]" dense outlined autogrow class="q-mt-xs" label="KI-Prompt (Motiv)" hint="Stil kommt automatisch aus der Kategorie" />
              </q-item-section>
              <q-item-section side top>
                <div class="column q-gutter-xs">
                  <q-btn flat dense color="primary" icon="auto_fix_high" label="KI-Bild" :loading="swapping[img.id]" :disable="mediaBusy" @click="swap(img.id, 'generated')" />
                  <q-btn flat dense color="primary" icon="photo_library" label="Nächstes Stockbild" :loading="swapping[img.id]" :disable="mediaBusy" @click="swap(img.id, 'next-stock')" />
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-dialog :model-value="!!zoomed" @update:model-value="(v) => !v && (zoomId = null)">
          <q-card v-if="zoomed" style="width: 900px; max-width: 94vw">
            <q-card-section class="row items-center q-py-sm">
              <div class="text-h6">{{ imageLabel(zoomed.id) }}</div>
              <div class="text-caption text-grey-7 q-ml-sm">{{ zoomIndex + 1 }} / {{ images.length }}</div>
              <q-space />
              <q-btn v-if="images.length > 1" flat round dense icon="chevron_left" @click="zoomStep(-1)"><q-tooltip>Vorheriges Bild (←)</q-tooltip></q-btn>
              <q-btn v-if="images.length > 1" flat round dense icon="chevron_right" @click="zoomStep(1)"><q-tooltip>Nächstes Bild (→)</q-tooltip></q-btn>
              <q-btn v-close-popup flat round dense icon="close" />
            </q-card-section>
            <a :href="zoomed.url" target="_blank" class="block bg-grey-2">
              <q-img :src="zoomed.url" fit="contain" style="max-height: 70vh" />
            </a>
            <q-card-section class="q-gutter-sm">
              <div class="text-caption text-grey-7">
                {{ zoomed.credit ? `${imageOrigin(zoomed)} · ${zoomed.credit.creator ?? 'Unbekannt'}` : imageOrigin(zoomed) }}
              </div>
              <q-input v-if="mediaEditable" v-model="prompts[zoomed.id]" dense outlined autogrow label="KI-Prompt (Motiv)" />
              <div v-else-if="zoomed.prompt" class="text-body2">Motiv: {{ zoomed.prompt }}</div>
            </q-card-section>
            <q-card-actions v-if="mediaEditable" align="right">
              <q-btn flat color="primary" icon="photo_library" label="Nächstes Stockbild" :loading="swapping[zoomed.id]" :disable="mediaBusy" @click="swap(zoomed.id, 'next-stock')" />
              <q-btn color="primary" icon="auto_fix_high" label="KI-Bild generieren" :loading="swapping[zoomed.id]" :disable="mediaBusy" @click="swap(zoomed.id, 'generated')" />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <q-card flat bordered>
          <q-card-section class="text-subtitle1">Quellen</q-card-section>
          <q-list dense>
            <q-item v-for="(s, i) in unit.sources" :key="s.url" clickable tag="a" :href="s.url" target="_blank">
              <q-item-section avatar>[{{ i }}]</q-item-section>
              <q-item-section>
                <q-item-label>{{ s.publisher }}</q-item-label>
                <q-item-label caption>{{ s.title }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge outline :color="TIER_COLOR[s.tier]" :label="TIER_LABEL[s.tier]" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card flat bordered>
          <q-card-section class="q-gutter-sm">
            <q-input v-model="title" outlined dense label="Titel" :disable="!editable" />
            <q-input v-model="json" outlined type="textarea" input-class="mono" rows="18" :label="draftEditable ? 'Entwurf (JSON)' : 'Inhalt (JSON)'" :disable="!editable" :error="previewContent === null" error-message="Kein gültiges JSON" />
            <q-btn color="primary" icon="save" label="Speichern" :disable="!editable || busy || previewContent === null" @click="save" />
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div v-else class="flex flex-center q-pa-xl"><q-spinner size="lg" color="primary" /></div>
  </q-page>
</template>

<style scoped>
.unit-log {
  max-height: 320px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
