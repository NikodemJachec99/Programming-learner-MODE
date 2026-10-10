// Warianty "what-if": wyszukanie operatorów i literałów do podmiany,
// zbudowanie wariantu B jako nowego tekstu (oryginał nie jest dotykany)
// i porównanie przebiegów A i B prostym językiem.

import type { Expr, Stmt } from './ast'
import { parse } from './parser'
import type { SimResult } from './interp'

export type OpSite = { id: string; line: number; start: number; end: number; op: string; expr: string; group: 'compare' | 'logical' | 'arith' }
export type ValueSite = { id: string; line: number; start: number; end: number; name: string; raw: string }
export type Edit = { start: number; end: number; text: string }

export const OP_GROUPS: Record<OpSite['group'], string[]> = {
  compare: ['<', '<=', '>', '>=', '==', '===', '!=', '!=='],
  logical: ['&&', '||', '??'],
  arith: ['+', '-', '*', '/', '%'],
}

function groupOf(op: string): OpSite['group'] | null {
  for (const [g, ops] of Object.entries(OP_GROUPS)) if (ops.includes(op)) return g as OpSite['group']
  return null
}

export function findSites(source: string): { ops: OpSite[]; values: ValueSite[]; error?: string } {
  let body: Stmt[]
  try {
    body = parse(source).body
  } catch (e) {
    return { ops: [], values: [], error: e instanceof Error ? e.message : String(e) }
  }
  const ops: OpSite[] = []
  const values: ValueSite[] = []
  const snippet = (s: number, e: number) => source.slice(s, e).replace(/\s+/g, ' ').trim()

  const literal = (e: Expr | null | undefined): { start: number; end: number } | null => {
    if (!e) return null
    if (e.type === 'Num' || e.type === 'Str' || e.type === 'Bool' || e.type === 'Null' || e.type === 'Undef') return { start: e.start, end: e.end }
    if (e.type === 'Unary' && e.op === '-' && e.arg.type === 'Num') return { start: e.start, end: e.end }
    return null
  }

  const visitE = (e: Expr | null | undefined, topCallArgs = false): void => {
    if (!e) return
    switch (e.type) {
      case 'Binary':
      case 'Logical': {
        const g = groupOf(e.op)
        if (g) ops.push({ id: `op${e.opStart}`, line: e.line, start: e.opStart, end: e.opStart + e.op.length, op: e.op, expr: snippet(e.start, e.end), group: g })
        visitE(e.left)
        visitE(e.right)
        return
      }
      case 'Call':
        visitE(e.callee)
        e.args.forEach(a => {
          if (a.type === 'Spread') return visitE(a.arg)
          const lit = topCallArgs ? literal(a) : null
          if (lit) values.push({ id: `v${lit.start}`, line: a.line, ...lit, name: `argument ${snippet(e.callee.start, e.callee.end)}(…)`, raw: source.slice(lit.start, lit.end) })
          visitE(a)
        })
        return
      case 'Unary':
      case 'Await':
        return visitE(e.arg)
      case 'Update':
        return visitE(e.arg)
      case 'Cond':
        visitE(e.test)
        visitE(e.cons)
        visitE(e.alt)
        return
      case 'Assign':
        visitE(e.target)
        visitE(e.value)
        return
      case 'Member':
        visitE(e.object)
        if (e.computed) visitE(e.prop)
        return
      case 'Array':
        e.items.forEach(i => visitE(i.type === 'Spread' ? i.arg : i))
        return
      case 'Object':
        e.props.forEach(p => visitE(p.value))
        return
      case 'Func':
        if (Array.isArray(e.body)) e.body.forEach(s => visitS(s))
        else visitE(e.body)
        return
      case 'Template':
        e.parts.forEach(p => p.kind === 'expr' && visitE(p.expr))
        return
      case 'Seq':
        e.items.forEach(x => visitE(x))
        return
      case 'New':
        e.args.forEach(a => visitE(a.type === 'Spread' ? a.arg : a))
        return
    }
  }

  const visitS = (s: Stmt | null, top = false): void => {
    if (!s) return
    switch (s.type) {
      case 'VarDecl':
        for (const d of s.decls) {
          const lit = literal(d.init)
          if (lit && !d.pattern) values.push({ id: `v${lit.start}`, line: s.line, ...lit, name: d.name, raw: source.slice(lit.start, lit.end) })
          visitE(d.init)
        }
        return
      case 'Expr':
        return visitE(s.expr, top)
      case 'Return':
      case 'Throw':
        return visitE(s.arg)
      case 'If':
        visitE(s.test)
        visitS(s.cons)
        visitS(s.alt)
        return
      case 'While':
      case 'DoWhile':
        visitE(s.test)
        visitS(s.body)
        return
      case 'For':
        visitS(s.init)
        visitE(s.test)
        visitE(s.update)
        visitS(s.body)
        return
      case 'ForOf':
        visitE(s.iter)
        visitS(s.body)
        return
      case 'Block':
        s.body.forEach(x => visitS(x))
        return
      case 'FuncDecl':
        if (Array.isArray(s.func.body)) s.func.body.forEach(x => visitS(x))
        s.func.params.forEach(p => {
          const lit = literal(p.default)
          if (lit) values.push({ id: `v${lit.start}`, line: s.line, ...lit, name: `domyślny ${p.name}`, raw: source.slice(lit.start, lit.end) })
        })
        return
      case 'Try':
        s.block.forEach(x => visitS(x))
        s.handler?.forEach(x => visitS(x))
        s.finalizer?.forEach(x => visitS(x))
        return
      case 'Switch':
        visitE(s.disc)
        s.cases.forEach(c => c.body.forEach(x => visitS(x)))
        return
      case 'ClassDecl':
        s.methods.forEach(m => Array.isArray(m.func.body) && m.func.body.forEach(x => visitS(x)))
        if (s.ctor && Array.isArray(s.ctor.body)) s.ctor.body.forEach(x => visitS(x))
        return
    }
  }
  body.forEach(s => visitS(s, true))
  ops.sort((a, b) => a.start - b.start)
  values.sort((a, b) => a.start - b.start)
  return { ops, values }
}

