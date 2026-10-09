<script setup lang="ts" generic="T extends string">
// CLAUDE.md: segmented controls instead of q-tabs for small exclusive choices
defineProps<{ options: { label: string; value: T; icon?: string }[] }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="wz-seg row no-wrap">
    <button v-for="o in options" :key="o.value" type="button" class="wz-seg-btn col" :class="{ active: model === o.value }" @click="model = o.value">
      <q-icon v-if="o.icon" :name="o.icon" size="18px" class="q-mr-xs" />{{ o.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.wz-seg { background: rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 4px; gap: 4px; }
.wz-seg-btn { border: 0; border-radius: 10px; padding: 10px 8px; background: transparent; color: var(--wz-muted); font: inherit; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.wz-seg-btn.active { background: #fff; color: var(--wz-bg); }
</style>
