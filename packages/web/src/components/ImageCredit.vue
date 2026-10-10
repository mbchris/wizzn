<script setup lang="ts">
import { ref } from 'vue'
import { formatLicense, type ImageCredit } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { nativePlugin } from 'src/native/capacitor'

/** ⓘ overlay for stock images: opens a sheet with title, creator, license and source (CC attribution). */
defineProps<{ credit?: ImageCredit | undefined }>()
const { pIcon, isIos } = usePlatform()
const shown = ref(false)

interface BrowserPlugin {
  open(o: { url: string; presentationStyle?: 'popover' | 'fullscreen' }): Promise<void>
}

/** Same link-out as SourceFooter: in-app browser when available, new tab otherwise */
function open(e: MouseEvent, url: string): void {
  const browser = nativePlugin<BrowserPlugin>('Browser')
  if (!browser) return
  e.preventDefault()
  void browser.open({ url, presentationStyle: 'popover' })
}
</script>

<template>
  <template v-if="credit">
    <button
      type="button"
      class="wz-credit-btn"
      aria-label="Bildnachweis"
      @click.stop="shown = true"
      @pointerdown.stop
      @touchstart.stop
    >
      <q-icon :name="pIcon('image_credit')" size="16px" />
    </button>
    <q-dialog v-model="shown" :position="isIos ? 'bottom' : 'standard'">
      <q-card class="wz-credit-card">
        <q-card-section class="wz-credit-body">
          <div class="wz-credit-title">{{ credit.title }}</div>
          <div v-if="credit.creator">
            von
            <a v-if="credit.creatorUrl" :href="credit.creatorUrl" target="_blank" rel="noopener" @click="open($event, credit.creatorUrl)">{{ credit.creator }}</a>
            <template v-else>{{ credit.creator }}</template>
          </div>
          <div>
            <a :href="credit.licenseUrl" target="_blank" rel="noopener" @click="open($event, credit.licenseUrl)">{{ formatLicense(credit) }}</a>
          </div>
          <div>
            <a :href="credit.sourceUrl" target="_blank" rel="noopener" @click="open($event, credit.sourceUrl)">Quelle ansehen</a>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </template>
</template>

<style scoped lang="scss">
.wz-credit-btn { position: absolute; right: 8px; bottom: 8px; z-index: 2; width: 24px; height: 24px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 50%; background: rgba(0, 0, 0, 0.5); color: #fff; cursor: pointer; }
.wz-credit-card { min-width: min(320px, 92vw); }
.wz-credit-body { display: flex; flex-direction: column; gap: 8px; font-size: 15px; }
.wz-credit-title { font-weight: 700; }
.wz-credit-body a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
</style>
