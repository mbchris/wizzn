import { describe, expect, it } from 'vitest'
import {
  EMPTY_STREAK,
  addDays,
  advanceStreak,
  completionEffects,
  dailyCap,
  earnedBadges,
  levelFor,
  viewStreak,
  weekStart,
  type CompletionContext,
  type StreakState,
} from '../src/gamification.js'

const streak = (p: Partial<StreakState>): StreakState => ({ ...EMPTY_STREAK, ...p })

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05') // Friday
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // Monday
  })
})

describe('advanceStreak', () => {
  it('starts at 1', () => {
    expect(advanceStreak(EMPTY_STREAK, '2026-10-09', false).state).toMatchObject({ current: 1, longest: 1, lastLocalDate: '2026-10-09' })
  })
  it('counts a day once', () => {
    const s = streak({ current: 3, longest: 3, lastLocalDate: '2026-10-09' })
    expect(advanceStreak(s, '2026-10-09', false).state.current).toBe(3)
  })
  it('extends on the next day and keeps longest', () => {
    const s = streak({ current: 3, longest: 10, lastLocalDate: '2026-10-08' })
    expect(advanceStreak(s, '2026-10-09', false).state).toMatchObject({ current: 4, longest: 10 })
  })
  it('resets after a missed day for free users', () => {
    const s = streak({ current: 5, longest: 5, lastLocalDate: '2026-10-07' })
    expect(advanceStreak(s, '2026-10-09', false).state).toMatchObject({ current: 1, longest: 5 })
  })
  it('bridges missed days with premium freezes', () => {
    const s = streak({ current: 5, longest: 5, lastLocalDate: '2026-10-06', freezesLeft: 2, freezesMonth: '2026-10' })
    const r = advanceStreak(s, '2026-10-09', true)
    expect(r.freezesUsed).toBe(2)
    expect(r.state).toMatchObject({ current: 6, freezesLeft: 0 })
  })
  it('does not bridge more days than freezes left', () => {
    const s = streak({ current: 5, lastLocalDate: '2026-10-05', freezesLeft: 2, freezesMonth: '2026-10' })
    expect(advanceStreak(s, '2026-10-09', true)).toMatchObject({ freezesUsed: 0, state: { current: 1, freezesLeft: 2 } })
  })
  it('refills 2 freezes in a new month (premium only)', () => {
    const s = streak({ current: 5, lastLocalDate: '2026-10-30', freezesLeft: 0, freezesMonth: '2026-10' })
    expect(advanceStreak(s, '2026-11-01', true).state).toMatchObject({ current: 6, freezesLeft: 1, freezesMonth: '2026-11' })
    expect(advanceStreak(s, '2026-11-01', false).state).toMatchObject({ current: 1, freezesLeft: 0 })
  })
  it('ignores dates before the last one', () => {
    const s = streak({ current: 4, lastLocalDate: '2026-10-09' })
    expect(advanceStreak(s, '2026-10-08', false).state.current).toBe(4)
  })
})

describe('viewStreak', () => {
  const s = streak({ current: 4, longest: 4, lastLocalDate: '2026-10-08' })
  it('is at risk when yesterday was the last day', () => {
    expect(viewStreak(s, '2026-10-09', false)).toMatchObject({ current: 4, atRisk: true, doneToday: false })
  })
  it('reads 0 once broken', () => {
    expect(viewStreak(s, '2026-10-10', false).current).toBe(0)
  })
  it('stays alive while freezes can still bridge the gap', () => {
    expect(viewStreak(streak({ ...s, freezesLeft: 1, freezesMonth: '2026-10' }), '2026-10-10', true)).toMatchObject({ current: 4, atRisk: true })
  })
})

describe('levelFor', () => {
  it('maps XP to levels', () => {
    expect(levelFor(0)).toEqual({ level: 1, totalXp: 0, levelStartXp: 0, nextLevelXp: 50 })
    expect(levelFor(50).level).toBe(2)
    expect(levelFor(2500)).toMatchObject({ level: 12, nextLevelXp: 3100 })
    expect(levelFor(3200)).toMatchObject({ level: 13, levelStartXp: 3100 })
  })
})

describe('badges', () => {
  const base = { totalUnits: 0, audioUnits: 0, writtenUnits: 0, fieldsTried: 0, fieldsTotal: 5, longestStreak: 0 }
  it('awards by thresholds', () => {
    expect(earnedBadges(base)).toEqual([])
    expect(earnedBadges({ ...base, totalUnits: 20, audioUnits: 10, writtenUnits: 10, fieldsTried: 5, longestStreak: 30 })).toEqual([
      'first_unit', 'streak_7', 'streak_30', 'all_fields', 'audio_10', 'written_10',
    ])
  })
  it('needs at least one field to exist for all_fields', () => {
    expect(earnedBadges({ ...base, fieldsTotal: 0 })).not.toContain('all_fields')
  })
})

describe('completionEffects', () => {
  const ctx = (p: Partial<CompletionContext> = {}): CompletionContext => ({
    today: '2026-10-09',
    premium: false,
    streak: EMPTY_STREAK,
    doneTodayBefore: 0,
    doneWeekBefore: 0,
    stats: { totalUnits: 1, audioUnits: 1, writtenUnits: 0, fieldsTried: 1, fieldsTotal: 5 },
    ownedBadges: [],
    ...p,
  })
  it('first unit: 10 + 5 XP, streak 1, first badge', () => {
    const e = completionEffects(ctx())
    expect(e.xp).toEqual([{ amount: 10, reason: 'unit' }, { amount: 5, reason: 'first_of_day' }])
    expect(e.streak.current).toBe(1)
    expect(e.newBadges).toEqual(['first_unit'])
  })
  it('second unit of the day: 10 XP, no duplicate badge', () => {
    const e = completionEffects(ctx({ doneTodayBefore: 1, ownedBadges: ['first_unit'] }))
    expect(e.xp).toEqual([{ amount: 10, reason: 'unit' }])
    expect(e.newBadges).toEqual([])
  })
  it('5th unit of the week pays the weekly bonus once', () => {
    expect(completionEffects(ctx({ doneTodayBefore: 1, doneWeekBefore: 4 })).xp).toContainEqual({ amount: 50, reason: 'weekly_goal' })
    expect(completionEffects(ctx({ doneTodayBefore: 1, doneWeekBefore: 5 })).weeklyGoalReached).toBe(false)
  })
  it('awards the streak badge from the advanced streak', () => {
    const s = streak({ current: 6, longest: 6, lastLocalDate: '2026-10-08' })
    expect(completionEffects(ctx({ streak: s, ownedBadges: ['first_unit'] })).newBadges).toEqual(['streak_7'])
  })
})

describe('dailyCap', () => {
  it('limits free users', () => {
    expect(dailyCap(2, false, 3)).toEqual({ limit: 3, done: 2, remaining: 1, reached: false })
    expect(dailyCap(3, false, 3).reached).toBe(true)
  })
  it('is unlimited for premium', () => {
    expect(dailyCap(9, true, 3)).toEqual({ limit: null, done: 9, remaining: null, reached: false })
  })
})
