import { ref } from 'vue'
import type { FieldDto } from '@wizzn/shared'
import { api } from 'src/api'

/** Field filter shared by the stream top bar and the Explore tab (null = all) */
const filter = ref<string | null>(null)
/** Set when interests change elsewhere; the kept-alive feed reloads on its next activation */
const stale = ref(false)
const fields = ref<FieldDto[]>([])
let loading: Promise<FieldDto[]> | null = null

async function loadFields(): Promise<FieldDto[]> {
  if (fields.value.length) return fields.value
  loading ??= api.fields().then((f) => (fields.value = f)).finally(() => (loading = null))
  return loading
}

export function useFeedFilter() {
  return { filter, stale, fields, loadFields }
}
