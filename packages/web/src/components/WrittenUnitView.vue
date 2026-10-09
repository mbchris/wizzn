<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { WRITTEN_MIN_DWELL_SEC, type FeedUnitDto, type WrittenUnit } from '@wizzn/shared'
import { useCompletion, useDwell } from 'src/composables/useCompletion'
import { usePlatform } from 'src/composables/usePlatform'
import SourceFooter from 'components/SourceFooter.vue'
import CompleteButton from 'components/CompleteButton.vue'

const props = defineProps<{ unit: FeedUnitDto & { content: WrittenUnit }; active: boolean }>()
const { pIcon } = usePlatform()
const track = ref<HTMLElement | null>(null)
const index = ref(0)
const maxSeen = ref(1)
const slides = computed(() => props.unit.content.slides)
const pct = computed(() => Math.round(((index.value + 1) / slides.value.length) * 100))
const onLast = computed(() => index.value === slides.value.length - 1)
const { completed, report } = useCompletion(props.unit.id)
const dwell = useDwell(() => props.active)
onUnmounted(dwell.stop)

const ready = computed(() => maxSeen.value >= slides.value.length && dwell.seconds.value >= WRITTEN_MIN_DWELL_SEC)
const waitSec = computed(() => Math.max(0, WRITTEN_MIN_DWELL_SEC - dwell.seconds.value))

/** Line-broken or "•"-separated bodies render as bullets (TikTok caption style) */
function bullets(body: string): string[] | null {
  const parts = body.split(/\n+|\s*•\s+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : null
}

function onScroll(): void {
  const el = track.value
  if (!el) return
  index.value = Math.round(el.scrollLeft / el.clientWidth)
  maxSeen.value = Math.max(maxSeen.value, index.value + 1)
}

function go(i: number): void {
  track.value?.scrollTo({ left: i * (track.value?.clientWidth ?? 0), behavior: 'smooth' })
}

function complete(): void {
  void report({ format: 'written', slidesSeen: maxSeen.value, dwellSec: dwell.seconds.value })
}
</script>

<template>
  <div class="wz-written">
    <div class="wz-deck">
      <div class="wz-deck-head">
        <span>Folie {{ index + 1 }} von {{ slides.length }}</span>
        <span>[ {{ pct }}% ]</span>
      </div>
      <div class="wz-deck-bar"><div :style="{ width: `${pct}%` }" /></div>

      <div ref="track" class="wz-track" @scroll.passive="onScroll">
        <section v-for="(s, i) in slides" :key="i" class="wz-slide" :aria-label="`Folie ${i + 1}`">
          <h3 class="wz-slide-title">{{ s.title }}</h3>
          <ul v-if="bullets(s.body)" class="wz-slide-body">
            <li v-for="(b, j) in bullets(s.body)" :key="j">{{ b }}</li>
          </ul>
          <p v-else class="wz-slide-body">{{ s.body }}</p>
          <div v-if="s.imageId && unit.media[s.imageId]" class="wz-slide-img">
            <img :src="unit.media[s.imageId]" alt="" loading="lazy" draggable="false" />
          </div>
        </section>
      </div>

      <div class="wz-dots" aria-hidden="true">
        <span v-for="(_s, i) in slides" :key="i" :class="{ on: i === index }" />
      </div>
    </div>

    <SourceFooter variant="link" :sources="unit.content.sources" :disclaimer="unit.field.adviceDisclaimer" />

    <CompleteButton
      v-if="onLast || completed"
      :ready="ready"
      :completed="completed"
      :fill="Math.min(1, dwell.seconds.value / WRITTEN_MIN_DWELL_SEC)"
      label="Einheit abschließen (+1)"
      :pending-label="`Noch ${waitSec}s lesen …`"
      @complete="complete"
    />
    <button v-else type="button" class="wz-next" @click="go(index + 1)">
      Wische für den nächsten Tipp ({{ index + 1 }}/{{ slides.length }})
      <q-icon :name="pIcon('chevron_right')" size="18px" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.wz-written { height: 100%; display: flex; flex-direction: column; gap: 10px; }

/* Charcoal deck with glowing category edge */
.wz-deck { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px 0 12px; border-radius: 24px; background: color-mix(in srgb, var(--wz-surface) 88%, var(--wz-glow)); border: 1.5px solid color-mix(in srgb, var(--wz-glow) 70%, transparent); box-shadow: 0 0 24px color-mix(in srgb, var(--wz-glow) 22%, transparent), inset 0 0 30px color-mix(in srgb, var(--wz-glow) 6%, transparent); }
.wz-deck-head { display: flex; justify-content: space-between; padding: 0 18px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 255, 255, 0.78); font-variant-numeric: tabular-nums; }
.wz-deck-bar { margin: 8px 18px 0; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.wz-deck-bar div { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--wz-a), var(--wz-c)); box-shadow: 0 0 10px var(--wz-glow); transition: width 0.35s cubic-bezier(0.3, 1.3, 0.5, 1); }

/* Horizontal pager; the browser locks the axis, so vertical feed paging pauses while swiping */
.wz-track { flex: 1; min-height: 0; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; }
.wz-track::-webkit-scrollbar { display: none; }
.wz-slide { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; display: flex; flex-direction: column; padding: 18px 18px 0; overflow-y: auto; }
.wz-slide-title { margin: 0 0 12px; font-family: var(--wz-font-display); font-size: clamp(22px, 6.4vw, 28px); line-height: 1.15; font-weight: 800; letter-spacing: -0.01em; }
.wz-slide-body { margin: 0; font-size: 16px; line-height: 1.5; color: rgba(255, 255, 255, 0.9); }
ul.wz-slide-body { padding-left: 1.1em; display: flex; flex-direction: column; gap: 8px; }
ul.wz-slide-body li::marker { color: var(--wz-glow); }
.wz-slide-img { flex: 1; min-height: 110px; margin-top: 14px; border-radius: 18px; overflow: hidden; }
.wz-slide-img img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; }

.wz-dots { display: flex; justify-content: center; gap: 10px; padding-top: 10px; }
.wz-dots span { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid rgba(255, 255, 255, 0.55); transition: all 0.2s; }
.wz-dots span.on { background: #fff; border-color: #fff; }

.wz-next { align-self: center; display: inline-flex; align-items: center; gap: 2px; min-height: var(--wz-hit); padding: 0 12px; border: 0; background: transparent; color: var(--wz-muted); font: inherit; font-size: 14px; cursor: pointer; }
</style>
