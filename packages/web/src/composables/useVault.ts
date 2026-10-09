import { ref } from 'vue'

/**
 * "Save to Brain" vault (LAYOUT.md micro-interactions).
 * Device-local until the API has a saved-units endpoint.
 */
const KEY = 'wizzn.vault'

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const saved = ref<Set<string>>(new Set(load()))

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...saved.value]))
  } catch {
    // storage unavailable: vault lives for this session only
  }
}

export function useVault() {
  const isSaved = (id: string): boolean => saved.value.has(id)
  function save(id: string): void {
    if (saved.value.has(id)) return
    saved.value = new Set(saved.value).add(id)
    persist()
  }
  function toggle(id: string): boolean {
    const next = new Set(saved.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saved.value = next
    persist()
    return next.has(id)
  }
  return { saved, isSaved, save, toggle }
}
