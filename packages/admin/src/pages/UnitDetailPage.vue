<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { formatLicense, type ReplaceImageMode, type UnitDetailDto } from '@wizzn/shared'
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
/** Asset shown large in the preview dialog */
const zoomId = ref<string | null>(null)
const zoomed = computed(() => images.value.find((a) => a.id === zoomId.value) ?? null)
const mediaBusy = computed(() => busy.value || Object.values(swapping.value).some(Boolean))
/** Unsaved edits would be overwritten by load(), and re-voicing reads the saved script */
const dirty = computed(() => !!unit.value && (title.value !== (unit.value.title ?? '') || json.value !== JSON.stringify(unit.value.contentJson, null, 2)))
const fmtSec = (s: number | null): string => (s === null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
const reviewable = computed(() => unit.value?.status === 'in_review')
const stuck = computed(() => !!unit.value?.stuck)
/** A stuck draft can be fixed by hand and then resumed (check → media → review) */
const draftEditable = computed(() => stuck.value && unit.value?.status === 'drafting')
const editable = computed(() => reviewable.value || draftEditable.value)
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
function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true)
  return new Promise((resolve) => {
    $q.dialog({ title: 'Ungespeicherte Änderungen', message: 'Titel/Inhalt wurden geändert, aber nicht gespeichert. Verwerfen und fortfahren?', ok: { label: 'Verwerfen', color: 'negative' }, cancel: { label: 'Abbrechen', flat: true } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false))
      .onDismiss(() => resolve(false))
  })
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
  if (!(await confirmDiscard())) return
  await swapOne(assetId, mode)
  await load()
}

/** Sequential so the provider is not hammered and every failure is reported */
async function regenerateAllImages(): Promise<void> {
  if (!(await confirmDiscard())) return
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
  if (!(await confirmDiscard())) return
  if (await revoiceOne()) $q.notify({ type: 'positive', message: 'Audio neu vertont' })
  await load()
}

async function regenerateAllMedia(): Promise<void> {
  if (!(await confirmDiscard())) return
  const voiced = audio.value ? await revoiceOne() : false
  let ok = 0
  for (const img of images.value) if (await swapOne(img.id, 'generated')) ok++
  await load()
  $q.notify({ type: 'info', message: `Medien neu: ${audio.value ? `Audio ${voiced ? 'ok' : 'fehlgeschlagen'}, ` : ''}${ok}/${images.value.length} Bilder` })
}

const save = () => act('Gespeichert', () => api(`/api/admin/units/${props.id}`, { method: 'PUT', body: { title: title.value, contentJson: previewContent.value } }))
const approve = () => act('Veröffentlicht', () => api(`/api/admin/units/${props.id}/approve`, { method: 'POST' }))
const REGENERATABLE = ['in_review', 'failed', 'rejected', 'published'] as const
const canRegenerate = computed(() => !!unit.value && (stuck.value || (REGENERATABLE as readonly string[]).includes(unit.value.status)))
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

onMounted(load)
</script>

<template>
  <q-page padding>
    <div v-if="unit" class="row q-col-gutter-lg">
      <div class="col-auto">
        <UnitPreview :title="title" :content="previewContent" :assets="unit.assets" />
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
          <q-btn color="positive" icon="done" label="Freigeben" :disable="!reviewable || busy" @click="approve" />
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
        <q-banner v-if="stuck" class="bg-orange-1">
          Der Pipeline-Job dieses Wissenshappens ist abgebrochen (z. B. Worker-Neustart). Der Worker setzt hängende Einträge
          automatisch fort; du kannst ihn auch selbst fortsetzen, neu generieren oder ablehnen (Löschen über die Liste).
          <template v-if="draftEditable"> Der Entwurf kann unten bearbeitet werden – speichern, dann „Fortsetzen“. Freigeben ist erst nach Prüfung und Medien möglich.</template>
        </q-banner>

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
            <q-item v-for="(img, i) in images" :key="'o' + img.id">
              <q-item-section avatar><q-icon :name="img.credit ? 'photo_library' : 'auto_fix_high'" /></q-item-section>
              <q-item-section>{{ unit.format === 'written' && i === 0 ? 'Titelbild' : `Bild ${unit.format === 'written' ? i : i + 1}` }}</q-item-section>
              <q-item-section side>{{ imageOrigin(img) }}</q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card v-if="reviewable && (images.length || audio)" flat bordered>
          <q-card-section class="row items-center q-gutter-sm">
            <div class="text-subtitle1">Medien</div>
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
            <q-item v-for="(img, i) in images" :key="img.id" class="items-start">
              <q-item-section avatar>
                <q-img :src="img.url" width="96px" ratio="1" class="rounded-borders cursor-pointer" @click="zoomId = img.id">
                  <q-tooltip>Vorschau</q-tooltip>
                </q-img>
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ unit.format === 'written' && i === 0 ? 'Titelbild' : `Bild ${unit.format === 'written' ? i : i + 1}` }} ·
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
          <q-card v-if="zoomed" style="width: 640px; max-width: 92vw">
            <q-img :src="zoomed.url" ratio="1" fit="contain" />
            <q-card-section class="q-gutter-sm">
              <div class="text-caption text-grey-7">
                {{ zoomed.credit ? `${imageOrigin(zoomed)} · ${zoomed.credit.creator ?? 'Unbekannt'}` : imageOrigin(zoomed) }}
              </div>
              <q-input v-model="prompts[zoomed.id]" dense outlined autogrow label="KI-Prompt (Motiv)" />
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat color="primary" icon="photo_library" label="Nächstes Stockbild" :loading="swapping[zoomed.id]" :disable="mediaBusy" @click="swap(zoomed.id, 'next-stock')" />
              <q-btn color="primary" icon="auto_fix_high" label="KI-Bild generieren" :loading="swapping[zoomed.id]" :disable="mediaBusy" @click="swap(zoomed.id, 'generated')" />
              <q-btn v-close-popup flat label="Schließen" />
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
