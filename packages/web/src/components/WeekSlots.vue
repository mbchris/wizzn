<script setup lang="ts">
import { usePlatform } from 'src/composables/usePlatform'

/** One slot per unit of the weekly goal (5 per Mon–Sun week) */
defineProps<{ done: number; goal: number }>()
const { pIcon } = usePlatform()
</script>

<template>
  <div class="wz-slots" role="img" :aria-label="`${Math.min(done, goal)} von ${goal} Einheiten diese Woche`">
    <span v-for="n in goal" :key="n" class="wz-slot" :class="{ on: n <= done }">
      <q-icon v-if="n <= done" :name="pIcon('check')" size="20px" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.wz-slots { display: flex; justify-content: center; gap: 10px; }
.wz-slot { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 1.5px solid rgba(255, 255, 255, 0.22); color: transparent; }
.wz-slot.on { border-color: var(--wz-mint); color: var(--wz-mint); background: rgba(0, 229, 153, 0.1); box-shadow: 0 0 10px rgba(0, 229, 153, 0.35); }
</style>
