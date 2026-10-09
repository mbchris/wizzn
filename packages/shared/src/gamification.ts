// Spec §7 — all rules are pure and computed server-side from completion_event.
export const XP_PER_UNIT = 10
export const XP_FIRST_OF_DAY = 5
export const WEEKLY_GOAL = 5
export const WEEKLY_GOAL_XP = 50
/** Spec §13: free daily cap default; the API reads FREE_DAILY_CAP to override it */
export const DEFAULT_FREE_DAILY_CAP = 3
export const PREMIUM_FREEZES_PER_MONTH = 2

/** Total XP needed to reach level i + 1 (level 1 starts at 0). Past the table: +600 XP per level. */
export const LEVEL_THRESHOLDS = [0, 50, 120, 220, 350, 520, 740, 1000, 1300, 1650, 2050, 2500] as const
const LEVEL_STEP_AFTER_TABLE = 600

export type XpReason = 'unit' | 'first_of_day' | 'weekly_goal'

export interface LevelInfo {
  level: number
  totalXp: number
  levelStartXp: number
  nextLevelXp: number
}

export function levelFor(totalXp: number): LevelInfo {
  const xp = Math.max(0, totalXp)
  const last = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]!
  if (xp >= last) {
    const extra = Math.floor((xp - last) / LEVEL_STEP_AFTER_TABLE)
    const start = last + extra * LEVEL_STEP_AFTER_TABLE
    return { level: LEVEL_THRESHOLDS.length + extra, totalXp: xp, levelStartXp: start, nextLevelXp: start + LEVEL_STEP_AFTER_TABLE }
  }
  let i = 0
  while (xp >= LEVEL_THRESHOLDS[i + 1]!) i++
  return { level: i + 1, totalXp: xp, levelStartXp: LEVEL_THRESHOLDS[i]!, nextLevelXp: LEVEL_THRESHOLDS[i + 1]! }
}

// ---- Local dates (YYYY-MM-DD, already in the user's time zone) ----

const toUtc = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const addDays = (d: string, n: number): string => fromUtc(toUtc(d) + n * 86_400_000)
export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
/** Monday of the ISO week containing `d` (spec: weekly goal runs Mon–Sun) */
export function weekStart(d: string): string {
  const dow = new Date(toUtc(d)).getUTCDay() // 0 = Sunday
  return addDays(d, -((dow + 6) % 7))
}

// ---- Streak ----

export interface StreakState {
  current: number
  longest: number
  lastLocalDate: string | null
  freezesLeft: number
  /** YYYY-MM of the last premium freeze refill */
  freezesMonth: string | null
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastLocalDate: null, freezesLeft: 0, freezesMonth: null }

/** Premium: 2 freezes per calendar month; unused ones do not roll over. */
export function refillFreezes(s: StreakState, today: string, premium: boolean): StreakState {
  const month = today.slice(0, 7)
  if (!premium || s.freezesMonth === month) return s
  return { ...s, freezesLeft: PREMIUM_FREEZES_PER_MONTH, freezesMonth: month }
}

/** A day counts with ≥ 1 completed unit; missed days are bridged by freezes automatically (premium). */
export function advanceStreak(prev: StreakState, today: string, premium: boolean): { state: StreakState; freezesUsed: number } {
  const s = refillFreezes(prev, today, premium)
  if (s.lastLocalDate === today) return { state: s, freezesUsed: 0 }
  let current = 1
  let freezesUsed = 0
  if (s.lastLocalDate) {
    const missed = daysBetween(s.lastLocalDate, today) - 1
    // Clock/time zone moved backwards: keep the streak as it is
    if (missed < 0) return { state: s, freezesUsed: 0 }
    if (missed === 0) current = s.current + 1
    else if (premium && missed <= s.freezesLeft) {
      current = s.current + 1
      freezesUsed = missed
    }
  }
  return {
    state: { ...s, current, longest: Math.max(s.longest, current), lastLocalDate: today, freezesLeft: s.freezesLeft - freezesUsed },
    freezesUsed,
  }
}

export interface StreakView {
  current: number
  longest: number
  doneToday: boolean
  /** Nothing completed today yet, but the streak is still alive */
  atRisk: boolean
  freezesLeft: number
}

/** What the profile shows today, without writing anything (a broken streak reads as 0). */
export function viewStreak(prev: StreakState, today: string, premium: boolean): StreakView {
  const s = refillFreezes(prev, today, premium)
  const base = { longest: s.longest, freezesLeft: premium ? s.freezesLeft : 0 }
  if (!s.lastLocalDate) return { ...base, current: 0, doneToday: false, atRisk: false }
  const missed = daysBetween(s.lastLocalDate, today) - 1
  if (missed < 0) return { ...base, current: s.current, doneToday: true, atRisk: false }
  if (missed === 0 || (premium && missed <= s.freezesLeft)) return { ...base, current: s.current, doneToday: false, atRisk: true }
  return { ...base, current: 0, doneToday: false, atRisk: false }
}

