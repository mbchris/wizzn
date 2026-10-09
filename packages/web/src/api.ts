import type { CompletionInput, CompletionResult, FeedResponse, FieldDto, InterestsInput, MeDto, PremiumDto, ProgressDto } from '@wizzn/shared'

const TOKEN_KEY = 'wizzn.token'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode): session lives only in memory
  }
}

let memoryToken: string | null = readToken()

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (memoryToken) headers.authorization = `Bearer ${memoryToken}`
  const res = await fetch(`${process.env.API_URL}${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data as { error?: string; message?: string; reason?: string } | null
    throw new ApiError(res.status, err?.error ?? err?.reason ?? err?.message ?? res.statusText)
  }
  return data as T
}

/** Spec §2: anonymous session on first launch; the token survives app restarts. */
export async function ensureSession(): Promise<MeDto> {
  if (memoryToken) {
    try {
      return await request<MeDto>('/api/me')
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e
      memoryToken = null
      writeToken(null)
    }
  }
  const signIn = await request<{ token: string }>('/api/auth/sign-in/anonymous', 'POST', {})
  memoryToken = signIn.token
  writeToken(signIn.token)
  return request<MeDto>('/api/me')
}

export type SocialProvider = 'apple' | 'google'

/**
 * Native id token → Better Auth session. The current (anonymous) bearer token is sent along, so the
 * server links the accounts and moves the progress (anonymous plugin onLinkAccount).
 */
export async function signInWithIdToken(provider: SocialProvider, idToken: string): Promise<MeDto> {
  const res = await request<{ token: string }>('/api/auth/sign-in/social', 'POST', { provider, idToken: { token: idToken } })
  memoryToken = res.token
  writeToken(res.token)
  return request<MeDto>('/api/me')
}

/** Ends the account session; the app continues with a fresh anonymous session */
export async function signOut(): Promise<MeDto> {
  await request<unknown>('/api/auth/sign-out', 'POST', {}).catch(() => undefined)
  memoryToken = null
  writeToken(null)
  return ensureSession()
}

export const api = {
  fields: () => request<FieldDto[]>('/api/fields'),
  me: () => request<MeDto>('/api/me'),
  saveInterests: (input: InterestsInput) => request<MeDto>('/api/me/interests', 'PUT', input),
  feed: (limit = 10) => request<FeedResponse>(`/api/feed?limit=${limit}`),
  complete: (unitId: string, input: CompletionInput) => request<CompletionResult>(`/api/units/${unitId}/complete`, 'POST', input),
  progress: () => request<ProgressDto>('/api/me/progress'),
  refreshSubscription: () => request<PremiumDto>('/api/me/subscription/refresh', 'POST', {}),
}
