import { ref } from 'vue'
import { Notify } from 'quasar'
import type { CompletionInput } from '@wizzn/shared'
import { api, ApiError } from 'src/api'

/** Reports a unit as completed once; the server re-checks the thresholds (spec §1). */
export function useCompletion(unitId: string) {
  const completed = ref(false)
  let sending = false

  async function report(input: CompletionInput): Promise<void> {
    if (completed.value || sending) return
    sending = true
    try {
      const res = await api.complete(unitId, input)
      completed.value = res.completed
      if (res.completed && res.firstTime) Notify.create({ message: 'Geschafft! 🎉', color: 'positive', position: 'top', timeout: 1500 })
    } catch (e) {
      // 400 = not enough progress yet; try again on the next progress event
      if (!(e instanceof ApiError && e.status === 400)) console.warn('completion failed', e)
    } finally {
      sending = false
    }
  }

  return { completed, report }
}

/** Counts seconds while `isActive()` and the page is visible. */
export function useDwell(isActive: () => boolean) {
  const seconds = ref(0)
  const timer = setInterval(() => {
    if (isActive() && document.visibilityState === 'visible') seconds.value++
  }, 1000)
  return { seconds, stop: () => clearInterval(timer) }
}
