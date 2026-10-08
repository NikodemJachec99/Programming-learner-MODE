// Wartości symulowanego JavaScriptu i operacje zgodne ze specyfikacją
// ECMAScript dla obsługiwanego podzbioru (ToNumber, ToString, IsLooselyEqual,
// IsStrictlyEqual, porównanie relacyjne).

import type { Expr, FuncNode } from './ast'

export type Env = {
  vars: Map<string, { value: Value; kind: 'let' | 'const' | 'var' | 'param' | 'func' | 'class' }>
  parent: Env | null
  /** Ramka funkcji (do snapshotów zmiennych lokalnych). */
  frame: string
}

export type JsObject = {
  kind: 'object'
  id: number
  props: Map<string, Value>
  proto: JsObject | null
  className?: string
  isError?: boolean
  /** Magazyn Map/Set (klucze porównywane jak SameValueZero). */
  internal?: Map<Value, Value> | Set<Value>
}
export type JsArray = { kind: 'array'; id: number; items: Value[] }
export type JsFunction = {
  kind: 'function'
  id: number
  name: string
  node: FuncNode
  env: Env
  thisValue?: Value
  homeClass?: JsClass
  isMethod?: boolean
}
export type JsBuiltin = {
  kind: 'builtin'
  id: number
  name: string
  call: (thisArg: Value, args: Value[]) => Generator<AwaitSignal, Value, ResumeMsg>
  props?: Map<string, Value>
}
export type JsClass = {
  kind: 'class'
  id: number
  name: string
  ctor: FuncNode | null
  env: Env
  proto: JsObject
  superClass: JsClass | null
  fields: { name: string; init: Expr | null }[]
  statics: Map<string, Value>
}
export type PromiseReaction = { onFul: Value | null; onRej: Value | null; target: JsPromise | null; label: string; resume?: (ok: boolean, v: Value) => void }
export type JsPromise = {
  kind: 'promise'
  id: number
  state: 'pending' | 'fulfilled' | 'rejected'
  value: Value
  reactions: PromiseReaction[]
  label: string
  handled: boolean
}

/** Sygnał zawieszenia koprocedury na await i wiadomość wznowienia. */
export type AwaitSignal = { await: JsPromise; label: string }
export type ResumeMsg = { ok: boolean; value: Value } | undefined

export type Value = undefined | null | boolean | number | string | JsObject | JsArray | JsFunction | JsBuiltin | JsClass | JsPromise

export const isRef = (v: Value): v is JsObject | JsArray | JsFunction | JsBuiltin | JsClass | JsPromise =>
  typeof v === 'object' && v !== null

export function typeOf(v: Value): string {
  if (v === null) return 'object'
  if (v === undefined) return 'undefined'
  if (typeof v !== 'object') return typeof v
  if (v.kind === 'function' || v.kind === 'builtin' || v.kind === 'class') return 'function'
  return 'object'
}

export function toBoolean(v: Value): boolean {
  if (isRef(v)) return true
  return Boolean(v)
}

export function toPrimitive(v: Value, hint: 'number' | 'string' | 'default' = 'default'): Value {
  if (!isRef(v)) return v
  switch (v.kind) {
    case 'array':
      return v.items.map(x => (x === null || x === undefined ? '' : toStr(x))).join(',')
    case 'object':
      if (v.isError) return `${toStr(v.props.get('name') ?? 'Error')}: ${toStr(v.props.get('message') ?? '')}`
      return hint === 'number' ? NaN : '[object Object]'
    case 'promise':
      return '[object Promise]'
    default:
      return `function ${(v as { name?: string }).name ?? ''}() { [native code] }`
  }
}

export function toNumber(v: Value): number {
  const p = toPrimitive(v, 'number')
  if (p === undefined) return NaN
  if (p === null) return 0
  if (typeof p === 'boolean') return p ? 1 : 0
  if (typeof p === 'number') return p
  if (typeof p === 'string') {
    const s = p.trim()
    if (s === '') return 0
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) || /^0[xob][0-9a-f]+$/i.test(s) || /^[+-]?Infinity$/.test(s)) return Number(s)
    return NaN
  }
  return NaN
}

export function toStr(v: Value): string {
  const p = toPrimitive(v, 'string')
  if (p === undefined) return 'undefined'
  if (p === null) return 'null'
  if (typeof p === 'number') return numToString(p)
  return String(p)
}

function numToString(n: number): string {
  if (Object.is(n, -0)) return '0'
  return String(n)
}

export function strictEquals(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b // NaN !== NaN, +0 === -0
  return a === b
}

