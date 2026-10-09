import { computed } from 'vue'
import { useQuasar } from 'quasar'
import { ICON_MAP } from 'src/utils/platformIcons'

export function usePlatform() {
  const $q = useQuasar()
  const isIos = computed(() => $q.platform.is.ios === true)
  /** Falls back to the literal name when the key is not mapped */
  const pIcon = (key: string): string => {
    const def = ICON_MAP[key]
    if (!def) return key
    return isIos.value ? def.ios : def.android
  }
  return { isIos, pIcon }
}
