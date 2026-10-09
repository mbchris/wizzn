<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { AUDIO_MIN_PLAYED, type AudioUnit, type FeedUnitDto } from '@wizzn/shared'
import { useCompletion } from 'src/composables/useCompletion'
import { usePlatform } from 'src/composables/usePlatform'
import SourceFooter from 'components/SourceFooter.vue'
import Waveform from 'components/Waveform.vue'
import CompleteButton from 'components/CompleteButton.vue'

const props = defineProps<{ unit: FeedUnitDto & { content: AudioUnit }; active: boolean; preload: boolean }>()
const { pIcon } = usePlatform()
const audio = ref<HTMLAudioElement | null>(null)
const art = ref<HTMLElement | null>(null)
const playing = ref(false)
const current = ref(0)
const listened = ref(0)
const preview = ref<number | null>(null)
const artIndex = ref(0)
let last = 0
const { completed, report } = useCompletion(props.unit.id)

const RATES = [1, 1.25, 1.5] as const
const rate = ref<(typeof RATES)[number]>(1)

const duration = computed(() => props.unit.content.durationSec)
const src = computed(() => props.unit.media[props.unit.content.audioId])
const images = computed(() => props.unit.content.images.flatMap((i) => (props.unit.media[i.imageId] ? [{ ...i, url: props.unit.media[i.imageId]! }] : [])))
/** Chapter = last image whose mark has been reached (LAYOUT.md: artwork auto-advances at chapter marks) */
const chapter = computed(() => images.value.reduce((at, img, i) => (img.showAtSec <= current.value ? i : at), 0))
const progress = computed(() => Math.min(1, current.value / duration.value))
const shownTime = computed(() => (preview.value === null ? current.value : preview.value * duration.value))
const ready = computed(() => listened.value >= duration.value * AUDIO_MIN_PLAYED)
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

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
}

function seekTo(seconds: number): void {
  const el = audio.value
  if (!el) return
  el.currentTime = Math.min(duration.value, Math.max(0, seconds))
  last = el.currentTime
  current.value = el.currentTime
}

function cycleRate(): void {
  rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length]!
  if (audio.value) audio.value.playbackRate = rate.value
}

function complete(): void {
  void report({ format: 'audio', listenedSec: Math.floor(listened.value) })
}

function scrollArt(i: number): void {
  const el = art.value
  const frame = el?.children[i] as HTMLElement | undefined
  if (el && frame) el.scrollTo({ left: frame.offsetLeft - (el.clientWidth - frame.clientWidth) / 2, behavior: 'smooth' })
}
function onArtScroll(): void {
  const el = art.value
  if (!el || !el.children.length) return
  const w = (el.children[0] as HTMLElement).clientWidth
  artIndex.value = Math.round(el.scrollLeft / Math.max(1, w))
}
watch(chapter, (c) => scrollArt(c))

// Leaving the card (or the tab) pauses playback
watch(
  () => props.active,
  (active) => {
    if (!active) audio.value?.pause()
  },
)
onUnmounted(() => audio.value?.pause())
</script>

<template>
  <div class="wz-audio">
    <div ref="art" class="wz-art" :class="{ single: images.length < 2 }" @scroll.passive="onArtScroll">
      <figure v-for="(img, i) in images" :key="img.imageId" class="wz-frame">
        <div class="wz-frame-inner">
          <img :src="img.url" :alt="`Illustration ${i + 1} von ${images.length}`" :loading="i === 0 ? 'eager' : 'lazy'" draggable="false" />
        </div>
      </figure>
      <figure v-if="!images.length" class="wz-frame"><div class="wz-frame-inner wz-frame-empty">🎧</div></figure>
    </div>
    <div v-if="images.length > 1" class="wz-dots" aria-hidden="true">
      <span v-for="(_i, i) in images" :key="i" :class="{ on: i === artIndex }" />
    </div>

    <div class="wz-wave-row">
      <span class="wz-time">{{ mmss(shownTime) }}</span>
      <Waveform :seed="unit.id" :progress="progress" :playing="playing" label="Wiedergabeposition" @preview="preview = $event" @seek="seekTo($event * duration)" />
      <span class="wz-time">{{ mmss(duration) }}</span>
    </div>

    <div class="wz-transport">
      <button type="button" class="wz-pill wz-tbtn" aria-label="15 Sekunden zurück" @click="seekTo(current - 15)">
        <q-icon :name="pIcon('rewind')" size="18px" />15s
      </button>
      <button type="button" class="wz-play" :aria-label="playing ? 'Pause' : 'Abspielen'" @click="toggle">
        <q-icon :name="playing ? pIcon('pause') : pIcon('play')" size="32px" />
      </button>
      <button type="button" class="wz-pill wz-tbtn" aria-label="Wiedergabegeschwindigkeit" @click="cycleRate">{{ rate === 1 ? '1.0' : rate }}x</button>
    </div>

    <SourceFooter :sources="unit.content.sources" :disclaimer="unit.field.adviceDisclaimer" />

    <CompleteButton
      :ready="ready"
      :completed="completed"
      :fill="listened / (duration * AUDIO_MIN_PLAYED)"
      label="Fertig? Tippen (+1 fürs Wochenziel)"
      pending-label="Hör bis zum Ende für +1"
      @complete="complete"
    />

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
      @loadedmetadata="audio && (audio.playbackRate = rate)"
    />
  </div>
</template>

<style scoped lang="scss">
.wz-audio { height: 100%; display: flex; flex-direction: column; gap: 10px; }

/* Illustration carousel: neighbours peek in, 1px gradient border with neon glow */
.wz-art { flex: 1; min-height: 120px; display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 0 -20px; padding: 6px 20px 10px; }
.wz-art::-webkit-scrollbar { display: none; }
.wz-frame { flex: 0 0 86%; margin: 0; scroll-snap-align: center; padding: 1.5px; border-radius: 22px; background: linear-gradient(135deg, var(--wz-b), var(--wz-a) 55%, var(--wz-c)); box-shadow: 0 0 16px color-mix(in srgb, var(--wz-glow) 45%, transparent); }
.wz-art.single .wz-frame { flex-basis: 100%; }
.wz-frame-inner { width: 100%; height: 100%; border-radius: 20.5px; overflow: hidden; background: #17121d; }
.wz-frame-inner img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; }
.wz-frame-empty { display: flex; align-items: center; justify-content: center; font-size: 56px; }

.wz-dots { display: flex; justify-content: center; gap: 8px; margin-top: -4px; }
.wz-dots span { width: 6px; height: 6px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.6); transition: background 0.2s; }
.wz-dots span.on { background: #fff; border-color: #fff; }

.wz-wave-row { display: flex; align-items: center; gap: 10px; }
.wz-time { flex: none; font-size: 13px; font-variant-numeric: tabular-nums; color: var(--wz-muted); }

.wz-transport { display: flex; align-items: center; justify-content: center; gap: 18px; }
.wz-tbtn { min-height: 40px; min-width: 76px; justify-content: center; font-weight: 700; font-size: 15px; cursor: pointer; }
.wz-play { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.22); color: #fff; cursor: pointer; background: radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.08)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); transition: transform 0.12s ease; }
.wz-play:active { transform: scale(0.93); }

@media (max-height: 700px) {
  .wz-audio { gap: 6px; }
  .wz-play { width: 54px; height: 54px; }
}
</style>
