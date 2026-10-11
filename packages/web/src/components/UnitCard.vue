<script setup lang="ts">
import { computed, ref } from 'vue'
import { levelLabel, type AudioUnit, type FeedbackVote, type FeedUnitDto, type WrittenUnit } from '@wizzn/shared'
import { usePlatform } from 'src/composables/usePlatform'
import { useVault } from 'src/composables/useVault'
import { useHaptics } from 'src/composables/useHaptics'
import { useSwipeFeedback } from 'src/composables/useSwipeFeedback'
import { fieldEmoji } from 'src/utils/fields'
import AudioUnitView from 'components/AudioUnitView.vue'
import WrittenUnitView from 'components/WrittenUnitView.vue'

/** One full-screen unit of a vertical stream (feed and unit viewer) */
const props = defineProps<{
  unit: FeedUnitDto
  index: number
  /** Snapped card while the page is visible: plays audio, counts dwell */
  active: boolean
  /** Only the active card and its neighbours mount their content (keeps the WebView light) */
  mountContent: boolean
  preload: boolean
}>()
const emit = defineEmits<{ vote: [FeedbackVote] }>()

const { pIcon } = usePlatform()
const haptics = useHaptics()
const vault = useVault()

const isWritten = (u: FeedUnitDto): u is FeedUnitDto & { content: WrittenUnit } => u.content.format === 'written'
const asAudio = (u: FeedUnitDto) => u as FeedUnitDto & { content: AudioUnit }

/* Swipe "mehr / weniger davon": written decks only at their edges, audio anywhere */
const card = ref<HTMLElement | null>(null)
const deckEdges = ref({ first: true, last: false })
const voted = ref<FeedbackVote | null>(null)
const { dx, direction, progress } = useSwipeFeedback(
  card,
  () => (isWritten(props.unit) ? { less: deckEdges.value.first, more: deckEdges.value.last } : { less: true, more: true }),
  vote,
)
const dragStyle = computed(() => (dx.value ? { transform: `translateX(${dx.value * 0.45}px) rotate(${dx.value * 0.02}deg)`, transition: 'none' } : {}))

function vote(v: FeedbackVote): void {
  voted.value = v
  haptics.success()
  emit('vote', v)
}

/* Double-tap "Save to Brain" (LAYOUT.md §3) */
interface Brain { key: number; x: number; y: number }
const brains = ref<Brain[]>([])
let lastTap = { t: 0, x: 0, y: 0 }
let brainKey = 0

function onTap(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, a, [role="slider"], audio')) return
  const now = performance.now()
  const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40
  if (now - lastTap.t < 320 && near) {
    lastTap = { t: 0, x: 0, y: 0 }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const b = { key: ++brainKey, x: e.clientX - box.left, y: e.clientY - box.top }
    brains.value.push(b)
    setTimeout(() => (brains.value = brains.value.filter((x) => x.key !== b.key)), 900)
    vault.save(props.unit.id)
    haptics.light()
    return
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY }
}

function toggleSave(): void {
  vault.toggle(props.unit.id)
  haptics.light()
}
</script>

