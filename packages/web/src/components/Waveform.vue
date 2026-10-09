<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHaptics } from 'src/composables/useHaptics'

/** Neon waveform scrubber (LAYOUT.md "Audio Wave Pulse"). Bars are seeded per unit so a unit always looks the same. */
const props = defineProps<{ seed: string; progress: number; playing: boolean; label: string }>()
const emit = defineEmits<{ seek: [fraction: number]; preview: [fraction: number | null] }>()
const haptics = useHaptics()

const BARS = 44
const CYAN = [0x60, 0xef, 0xff]
const VIOLET = [0xb0, 0x6b, 0xff]
const PINK = [0xe9, 0x40, 0x57]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const mix = (a: number[], b: number[], t: number): string => `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(',')})`

const bars = computed(() => {
  let h = hash(props.seed)
  return Array.from({ length: BARS }, (_, i) => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    const envelope = 0.55 + 0.45 * Math.sin((i / (BARS - 1)) * Math.PI)
    const t = i / (BARS - 1)
    return {
      height: Math.max(0.16, Math.min(1, (0.3 + (h / 2 ** 32) * 0.7) * envelope)),
      color: t < 0.5 ? mix(CYAN, VIOLET, t * 2) : mix(VIOLET, PINK, (t - 0.5) * 2),
    }
  })
})

const dragFrac = ref<number | null>(null)
const shown = computed(() => dragFrac.value ?? props.progress)
const played = computed(() => Math.round(shown.value * BARS))
let lastBar = -1

function fractionAt(e: PointerEvent): number {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}
function move(e: PointerEvent): void {
  const f = fractionAt(e)
  dragFrac.value = f
  emit('preview', f)
  const bar = Math.round(f * BARS)
  if (bar !== lastBar) haptics.tick()
  lastBar = bar
}
function down(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  move(e)
}
function up(e: PointerEvent): void {
  if (dragFrac.value === null) return
  emit('seek', fractionAt(e))
  dragFrac.value = null
  emit('preview', null)
  lastBar = -1
}
function key(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0
  if (!step) return
  e.preventDefault()
  emit('seek', Math.min(1, Math.max(0, props.progress + step)))
}
</script>

<template>
  <div
    class="wz-wave"
    :class="{ playing }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(shown * 100)"
    @pointerdown="down"
    @pointermove="dragFrac !== null && move($event)"
    @pointerup="up"
    @pointercancel="up"
    @keydown="key"
  >
    <span
      v-for="(b, i) in bars"
      :key="i"
      class="wz-bar"
      :class="{ on: i < played, head: i >= played - 5 && i < played }"
      :style="{ height: `${b.height * 100}%`, '--c': b.color, animationDelay: `${(i % 5) * 0.11}s` }"
    />
  </div>
</template>

<style scoped lang="scss">
/* 48px tall: covers both the 44pt (iOS) and 48dp (Android) hit target */
.wz-wave { flex: 1; min-width: 0; height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 2px; cursor: pointer; touch-action: none; outline: none; }
.wz-wave:focus-visible { outline: 2px solid var(--wz-cyan); outline-offset: 4px; border-radius: 8px; }
.wz-bar { flex: 1; max-width: 4px; min-height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); transform-origin: center; transition: background 0.15s; }
.wz-bar.on { background: var(--c); box-shadow: 0 0 6px var(--c); }
.playing .wz-bar.head { animation: wz-pulse 0.55s ease-in-out infinite alternate; }
@keyframes wz-pulse { from { transform: scaleY(0.75); } to { transform: scaleY(1.18); box-shadow: 0 0 12px var(--c); } }
</style>
