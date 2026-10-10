<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { readingMinutes, writtenMinDwellSec, writtenPageCount, type FeedUnitDto, type WrittenUnit } from '@wizzn/shared'
import { useCompletion, useDwell } from 'src/composables/useCompletion'
import { usePlatform } from 'src/composables/usePlatform'
import SourceFooter from 'components/SourceFooter.vue'
import ImageCredit from 'components/ImageCredit.vue'
import CompleteButton from 'components/CompleteButton.vue'

const props = defineProps<{ unit: FeedUnitDto & { content: WrittenUnit }; active: boolean }>()
const { pIcon } = usePlatform()
const track = ref<HTMLElement | null>(null)
const index = ref(0)
const maxSeen = ref(1)
const slides = computed(() => props.unit.content.slides)
/** Issue #4: optional cover is page 0; pre-#4 units have none */
const cover = computed(() => props.unit.content.cover ?? null)
const pages = computed(() => writtenPageCount(props.unit.content))
const minDwell = computed(() => writtenMinDwellSec(props.unit.content))
const minutes = computed(() => readingMinutes(props.unit.content))
const pct = computed(() => Math.round(((index.value + 1) / pages.value) * 100))
const onLast = computed(() => index.value === pages.value - 1)
const { completed, report } = useCompletion(props.unit.id)
const dwell = useDwell(() => props.active)
onUnmounted(dwell.stop)

const ready = computed(() => maxSeen.value >= pages.value && dwell.seconds.value >= minDwell.value)
const waitSec = computed(() => Math.max(0, minDwell.value - dwell.seconds.value))

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
        <span>Folie {{ index + 1 }} von {{ pages }}</span>
        <span>[ {{ pct }}% ]</span>
      </div>
      <div class="wz-deck-bar"><div :style="{ width: `${pct}%` }" /></div>

      <div ref="track" class="wz-track" @scroll.passive="onScroll">
        <section v-if="cover" class="wz-slide wz-cover" aria-label="Titelseite">
          <div v-if="unit.media[cover.imageId]" class="wz-cover-img">
            <img :src="unit.media[cover.imageId]" :alt="unit.credits?.[cover.imageId]?.title ?? ''" draggable="false" />
            <ImageCredit :credit="unit.credits?.[cover.imageId]" />
          </div>
          <span class="wz-cover-time">
            <q-icon :name="pIcon('reading_time')" size="14px" />
            ≈ {{ minutes }} Min. Lesezeit
          </span>
          <h3 class="wz-slide-title">{{ unit.title }}</h3>
          <p class="wz-slide-body">{{ cover.hook }}</p>
        </section>
        <section v-for="(s, i) in slides" :key="i" class="wz-slide" :aria-label="`Folie ${i + 1 + (cover ? 1 : 0)}`">
          <h3 class="wz-slide-title">{{ s.title }}</h3>
          <ul v-if="bullets(s.body)" class="wz-slide-body">
            <li v-for="(b, j) in bullets(s.body)" :key="j">{{ b }}</li>
          </ul>
          <p v-else class="wz-slide-body">{{ s.body }}</p>
          <div v-if="s.imageId && unit.media[s.imageId]" class="wz-slide-img">
            <img :src="unit.media[s.imageId]" :alt="unit.credits?.[s.imageId]?.title ?? ''" loading="lazy" draggable="false" />
            <ImageCredit :credit="unit.credits?.[s.imageId]" />
          </div>
        </section>
      </div>

      <div class="wz-dots">
        <span v-for="i in pages" :key="i" aria-hidden="true" :class="{ on: i - 1 === index }" />
        <button v-if="!onLast" type="button" class="wz-next" :aria-label="`Nächster Tipp (${index + 1}/${pages})`" @click="go(index + 1)">
          <q-icon :name="pIcon('chevron_right')" size="20px" />
        </button>
      </div>
    </div>

    <SourceFooter variant="link" :sources="unit.content.sources" :disclaimer="unit.field.adviceDisclaimer" />

    <CompleteButton
      v-if="onLast || completed"
      :ready="ready"
      :completed="completed"
      :fill="Math.min(1, dwell.seconds.value / minDwell)"
      label="Einheit abschließen (+1)"
      :pending-label="`Noch ${waitSec}s lesen …`"
      @complete="complete"
    />
  </div>
</template>

<style scoped lang="scss">
.wz-written { height: 100%; display: flex; flex-direction: column; gap: 6px; }

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
.wz-slide-img { position: relative; flex: 1; min-height: 110px; margin-top: 14px; border-radius: 18px; overflow: hidden; }
.wz-slide-img img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; }

/* Cover: head image on top, title + hook below (Instagram-post shape, issue #4) */
.wz-cover-img { position: relative; flex: 0 0 55%; min-height: 160px; margin-bottom: 14px; border-radius: 18px; overflow: hidden; }
.wz-cover-img img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; }
.wz-cover-time { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; margin-bottom: 8px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.85); background: color-mix(in srgb, var(--wz-glow) 22%, transparent); }

.wz-dots { position: relative; display: flex; justify-content: center; align-items: center; gap: 10px; min-height: 32px; padding-top: 6px; }
.wz-dots span { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid rgba(255, 255, 255, 0.55); transition: all 0.2s; }
.wz-dots span.on { background: #fff; border-color: #fff; }

.wz-next { position: absolute; right: 12px; bottom: -4px; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.1); color: #fff; cursor: pointer; }
</style>
