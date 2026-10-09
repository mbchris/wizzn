import { WEEKLY_GOAL, dailyCap, levelFor, weekStart, type InterestsInput, type MeDto, type PremiumDto, type ProgressDto } from '@wizzn/shared'
import type { ProgressRepo } from '../src/progress-repo.js'
import type { AuthPort, Repos, SessionUser } from '../src/types.js'

export const anon: SessionUser = { id: 'u1', name: 'Anonymous', email: 'x@anonymous.invalid', isAnonymous: true }

export function fakeAuth(user: SessionUser | null = anon): AuthPort {
  return {
    handler: async () => new Response('auth', { status: 200 }),
    getSessionUser: async (headers) => (headers.get('authorization') ? user : null),
  }
}

export function fakeRepos(opts: { dbUp?: boolean } = {}): Repos & { saved: InterestsInput[] } {
  const saved: InterestsInput[] = []
  return {
    saved,
    pingDb: async () => {
      if (opts.dbUp === false) throw new Error('down')
    },
    listFields: async () => [{ id: 'f1', slug: 'finance', nameDe: 'Finanzen', adviceDisclaimer: true, themes: [] }],
    getMe: async (u): Promise<MeDto> => ({ id: u.id, name: u.name, email: null, isAnonymous: u.isAnonymous, timezone: 'Europe/Berlin', formats: ['audio'], interests: [] }),
    saveInterests: async (_id, input) => {
      saved.push(input)
    },
  }
}

/** In-memory ProgressRepo: tracks completions and entitlements, rewards are a fixed first-unit result */
export function fakeProgress(opts: { doneToday?: number; premium?: boolean; knownUsers?: string[] } = {}) {
  const completions: { unitId: string; date: string }[] = []
  const entitlements = new Map<string, { productId: string; activeUntil: Date }>()
  const transfers: { from: string; to: string }[] = []
  const doneOn = (date: string) => (opts.doneToday ?? 0) + completions.filter((c) => c.date === date).length
  const premiumOf = (userId: string, now: Date): PremiumDto => {
    const e = entitlements.get(userId)
    const active = Boolean(opts.premium) || Boolean(e && e.activeUntil > now)
    return { active, until: e?.activeUntil.toISOString() ?? null, productId: e?.productId ?? null }
  }
  const repo: ProgressRepo = {
    getPremium: async (userId, now) => premiumOf(userId, now),
    countDoneOn: async (_u, date) => doneOn(date),
    async recordCompletion(_u, unitId, today, premium, cap) {
      if (completions.some((c) => c.unitId === unitId)) return null
      completions.push({ unitId, date: today })
      return {
        xpGained: 15,
        xp: [{ amount: 10, reason: 'unit' }, { amount: 5, reason: 'first_of_day' }],
        level: levelFor(15),
        levelUp: false,
        streak: 1,
        streakExtended: true,
        freezesUsed: 0,
        weeklyGoalReached: false,
        week: { done: 1, goal: WEEKLY_GOAL },
        newBadges: ['first_unit'],
        cap: dailyCap(doneOn(today), premium, cap),
      }
    },
    getProgress: async (_u, today, premium, cap): Promise<ProgressDto> => ({
      today,
      streak: { current: 0, longest: 0, doneToday: false, atRisk: false, freezesLeft: 0 },
      level: levelFor(0),
      week: { start: weekStart(today), done: 0, goal: WEEKLY_GOAL },
      cap: dailyCap(doneOn(today), premium.active, cap),
      badges: [],
      premium,
      stats: { totalUnits: 0, audioUnits: 0, writtenUnits: 0 },
    }),
    async setEntitlement(userId, productId, activeUntil) {
      if (opts.knownUsers && !opts.knownUsers.includes(userId)) return false
      entitlements.set(userId, { productId, activeUntil })
      return true
    },
    async transferEntitlement(from, to) {
      for (const f of from) transfers.push({ from: f, to })
    },
    transferUserData: async () => 'moved',
  }
  return Object.assign(repo, { completions, entitlements, transfers })
}
