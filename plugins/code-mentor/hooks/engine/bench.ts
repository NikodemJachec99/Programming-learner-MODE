// Laboratorium w zmianie: kilka wersji tego samego kodu (przed, po, alternatywy,
// własne kopie) uruchamianych na jawnych przypadkach. Wszystko w pamięci, w
// symulatorze. Prawdziwy wynik da się sprawdzić tylko przez Claude i testy projektu.

import type { MentorBenchVariant } from '../../types'
import { definesName, looksLikeCall } from '../sim/autocall'
import { simulateCached } from '../ui/simcache'

export type BenchCell = { text: string; kind: 'ok' | 'error' | 'assumed' | 'missing'; /** Linie kolejnych kroków (do animacji). */ trace: number[] }

const BUILTIN = new Set(['console', 'log', 'print', 'await', 'JSON', 'stringify', 'Math', 'String', 'Number', 'Promise', 'Object', 'Array', 'parse'])
const MAX_OUT = 120

export const MAX_VARIANTS = 4
export const MAX_CASES = 6

/** Nazwy funkcji wołanych w przypadku (bez wbudowanych). */
export function calledNames(call: string): string[] {
  return [...new Set([...call.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]!).filter(x => !BUILTIN.has(x)))]
}

/** Przypadek jako instrukcja: gołe wywołanie dostaje wypis wyniku (z await, gdy funkcja jest asynchroniczna). */
export function caseStatement(call: string, dialect: 'js' | 'dart'): string {
  const t = call.trim().replace(/;$/, '')
  if (/^(console\.log|print)\s*\(/.test(t) || /[=;]/.test(t)) return t
  return dialect === 'dart' ? `print(await (${t}));` : `console.log(await (${t}))`
}

/** Jeden przypadek na jednej wersji kodu. */
export function runCase(code: string, call: string, dialect: 'js' | 'dart'): BenchCell {
  const missing = calledNames(call).filter(n => !definesName(code, n, dialect))
  if (missing.length) return { text: `brak \`${missing[0]}\` w tej wersji`, kind: 'missing', trace: [] }
  const r = simulateCached(`${code}\n${caseStatement(call, dialect)}`, dialect)
  const trace = r.steps.slice(0, 400).map(s => s.line)
  if (!r.ok) {
    const msg = r.error?.message ?? 'nie da się wykonać'
    return { text: `błąd: ${msg.length > MAX_OUT ? msg.slice(0, MAX_OUT - 1) + '…' : msg}`, kind: 'error', trace }
  }
  const out = r.output.join(' | ') || '(nic nie wypisało)'
  const text = out.length > MAX_OUT ? out.slice(0, MAX_OUT - 1) + '…' : out
  return { text, kind: r.assumed ? 'assumed' : 'ok', trace }
}

/**
 * Tabela wyników: wiersz to przypadek, kolumna to wersja. `differs` jest prawdą,
 * gdy co najmniej dwie wersje, które dało się uczciwie uruchomić, dały inny wynik.
 */
export function runBench(variants: readonly MentorBenchVariant[], cases: readonly string[], dialect: 'js' | 'dart'): { cells: BenchCell[][]; differs: boolean[] } {
  // klucz to dokładnie to, co wpływa na wynik: kod wersji, przypadki i dialekt
  const key = `${dialect}\u0000${variants.map(v => v.code).join('\u0001')}\u0000${cases.join('\u0001')}`
  const hit = BENCH_CACHE.get(key)
  if (hit) {
    benchStats.hits++
    return hit
  }
  benchStats.computed++
  const cells = cases.map(c => variants.map(v => runCase(v.code, c, dialect)))
  const differs = cells.map(row => new Set(row.filter(x => x.kind === 'ok' || x.kind === 'error').map(x => x.text)).size > 1)
  const res = { cells, differs }
  BENCH_CACHE.set(key, res)
  if (BENCH_CACHE.size > 32) BENCH_CACHE.delete(BENCH_CACHE.keys().next().value as string)
  return res
}

/** Wyniki tabel laboratorium: przerysowanie i klatki animacji nie liczą ich od nowa. */
const BENCH_CACHE = new Map<string, { cells: BenchCell[][]; differs: boolean[] }>()
/** Liczniki do pomiarów i testów: ile tabel policzono, ile wzięto z pamięci. */
export const benchStats = { computed: 0, hits: 0 }

export function validCase(call: string): string | null {
  const t = call.trim()
  if (!t) return 'Wpisz wywołanie, np. label(10).'
  if (!looksLikeCall(t)) return `„${t}” to nie jest wywołanie funkcji. Wpisz np. label(10).`
  if (t.length > 200) return 'Za długie wywołanie (najwyżej 200 znaków).'
  return null
}

const lines = (code: string) => code.split('\n')

export function replaceLine(code: string, line: number, text: string): string {
  const l = lines(code)
  if (line < 1 || line > l.length) return code
  l[line - 1] = text
  return l.join('\n')
}

export function insertLineAfter(code: string, line: number, text = ''): string {
  const l = lines(code)
  l.splice(Math.max(0, Math.min(l.length, line)), 0, text)
  return l.join('\n')
}

export function deleteLine(code: string, line: number): string {
  const l = lines(code)
  if (l.length <= 1 || line < 1 || line > l.length) return code
  l.splice(line - 1, 1)
  return l.join('\n')
}

/** Kolejny wolny identyfikator wersji: A, B, C, D. */
export function nextVariantId(variants: readonly MentorBenchVariant[]): string | null {
  if (variants.length >= MAX_VARIANTS) return null
  return 'ABCDEFGH'.split('').find(id => !variants.some(v => v.id === id)) ?? null
}

/**
 * Prośba do Claude o sprawdzenie przewidywań na prawdziwym kodzie. Claude uruchamia
 * testy przez swoje zwykłe narzędzia i uprawnienia; Mentor niczego nie odpala sam.
 */
export function regressionPrompt(file: string, lang: string, variants: readonly MentorBenchVariant[], cases: readonly string[], cells: BenchCell[][]): string {
  const fence = '```'
  const after = variants.findIndex(v => v.origin === 'after')
  const col = after >= 0 ? after : variants.length - 1
  const rows = cases.map((c, i) => `- \`${c}\` → ${cells[i]?.[col]?.text ?? '?'}`)
  const extra = variants.filter(v => v.origin === 'edit' || v.origin === 'alt')
  return [
    `Sprawdź na prawdziwym kodzie, czy przewidywanie symulatora Mentora się zgadza. Plik: ${file}.`,
    `Przypadki i wynik, który symulator przewiduje dla obecnej wersji (${variants[col]?.label ?? 'po zmianie'}):\n${rows.join('\n')}`,
    ...extra.map(v => `Wersja do porównania „${v.label}” (tylko do testu, nie wstawiaj jej do pliku):\n${fence}${lang}\n${v.code}\n${fence}`),
    'Uruchom istniejące testy tej funkcji. Jeśli żaden nie pokrywa tych przypadków, napisz tymczasowy test z nimi, uruchom go i pokaż wynik obok przewidywania. Zaznacz każdą różnicę i powiedz, skąd się bierze. Nie zmieniaj kodu produkcyjnego.',
  ].join('\n\n')
}
