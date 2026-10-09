import { relations } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { UNIT_STATUSES } from '@wizzn/shared'

export const unitFormat = pgEnum('unit_format', ['audio', 'written'])
export const unitStatus = pgEnum('unit_status', UNIT_STATUSES)
export const assetKind = pgEnum('asset_kind', ['image', 'audio'])

export const field = pgTable('field', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameDe: text('name_de').notNull(),
  adviceDisclaimer: boolean('advice_disclaimer').notNull().default(false),
})

export const theme = pgTable('theme', {
  id: uuid('id').primaryKey().defaultRandom(),
  fieldId: uuid('field_id').notNull().references(() => field.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  nameDe: text('name_de').notNull(),
})

export const contentBrief = pgTable('content_brief', {
  id: uuid('id').primaryKey().defaultRandom(),
  fieldId: uuid('field_id').notNull().references(() => field.id),
  themeId: uuid('theme_id').references(() => theme.id),
  topic: text('topic').notNull(),
  context: text('context').notNull().default(''),
  format: unitFormat('format').notNull(),
  count: integer('count').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const unit = pgTable(
  'unit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    briefId: uuid('brief_id').notNull().references(() => contentBrief.id),
    fieldId: uuid('field_id').notNull().references(() => field.id),
    themeId: uuid('theme_id').references(() => theme.id),
    format: unitFormat('format').notNull(),
    status: unitStatus('status').notNull().default('queued'),
    title: text('title'),
    contentJson: jsonb('content_json'),
    promptVersion: text('prompt_version'),
    model: text('model'),
    failureReason: text('failure_reason'),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('unit_feed_idx').on(t.status, t.fieldId, t.format)],
)

export const source = pgTable('source', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title').notNull(),
  publisher: text('publisher').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  lastCheckedAt: timestamp('last_checked_at'),
})

export const asset = pgTable('asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
  kind: assetKind('kind').notNull(),
  path: text('path').notNull(),
  durationSec: integer('duration_sec'),
})

export const checkReport = pgTable('check_report', {
  unitId: uuid('unit_id').primaryKey().references(() => unit.id, { onDelete: 'cascade' }),
  reportJson: jsonb('report_json').notNull(),
  passed: boolean('passed').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const fieldRelations = relations(field, ({ many }) => ({ themes: many(theme) }))
export const themeRelations = relations(theme, ({ one }) => ({ field: one(field, { fields: [theme.fieldId], references: [field.id] }) }))
export const unitRelations = relations(unit, ({ one, many }) => ({
  brief: one(contentBrief, { fields: [unit.briefId], references: [contentBrief.id] }),
  field: one(field, { fields: [unit.fieldId], references: [field.id] }),
  sources: many(source),
  assets: many(asset),
  checkReport: one(checkReport, { fields: [unit.id], references: [checkReport.unitId] }),
}))
export const sourceRelations = relations(source, ({ one }) => ({ unit: one(unit, { fields: [source.unitId], references: [unit.id] }) }))
export const assetRelations = relations(asset, ({ one }) => ({ unit: one(unit, { fields: [asset.unitId], references: [unit.id] }) }))
