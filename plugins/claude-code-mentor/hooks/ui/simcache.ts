// Pamięć podręczna wyników symulacji (render może się powtarzać często).
// Symulacja jest deterministyczna, więc wynik zależy tylko od tekstu i dialektu.

import { simulate } from '../sim/interp'
import type { SimResult } from '../sim/interp'
import { dartToJs } from '../sim/dart'
import { findSites } from '../sim/variants'
import type { OpSite, ValueSite } from '../sim/variants'

export type Dialect = 'js' | 'dart'

const cache = new Map<string, SimResult>()

export function simulateCached(source: string, dialect: Dialect = 'js'): SimResult {
  const key = `${dialect}\u0000${source}`
  const hit = cache.get(key)
  if (hit) return hit
  const r = simulate(source, { maxSteps: 2000, dialect })
  cache.set(key, r)
  if (cache.size > 24) cache.delete(cache.keys().next().value as string)
  return r
}

const DART_OP: Record<string, string> = { '===': '==', '!==': '!=' }

/** Miejsca do podmiany (what-if). Dla Darta szukamy w przetłumaczonym kodzie i wracamy do pozycji w oryginale. */
export function simSites(source: string, dialect: Dialect = 'js'): { ops: OpSite[]; values: ValueSite[]; error?: string } {
  if (dialect === 'js') return findSites(source)
  const tr = dartToJs(source)
  if (!tr.ok) return { ops: [], values: [], error: tr.error }
  const sites = findSites(tr.js)
  const back = (start: number, end: number) => tr.map.find(m => m.js[0] === start && m.js[1] === end)?.dart ?? null
  const ops: OpSite[] = []
  for (const o of sites.ops) {
    const d = back(o.start, o.end)
    if (d) ops.push({ ...o, start: d[0], end: d[1], op: DART_OP[o.op] ?? o.op })
  }
  const values: ValueSite[] = []
  for (const v of sites.values) {
    const d = back(v.start, v.end)
    if (d) values.push({ ...v, start: d[0], end: d[1], raw: source.slice(d[0], d[1]) })
  }
  return { ops, values }
}

/** Operatory do wyboru w danym dialekcie (Dart nie ma === ani !==). */
export function dialectOps(ops: string[], dialect: Dialect): string[] {
  return dialect === 'js' ? ops : [...new Set(ops.map(o => DART_OP[o] ?? o))]
}

export const BOUNDARY_NOTE = 'Równość obu stron to przypadek brzegowy: < i > dają wtedy false, <= i >= dają true. Przy == / === liczy się też typ wartości (w zależności od języka).'
