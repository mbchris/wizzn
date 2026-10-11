import { ref } from 'vue'
import { Notify } from 'quasar'
import { api } from 'src/api'

/**
 * "Save to Brain" vault (LAYOUT.md micro-interactions), server-backed since the knowledge stream:
 * bookmarks survive reinstalls and move with the account. Updates are optimistic and roll back on error.
 */
const LEGACY_KEY = 'wizzn.vault'

const saved = ref<Set<string>>(new Set())
let migrated = false

function readLegacy(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** One-time upload of the device-local vault from before the API had saved units */
async function migrateLegacy(): Promise<void> {
  if (migrated) return
  migrated = true
  const ids = readLegacy()
  if (!ids.length) return
  // Units deleted in the meantime answer 404; they are simply dropped
  await Promise.allSettled(ids.map((id) => api.save(id)))
  setLocal(ids, true)
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // storage unavailable: the migration may run again, which is idempotent
  }
}

function setLocal(ids: string[], on: boolean): void {
  const next = new Set(saved.value)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  saved.value = next
}

async function persist(id: string, on: boolean): Promise<void> {
  try {
    await (on ? api.save(id) : api.unsave(id))
  } catch (e) {
    console.warn('vault sync failed', e)
    setLocal([id], !on)
    Notify.create({ message: 'Konnte nicht gespeichert werden. Versuch es noch einmal.', color: 'negative', position: 'top', timeout: 2000 })
  }
}

export function useVault() {
  const isSaved = (id: string): boolean => saved.value.has(id)
  /** Server state from loaded units (FeedUnitDto.saved) */
  function seed(units: { id: string; saved: boolean }[]): void {
    setLocal(units.filter((u) => u.saved).map((u) => u.id), true)
    void migrateLegacy()
  }
  function save(id: string): void {
    if (saved.value.has(id)) return
    setLocal([id], true)
    void persist(id, true)
  }
  function toggle(id: string): boolean {
    const on = !saved.value.has(id)
    setLocal([id], on)
    void persist(id, on)
    return on
  }
  return { saved, isSaved, seed, save, toggle }
}
