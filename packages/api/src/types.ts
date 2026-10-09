import type { FieldDto, InterestsInput, MeDto } from '@wizzn/shared'

export interface SessionUser {
  id: string
  name: string
  isAnonymous: boolean
}

/** Minimal surface of Better Auth used by the app; lets tests inject a fake. */
export interface AuthPort {
  handler(request: Request): Promise<Response>
  getSessionUser(headers: Headers): Promise<SessionUser | null>
}

export interface Repos {
  pingDb(): Promise<void>
  listFields(): Promise<FieldDto[]>
  getMe(user: SessionUser): Promise<MeDto>
  saveInterests(userId: string, input: InterestsInput): Promise<void>
}

export interface AppVariables {
  user: SessionUser
}
