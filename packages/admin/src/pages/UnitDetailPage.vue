<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { formatLicense, type ReplaceImageMode, type UnitDetailDto } from '@wizzn/shared'
import { api, ApiError, errorMessage, replaceImage } from 'src/api'
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

async function swap(assetId: string, mode: ReplaceImageMode): Promise<void> {
  swapping.value[assetId] = true
  try {
    await replaceImage(props.id, assetId, mode)
    await load()
  } catch (e) {
    const message = e instanceof ApiError && e.status === 422 ? 'Kein weiteres Stockbild gefunden' : errorMessage(e)
    $q.notify({ type: e instanceof ApiError && e.status === 422 ? 'warning' : 'negative', message })
  } finally {
    swapping.value[assetId] = false
  }
}

const save = () => act('Gespeichert', () => api(`/api/admin/units/${props.id}`, { method: 'PUT', body: { title: title.value, contentJson: previewContent.value } }))
const approve = () => act('Veröffentlicht', () => api(`/api/admin/units/${props.id}/approve`, { method: 'POST' }))
const REGENERATABLE = ['in_review', 'failed', 'rejected', 'published'] as const
const canRegenerate = computed(() => !!unit.value && (stuck.value || (REGENERATABLE as readonly string[]).includes(unit.value.status)))
const resume = () => act('Wird fortgesetzt', () => api(`/api/admin/units/${props.id}/resume`, { method: 'POST' }))
const doRequeue = () => act('Neu in der Pipeline', () => api(`/api/admin/units/${props.id}/requeue`, { method: 'POST' }))
function requeue(): void {
  if (unit.value?.status !== 'published') return void doRequeue()
  $q.dialog({
    title: 'Neu generieren',
    message: 'Der Wissenshappen wird aus dem Feed genommen und mit dem aktuellen Auftrag und den aktuellen Prompts neu erstellt. Danach muss er erneut freigegeben werden.',
    ok: { label: 'Neu generieren', color: 'primary' },
    cancel: { label: 'Abbrechen', flat: true },
  }).onOk(() => void doRequeue())
}
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
          <q-btn flat icon="replay" label="Neu generieren" :disable="busy || !canRegenerate" @click="requeue" />
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

        <q-card v-if="reviewable && images.length" flat bordered>
          <q-card-section class="text-subtitle1">Bilder</q-card-section>
          <q-list separator>
            <q-item v-for="img in images" :key="img.id">
              <q-item-section avatar><q-img :src="img.url" width="56px" ratio="1" class="rounded-borders" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ img.credit ? `Stock · ${img.credit.provider} · ${formatLicense(img.credit)}` : 'KI' }}</q-item-label>
                <q-item-label v-if="img.stockQuery" caption>{{ img.stockQuery }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="row q-gutter-sm">
                  <q-btn flat dense color="primary" label="Nächstes Stockbild" :loading="swapping[img.id]" :disable="busy || swapping[img.id]" @click="swap(img.id, 'next-stock')" />
                  <q-btn flat dense color="primary" label="KI-Bild" :loading="swapping[img.id]" :disable="busy || swapping[img.id]" @click="swap(img.id, 'generated')" />
                </div>
              </q-item-section>
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
