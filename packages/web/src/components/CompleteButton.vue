<script setup lang="ts">
import { ref, watch } from 'vue'
import { usePlatform } from 'src/composables/usePlatform'

/** Completion CTA: dim until the unit's threshold is met, then glows; bursts on success (LAYOUT.md §3). */
const props = defineProps<{ ready: boolean; completed: boolean; label: string; pendingLabel: string; fill?: number }>()
defineEmits<{ complete: [] }>()
const { pIcon } = usePlatform()

const burst = ref(false)
watch(
  () => props.completed,
  (done) => {
    if (!done) return
    burst.value = true
    setTimeout(() => (burst.value = false), 1100)
  },
)

const PARTICLES = 16
const particle = (n: number): Record<string, string> => {
  const angle = (n / PARTICLES) * Math.PI * 2
  const dist = 70 + (n % 3) * 22
  return {
    '--dx': `${Math.cos(angle) * dist}px`,
    '--dy': `${Math.sin(angle) * dist * 0.6}px`,
    background: ['var(--wz-a)', 'var(--wz-c)', '#fff'][n % 3]!,
    animationDelay: `${(n % 4) * 0.03}s`,
  }
}
</script>

<template>
  <div class="wz-complete">
    <button
      type="button"
      class="wz-done"
      :class="{ ready: ready && !completed, completed }"
      :disabled="!ready || completed"
      :style="!ready && !completed && fill !== undefined ? { '--fill': `${Math.round(fill * 100)}%` } : undefined"
      @click="$emit('complete')"
    >
      <q-icon :name="completed ? pIcon('check') : pIcon('bolt')" size="20px" />
      <span>{{ completed ? 'Erledigt · +1 fürs Wochenziel' : ready ? label : pendingLabel }}</span>
    </button>
    <div v-if="burst" class="wz-burst" aria-hidden="true"><i v-for="n in PARTICLES" :key="n" :style="particle(n)" /></div>
  </div>
</template>

<style scoped lang="scss">
.wz-complete { position: relative; }
.wz-done {
  --fill: 0%;
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid var(--wz-line);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  color: var(--wz-muted);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.12) var(--fill), rgba(255, 255, 255, 0.04) var(--fill));
  transition: transform 0.15s ease, box-shadow 0.3s ease;
  cursor: default;
}
.wz-done.ready {
  border-color: transparent;
  color: var(--wz-on-accent);
  background: linear-gradient(90deg, var(--wz-a), var(--wz-b), var(--wz-c));
  box-shadow: 0 0 22px color-mix(in srgb, var(--wz-glow) 55%, transparent);
  cursor: pointer;
  animation: wz-ready 1.6s ease-in-out infinite alternate;
}
.wz-done.ready:active { transform: scale(0.97); }
.wz-done.completed { border-color: color-mix(in srgb, var(--wz-mint) 60%, transparent); color: var(--wz-mint); background: rgba(0, 229, 153, 0.1); }
@keyframes wz-ready { to { box-shadow: 0 0 34px color-mix(in srgb, var(--wz-glow) 75%, transparent); } }

.wz-burst { position: absolute; left: 50%; top: 50%; pointer-events: none; }
.wz-burst i { position: absolute; width: 8px; height: 8px; margin: -4px; border-radius: 50%; animation: wz-particle 0.9s cubic-bezier(0.15, 0.8, 0.3, 1) forwards; }
@keyframes wz-particle { from { transform: translate(0, 0) scale(1); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; } }
</style>