/** IsLooselyEqual (==) dla obsługiwanych typów, krok po kroku jak w specyfikacji. */
export function looseEquals(a: Value, b: Value, trace?: string[]): boolean {
  const note = (s: string) => trace?.push(s)
  const ta = a === null ? 'null' : typeOf(a)
  const tb = b === null ? 'null' : typeOf(b)
  if (ta === tb) {
    note('ten sam typ: porównanie jak ===')
    return strictEquals(a, b)
  }
  if ((a === null && b === undefined) || (a === undefined && b === null)) {
    note('null == undefined jest z definicji true')
    return true
  }
  if (a === null || a === undefined || b === null || b === undefined) {
    note('null/undefined jest luźno równe tylko null/undefined')
    return false
  }
  if (typeof a === 'number' && typeof b === 'string') {
    note(`string → number: ${JSON.stringify(b)} → ${toNumber(b)}`)
    return looseEquals(a, toNumber(b), trace)
  }
  if (typeof a === 'string' && typeof b === 'number') {
    note(`string → number: ${JSON.stringify(a)} → ${toNumber(a)}`)
    return looseEquals(toNumber(a), b, trace)
  }
  if (typeof a === 'boolean') {
    note(`boolean → number: ${a} → ${a ? 1 : 0}`)
    return looseEquals(a ? 1 : 0, b, trace)
  }
  if (typeof b === 'boolean') {
    note(`boolean → number: ${b} → ${b ? 1 : 0}`)
    return looseEquals(a, b ? 1 : 0, trace)
  }
  if (isRef(a) && !isRef(b)) {
    const p = toPrimitive(a)
    note(`obiekt → prymityw: ${display(a)} → ${display(p)}`)
    return looseEquals(p, b, trace)
  }
  if (!isRef(a) && isRef(b)) {
    const p = toPrimitive(b)
    note(`obiekt → prymityw: ${display(b)} → ${display(p)}`)
    return looseEquals(a, p, trace)
  }
  return false
}

/** Porównanie relacyjne (<, >, <=, >=) zgodne z IsLessThan. */
export function compare(op: '<' | '>' | '<=' | '>=', a: Value, b: Value, trace?: string[]): boolean {
  const pa = toPrimitive(a, 'number')
  const pb = toPrimitive(b, 'number')
  if (typeof pa === 'string' && typeof pb === 'string') {
    trace?.push('dwa napisy: porównanie leksykograficzne kodów znaków (UTF-16), nie liczb')
    switch (op) {
      case '<':
        return pa < pb
      case '>':
        return pa > pb
      case '<=':
        return pa <= pb
      case '>=':
        return pa >= pb
    }
  }
  const na = toNumber(pa)
  const nb = toNumber(pb)
  if (typeof pa !== 'number' || typeof pb !== 'number') trace?.push(`konwersja na liczby: ${display(pa)} → ${na}, ${display(pb)} → ${nb}`)
  if (Number.isNaN(na) || Number.isNaN(nb)) {
    trace?.push('NaN w porównaniu: każde porównanie relacyjne z NaN daje false')
    return false
  }
  switch (op) {
    case '<':
      return na < nb
    case '>':
      return na > nb
    case '<=':
      return na <= nb
    case '>=':
      return na >= nb
  }
}

/** Czytelny zapis wartości (jak w konsoli), ograniczony długością. */
export function display(v: Value, depth = 0, seen: Set<number> = new Set()): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') return depth === 0 ? JSON.stringify(v) : JSON.stringify(v)
  if (typeof v === 'number') return numToString(v)
  if (typeof v === 'boolean') return String(v)
  if (seen.has(v.id)) return '[Circular]'
  switch (v.kind) {
    case 'array': {
      if (depth > 2) return '[Array]'
      seen.add(v.id)
      const items = v.items.slice(0, 12).map(x => display(x, depth + 1, seen))
      seen.delete(v.id)
      return `[${items.join(', ')}${v.items.length > 12 ? `, … (+${v.items.length - 12})` : ''}]`
    }
    case 'object': {
      if (v.isError) return `${toStr(v.props.get('name'))}: ${toStr(v.props.get('message'))}`
      if (depth > 2) return '{…}'
      seen.add(v.id)
      const entries = [...v.props.entries()].slice(0, 10).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${display(x, depth + 1, seen)}`)
      seen.delete(v.id)
      const prefix = v.className ? `${v.className} ` : ''
      return `${prefix}{${entries.length ? ' ' + entries.join(', ') + (v.props.size > 10 ? ', …' : '') + ' ' : ''}}`
    }
    case 'function':
      return `[Function ${v.name || '(anonimowa)'}]`
    case 'builtin':
      return `[Function ${v.name}]`
    case 'class':
      return `[class ${v.name}]`
    case 'promise':
      return v.state === 'pending' ? `Promise { <pending> }` : v.state === 'fulfilled' ? `Promise { ${display(v.value, depth + 1, seen)} }` : `Promise { <rejected> ${display(v.value, depth + 1, seen)} }`
  }
}

/** console.log formatuje napisy bez cudzysłowów na najwyższym poziomie. */
export function logFormat(args: Value[]): string {
  return args.map(a => (typeof a === 'string' ? a : display(a))).join(' ')
}
