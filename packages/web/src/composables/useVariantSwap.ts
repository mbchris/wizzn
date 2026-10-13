import type { Ref } from 'vue'
import { Notify } from 'quasar'
import type { FeedUnitDto } from '@wizzn/shared'
import { api } from 'src/api'
import { useVault } from './useVault'

/** "Lieber lesen / lieber hören": replaces a unit of a stream in place with its slides/audio counterpart. */
export function useVariantSwap(units: Ref<FeedUnitDto[]>) {
  const vault = useVault()
  const pending = new Set<string>()

  async function swap(unit: FeedUnitDto): Promise<void> {
    const otherId = unit.counterpartId
    if (!otherId || pending.has(unit.id)) return
    pending.add(unit.id)
    try {
      const other = await api.unit(otherId)
      const at = units.value.findIndex((u) => u.id === unit.id)
      // Already in the stream (e.g. pulled in by "mehr davon"): no duplicate card
      if (at < 0 || units.value.some((u) => u.id === other.id)) return
      units.value.splice(at, 1, { ...other, discovery: unit.discovery })
      vault.seed([other])
    } catch (e) {
      console.warn('variant swap failed', e)
      Notify.create({ message: 'Die andere Version konnte nicht geladen werden.', color: 'negative', position: 'top', timeout: 1800 })
    } finally {
      pending.delete(unit.id)
    }
  }

  return { swap }
}
