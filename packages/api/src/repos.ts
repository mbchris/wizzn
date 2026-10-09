import { eq, inArray, sql } from 'drizzle-orm'
import type { FieldDto, InterestsInput, MeDto } from '@wizzn/shared'
import type { Db } from './db/client.js'
import { theme, userInterest, userProfile } from './db/schema/index.js'
import type { Repos, SessionUser } from './types.js'

export function createRepos(db: Db): Repos {
  return {
    async pingDb() {
      await db.execute(sql`select 1`)
    },

    async listFields(): Promise<FieldDto[]> {
      const rows = await db.query.field.findMany({ with: { themes: true }, orderBy: (f, { asc }) => [asc(f.slug)] })
      return rows.map((f) => ({
        id: f.id,
        slug: f.slug,
        nameDe: f.nameDe,
        adviceDisclaimer: f.adviceDisclaimer,
        themes: f.themes.map((t) => ({ id: t.id, slug: t.slug, nameDe: t.nameDe })),
      }))
    },

    async getMe(user: SessionUser): Promise<MeDto> {
      const profile = await db.query.userProfile.findFirst({ where: eq(userProfile.userId, user.id) })
      const interests = await db
        .select({ fieldId: userInterest.fieldId, themeId: userInterest.themeId })
        .from(userInterest)
        .where(eq(userInterest.userId, user.id))
      return {
        id: user.id,
        name: user.name,
        isAnonymous: user.isAnonymous,
        timezone: profile?.timezone ?? 'Europe/Berlin',
        formats: profile?.formats ?? ['audio', 'written'],
        interests,
      }
    },

    async saveInterests(userId: string, input: InterestsInput) {
      await db.transaction(async (tx) => {
        // Themes must belong to one of the chosen fields
        const themes = input.themeIds.length
          ? await tx.select({ id: theme.id, fieldId: theme.fieldId }).from(theme).where(inArray(theme.id, input.themeIds))
          : []
        const rows = [
          ...input.fieldIds.map((fieldId) => ({ userId, fieldId, themeId: null })),
          ...themes.filter((t) => input.fieldIds.includes(t.fieldId)).map((t) => ({ userId, fieldId: t.fieldId, themeId: t.id })),
        ]
        await tx.delete(userInterest).where(eq(userInterest.userId, userId))
        await tx.insert(userInterest).values(rows)
        const profile = { formats: input.formats, onboardedAt: new Date(), ...(input.timezone ? { timezone: input.timezone } : {}) }
        await tx.insert(userProfile).values({ userId, ...profile }).onConflictDoUpdate({ target: userProfile.userId, set: profile })
      })
    },
  }
}
