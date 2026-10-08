// Eksplorator warunków: jeden operator porównania, dwie wartości,
// semantyka konkretnego języka (JavaScript, Python 3, PHP 8).
// Służy do pokazania przypadków brzegowych i konwersji typów.

import { compare, display, looseEquals, strictEquals } from './values'
import type { Value } from './values'

export type CondLang = 'js' | 'py' | 'php'

export type Lit =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'undef' }

export const COND_OPS: Record<CondLang, string[]> = {
  js: ['<', '<=', '>', '>=', '==', '===', '!=', '!=='],
  py: ['<', '<=', '>', '>=', '==', '!='],
  php: ['<', '<=', '>', '>=', '==', '===', '!=', '!=='],
}

export const LANG_NAMES: Record<CondLang, string> = { js: 'JavaScript / TypeScript', py: 'Python 3', php: 'PHP 8' }

/** Parsuje literał wpisany przez użytkownika: 7, -1.5, "7", 'a', true, null, None, undefined. */
export function parseLiteral(text: string, lang: CondLang): Lit | { error: string } {
  const s = text.trim()
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return { t: 'num', v: Number(s) }
  if (/^(".*"|'.*')$/s.test(s)) return { t: 'str', v: s.slice(1, -1) }
  const low = s.toLowerCase()
  if (lang === 'py') {
    if (s === 'True' || s === 'False') return { t: 'bool', v: s === 'True' }
    if (s === 'None') return { t: 'null' }
  } else {
    if (low === 'true' || low === 'false') return { t: 'bool', v: low === 'true' }
    if (low === 'null') return { t: 'null' }
    if (lang === 'js' && s === 'undefined') return { t: 'undef' }
    if (lang === 'js' && s === 'NaN') return { t: 'num', v: NaN }
  }
  return { error: `Nie rozpoznaję wartości ${s}. Liczba (7), napis w cudzysłowie ("7"), ${lang === 'py' ? 'True/False/None' : 'true/false/null'}.` }
}

export function showLit(l: Lit, lang: CondLang): string {
  switch (l.t) {
    case 'num':
      return Number.isNaN(l.v) ? 'NaN' : String(l.v)
    case 'str':
      return JSON.stringify(l.v)
    case 'bool':
      return lang === 'py' ? (l.v ? 'True' : 'False') : String(l.v)
    case 'null':
      return lang === 'py' ? 'None' : 'null'
    case 'undef':
      return 'undefined'
  }
}

export type CondResult = { value: boolean | null; error?: string; notes: string[] }

export function evalCond(lang: CondLang, op: string, a: Lit, b: Lit): CondResult {
  switch (lang) {
    case 'js':
      return evalJs(op, a, b)
    case 'py':
      return evalPy(op, a, b)
    case 'php':
      return evalPhp(op, a, b)
  }
}

const toJs = (l: Lit): Value => (l.t === 'null' ? null : l.t === 'undef' ? undefined : l.v)

function evalJs(op: string, a: Lit, b: Lit): CondResult {
  const notes: string[] = []
  const x = toJs(a)
  const y = toJs(b)
  let value: boolean
  switch (op) {
    case '===':
    case '!==': {
      const eq = strictEquals(x, y)
      if (a.t !== b.t) notes.push(`=== nie konwertuje typów: ${a.t} vs ${b.t}, więc wartości nie są równe`)
      value = op === '===' ? eq : !eq
      break
    }
    case '==':
    case '!=': {
      const eq = looseEquals(x, y, notes)
      value = op === '==' ? eq : !eq
      break
    }
    default:
      value = compare(op as '<', x, y, notes)
  }
  notes.push(`${display(x)} ${op} ${display(y)} → ${value}`)
  return { value, notes }
}

function pyNum(l: Lit): number | null {
  if (l.t === 'num') return l.v
  if (l.t === 'bool') return l.v ? 1 : 0
  return null
}

function evalPy(op: string, a: Lit, b: Lit): CondResult {
  const notes: string[] = []
  const na = pyNum(a)
  const nb = pyNum(b)
  if (op === '==' || op === '!=') {
    let eq: boolean
    if (na !== null && nb !== null) {
      eq = na === nb
      if (a.t === 'bool' || b.t === 'bool') notes.push('w Pythonie bool to podklasa int: True == 1, False == 0')
    } else if (a.t === 'str' && b.t === 'str') eq = a.v === b.v
    else if (a.t === 'null' && b.t === 'null') eq = true
    else {
      eq = false
      notes.push(`różne typy (${pyType(a)} i ${pyType(b)}): == w Pythonie NIE konwertuje napisów na liczby, więc wynik to False`)
    }
    const value = op === '==' ? eq : !eq
    notes.push(`${showLit(a, 'py')} ${op} ${showLit(b, 'py')} → ${value ? 'True' : 'False'}`)
    return { value, notes }
  }
  if (na !== null && nb !== null) {
    const value = cmp(op, na, nb)
    notes.push(`${showLit(a, 'py')} ${op} ${showLit(b, 'py')} → ${value ? 'True' : 'False'}`)
    return { value, notes }
  }
  if (a.t === 'str' && b.t === 'str') {
    notes.push('dwa napisy: porównanie leksykograficzne punktów kodowych Unicode')
    const value = cmp(op, a.v, b.v)
    notes.push(`→ ${value ? 'True' : 'False'}`)
    return { value, notes }
  }
  return { value: null, error: `TypeError: '${op}' not supported between instances of '${pyType(a)}' and '${pyType(b)}'`, notes: ['Python 3 nie porządkuje wartości różnych typów: zamiast zgadywać, rzuca TypeError (w Pythonie 2 było inaczej)'] }
}

