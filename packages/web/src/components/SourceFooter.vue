<script setup lang="ts">
import type { Source } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { nativePlugin } from 'src/native/capacitor'

/** Verified citation linkout. `pill` = frosted pill (audio), `link` = centered underlined link (decks). */
withDefaults(defineProps<{ sources: Source[]; disclaimer: boolean; variant?: 'pill' | 'link' }>(), { variant: 'pill' })
const { pIcon } = usePlatform()

interface BrowserPlugin {
  open(o: { url: string; presentationStyle?: 'popover' | 'fullscreen' }): Promise<void>
}

/** SFSafariViewController / Custom Tabs via @capacitor/browser when installed, new tab otherwise */
function open(e: MouseEvent, url: string): void {
  const browser = nativePlugin<BrowserPlugin>('Browser')
  if (!browser) return
  e.preventDefault()
  void browser.open({ url, presentationStyle: 'popover' })
}
</script>

<template>
  <div class="wz-sources" :class="variant">
    <a v-for="s in sources" :key="s.url" :href="s.url" target="_blank" rel="noopener" :title="s.title" :class="variant === 'pill' ? 'wz-pill' : 'wz-link'" @click="open($event, s.url)">
      <q-icon :name="pIcon('source')" size="14px" />
      <span class="ellipsis">Quelle: <span :class="{ u: variant === 'link' }">{{ s.publisher }}</span></span>
    </a>
    <div v-if="disclaimer" class="wz-disclaimer">Allgemeine Information, keine professionelle Beratung.</div>
  </div>
</template>

<style scoped lang="scss">
.wz-sources { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.wz-sources a { max-width: 100%; min-height: var(--wz-hit); color: rgba(255, 255, 255, 0.86); }
.wz-pill { font-size: 13px; font-weight: 500; }
.wz-link { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; text-decoration: none; }
.u { text-decoration: underline; text-underline-offset: 3px; color: #fff; }
.wz-disclaimer { width: 100%; text-align: center; font-size: 11px; color: var(--wz-muted); }
</style>
