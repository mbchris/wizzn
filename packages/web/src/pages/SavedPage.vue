<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { UnitTileDto } from '@wizzn/shared'
import { api } from 'src/api'
import { usePlatform } from 'src/composables/usePlatform'
import UnitGrid from 'components/UnitGrid.vue'

/** "Mein Gehirn": the user's bookmarked units as a tile grid */
const router = useRouter()
const { pIcon } = usePlatform()
const items = ref<UnitTileDto[]>([])
const cursor = ref<string | null>(null)
const hasMore = ref(true)
const loading = ref(false)
const error = ref('')

async function load(): Promise<void> {
  if (loading.value || !hasMore.value) return
  loading.value = true
  error.value = ''
  try {
    const page = await api.saved(cursor.value)
    const known = new Set(items.value.map((t) => t.id))
    items.value.push(...page.items.filter((t) => !known.has(t.id)))
    cursor.value = page.cursor
    hasMore.value = page.cursor !== null
  } catch (e) {
    console.warn('saved load failed', e)
    error.value = 'Deine gespeicherten Wissenshappen konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="wz-tab-page">
    <header class="wz-page-head">
      <q-btn flat round dense color="white" :icon="pIcon('back')" aria-label="Zurück" @click="router.back()" />
      <h1 class="wz-title q-my-none">Mein Gehirn</h1>
    </header>
    <p class="wz-sub">Alles, was du gespeichert hast – doppeltippen oder Lesezeichen im Stream.</p>

    <div v-if="error" class="wz-glass q-pa-md q-mb-md">
      {{ error }}
      <q-btn flat no-caps color="white" :icon="pIcon('refresh')" label="Nochmal" @click="load" />
    </div>
    <div v-else-if="!loading && !items.length" class="wz-empty">
      <div class="wz-empty-emoji">🧠</div>
      <p>Noch leer. Tippe im Stream doppelt auf einen Wissenshappen, um ihn hier zu sammeln.</p>
      <q-btn rounded unelevated no-caps color="white" text-color="dark" label="Zum Stream" @click="router.push('/feed')" />
    </div>
    <UnitGrid :items="items" :loading="loading" :has-more="hasMore" @more="load" @open="router.push(`/unit/${$event.id}`)" />
  </div>
</template>

<style scoped lang="scss">
.wz-page-head { display: flex; align-items: center; gap: 6px; margin: 0 0 4px -8px; }
.wz-sub { color: var(--wz-muted); margin: 0 0 16px; }
.wz-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 40px 16px; color: var(--wz-muted); }
.wz-empty-emoji { font-size: 52px; }
</style>
