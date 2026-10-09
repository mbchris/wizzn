import { date, index, integer, pgTable, primaryKey, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { unitFormat, field, theme, unit } from './content.js'
import { user } from './auth.js'

// App-specific user data kept apart from Better Auth's `user` table
export const userProfile = pgTable('user_profile', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  pushToken: text('push_token'),
  reminderTime: time('reminder_time'),
  formats: unitFormat('formats').array().notNull().default(['audio', 'written']),
  onboardedAt: timestamp('onboarded_at'),
})

export const userInterest = pgTable(
  'user_interest',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').notNull().references(() => field.id, { onDelete: 'cascade' }),
    themeId: uuid('theme_id').references(() => theme.id, { onDelete: 'cascade' }),
  },
  (t) => [index('user_interest_user_idx').on(t.userId)],
)

export const completionEvent = pgTable(
  'completion_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').notNull().references(() => unit.id),
    completedAt: timestamp('completed_at').notNull().defaultNow(),
    localDate: date('local_date').notNull(),
  },
  (t) => [
    index('completion_user_date_idx').on(t.userId, t.localDate),
    // A unit counts once per user (XP/streak are derived from this table)
    uniqueIndex('completion_user_unit_uq').on(t.userId, t.unitId),
  ],
)

export const feedImpression = pgTable(
  'feed_impression',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id').notNull().references(() => unit.id),
    servedAt: timestamp('served_at').notNull().defaultNow(),
  },
  (t) => [index('impression_user_served_idx').on(t.userId, t.servedAt)],
)

export const streak = pgTable('streak', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  current: integer('current').notNull().default(0),
  longest: integer('longest').notNull().default(0),
  lastLocalDate: date('last_local_date'),
  freezesLeft: integer('freezes_left').notNull().default(0),
})

export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('xp_user_idx').on(t.userId)],
)

export const userBadge = pgTable(
  'user_badge',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    badgeKey: text('badge_key').notNull(),
    earnedAt: timestamp('earned_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeKey] })],
)

export const entitlement = pgTable('entitlement', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  activeUntil: timestamp('active_until').notNull(),
  source: text('source').notNull().default('revenuecat'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
