<script setup lang="ts" generic="T extends string">
// CLAUDE.md: segmented controls instead of q-tabs for small exclusive choices
defineProps<{ options: { label: string; value: T; icon?: string }[]; stacked?: boolean }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="wz-seg row no-wrap" :class="{ stacked }" role="radiogroup">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="wz-seg-btn col"
      :class="{ active: model === o.value }"
      @click="model = o.value"
    >
      <q-icon v-if="o.icon" :name="o.icon" :size="stacked ? '26px' : '18px'" :class="stacked ? 'q-mb-xs' : 'q-mr-xs'" />{{ o.label }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.wz-seg { background: rgba(255, 255, 255, 0.06); border: 1px solid var(--wz-faint); border-radius: 16px; padding: 4px; gap: 4px; }
.wz-seg-btn { border: 0; border-radius: 12px; min-height: 44px; padding: 10px 8px; background: transparent; color: var(--wz-muted); font: inherit; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, color 0.2s; }
.wz-seg-btn.active { background: rgba(255, 255, 255, 0.16); color: #fff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 2px 8px rgba(0, 0, 0, 0.35); }
.stacked .wz-seg-btn { flex-direction: column; padding: 14px 6px; font-size: 14px; line-height: 1.2; text-align: center; }
</style>
