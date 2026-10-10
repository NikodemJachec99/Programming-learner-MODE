// Klient lokalnej bazy. Moduł hooków nie ma Node, więc każdy batch operacji
// idzie do krótkotrwałego procesu `node mentor-db.mjs` (SQLite WAL). Gdy helper
// jest niedostępny, zapisy czekają w buforze ($.store) i są dosyłane później.

import type { Host } from '../host'

export type Op = { op: string; args?: Record<string, unknown> }
export type OpResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

export type DbCtx = {
  node: string
  helper: string
  sqlHelper: string
  dataDir: string
}

const PENDING_KEY = 'pendingOps'
const PENDING_MAX = 400
const WRITE_OPS = new Set([
  'addObservations', 'saveChange', 'recordEvidence', 'recordExposure', 'saveLesson', 'markLesson', 'cachePut', 'commitUsage',
  'saveExercise', 'gradeExercise', 'setNotes', 'setSettings', 'deleteChanges', 'clearData',
])

export class DbError extends Error {}

/** Łączy ścieżkę separatorem systemu, który widać po pierwszej części (C:\\… albo /…). */
export function joinPath(...parts: string[]): string {
  const sep = /^[A-Za-z]:|\\/.test(parts[0] ?? '') && !(parts[0] ?? '').startsWith('/') ? '\\' : '/'
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
}

async function spawnJson(io: Host, ctx: DbCtx, script: string, payload: unknown, timeoutMs: number): Promise<unknown> {
  const r = await io.run([ctx.node, '--no-warnings', script], { stdin: JSON.stringify(payload), timeoutMs, cwd: ctx.dataDir })
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? ''
  if (!line) throw new DbError(`helper nie zwrócił wyniku (exit ${r.exitCode}): ${r.stderr.slice(0, 300)}`)
  try {
    return JSON.parse(line)
  } catch {
    throw new DbError(`helper zwrócił nie-JSON: ${line.slice(0, 200)}`)
  }
}

/** Wykonuje batch. Rzuca DbError tylko przy błędzie całego procesu. */
export async function batch(io: Host, ctx: DbCtx, ops: Op[], timeoutMs = 30000): Promise<OpResult[]> {
  const out = (await spawnJson(io, ctx, ctx.helper, { v: 1, dataDir: ctx.dataDir, ops }, timeoutMs)) as { ok: boolean; error?: string; results?: OpResult[] }
  if (!out.ok || !out.results) throw new DbError(out.error ?? 'helper: nieznany błąd')
  return out.results
}

export async function one<T>(io: Host, ctx: DbCtx, op: string, args?: Record<string, unknown>): Promise<T> {
  const [r] = await batch(io, ctx, [{ op, args }])
  if (!r) throw new DbError('brak wyniku')
  if (!r.ok) throw new DbError(`${op}: ${r.error}`)
  return r.value as T
}

/** Zapis, który nie może zginąć: przy awarii helpera ląduje w buforze. */
export async function write(io: Host, ctx: DbCtx | null, ops: Op[]): Promise<OpResult[] | null> {
  if (ctx) {
    try {
      const res = await batch(io, ctx, ops)
      return res
    } catch (e) {
      io.log(`code-mentor: zapis odłożony do bufora (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  const pending = ((await io.storeGet(PENDING_KEY)) as Op[] | undefined) ?? []
  const next = [...pending, ...ops.filter(o => WRITE_OPS.has(o.op))].slice(-PENDING_MAX)
  await io.storeSet(PENDING_KEY, next)
  return null
}

export async function pendingCount(io: Host): Promise<number> {
  return (((await io.storeGet(PENDING_KEY)) as Op[] | undefined) ?? []).length
}

/** Dosyła bufor. Zwraca liczbę dosłanych operacji. */
export async function flushPending(io: Host, ctx: DbCtx): Promise<number> {
  const pending = ((await io.storeGet(PENDING_KEY)) as Op[] | undefined) ?? []
  if (!pending.length) return 0
  await batch(io, ctx, pending, 60000)
  await io.storeDelete(PENDING_KEY)
  return pending.length
}

export type SqlStage = { title: string; explain: string; note?: string; columns: string[]; rows: unknown[][]; total: number }
export type SqlRun = { ok: boolean; stages?: SqlStage[]; engine?: string; error?: string }

export async function runSql(io: Host, ctx: DbCtx, setup: string, query: string): Promise<SqlRun> {
  return (await spawnJson(io, ctx, ctx.sqlHelper, { setup, query }, 15000)) as SqlRun
}
