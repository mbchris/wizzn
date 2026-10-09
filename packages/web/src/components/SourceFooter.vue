<script setup lang="ts">
import type { Source } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'

defineProps<{ sources: Source[]; disclaimer: boolean }>()
const { pIcon } = usePlatform()
</script>

<template>
  <div class="wz-sources">
    <a v-for="s in sources" :key="s.url" :href="s.url" target="_blank" rel="noopener" class="wz-pill q-mr-xs q-mb-xs">
      <q-icon :name="pIcon('link')" size="14px" />{{ s.publisher }}
    </a>
    <div v-if="disclaimer" class="text-caption q-mt-xs" style="color: var(--wz-muted)">Allgemeine Information, keine professionelle Beratung.</div>
  </div>
</template>

<style scoped>
.wz-sources a { color: #fff; text-decoration: none; }
</style>
