import { aliasedTable, and, asc, desc, eq, ilike, inArray, ne, notExists, or, sql, type SQL } from 'drizzle-orm'
import { scoreRelated, type FeedbackVote, type Level, type UnitFormat, type UnitTileDto } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { asset, completionEvent, contentBrief, field, savedUnit, theme, unit, unitFeedback, unitLink, userInterest } from './db/schema/index.js'
import { pickOnePerPair } from './feed-repo.js'

export interface SavedCursor {
  at: string
  id: string
}

/** Search hit before shuffling/paging; rank 0 = title match (best) … 3 = field name */
export interface SearchHit {
  id: string
  rank: number
}

export interface KnowledgeRepo {
  /** Rebuilds the outgoing + incoming edges of a freshly published unit */
  linkUnit(unitId: string): Promise<void>
  /** Continuation after a unit: series level+1, same level, related, then same theme/field */
  nextIds(userId: string, unitId: string, formats: UnitFormat[], limit: number, exclude?: string[]): Promise<string[]>
  /** false when the unit is not published */
  vote(userId: string, unitId: string, vote: FeedbackVote): Promise<boolean>
  save(userId: string, unitId: string): Promise<boolean>
  unsave(userId: string, unitId: string): Promise<void>
  listSaved(userId: string, limit: number, cursor: SavedCursor | null): Promise<{ tiles: UnitTileDto[]; next: SavedCursor | null }>
  /** Ranked published hits (one per pair), at most `limit` */
  search(q: string, limit: number): Promise<SearchHit[]>
  /** "Für dich" grid without query: newest units of the user's fields */
  forYou(userId: string, limit: number): Promise<string[]>
  tiles(ids: string[]): Promise<UnitTileDto[]>
}

