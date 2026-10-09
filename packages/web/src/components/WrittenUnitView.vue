<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { FeedUnitDto, WrittenUnit } from '@wizzn/shared'
import { useCompletion, useDwell } from 'src/composables/useCompletion'
import SourceFooter from 'components/SourceFooter.vue'

const props = defineProps<{ unit: FeedUnitDto & { content: WrittenUnit }; active: boolean }>()
const track = ref<HTMLElement | null>(null)
const index = ref(0)
const maxSeen = ref(1)
const slides = computed(() => props.unit.content.slides)
const { completed, report } = useCompletion(props.unit.id)
const dwell = useDwell(() => props.active)
onUnmounted(dwell.stop)

function onScroll(): void {
  const el = track.value
  if (!el) return
  index.value = Math.round(el.scrollLeft / el.clientWidth)
  maxSeen.value = Math.max(maxSeen.value, index.value + 1)
}

function go(i: number): void {
  track.value?.scrollTo({ left: i * (track.value?.clientWidth ?? 0), behavior: 'smooth' })
}

watch([maxSeen, dwell.seconds], ([seen, sec]) => {
  if (seen >= slides.value.length && sec >= 15) void report({ format: 'written', slidesSeen: seen, dwellSec: sec })
})
</script>

<template>
  <div class="fit column no-wrap">
    <div ref="track" class="wz-track col row no-wrap" @scroll.passive="onScroll">
      <section v-for="(s, i) in slides" :key="i" class="wz-slide column no-wrap" @click="go(Math.min(i + 1, slides.length - 1))">
        <div class="wz-img" :class="{ empty: !s.imageId || !unit.media[s.imageId] }">
          <img v-if="s.imageId && unit.media[s.imageId]" :src="unit.media[s.imageId]" alt="" loading="lazy" />
        </div>
        <div class="text-weight-bold q-mt-md" style="font-size: 22px; line-height: 1.2">{{ s.title }}</div>
        <div class="q-mt-sm" style="font-size: 17px; line-height: 1.5">{{ s.body }}</div>
      </section>
    </div>
    <div class="row justify-center q-gutter-xs q-my-sm">
      <span v-for="(_s, i) in slides" :key="i" class="wz-bar" :class="{ on: i <= index, done: completed }" />
    </div>
    <SourceFooter v-if="index === slides.length - 1" :sources="unit.content.sources" :disclaimer="unit.field.adviceDisclaimer" />
  </div>
</template>

<style scoped lang="scss">
.wz-track { overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.wz-track::-webkit-scrollbar { display: none; }
.wz-slide { flex: 0 0 100%; scroll-snap-align: start; padding: 0 4px; }
.wz-img { width: 100%; aspect-ratio: 1; max-height: 42dvh; border-radius: 24px; overflow: hidden; background: rgba(255, 255, 255, 0.15); }
.wz-img img { width: 100%; height: 100%; object-fit: cover; }
.wz-img.empty { aspect-ratio: auto; height: 0; }
.wz-bar { width: 28px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.3); transition: background 0.2s; }
.wz-bar.on { background: #fff; }
.wz-bar.done { background: #b8f5c8; }
</style>
