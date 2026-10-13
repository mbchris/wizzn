<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KnowledgeNode } from '@wizzn/shared'

/** modelValue: key of the selected node; the list shows that node and everything below it */
const props = defineProps<{ nodes: KnowledgeNode[]; modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [key: string | null] }>()

const COLUMN_WIDTH = 210
const NODE_WIDTH = 186
const ROW_HEIGHT = 34
const NODE_HEIGHT = 26

interface Placed {
  node: KnowledgeNode
  depth: number
  row: number
  parent: Placed | null
}

const expanded = ref(new Set<string>())

function pathTo(nodes: KnowledgeNode[], key: string): string[] | null {
  for (const node of nodes) {
    if (node.key === key) return [node.key]
    const below = pathTo(node.children, key)
    if (below) return [node.key, ...below]
  }
  return null
}
// A selection restored from the URL must be visible, so its branch opens
watch(
  () => [props.modelValue, props.nodes] as const,
  ([key, nodes]) => {
    const path = key ? pathTo(nodes, key) : null
    if (path?.some((k) => !expanded.value.has(k))) expanded.value = new Set([...expanded.value, ...path])
  },
  { immediate: true },
)

/** Leaves take one row each; a parent sits on the row of its first child, so branches read left to right */
const placed = computed(() => {
  const all: Placed[] = []
  let nextRow = 0
  const visit = (node: KnowledgeNode, depth: number, parent: Placed | null): Placed => {
    const self: Placed = { node, depth, row: 0, parent }
    all.push(self)
    const children = expanded.value.has(node.key) ? node.children.map((child) => visit(child, depth + 1, self)) : []
    self.row = children[0]?.row ?? nextRow++
    return self
  }
  props.nodes.forEach((node) => visit(node, 0, null))
  return all
})
const width = computed(() => (Math.max(0, ...placed.value.map((p) => p.depth)) + 1) * COLUMN_WIDTH)
const height = computed(() => (Math.max(0, ...placed.value.map((p) => p.row)) + 1) * ROW_HEIGHT)
const left = (p: Placed): number => p.depth * COLUMN_WIDTH
const middle = (p: Placed): number => p.row * ROW_HEIGHT + ROW_HEIGHT / 2
const edges = computed(() =>
  placed.value.flatMap((p) => {
    if (!p.parent) return []
    const [fromX, toX] = [left(p.parent) + NODE_WIDTH, left(p)]
    const bend = (fromX + toX) / 2
    return [{ key: p.node.key, d: `M${fromX},${middle(p.parent)} C${bend},${middle(p.parent)} ${bend},${middle(p)} ${toX},${middle(p)}` }]
  }),
)

function toggle(node: KnowledgeNode): void {
  const next = new Set(expanded.value)
  if (props.modelValue === node.key) {
    next.delete(node.key)
    emit('update:modelValue', null)
  } else {
    next.add(node.key)
    emit('update:modelValue', node.key)
  }
  expanded.value = next
}
</script>

<template>
  <div class="graph-scroll">
    <div class="graph" :style="{ width: `${width}px`, height: `${height}px` }">
      <svg class="graph-edges" :width="width" :height="height">
        <path v-for="edge in edges" :key="edge.key" :d="edge.d" />
      </svg>
      <button
        v-for="p in placed"
        :key="p.node.key"
        type="button"
        class="graph-node row no-wrap items-center"
        :class="[`graph-node--${p.node.kind}`, { 'graph-node--selected': p.node.key === modelValue }]"
        :style="{ left: `${left(p)}px`, top: `${middle(p) - NODE_HEIGHT / 2}px`, width: `${NODE_WIDTH}px`, height: `${NODE_HEIGHT}px` }"
        :title="p.node.label"
        @click="toggle(p.node)"
      >
        <span class="col ellipsis text-left">{{ p.node.label }}</span>
        <!-- Levels hold units themselves; every other node counts what lies below it -->
        <span class="graph-count">{{ p.node.kind === 'level' ? p.node.own : p.node.count }}</span>
        <q-icon v-if="p.node.children.length" :name="expanded.has(p.node.key) ? 'chevron_left' : 'chevron_right'" size="16px" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.graph-scroll {
  max-height: 340px;
  overflow: auto;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  padding: 8px;
}
.graph {
  position: relative;
}
.graph-edges {
  position: absolute;
  inset: 0;
  fill: none;
  stroke: #bdbdbd;
  stroke-width: 1.5;
}
.graph-node {
  position: absolute;
  gap: 6px;
  padding: 0 6px 0 8px;
  font-size: 12px;
  background: #fff;
  border: 1px solid #bdbdbd;
  border-left-width: 4px;
  border-radius: 4px;
  cursor: pointer;
}
.graph-node:hover {
  background: #f5f5f5;
}
.graph-node--field {
  border-left-color: var(--q-primary);
  font-weight: 600;
}
.graph-node--theme {
  border-left-color: var(--q-secondary);
}
.graph-node--series {
  border-left-color: var(--q-accent);
}
.graph-node--level {
  border-left-color: #757575;
}
.graph-node--selected,
.graph-node--selected:hover {
  background: var(--q-primary);
  border-color: var(--q-primary);
  color: #fff;
}
.graph-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
</style>