/** Escapes LIKE wildcards in user input */
const likeTerm = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export function createKnowledgeRepo(db: Db, mediaUrl: (path: string) => string): KnowledgeRepo {
  const published = eq(unit.status, 'published')

  /** Not completed by the user, neither the unit nor its pair sibling */
  const notCompleted = (userId: string): SQL => {
    const sibling = aliasedTable(unit, 'done_sibling')
    return notExists(
      db
        .select({ one: sql`1` })
        .from(completionEvent)
        .innerJoin(sibling, eq(sibling.id, completionEvent.unitId))
        .where(and(eq(completionEvent.userId, userId), or(eq(sibling.id, unit.id), and(sql`${unit.pairId} is not null`, eq(sibling.pairId, unit.pairId))))),
    )
  }

  async function tiles(ids: string[]): Promise<UnitTileDto[]> {
    if (!ids.length) return []
    const rows = await db
      .select({ id: unit.id, title: unit.title, format: unit.format, level: unit.level, slug: field.slug, nameDe: field.nameDe })
      .from(unit)
      .innerJoin(field, eq(field.id, unit.fieldId))
      .where(and(inArray(unit.id, ids), published))
    const images = await db
      .select({ unitId: asset.unitId, path: asset.path })
      .from(asset)
      .where(and(inArray(asset.unitId, ids), eq(asset.kind, 'image')))
      .orderBy(asc(asset.position))
    const firstImage = new Map<string, string>()
    for (const i of images) if (!firstImage.has(i.unitId)) firstImage.set(i.unitId, mediaUrl(i.path))
    const byId = new Map(rows.map((r) => [r.id, r]))
    return ids.flatMap((id) => {
      const r = byId.get(id)
      return r ? [{ id, title: r.title ?? '', format: r.format, level: r.level as Level, field: { slug: r.slug, nameDe: r.nameDe }, image: firstImage.get(id) ?? null }] : []
    })
  }

  return {
    tiles,

    async linkUnit(unitId) {
      const [me] = await db
        .select({ id: unit.id, pairId: unit.pairId, series: unit.series, level: unit.level, themeId: unit.themeId, fieldId: unit.fieldId, title: unit.title, topic: contentBrief.topic })
        .from(unit)
        .innerJoin(contentBrief, eq(contentBrief.id, unit.briefId))
        .where(eq(unit.id, unitId))
      if (!me) return
      const notSelf = and(ne(unit.id, me.id), me.pairId ? or(sql`${unit.pairId} is null`, ne(unit.pairId, me.pairId)) : undefined)
      const edges: { from: string; to: string; kind: 'series' | 'related'; score: number }[] = []
      const linked = new Set<string>()
      if (me.series) {
        const peers = await db
          .select({ id: unit.id, level: unit.level })
          .from(unit)
          .where(and(published, notSelf, eq(unit.series, me.series), sql`${unit.level} between ${me.level - 1} and ${me.level + 1}`))
        for (const p of peers) {
          linked.add(p.id)
          // Deeper level scores slightly higher so "next" prefers going down the ladder
          edges.push({ from: me.id, to: p.id, kind: 'series', score: p.level > me.level ? 1.1 : 1 })
          edges.push({ from: p.id, to: me.id, kind: 'series', score: me.level > p.level ? 1.1 : 1 })
        }
      }
      const others = await db
        .select({ id: unit.id, pairId: unit.pairId, title: unit.title, topic: contentBrief.topic })
        .from(unit)
        .innerJoin(contentBrief, eq(contentBrief.id, unit.briefId))
        .where(
          and(
            published,
            notSelf,
            me.themeId ? eq(unit.themeId, me.themeId) : eq(unit.fieldId, me.fieldId),
            // Same-series units connect only via series edges, so "related" can never skip a locked level
            me.series ? or(sql`${unit.series} is null`, ne(unit.series, me.series)) : undefined,
          ),
        )
        .orderBy(desc(unit.publishedAt))
        .limit(200)
      const related = scoreRelated(
        { id: me.id, pairId: me.pairId, text: `${me.title ?? ''} ${me.topic}` },
        others.filter((o) => !linked.has(o.id)).map((o) => ({ id: o.id, pairId: o.pairId, text: `${o.title ?? ''} ${o.topic}` })),
      )
      for (const r of related) {
        edges.push({ from: me.id, to: r.id, kind: 'related', score: r.score })
        edges.push({ from: r.id, to: me.id, kind: 'related', score: r.score })
      }
      await db.transaction(async (tx) => {
        await tx.delete(unitLink).where(or(eq(unitLink.fromUnitId, me.id), eq(unitLink.toUnitId, me.id)))
        if (edges.length) {
          await tx
            .insert(unitLink)
            .values(edges.map((e) => ({ fromUnitId: e.from, toUnitId: e.to, kind: e.kind, score: e.score })))
            .onConflictDoNothing()
        }
      })
    },

    async nextIds(userId, unitId, formats, limit, exclude = []) {
      const [me] = await db.select({ id: unit.id, pairId: unit.pairId, level: unit.level, themeId: unit.themeId, fieldId: unit.fieldId }).from(unit).where(eq(unit.id, unitId))
      if (!me) return []
      const skip = new Set([me.id, ...exclude])
      const eligible = and(published, inArray(unit.format, formats), notCompleted(userId), me.pairId ? or(sql`${unit.pairId} is null`, ne(unit.pairId, me.pairId)) : undefined)
      const linked = await db
        .select({ id: unit.id, pairId: unit.pairId, level: unit.level, kind: unitLink.kind, score: unitLink.score })
        .from(unitLink)
        .innerJoin(unit, eq(unit.id, unitLink.toUnitId))
        .where(and(eq(unitLink.fromUnitId, me.id), eligible))
      // Down the ladder first, then same-level siblings, then related by overlap; lower levels are already known
      const order = (l: (typeof linked)[number]): number =>
        l.kind === 'series' ? (l.level > me.level ? 0 : l.level === me.level ? 1 : 9) : 2 - l.score
      const ranked = linked.filter((l) => !skip.has(l.id) && order(l) < 9).sort((a, b) => order(a) - order(b))
      const out = pickOnePerPair(ranked, Math.random).map((l) => l.id)
      if (out.length < limit) {
        // Sparse graph: continue in the same theme (or field), newest first
        const fill = await db
          .select({ id: unit.id, pairId: unit.pairId })
          .from(unit)
          .where(and(eligible, me.themeId ? eq(unit.themeId, me.themeId) : eq(unit.fieldId, me.fieldId), eq(unit.level, 1)))
          .orderBy(desc(unit.publishedAt))
          .limit(limit * 4)
        const have = new Set([...out, ...skip])
        out.push(...pickOnePerPair(fill.filter((f) => !have.has(f.id)), Math.random).map((f) => f.id))
      }
      return out.slice(0, limit)
    },

    async vote(userId, unitId, vote) {
      const row = await db.query.unit.findFirst({ where: and(eq(unit.id, unitId), published), columns: { id: true } })
      if (!row) return false
      await db
        .insert(unitFeedback)
        .values({ userId, unitId, vote })
        .onConflictDoUpdate({ target: [unitFeedback.userId, unitFeedback.unitId], set: { vote, createdAt: new Date() } })
      return true
    },

    async save(userId, unitId) {
      const row = await db.query.unit.findFirst({ where: and(eq(unit.id, unitId), published), columns: { id: true } })
      if (!row) return false
      await db.insert(savedUnit).values({ userId, unitId }).onConflictDoNothing()
      return true
    },

    async unsave(userId, unitId) {
      await db.delete(savedUnit).where(and(eq(savedUnit.userId, userId), eq(savedUnit.unitId, unitId)))
    },

    async listSaved(userId, limit, cursor) {
      // The cursor carries the timestamp as Postgres text (µs, no zone): a JS Date would lose precision and shift by the TZ
      const savedAtText = sql<string>`to_char(${savedUnit.savedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`
      const rows = await db
        .select({ id: savedUnit.unitId, at: savedAtText })
        .from(savedUnit)
        .innerJoin(unit, eq(unit.id, savedUnit.unitId))
        .where(
          and(
            eq(savedUnit.userId, userId),
            published,
            cursor ? sql`(${savedUnit.savedAt}, ${savedUnit.unitId}) < (${cursor.at}::timestamp, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(savedUnit.savedAt), desc(savedUnit.unitId))
        .limit(limit + 1)
      const page = rows.slice(0, limit)
      const last = page.at(-1)
      return { tiles: await tiles(page.map((r) => r.id)), next: rows.length > limit && last ? { at: last.at, id: last.id } : null }
    },

    async search(q, limit) {
      const term = likeTerm(q)
      const rank = sql<number>`case
        when ${unit.title} ilike ${term} then 0
        when ${contentBrief.topic} ilike ${term} then 1
        when ${theme.nameDe} ilike ${term} then 2
        else 3 end`
      const rows = await db
        .select({ id: unit.id, pairId: unit.pairId, rank })
        .from(unit)
        .innerJoin(contentBrief, eq(contentBrief.id, unit.briefId))
        .innerJoin(field, eq(field.id, unit.fieldId))
        .leftJoin(theme, eq(theme.id, unit.themeId))
        .where(and(published, or(ilike(unit.title, term), ilike(contentBrief.topic, term), ilike(theme.nameDe, term), ilike(field.nameDe, term), ilike(unit.series, term))))
        .orderBy(rank, desc(unit.publishedAt))
        .limit(limit * 2)
      return pickOnePerPair(rows, Math.random)
        .slice(0, limit)
        .map(({ id, rank: r }) => ({ id, rank: Number(r) }))
    },

    async forYou(userId, limit) {
      const fields = db.select({ id: userInterest.fieldId }).from(userInterest).where(eq(userInterest.userId, userId))
      const rows = await db
        .select({ id: unit.id, pairId: unit.pairId })
        .from(unit)
        .where(and(published, inArray(unit.fieldId, fields), notCompleted(userId), eq(unit.level, 1)))
        .orderBy(desc(unit.publishedAt))
        .limit(limit * 2)
      return pickOnePerPair(rows, Math.random)
        .slice(0, limit)
        .map((r) => r.id)
    },
  }
}