function pyType(l: Lit): string {
  return l.t === 'num' ? (Number.isInteger(l.v) ? 'int' : 'float') : l.t === 'str' ? 'str' : l.t === 'bool' ? 'bool' : 'NoneType'
}

function isPhpNumeric(s: string): boolean {
  return /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s)
}

function phpBool(l: Lit): boolean {
  switch (l.t) {
    case 'num':
      return l.v !== 0
    case 'str':
      return l.v !== '' && l.v !== '0'
    case 'bool':
      return l.v
    default:
      return false
  }
}

function evalPhp(op: string, a: Lit, b: Lit): CondResult {
  const notes: string[] = []
  if (op === '===' || op === '!==') {
    const sameType = a.t === b.t && !(a.t === 'num' && b.t === 'num' && Number.isInteger(a.v) !== Number.isInteger(b.v))
    const eq = sameType && JSON.stringify(a) === JSON.stringify(b)
    if (!sameType) notes.push('=== w PHP wymaga tego samego typu (int i float to różne typy)')
    const value = op === '===' ? eq : !eq
    notes.push(`→ ${value}`)
    return { value, notes }
  }
  // Porównanie luźne wg tabeli PHP 8
  let c: number
  if (a.t === 'bool' || b.t === 'bool' || ((a.t === 'null') !== (b.t === 'null') && a.t !== 'str' && b.t !== 'str')) {
    const x = phpBool(a)
    const y = phpBool(b)
    notes.push(`bool lub null po jednej stronie: obie strony zamieniane na bool (${showLit(a, 'php')} → ${x}, ${showLit(b, 'php')} → ${y})`)
    c = Number(x) - Number(y)
  } else if (a.t === 'null' && b.t === 'null') {
    c = 0
  } else if (a.t === 'null' || b.t === 'null') {
    const s = a.t === 'str' ? a.v : (b as { v: string }).v
    notes.push('null porównywany z napisem: null zamienia się na ""')
    const x = a.t === 'null' ? '' : s
    const y = b.t === 'null' ? '' : s
    c = x < y ? -1 : x > y ? 1 : 0
  } else if (a.t === 'str' && b.t === 'str') {
    if (isPhpNumeric(a.v) && isPhpNumeric(b.v)) {
      notes.push('oba napisy są liczbowe: PHP porównuje je jak liczby (np. "1e3" == "1000")')
      c = Number(a.v) - Number(b.v)
    } else {
      notes.push('napisy (nie oba liczbowe): porównanie tekstowe')
      c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0
    }
  } else if (a.t === 'num' && b.t === 'num') {
    c = a.v - b.v
  } else {
    const num = a.t === 'num' ? a.v : (b as { v: number }).v
    const str = a.t === 'str' ? a.v : (b as { v: string }).v
    if (isPhpNumeric(str)) {
      notes.push(`napis liczbowy ${JSON.stringify(str)} porównany z liczbą: porównanie liczbowe`)
      c = a.t === 'num' ? num - Number(str) : Number(str) - num
    } else {
      notes.push(`PHP 8: napis nieliczbowy ${JSON.stringify(str)} vs liczba: liczba zamieniana na napis i porównanie tekstowe (w PHP 7 było odwrotnie: 0 == "abc" dawało true)`)
      const x = a.t === 'num' ? String(num) : str
      const y = a.t === 'num' ? str : String(num)
      c = x < y ? -1 : x > y ? 1 : 0
    }
  }
  const value = op === '==' ? c === 0 : op === '!=' ? c !== 0 : cmp(op, c, 0)
  notes.push(`${showLit(a, 'php')} ${op} ${showLit(b, 'php')} → ${value}`)
  return { value, notes }
}

function cmp(op: string, x: number | string, y: number | string): boolean {
  switch (op) {
    case '<':
      return x < y
    case '<=':
      return x <= y
    case '>':
      return x > y
    case '>=':
      return x >= y
    case '==':
      return x === y
    case '!=':
      return x !== y
  }
  return false
}

/** Tabela przypadków brzegowych: wartości wokół stałej, wszystkie operatory. */
export function boundaryTable(lang: CondLang, b: Lit, extra?: Lit): { a: Lit; results: { op: string; r: CondResult }[] }[] {
  const around: Lit[] = []
  if (b.t === 'num' && Number.isFinite(b.v)) around.push({ t: 'num', v: b.v - 1 }, { t: 'num', v: b.v }, { t: 'num', v: b.v + 1 })
  else around.push(b)
  if (extra && !around.some(x => JSON.stringify(x) === JSON.stringify(extra))) around.unshift(extra)
  return around.map(a => ({ a, results: COND_OPS[lang].map(op => ({ op, r: evalCond(lang, op, a, b) })) }))
}
