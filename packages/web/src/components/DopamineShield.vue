<script setup lang="ts">
import { computed, useId } from 'vue'

/** "The Dopamine Shield" weekly badge (LAYOUT.md Color schema §2C). Locked = still collecting. */
const props = defineProps<{ done: number; goal: number; size?: number }>()
const uid = useId()
const unlocked = computed(() => props.done >= props.goal)
const px = computed(() => props.size ?? 220)
const id = (n: string): string => `${uid}-${n}`
</script>

<template>
  <div class="wz-shield" :class="{ unlocked }" :style="{ width: `${px}px`, height: `${px * 1.1}px` }">
    <div class="wz-aura" />
    <svg viewBox="0 0 200 220" class="wz-shield-svg" aria-hidden="true">
      <defs>
        <linearGradient :id="id('metal')" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffe2a8" />
          <stop offset="0.35" stop-color="#c9843f" />
          <stop offset="0.65" stop-color="#6e3a17" />
          <stop offset="1" stop-color="#f0b45e" />
        </linearGradient>
        <linearGradient :id="id('inner')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b1a12" />
          <stop offset="1" stop-color="#110b09" />
        </linearGradient>
        <radialGradient :id="id('fire')" cx="0.5" cy="0.62" r="0.55">
          <stop offset="0" stop-color="#ffe08a" />
          <stop offset="0.45" stop-color="#ff7a1a" stop-opacity="0.85" />
          <stop offset="1" stop-color="#ff3d00" stop-opacity="0" />
        </radialGradient>
      </defs>
      <path d="M100 6 L184 36 V102 C184 156 148 194 100 214 C52 194 16 156 16 102 V36 Z" :fill="`url(#${id('metal')})`" />
      <path d="M100 24 L168 49 V103 C168 147 139 178 100 195 C61 178 32 147 32 103 V49 Z" :fill="`url(#${id('inner')})`" stroke="#ffd08a" stroke-opacity="0.35" stroke-width="1.5" />
      <ellipse class="wz-fire" cx="100" cy="118" rx="58" ry="66" :fill="`url(#${id('fire')})`" />
    </svg>
    <div class="wz-shield-text">
      <div class="wz-flame">🔥</div>
      <div class="wz-count">{{ Math.min(done, goal) }}</div>
      <div class="wz-of">von {{ goal }}</div>
    </div>
    <div class="wz-ribbon">{{ unlocked ? 'Gemeistert' : 'Dopamin-Schild' }}</div>
    <template v-if="unlocked">
      <i v-for="n in 10" :key="n" class="wz-spark" :style="{ left: `${10 + ((n * 37) % 80)}%`, animationDelay: `${(n % 5) * 0.35}s` }" />
    </template>
  </div>
</template>

<style scoped lang="scss">
.wz-shield { position: relative; margin: 0 auto; filter: grayscale(0.85) brightness(0.7); transition: filter 0.6s ease; }
.wz-shield.unlocked { filter: none; }
.wz-aura { position: absolute; inset: 8% 4%; border-radius: 50%; background: radial-gradient(circle, rgba(255, 122, 26, 0.45), transparent 70%); filter: blur(18px); }
.unlocked .wz-aura { animation: wz-aura 2.4s ease-in-out infinite alternate; }
.wz-shield-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.unlocked .wz-fire { animation: wz-flicker 1.2s ease-in-out infinite alternate; transform-origin: 50% 70%; }
.wz-shield-text { position: absolute; inset: 12% 0 30%; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6); }
.wz-flame { font-size: 1.6em; margin-bottom: 2px; }
.wz-count { font-family: var(--wz-font-display); font-weight: 900; font-size: 4.2em; background: linear-gradient(180deg, #fff3d6, #ffb347 60%, #e0701b); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 10px rgba(255, 140, 40, 0.8)); }
.wz-of { font-weight: 800; font-size: 1.05em; letter-spacing: 0.06em; text-transform: uppercase; color: #ffe2a8; }
.wz-ribbon { position: absolute; left: 4%; right: 4%; bottom: 13%; padding: 6px 4px; border-radius: 6px; text-align: center; font-weight: 900; font-size: 0.8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.05em; text-transform: uppercase; color: #ffe9c2; background: linear-gradient(180deg, #8c4a1d, #5a2a10); border: 1.5px solid #e6a85a; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5); }
.wz-spark { position: absolute; bottom: 30%; width: 4px; height: 4px; border-radius: 50%; background: #ffd27a; box-shadow: 0 0 8px #ff9a3c; animation: wz-spark 1.8s ease-out infinite; opacity: 0; }
@keyframes wz-flicker { from { transform: scale(0.94); opacity: 0.8; } to { transform: scale(1.06); opacity: 1; } }
@keyframes wz-aura { from { opacity: 0.6; transform: scale(0.95); } to { opacity: 1; transform: scale(1.08); } }
@keyframes wz-spark { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-130px) translateX(12px); opacity: 0; } }
</style>
