// Change Lab: rekord jednej zmiany Claude w pliku. "Przed" to originalFile z wyniku
// narzędzia, "po" to ten plik z nałożonym patchem narzędzia (albo treść Write).
// Nic nie jest odtwarzane ani zgadywane: gdy narzędzie nie dało poprzedniej wersji,
// "przed" jest oznaczone jako niedostępne.

import type { Hunk } from './diff'
import { detectConcepts, newSymbols } from './detect'

export type ChangeStatus = 'ok' | 'failed' | 'blocked'

/** Lekki rekord do listy (bez kodu). */
export type ChangeMeta = {
  id: string
  ts: number
  turnKey: string
  turnLabel: string | null
  tool: string
  kind: 'create' | 'edit' | 'config' | 'dependency'
  status: ChangeStatus
  file: string
  lang: string
  line: number | null
  added: number
  removed: number
  summary: string
  concepts: string[]
  facts: string[]
  hasBefore: boolean
  hasAfter: boolean
}

/** Pełny rekord: okna kodu przed i po oraz diff. */
export type ChangeFull = ChangeMeta & {
  unified: string
  before: string | null
  beforeStart: number
  after: string | null
  afterStart: number
}

/** Nakłada hunki structuredPatch na oryginał. Null, gdy kontekst się nie zgadza (wtedy nie zgadujemy). */
export function applyHunks(original: string, hunks: readonly Hunk[]): string | null {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const src = original.split(/\r?\n/)
  const out: string[] = []
  let at = 0 // indeks w src (0-based)
  for (const h of hunks) {
    const start = Math.max(0, h.oldStart - 1)
    if (start < at) return null
    while (at < start) out.push(src[at++]!)
    for (const l of h.lines) {
      const tag = l[0]
      const text = l.slice(1)
      if (tag === '\\') continue // "\ No newline at end of file"
      if (tag === ' ' || tag === '-') {
        if (src[at] !== text) return null
        if (tag === ' ') out.push(text)
        at++
      } else if (tag === '+') out.push(text)
    }
  }
  while (at < src.length) out.push(src[at++]!)
  return out.join(eol)
}

const indentOf = (s: string) => /^\s*/.exec(s)![0].length
const isBlank = (s: string) => s.trim() === ''

/**
 * Okno kodu wokół zmienionych linii, rozszerzone do całego bloku najwyższego poziomu
 * (funkcji, klasy), żeby dało się je wykonać w symulatorze. Gdy blok jest za długi,
 * zostaje sam obszar zmiany z kontekstem.
 */
export function windowFor(text: string, from: number, to: number, maxLines = 160): { text: string; start: number } {
  const lines = text.split(/\r?\n/)
  if (!lines.length) return { text: '', start: 1 }
  let a = Math.max(0, Math.min(lines.length - 1, from - 1))
  let b = Math.max(a, Math.min(lines.length - 1, to - 1))
  // w górę do początku bloku: linia bez wcięcia, która nie jest zamknięciem
  while (a > 0 && !(indentOf(lines[a]!) === 0 && !isBlank(lines[a]!) && !/^[)\]}]/.test(lines[a]!.trim()))) a--
  // komentarze i adnotacje tuż nad blokiem też należą do niego
  while (a > 0 && /^\s*(\/\/|\*|\/\*|@|#)/.test(lines[a - 1]!)) a--
  // w dół do końca bloku: następna linia bez wcięcia, która zamyka albo zaczyna coś nowego
  let depth = 0
  for (let i = a; i < lines.length; i++) {
    for (const ch of lines[i]!.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '')) {
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') depth--
    }
    if (i >= b && depth <= 0 && (i + 1 >= lines.length || indentOf(lines[i + 1]!) === 0 || isBlank(lines[i + 1]!))) {
      b = i
      break
    }
    if (i === lines.length - 1) b = i
  }
  if (b - a + 1 > maxLines) {
    a = Math.max(0, from - 1 - 8)
    b = Math.min(lines.length - 1, to - 1 + 8)
  }
  while (b > a && isBlank(lines[b]!)) b--
  return { text: lines.slice(a, b + 1).join('\n'), start: a + 1 }
}

/** Zakres zmienionych linii w starej i nowej wersji na podstawie hunków. */
export function changedRanges(hunks: readonly Hunk[]): { old: [number, number]; new: [number, number] } | null {
  if (!hunks.length) return null
  let oldA = Infinity
  let oldB = 0
  let newA = Infinity
  let newB = 0
  for (const h of hunks) {
    let o = h.oldStart
    let n = h.newStart
    for (const l of h.lines) {
      const tag = l[0]
      if (tag === '-') {
        oldA = Math.min(oldA, o)
        oldB = Math.max(oldB, o)
        newA = Math.min(newA, n)
        newB = Math.max(newB, n)
        o++
      } else if (tag === '+') {
        newA = Math.min(newA, n)
        newB = Math.max(newB, n)
        oldA = Math.min(oldA, o)
        oldB = Math.max(oldB, o)
        n++
      } else if (tag === ' ') {
        o++
        n++
      }
    }
  }
  if (newA === Infinity) return null
  return { old: [oldA, Math.max(oldA, oldB)], new: [newA, Math.max(newA, newB)] }
}

