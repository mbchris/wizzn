<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { AudioUnit, FeedUnitDto } from '@wizzn/shared'
import { useCompletion } from 'src/composables/useCompletion'
import { usePlatform } from 'src/composables/usePlatform'
import SourceFooter from 'components/SourceFooter.vue'

const props = defineProps<{ unit: FeedUnitDto & { content: AudioUnit }; active: boolean; preload: boolean }>()
const { pIcon } = usePlatform()
const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const current = ref(0)
const listened = ref(0)
let last = 0
const { completed, report } = useCompletion(props.unit.id)

const duration = computed(() => props.unit.content.durationSec)
const src = computed(() => props.unit.media[props.unit.content.audioId])
const image = computed(() => {
  const shown = props.unit.content.images.filter((i) => i.showAtSec <= current.value)
  const img = shown[shown.length - 1] ?? props.unit.content.images[0]
  return img ? props.unit.media[img.imageId] : undefined
})
const progress = computed(() => Math.min(1, current.value / duration.value))
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function toggle(): void {
  const el = audio.value
  if (!el) return
  if (el.paused) void el.play()
  else el.pause()
}

function onTime(): void {
  const t = audio.value?.currentTime ?? 0
  // Only continuous playback counts; seeking forward does not
  const delta = t - last
  if (delta > 0 && delta < 2) listened.value += delta
  last = t
  current.value = t
  if (listened.value >= duration.value * 0.9) void report({ format: 'audio', listenedSec: Math.floor(listened.value) })
}

function seek(e: MouseEvent): void {
  const el = audio.value
  const bar = e.currentTarget as HTMLElement
  if (!el) return
  el.currentTime = ((e.clientX - bar.getBoundingClientRect().left) / bar.clientWidth) * duration.value
  last = el.currentTime
}

// Leaving the card pauses playback
watch(
  () => props.active,
  (active) => {
    if (!active) audio.value?.pause()
  },
)
onUnmounted(() => audio.value?.pause())
</script>

<template>
  <div class="fit column no-wrap">
    <div class="wz-cover col-auto">
      <transition name="fade" mode="out-in"><img v-if="image" :key="image" :src="image" alt="" /></transition>
    </div>
    <q-space />
    <div class="wz-glass q-pa-md">
      <div class="row items-center no-wrap q-gutter-md">
        <q-btn round unelevated size="lg" class="wz-play" :icon="playing ? pIcon('pause') : pIcon('play')" @click="toggle" />
        <div class="col">
          <div class="wz-progress" @click="seek"><div :style="{ width: `${progress * 100}%` }" :class="{ done: completed }" /></div>
          <div class="row justify-between text-caption q-mt-xs" style="color: var(--wz-muted)">
            <span>{{ mmss(current) }}</span><span>{{ mmss(duration) }}</span>
          </div>
        </div>
      </div>
      <SourceFooter class="q-mt-sm" :sources="unit.content.sources" :disclaimer="unit.field.adviceDisclaimer" />
    </div>
    <audio
      v-if="src"
      ref="audio"
      :src="src"
      :preload="active || preload ? 'auto' : 'none'"
      playsinline
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @timeupdate="onTime"
    />
  </div>
</template>

<style scoped lang="scss">
.wz-cover { width: 100%; aspect-ratio: 1; max-height: 50dvh; border-radius: 28px; overflow: hidden; background: rgba(255, 255, 255, 0.15); }
.wz-cover img { width: 100%; height: 100%; object-fit: cover; }
.wz-play { background: #fff; color: var(--wz-bg); }
.wz-progress { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.25); overflow: hidden; cursor: pointer; }
.wz-progress div { height: 100%; background: #fff; border-radius: 4px; }
.wz-progress div.done { background: #b8f5c8; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
