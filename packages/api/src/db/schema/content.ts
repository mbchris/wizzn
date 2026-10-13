import { relations } from 'drizzle-orm'
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { UNIT_LOG_LEVELS, UNIT_STATUSES, type ImageCredit, type Level, type SourceTier } from '@wizzn/shared'

export const unitFormat = pgEnum('unit_format', ['audio', 'written'])
export const unitStatus = pgEnum('unit_status', UNIT_STATUSES)
export const assetKind = pgEnum('asset_kind', ['image', 'audio'])
export const assetOrigin = pgEnum('asset_origin', ['generated', 'stock'])

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
  /** Editorial voice / story plot (EDITORIAL_STYLES / STORY_ARCS); null → random per unit */
  style: text('style'),
  storyArc: text('story_arc'),
  // null → each variant becomes a written + audio pair
  format: unitFormat('format'),
  count: integer('count').notNull().default(1),
  /** Depth 1–5 within a series (knowledge stream) */
  level: smallint('level').$type<Level>().notNull().default(1),
  series: text('series'),
  /** Level 4: field the unit bridges to */
  crossFieldId: uuid('cross_field_id').references(() => field.id),
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
    /** Written + audio units on the same topic; the feed shows only one of them */
    pairId: uuid('pair_id'),
    status: unitStatus('status').notNull().default('queued'),
    /** Copied from the brief for feed queries */
    level: smallint('level').$type<Level>().notNull().default(1),
    series: text('series'),
    title: text('title'),
    contentJson: jsonb('content_json'),
    promptVersion: text('prompt_version'),
    model: text('model'),
    failureReason: text('failure_reason'),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('unit_feed_idx').on(t.status, t.fieldId, t.format), index('unit_pair_idx').on(t.pairId), index('unit_series_idx').on(t.series, t.level)],
)

export const source = pgTable('source', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
  // Index the LLM refers to in claims ("[0]", "[1]")
  position: integer('position').notNull().default(0),
  url: text('url').notNull(),
  title: text('title').notNull(),
  publisher: text('publisher').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  // Issue #4: 1 curated, 2 wikipedia, 3 europepmc, 4 web; pre-#4 rows are unknown → 4
  tier: smallint('tier').$type<SourceTier>().notNull().default(4),
  provider: text('provider').notNull().default('web'),
  lastCheckedAt: timestamp('last_checked_at'),
})

export const asset = pgTable('asset', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
  kind: assetKind('kind').notNull(),
  position: integer('position').notNull().default(0),
  path: text('path').notNull(),
  durationSec: integer('duration_sec'),
  origin: assetOrigin('origin').notNull().default('generated'),
  credit: jsonb('credit').$type<ImageCredit>(),
  stockQuery: text('stock_query'),
  prompt: text('prompt'),
  /** Model/engine that produced the asset (TTS voice, image model); null for stock and pre-provenance rows */
  generator: text('generator'),
  rejectedStockIds: jsonb('rejected_stock_ids').$type<string[]>().notNull().default([]),
})

export const checkReport = pgTable('check_report', {
  unitId: uuid('unit_id').primaryKey().references(() => unit.id, { onDelete: 'cascade' }),
  reportJson: jsonb('report_json').notNull(),
  passed: boolean('passed').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const unitLogLevel = pgEnum('unit_log_level', UNIT_LOG_LEVELS)

/** Pipeline progress per unit, written by the worker and polled by the admin UI */
export const unitLog = pgTable(
  'unit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    unitId: uuid('unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
    at: timestamp('at').notNull().defaultNow(),
    level: unitLogLevel('level').notNull().default('info'),
    step: text('step'),
    message: text('message').notNull(),
  },
  (t) => [index('unit_log_unit_idx').on(t.unitId, t.id)],
)

export const unitLinkKind = pgEnum('unit_link_kind', ['series', 'related'])

/** Knowledge graph edge; stored in both directions */
export const unitLink = pgTable(
  'unit_link',
  {
    fromUnitId: uuid('from_unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
    toUnitId: uuid('to_unit_id').notNull().references(() => unit.id, { onDelete: 'cascade' }),
    kind: unitLinkKind('kind').notNull(),
    score: real('score').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromUnitId, t.toUnitId] })],
)

export const fieldRelations = relations(field, ({ many }) => ({ themes: many(theme) }))
export const themeRelations = relations(theme, ({ one }) => ({ field: one(field, { fields: [theme.fieldId], references: [field.id] }) }))
export const unitRelations = relations(unit, ({ one, many }) => ({
  brief: one(contentBrief, { fields: [unit.briefId], references: [contentBrief.id] }),
  field: one(field, { fields: [unit.fieldId], references: [field.id] }),
  theme: one(theme, { fields: [unit.themeId], references: [theme.id] }),
  sources: many(source),
  assets: many(asset),
  checkReport: one(checkReport, { fields: [unit.id], references: [checkReport.unitId] }),
}))
export const sourceRelations = relations(source, ({ one }) => ({ unit: one(unit, { fields: [source.unitId], references: [unit.id] }) }))
export const assetRelations = relations(asset, ({ one }) => ({ unit: one(unit, { fields: [asset.unitId], references: [unit.id] }) }))
export const contentBriefRelations = relations(contentBrief, ({ one, many }) => ({
  field: one(field, { fields: [contentBrief.fieldId], references: [field.id] }),
  theme: one(theme, { fields: [contentBrief.themeId], references: [theme.id] }),
  units: many(unit),
}))
export const checkReportRelations = relations(checkReport, ({ one }) => ({
  unit: one(unit, { fields: [checkReport.unitId], references: [unit.id] }),
}))
