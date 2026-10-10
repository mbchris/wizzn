import type { ReplaceImageMode, UnitDetailDto } from '@wizzn/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
}

export async function api<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${process.env.API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string } | null)?.error ?? (data as { message?: string } | null)?.message ?? res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export interface Session {
  user: { id: string; email: string; name: string }
}

export const authApi = {
  session: () => api<Session | null>('/api/auth/get-session'),
  signIn: (email: string, password: string) => api<Session>('/api/auth/sign-in/email', { method: 'POST', body: { email, password } }),
  signUp: (email: string, password: string, name: string) =>
    api<Session>('/api/auth/sign-up/email', { method: 'POST', body: { email, password, name } }),
  signOut: () => api<unknown>('/api/auth/sign-out', { method: 'POST', body: {} }),
}

export const replaceImage = (unitId: string, assetId: string, mode: ReplaceImageMode): Promise<UnitDetailDto['assets'][number]> =>
  api(`/api/admin/units/${unitId}/assets/${assetId}/replace`, { method: 'POST', body: { mode } })

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
