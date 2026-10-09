import { ref } from 'vue'
import { Notify } from 'quasar'
import { BADGES, type CompletionInput, type CompletionRewardsDto } from '@wizzn/shared'
import { api, ApiError } from 'src/api'
import { useProgress } from './useProgress'
import { useHaptics } from './useHaptics'

const PAYMENT_REQUIRED = 402

function celebrate(r: CompletionRewardsDto): void {
  const parts = [`+${r.xpGained} XP`]
  if (r.streakExtended) parts.push(`🔥 ${r.streak} ${r.streak === 1 ? 'Tag' : 'Tage'}`)
  Notify.create({ message: `Geschafft! 🎉 ${parts.join(' · ')}`, color: 'positive', position: 'top', timeout: 1800 })
  if (r.freezesUsed) Notify.create({ message: `🧊 Streak gerettet – ${r.freezesUsed} Freeze${r.freezesUsed > 1 ? 's' : ''} eingesetzt`, color: 'info', position: 'top', timeout: 2500 })
  if (r.weeklyGoalReached) Notify.create({ message: `🎯 Wochenziel erreicht! +50 XP`, color: 'deep-purple', position: 'top', timeout: 2500 })
  if (r.levelUp) Notify.create({ message: `⭐ Level ${r.level.level}!`, color: 'amber-9', position: 'top', timeout: 2500 })
  for (const b of r.newBadges) Notify.create({ message: `${BADGES[b].emoji} Neues Abzeichen: ${BADGES[b].nameDe}`, color: 'dark', position: 'top', timeout: 3000 })
}

/** Reports a unit as completed once; the server re-checks the thresholds (spec §1). */
export function useCompletion(unitId: string) {
  const completed = ref(false)
  const { applyRewards, capReached } = useProgress()
  const haptics = useHaptics()
  let sending = false

  async function report(input: CompletionInput): Promise<void> {
    if (completed.value || sending || capReached.value) return
    sending = true
    try {
      const res = await api.complete(unitId, input)
      completed.value = res.completed
      if (res.completed) haptics.success()
      if (res.rewards) {
        applyRewards(res.rewards)
        celebrate(res.rewards)
      }
    } catch (e) {
      // 402 = free daily cap reached: stop reporting, the feed shows the paywall
      if (e instanceof ApiError && e.status === PAYMENT_REQUIRED) capReached.value = true
      // 400 = not enough progress yet; try again on the next progress event
      else if (!(e instanceof ApiError && e.status === 400)) console.warn('completion failed', e)
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
