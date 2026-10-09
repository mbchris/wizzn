import { ref } from 'vue'
import type { CompletionRewardsDto, MeDto, ProgressDto } from '@wizzn/shared'
import { api, ensureSession } from 'src/api'

// Module-level state shared by feed, players and profile (the app has no store library)
const progress = ref<ProgressDto | null>(null)
const me = ref<MeDto | null>(null)
/** Set when a completion hits the free daily cap; the feed then ends with the paywall */
const capReached = ref(false)
const lastRewards = ref<CompletionRewardsDto | null>(null)

async function refresh(): Promise<ProgressDto> {
  const [p, m] = await Promise.all([api.progress(), ensureSession()])
  progress.value = p
  me.value = m
  capReached.value = p.cap.reached
  return p
}

function applyRewards(r: CompletionRewardsDto): void {
  lastRewards.value = r
  if (r.cap.reached) capReached.value = true
  if (!progress.value) return
  progress.value = {
    ...progress.value,
    level: r.level,
    cap: r.cap,
    streak: { ...progress.value.streak, current: r.streak, longest: Math.max(progress.value.streak.longest, r.streak), doneToday: true, atRisk: false },
    week: { ...progress.value.week, done: r.week.done },
  }
}

export function useProgress() {
  return { progress, me, capReached, lastRewards, refresh, applyRewards }
}
