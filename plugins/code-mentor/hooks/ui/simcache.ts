// Pamięć podręczna wyników symulacji (render może się powtarzać często).
// Symulacja jest deterministyczna, więc wynik zależy tylko od tekstu i dialektu.

import { simulate } from '../sim/interp'
import type { SimResult } from '../sim/interp'
import { dartToJs } from '../sim/dart'
import { healBraces, healJs } from '../sim/heal'
import { findSites } from '../sim/variants'
import type { OpSite, ValueSite } from '../sim/variants'
import { applyEdits } from '../sim/variants'
import { autoCall, looksLikeCall, pairCall } from '../sim/autocall'
import type { MentorSimState } from '../../types'

export type Dialect = 'js' | 'dart'

const cache = new Map<string, SimResult>()

export function simulateCached(source: string, dialect: Dialect = 'js'): SimResult {
  const key = `${dialect}\u0000${source}`
  const hit = cache.get(key)
  if (hit) return hit
  // wycinek z lekcji albo zaznaczenia: domknięte nawiasy, nieznane nazwy jako zaślepki
  let healed: { source: string; notes: string[] } = { source, notes: [] }
  if (dialect === 'js') healed = healJs(source)
  else if (!dartToJs(source).ok) {
    const b = healBraces(source)
    if (dartToJs(b.source).ok) healed = b
  }
  const r = simulate(healed.source, { maxSteps: 2000, dialect, stubs: true })
  if (healed.notes.length) r.hypotheses.unshift(`Kod to wycinek, więc symulator go uzupełnił: ${healed.notes.join(', ')}. Dopiski widać w kodzie powyżej.`)
  cache.set(key, r)
  if (cache.size > 24) cache.delete(cache.keys().next().value as string)
  return r
}

/** Kod do wykonania: wariant, a do tego wywołanie (wpisane albo dobrane automatycznie). */
export function program(s: MentorSimState, variant: 'A' | 'B'): string {
  const base = s.pair ? (variant === 'A' ? s.pair.a : s.pair.b) : variant === 'B' && s.edits.length ? applyEdits(s.source, s.edits) : s.source
  // para: jedno wywołanie, które istnieje w A i w B, inaczej żadne
  if (s.pair) {
    const pc = pairCall(s.pair.a, s.pair.b, s.dialect ?? 'js', s.callArgs)
    return pc.call ? `${base}\n${pc.call}` : base
  }
  const call = s.callArgs.trim()
  if (call && looksLikeCall(call)) return `${base}\n${call}`
  const ac = autoCall(base, s.dialect ?? 'js')
  return ac ? `${base}\n${ac.call}` : base
}

/** Liczba kroków bieżącego wariantu (do odtwarzania). */
export function simTotal(s: MentorSimState): number {
  const variant = s.pair || s.edits.length ? s.variant : 'A'
  return Math.max(1, simulateCached(program(s, variant), s.dialect ?? 'js').steps.length)
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
