import type { QueueName } from './jobs/queues.js'
import type { ClaimResult } from './pipeline/recover.js'
import type { BriefInput, FieldDto, InterestsInput, MeDto, UnitDetailDto, UnitEdit, UnitListQuery, UnitLogDto, UnitSummaryDto } from '@wizzn/shared'

export interface SessionUser {
  id: string
  name: string
  email: string
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

export type AdminActionResult = 'ok' | 'not_found' | 'invalid_state' | 'invalid_content' | 'has_history'

export interface AdminRepo {
  createBrief(input: BriefInput, createdBy: string): Promise<{ briefId: string; unitIds: string[] }>
  listUnits(query: UnitListQuery): Promise<UnitSummaryDto[]>
  getUnit(id: string): Promise<UnitDetailDto | null>
  /** in_review: content must match unitContentSchema. Stuck in drafting: content must be a complete draft. */
  editUnit(id: string, edit: UnitEdit): Promise<AdminActionResult>
  approve(id: string): Promise<AdminActionResult>
  reject(id: string, reason: string): Promise<AdminActionResult>
  /** published → locked: hidden from feed/search/saved lists; completions, XP and streaks are untouched */
  lock(id: string): Promise<AdminActionResult>
  /** locked → published again (content must match unitContentSchema) */
  unlock(id: string): Promise<AdminActionResult>
  /** Moves failed/rejected/in_review/published/stuck units back to queued; caller enqueues research */
  requeue(id: string): Promise<AdminActionResult>
  /** Keeps sources, re-runs draft → check → media; caller enqueues the draft queue */
  redraft(id: string): Promise<AdminActionResult>
  /** Hard delete; refused while a worker processes the unit or once users have seen/completed it */
  deleteUnit(id: string): Promise<AdminActionResult>
  /** Puts a stuck unit back before its interrupted step; caller enqueues the returned queue */
  resume(id: string): Promise<ClaimResult>
  /** Pipeline protocol, oldest first; `after` returns only newer lines (polling) */
  listLogs(id: string, after?: number): Promise<UnitLogDto[]>
  /** Admin-side protocol line, e.g. a manual restart */
  addLog(id: string, message: string): Promise<void>
}

export interface JobQueue {
  enqueueResearch(unitId: string): Promise<void>
  enqueue(queue: QueueName, unitId: string): Promise<void>
}
