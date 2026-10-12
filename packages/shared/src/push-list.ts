import type { UnitSummaryDto } from './admin.js'

/** Units picked in the admin for `pnpm coolify:push-delta --units <file>`; the script reads only the first column */
export type PushListUnit = Pick<UnitSummaryDto, 'id' | 'status' | 'format' | 'title' | 'topic'>

const pad = (n: number): string => String(n).padStart(2, '0')
const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim()

export function formatPushList(units: PushListUnit[], at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  const lines = units.map((u) => [u.id, u.status, u.format, oneLine(u.title ?? u.topic)].join('\t'))
  return [`# wizzn push list · ${stamp} · ${units.length} units`, ...lines, ''].join('\n')
}

export function pushListFilename(at: Date): string {
  return `wizzn-push-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.txt`
}