/** Nakłada podmiany na tekst (od końca, żeby pozycje się nie przesuwały). */
export function applyEdits(source: string, edits: Edit[]): string {
  let out = source
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

export type Comparison = {
  same: boolean
  lines: string[]
}

/** Porównuje dwa przebiegi i opisuje różnice prostym językiem. */
export function compareRuns(a: SimResult, b: SimResult, edits: { before: string; after: string; line: number }[]): Comparison {
  const lines: string[] = []
  if (edits.length) lines.push(`Zmiana w wariancie B: ${edits.map(e => `linia ${e.line}: ${e.before} → ${e.after}`).join('; ')}.`)
  if (!a.ok || !b.ok) {
    if (a.error) lines.push(`A: ${a.error.message}`)
    if (b.error) lines.push(`B: ${b.error.message}`)
  }
  // warunki: dopasowanie po kolejności pierwszego wykonania i linii
  const n = Math.max(a.conditions.length, b.conditions.length)
  for (let i = 0; i < n; i++) {
    const ca = a.conditions[i]
    const cb = b.conditions[i]
    if (!ca || !cb) {
      const c = ca ?? cb!
      lines.push(`Warunek w linii ${c.line} (${c.expr}) wykonał się tylko w wariancie ${ca ? 'A' : 'B'}: inna ścieżka sprawiła, że w drugim wariancie program w ogóle do niego nie doszedł.`)
      continue
    }
    const ra = ca.results.join(', ')
    const rb = cb.results.join(', ')
    if (ra !== rb) {
      if (ca.results.length === 1 && cb.results.length === 1) {
        lines.push(`Linia ${ca.line}: w A \`${ca.expr}\` → ${ra}, w B \`${cb.expr}\` → ${rb}. Program wybiera ${ca.results[0] ? 'gałąź if' : 'gałąź else / pomija blok'} w A i ${cb.results[0] ? 'gałąź if' : 'gałąź else / pomija blok'} w B.`)
      } else {
        lines.push(`Linia ${ca.line}: warunek sprawdzono ${ca.results.length}× w A i ${cb.results.length}× w B. A: [${ra}], B: [${rb}].`)
      }
    }
  }
  for (const la of a.loops) {
    const lb = b.loops.find(x => x.line === la.line)
    if (!lb) lines.push(`Pętla w linii ${la.line}: w A ${la.iterations} iteracji, w B nie wykonała się wcale.`)
    else if (lb.iterations !== la.iterations) lines.push(`Pętla w linii ${la.line}: A wykonała ${la.iterations} iteracji, B ${lb.iterations}. Typowa przyczyna: zmiana operatora granicznego (< vs <=) albo wartości startowej/końcowej.`)
  }
  for (const lb of b.loops) if (!a.loops.some(x => x.line === lb.line)) lines.push(`Pętla w linii ${lb.line}: w B ${lb.iterations} iteracji, w A nie wykonała się wcale.`)
  const outA = a.output.join('\n')
  const outB = b.output.join('\n')
  if (outA !== outB) lines.push(`Wyjście: A wypisało [${a.output.map(o => JSON.stringify(o)).join(', ')}], B wypisało [${b.output.map(o => JSON.stringify(o)).join(', ')}].`)
  const keys = new Set([...Object.keys(a.finalVars), ...Object.keys(b.finalVars)])
  const diffs = [...keys].filter(k => a.finalVars[k] !== b.finalVars[k] && !(a.finalVars[k] ?? '').startsWith('[Function'))
  if (diffs.length) lines.push(`Stan końcowy różni się: ${diffs.map(k => `${k}: A=${a.finalVars[k] ?? '—'}, B=${b.finalVars[k] ?? '—'}`).join('; ')}.`)
  const same = lines.length <= (edits.length ? 1 : 0)
  if (same) lines.push('Dla tych danych oba warianty zachowują się identycznie. Różnica może ujawnić się dopiero dla innych wartości (sprawdź przypadek brzegowy, np. równość obu stron porównania).')
  for (const e of edits) {
    const note = boundaryNote(e.before, e.after)
    if (note) lines.push(note)
  }
  return { same, lines }
}

export function boundaryNote(before: string, after: string): string | null {
  const pair = new Set([before, after])
  const has = (x: string, y: string) => pair.has(x) && pair.has(y)
  if (has('<', '<=') || has('>', '>=')) return 'Przypadek brzegowy: < i <= (oraz > i >=) różnią się WYŁĄCZNIE wtedy, gdy obie strony są równe. Dla x = granicy wersja ostra daje false, a nieostra true. To źródło błędów off-by-one w pętlach.'
  if (has('<', '>') || has('<=', '>=')) return 'Odwrócenie kierunku porównania zamienia zbiór wartości, dla których warunek jest prawdziwy. Gdy obie strony są równe, < i > dają false, a <= i >= dają true.'
  if (has('==', '===') || has('!=', '!==')) return 'Różnica == vs ===: == przed porównaniem konwertuje typy (np. 0 == "" → true, "5" == 5 → true), === wymaga tego samego typu. Dla wartości tego samego typu wynik jest identyczny.'
  if (has('&&', '||')) return '&& wymaga, by obie strony były truthy (i nie sprawdza prawej, gdy lewa jest falsy). || wystarcza jedna truthy strona (i nie sprawdza prawej, gdy lewa jest truthy).'
  if (has('||', '??')) return '|| zastępuje KAŻDĄ wartość falsy (0, "", false, null, undefined, NaN), a ?? tylko null i undefined. Dla 0 albo "" wyniki się różnią.'
  return null
}
