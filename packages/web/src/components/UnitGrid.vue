<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { UnitTileDto } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { fieldEmoji } from 'src/utils/fields'

/**
 * Instagram-style 3-column tile grid with infinite scroll. Deliberately shows no counts:
 * the catalogue size stays hidden (spec: knowledge stream §6).
 */
const props = defineProps<{ items: UnitTileDto[]; loading: boolean; hasMore: boolean }>()
const emit = defineEmits<{ more: []; open: [UnitTileDto] }>()
const { pIcon } = usePlatform()

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && props.hasMore && !props.loading) emit('more')
  }, { rootMargin: '300px' })
  if (sentinel.value) observer.observe(sentinel.value)
})
// The sentinel may stay visible after a short page: ask again once loading settles
watch(() => props.loading, (busy) => {
  if (busy || !props.hasMore || !sentinel.value) return
  const box = sentinel.value.getBoundingClientRect()
  if (box.top < window.innerHeight + 300) emit('more')
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div>
    <div class="wz-tiles">
      <button
        v-for="t in items"
        :key="t.id"
        type="button"
        class="wz-tile"
        :class="`wz-field-${t.field.slug}`"
        :aria-label="t.title"
        @click="emit('open', t)"
      >
        <img v-if="t.image" :src="t.image" alt="" loading="lazy" draggable="false" />
        <span v-else class="wz-tile-emoji" aria-hidden="true">{{ fieldEmoji(t.field.slug) }}</span>
        <span class="wz-tile-shade" />
        <span class="wz-tile-title">{{ t.title }}</span>
        <q-icon v-if="t.format === 'audio'" class="wz-tile-format" :name="pIcon('headphones')" size="16px" />
        <span v-if="t.level > 1" class="wz-tile-level">L{{ t.level }}</span>
      </button>
    </div>
    <div ref="sentinel" class="wz-tiles-foot">
      <q-spinner-dots v-if="loading" size="32px" color="white" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.wz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; margin: 0 -16px; }
.wz-tile { position: relative; aspect-ratio: 4 / 5; border: 0; padding: 0; overflow: hidden; cursor: pointer; color: #fff; font: inherit; text-align: left; background: radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--wz-a) 40%, transparent), transparent 60%), radial-gradient(100% 80% at 100% 100%, color-mix(in srgb, var(--wz-c) 30%, transparent), transparent 60%), var(--wz-field-bg); }
.wz-tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.wz-tile-emoji { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); font-size: 34px; }
.wz-tile-shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.78)); }
.wz-tile-title { position: absolute; left: 8px; right: 8px; bottom: 7px; font-size: 12px; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wz-tile-format { position: absolute; top: 6px; right: 6px; filter: drop-shadow(0 0 4px #000); }
.wz-tile-level { position: absolute; top: 6px; left: 6px; padding: 1px 6px; border-radius: 8px; font-size: 10px; font-weight: 800; background: color-mix(in srgb, var(--wz-glow) 85%, transparent); color: var(--wz-on-accent); }
.wz-tiles-foot { display: flex; justify-content: center; min-height: 56px; padding-top: 12px; }
</style>