<template>
  <article
    ref="card"
    :data-index="index"
    class="wz-card"
    :class="[`wz-field-${unit.field.slug}`, { 'is-active': active }]"
    @pointerup="onTap"
  >
    <div class="wz-card-inner" :style="dragStyle">
      <div class="wz-card-head">
        <span class="wz-tag">
          <span aria-hidden="true">{{ fieldEmoji(unit.field.slug) }}</span>{{ unit.field.nameDe }}
          <template v-if="unit.series"><span class="wz-dot">•</span>{{ levelLabel(unit.level) }}</template>
          <template v-if="unit.discovery"><span class="wz-dot">•</span>Entdecken</template>
        </span>
        <div class="wz-head-actions">
          <button type="button" class="wz-icon-btn wz-vote" :class="{ on: voted === -1 }" aria-label="Weniger davon" @click="vote(-1)">
            <q-icon :name="pIcon('less_like')" size="20px" />
          </button>
          <button type="button" class="wz-icon-btn wz-vote" :class="{ on: voted === 1 }" aria-label="Mehr davon" @click="vote(1)">
            <q-icon :name="pIcon('more_like')" size="20px" />
          </button>
          <button
            type="button"
            class="wz-icon-btn wz-save"
            :class="{ saved: vault.isSaved(unit.id) }"
            :aria-pressed="vault.isSaved(unit.id)"
            aria-label="Im Gehirn speichern"
            @click="toggleSave"
          >
            <q-icon :name="vault.isSaved(unit.id) ? pIcon('bookmark_filled') : pIcon('bookmark')" size="24px" />
          </button>
        </div>
      </div>
      <h2 class="wz-title wz-unit-title" :class="{ compact: isWritten(unit) }">{{ unit.title }}</h2>
      <div class="wz-unit-body">
        <template v-if="mountContent">
          <WrittenUnitView v-if="isWritten(unit)" :unit="unit" :active="active" @edges="deckEdges = $event" />
          <AudioUnitView v-else :unit="asAudio(unit)" :active="active" :preload="preload" />
        </template>
      </div>
    </div>
    <div v-if="direction" class="wz-swipe-label" :class="direction === 1 ? 'more' : 'less'" :style="{ opacity: progress }" aria-hidden="true">
      <q-icon :name="pIcon(direction === 1 ? 'more_like' : 'less_like')" size="28px" />
      {{ direction === 1 ? 'Mehr davon' : 'Weniger davon' }}
    </div>
    <span v-for="b in brains" :key="b.key" class="wz-brain" :style="{ left: `${b.x}px`, top: `${b.y}px` }" aria-hidden="true">🧠</span>
  </article>
</template>

<style scoped lang="scss">
.wz-card {
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  position: relative;
  overflow: hidden;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  /* Category tone + a soft glow from the top, like a lit stage */
  background:
    radial-gradient(120% 55% at 50% 0%, color-mix(in srgb, var(--wz-glow) 20%, transparent), transparent 65%),
    radial-gradient(90% 40% at 50% 100%, color-mix(in srgb, var(--wz-b) 10%, transparent), transparent 70%),
    var(--wz-field-bg);
}
.wz-card-inner { height: 100%; display: flex; flex-direction: column; padding: calc(var(--wz-topbar-h) + var(--wz-safe-top) + 10px) 20px 14px; transition: transform 0.25s cubic-bezier(0.2, 1.2, 0.4, 1); }
/* Card-snap bounce: incoming unit overshoots ~4px, then settles (spring-like cubic-bezier) */
.wz-card.is-active .wz-card-inner { animation: wz-snap 0.55s cubic-bezier(0.25, 1.4, 0.45, 1); }
@keyframes wz-snap { 0% { transform: translateY(14px); opacity: 0.6; } 60% { transform: translateY(-4px); opacity: 1; } 100% { transform: translateY(0); } }

.wz-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 -10px 4px 0; }
.wz-head-actions { display: flex; align-items: center; flex: none; }
.wz-dot { opacity: 0.6; margin: 0 2px; }
.wz-vote { color: rgba(255, 255, 255, 0.6); }
.wz-vote.on { color: var(--wz-glow); }
.wz-save { color: rgba(255, 255, 255, 0.85); }
.wz-save.saved { color: var(--wz-glow); filter: drop-shadow(0 0 6px var(--wz-glow)); }
.wz-unit-title { margin: 0 0 8px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wz-unit-title.compact { font-size: 18px; font-weight: 700; color: rgba(255, 255, 255, 0.82); -webkit-line-clamp: 2; }
.wz-unit-body { flex: 1; min-height: 0; }

/* Swipe feedback badge: slides in from the side the content moves away from */
.wz-swipe-label { position: absolute; z-index: 6; top: 42%; display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; font-weight: 800; font-size: 16px; color: var(--wz-on-accent); pointer-events: none; box-shadow: 0 0 24px color-mix(in srgb, var(--wz-glow) 50%, transparent); }
.wz-swipe-label.more { right: 16px; background: var(--wz-glow); }
.wz-swipe-label.less { left: 16px; background: rgba(255, 255, 255, 0.85); }

.wz-brain { position: absolute; z-index: 5; font-size: 84px; line-height: 1; pointer-events: none; transform: translate(-50%, -50%); filter: drop-shadow(0 0 18px #ff2d95) drop-shadow(0 0 30px #60efff); animation: wz-brain 0.9s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
@keyframes wz-brain { 0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0; } 25% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; } 60% { transform: translate(-50%, -60%) scale(1); opacity: 1; } 100% { transform: translate(-50%, -130%) scale(0.9); opacity: 0; } }
</style>