// ---- Badges ----

export const BADGE_KEYS = ['first_unit', 'streak_7', 'streak_30', 'all_fields', 'audio_10', 'written_10'] as const
export type BadgeKey = (typeof BADGE_KEYS)[number]

export const BADGES: Record<BadgeKey, { emoji: string; nameDe: string; descriptionDe: string }> = {
  first_unit: { emoji: '🌱', nameDe: 'Erster Happen', descriptionDe: 'Deine erste Einheit abgeschlossen' },
  streak_7: { emoji: '🔥', nameDe: 'Wochenflamme', descriptionDe: '7 Tage Streak' },
  streak_30: { emoji: '☄️', nameDe: 'Monatsfeuer', descriptionDe: '30 Tage Streak' },
  all_fields: { emoji: '🧭', nameDe: 'Entdecker:in', descriptionDe: 'Alle Gebiete ausprobiert' },
  audio_10: { emoji: '🎧', nameDe: 'Ganz Ohr', descriptionDe: '10 Audio-Einheiten' },
  written_10: { emoji: '📚', nameDe: 'Leseratte', descriptionDe: '10 Slide-Einheiten' },
}

export interface BadgeStats {
  totalUnits: number
  audioUnits: number
  writtenUnits: number
  fieldsTried: number
  fieldsTotal: number
  longestStreak: number
}

export function earnedBadges(s: BadgeStats): BadgeKey[] {
  const rules: Record<BadgeKey, boolean> = {
    first_unit: s.totalUnits >= 1,
    streak_7: s.longestStreak >= 7,
    streak_30: s.longestStreak >= 30,
    all_fields: s.fieldsTotal > 0 && s.fieldsTried >= s.fieldsTotal,
    audio_10: s.audioUnits >= 10,
    written_10: s.writtenUnits >= 10,
  }
  return BADGE_KEYS.filter((k) => rules[k])
}

// ---- One completion → streak, XP, badges ----

export interface CompletionContext {
  today: string
  premium: boolean
  streak: StreakState
  /** First-time completions on `today` / this week, NOT counting the one being processed */
  doneTodayBefore: number
  doneWeekBefore: number
  /** Totals INCLUDING the one being processed; longestStreak is filled in here */
  stats: Omit<BadgeStats, 'longestStreak'>
  ownedBadges: string[]
}

export interface CompletionEffects {
  streak: StreakState
  freezesUsed: number
  xp: { amount: number; reason: XpReason }[]
  newBadges: BadgeKey[]
  weeklyGoalReached: boolean
}

export function completionEffects(ctx: CompletionContext): CompletionEffects {
  const { state, freezesUsed } = advanceStreak(ctx.streak, ctx.today, ctx.premium)
  const xp: CompletionEffects['xp'] = [{ amount: XP_PER_UNIT, reason: 'unit' }]
  if (ctx.doneTodayBefore === 0) xp.push({ amount: XP_FIRST_OF_DAY, reason: 'first_of_day' })
  // Exactly the 5th unit of the week pays the bonus, so it is granted once per week
  const weeklyGoalReached = ctx.doneWeekBefore + 1 === WEEKLY_GOAL
  if (weeklyGoalReached) xp.push({ amount: WEEKLY_GOAL_XP, reason: 'weekly_goal' })
  const owned = new Set(ctx.ownedBadges)
  const newBadges = earnedBadges({ ...ctx.stats, longestStreak: state.longest }).filter((b) => !owned.has(b))
  return { streak: state, freezesUsed, xp, newBadges, weeklyGoalReached }
}

// ---- Daily cap (free tier) ----

export interface DailyCapDto {
  /** null = unlimited (premium) */
  limit: number | null
  done: number
  remaining: number | null
  reached: boolean
}

export function dailyCap(doneToday: number, premium: boolean, cap: number): DailyCapDto {
  if (premium) return { limit: null, done: doneToday, remaining: null, reached: false }
  const remaining = Math.max(0, cap - doneToday)
  return { limit: cap, done: doneToday, remaining, reached: remaining === 0 }
}

// ---- DTOs ----

export interface PremiumDto {
  active: boolean
  until: string | null
  productId: string | null
}

export interface ProgressDto {
  today: string
  streak: StreakView
  level: LevelInfo
  week: { start: string; done: number; goal: number }
  cap: DailyCapDto
  badges: { key: BadgeKey; earnedAt: string }[]
  premium: PremiumDto
  stats: { totalUnits: number; audioUnits: number; writtenUnits: number }
}

export interface CompletionRewardsDto {
  xpGained: number
  xp: { amount: number; reason: XpReason }[]
  level: LevelInfo
  levelUp: boolean
  streak: number
  streakExtended: boolean
  freezesUsed: number
  weeklyGoalReached: boolean
  week: { done: number; goal: number }
  newBadges: BadgeKey[]
  cap: DailyCapDto
}

