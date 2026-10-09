import type { InterestsInput, MeDto } from '@wizzn/shared'
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
    getMe: async (u): Promise<MeDto> => ({ id: u.id, name: u.name, isAnonymous: u.isAnonymous, timezone: 'Europe/Berlin', formats: ['audio'], interests: [] }),
    saveInterests: async (_id, input) => {
      saved.push(input)
    },
  }
}