const OPS = ['===', '!==', '<=', '>=', '==', '!=', '&&', '||', '??', '<', '>', '+', '-', '*', '/', '%']
const tokens = (s: string) => s.match(/===|!==|<=|>=|==|!=|&&|\|\||\?\?|[<>+\-*/%]|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`[^`]*`|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|\S/g) ?? []

/**
 * Co się zmieniło, w faktach z diffu: podmieniony operator albo wartość, nowe i usunięte
 * nazwy, nowe mechanizmy. Bez modelu, więc zawsze prawdziwe względem diffu.
 */
/** Pojęcia, które pojawiają się prawie w każdej zmianie: same w sobie nie są tematem do nauki. */
export const BASIC_CONCEPTS = new Set(['variables', 'data-types', 'operators', 'functions', 'strings', 'arrays', 'objects-maps', 'conditionals', 'loops', 'modules-imports', 'logging', 'equality', 'boolean-logic'])

type Refactor = { test: (r: string, a: string, lang: string) => boolean; text: (lang: string) => string }

const LOOP = /\bfor\s*\(|\bfor\s+\w+\s+(?:of|in)\b|\.forEach\(|\bwhile\s*\(/

/** Typowe przeróbki rozpoznawane po tym, co zniknęło i co się pojawiło. Kolejność = ważność. */
const REFACTORS: Refactor[] = [
  {
    test: (r, a) => LOOP.test(r) && /\bawait\b/.test(r) && /Promise\.all(?:Settled)?\(|Future\.wait\(/.test(a) && !/Promise\.all|Future\.wait/.test(r),
    text: l => `Zamiast czekać w pętli na każde \`await\` po kolei, wszystkie zadania startują naraz (\`${l === 'dart' ? 'Future.wait' : 'Promise.all'}\`).`,
  },
  {
    test: (r, a) => LOOP.test(r) && /\.(?:push|add)\(/.test(r) && /\.(?:map|filter|reduce|where|fold|flatMap)\(/.test(a) && !/\.(?:map|filter|reduce|where|fold|flatMap)\(/.test(r),
    text: () => 'Pętla, która dokładała elementy (`push`), zamieniona na `map`/`filter`/`reduce`: wynik powstaje w jednym wyrażeniu.',
  },
  { test: (r, a) => /\.then\(/.test(r) && /\bawait\b/.test(a) && !/\.then\(/.test(a), text: () => '`.then(...)` zamienione na `await`: ten sam kod asynchroniczny, czytany z góry na dół.' },
  { test: (r, a) => /\belse\s+if\b/.test(r) && /\bswitch\s*\(/.test(a) && !/\bswitch\s*\(/.test(r), text: () => 'Łańcuch `else if` zamieniony na `switch`.' },
  { test: (r, a) => /\bvar\s/.test(r) && /\b(?:const|let)\s/.test(a) && !/\bvar\s/.test(a), text: () => '`var` zamienione na `const`/`let`: zmienna żyje tylko w swoim bloku.' },
  { test: (r, a) => /\btry\s*\{/.test(a) && !/\btry\s*\{/.test(r), text: () => 'Dodana obsługa błędów: `try`/`catch`. Błąd nie wywróci już całego programu.' },
  {
    test: (r, a) => /[!=]==?\s*(?:null|undefined)\b|\?\.|\?\?/.test(a) && !/[!=]==?\s*(?:null|undefined)\b|\?\.|\?\?/.test(r),
    text: () => 'Dodane zabezpieczenie przed pustą wartością (`null`/`undefined`).',
  },
  { test: (r, a) => /\bthrow\b/.test(a) && !/\bthrow\b/.test(r), text: () => 'Dodane `throw`: przy złych danych kod kończy się czytelnym błędem, zamiast liczyć dalej na śmieciach.' },
  { test: (r, a) => /\b(?:test|it|describe)\s*\(\s*['"`]|\bexpect\(/.test(a) && !/\bexpect\(/.test(r), text: () => 'Dodany test: sprawdza, że kod robi to, co ma robić.' },
  {
    test: (r, a, l) => l === 'ts' && count(a, TYPE_ANN) >= count(r, TYPE_ANN) + 2,
    text: () => 'Dodane typy: TypeScript wyłapie złą wartość, zanim kod się uruchomi.',
  },
]
const TYPE_ANN = /[\w)\]]\s*:\s*(?:string|number|boolean|void|unknown|Promise<|Record<|[A-Z]\w*|\w+\[\])/g
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

/** Opisy rozpoznanych przeróbek (najwyżej 2), np. pętla z `await` → `Promise.all`. */
export function refactorFacts(removed: readonly string[], added: readonly string[], lang: string): string[] {
  const r = removed.join('\n')
  const a = added.join('\n')
  if (!r.trim() && !a.trim()) return []
  return REFACTORS.filter(x => x.test(r, a, lang)).slice(0, 2).map(x => x.text(lang))
}

export function describeChange(removed: readonly string[], added: readonly { line: number; text: string }[], lang: string, conceptName: (id: string) => string | null, isCreate: boolean): string[] {
  const facts: string[] = []
  if (isCreate) facts.push(`Nowy plik, ${added.length} linii.`)
  else facts.push(...refactorFacts(removed, added.map(x => x.text), lang))
  // zmiana jednego tokenu w parze linii usunięta/dodana
  const pairs = Math.min(removed.length, added.length)
  for (let i = 0; i < pairs && facts.length < 3; i++) {
    const a = tokens(removed[i]!)
    const b = tokens(added[i]!.text)
    if (a.length !== b.length || !a.length) continue
    const diff = a.map((t, j) => (t !== b[j] ? j : -1)).filter(j => j >= 0)
    if (diff.length !== 1) continue
    const j = diff[0]!
    const before = a[j]!
    const after = b[j]!
    const expr = added[i]!.text.trim().replace(/\s*\{\s*$/, '').slice(0, 60)
    if (OPS.includes(before) && OPS.includes(after)) facts.push(`Linia ${added[i]!.line}: operator \`${before}\` → \`${after}\` w \`${expr}\`.`)
    else if (/^[\d"'`]/.test(before) && /^[\d"'`]/.test(after)) facts.push(`Linia ${added[i]!.line}: wartość \`${before}\` → \`${after}\`.`)
    else if (/^[A-Za-z_$]/.test(before) && /^[A-Za-z_$]/.test(after)) facts.push(`Linia ${added[i]!.line}: \`${before}\` → \`${after}\`.`)
  }
  const removedLines = removed.map((text, i) => ({ line: i + 1, text }))
  const was = new Set(newSymbols(removedLines))
  const now = newSymbols([...added])
  const fresh = now.filter(s => !was.has(s))
  const gone = [...was].filter(s => !now.includes(s))
  if (fresh.length) facts.push(`Nowe: ${fresh.slice(0, 4).map(s => `\`${s}\``).join(', ')}.`)
  if (gone.length) facts.push(`Usunięte: ${gone.slice(0, 4).map(s => `\`${s}\``).join(', ')}.`)
  const before = new Set(detectConcepts(lang, removedLines).map(h => h.id))
  const appeared = detectConcepts(lang, [...added])
    .filter(h => h.strong && !before.has(h.id) && !BASIC_CONCEPTS.has(h.id))
    .map(h => conceptName(h.id))
    .filter((x): x is string => !!x)
  if (appeared.length) facts.push(`Pojawia się: ${appeared.slice(0, 3).join(', ')}.`)
  if (!facts.length && (removed.length || added.length)) facts.push(`Zmienione linie: +${added.length} −${removed.length}.`)
  return facts.slice(0, 5)
}

/** Pierwsza zmieniona linia (numeracja pliku po zmianie) z unified diff. */
export function firstChangedLine(unified: string): number | null {
  let n = 0
  for (const l of unified.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
    if (h) {
      n = Number(h[1])
      continue
    }
    if (!n) continue
    if (l.startsWith('+') || l.startsWith('-')) return n
    n++
  }
  return null
}

/**
 * Stopniowe podpowiedzi do „Zgadnij zmianę”, z samego diffu: najpierw gdzie, potem co
 * (bez odpowiedzi), a odpowiedzią jest dopiero odsłonięty diff.
 */
export function changeHints(c: { unified: string; facts: string[]; added: number; removed: number }): string[] {
  const out: string[] = []
  const line = firstChangedLine(c.unified)
  out.push(line ? `Zmiana zaczyna się w linii ${line}${c.added + c.removed > 2 ? `, obejmuje ${c.added + c.removed} linii` : ''}.` : `Zmienia się ${c.added + c.removed} linii.`)
  const fact = c.facts[0]
  if (fact) {
    const masked = fact.replace(/→ `[^`]*`( w `[^`]*`)?/, '→ `?`').replace(/^Nowe: .*$/, 'Pojawia się nowa nazwa (funkcja, klasa albo stała).')
    out.push(masked)
  }
  return out
}

/** Języki, które symulator wykonuje krok po kroku. */
export function simDialect(lang: string): 'js' | 'dart' | null {
  if (lang === 'js' || lang === 'ts') return 'js'
  if (lang === 'dart') return 'dart'
  return null
}

/** Grupowanie listy zmian po turach, w kolejności od najnowszej. */
export function groupByTurn(changes: readonly ChangeMeta[]): { key: string; label: string | null; ts: number; items: ChangeMeta[] }[] {
  const groups = new Map<string, { key: string; label: string | null; ts: number; items: ChangeMeta[] }>()
  for (const c of changes) {
    const g = groups.get(c.turnKey) ?? { key: c.turnKey, label: c.turnLabel, ts: c.ts, items: [] }
    g.items.push(c)
    g.ts = Math.max(g.ts, c.ts)
    if (!g.label && c.turnLabel) g.label = c.turnLabel
    groups.set(c.turnKey, g)
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.ts - b.ts)
  return [...groups.values()].sort((a, b) => b.ts - a.ts)
}
