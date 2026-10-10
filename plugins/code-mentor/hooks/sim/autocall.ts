// Wywołanie z przykładowymi danymi dla kodu, który tylko definiuje funkcje
// (typowy fragment z lekcji albo zmiany). Bez tego symulator kończy się po
// pierwszym kroku i nic nie pokazuje. Dane dobieramy z typu i nazwy parametru.

export type AutoCall = { call: string; label: string; name: string }

type Fn = { name: string; params: string; isAsync: boolean; exported: boolean; pos: number }

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if ('([{<'.includes(ch)) depth++
    else if (')]}>'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(x => x.trim()).filter(Boolean)
}

/** Przykładowa wartość w składni JS/Darta dla parametru o danej nazwie i typie. */
export function sampleValue(name: string, type: string, dialect: 'js' | 'dart'): string {
  const t = type.replace(/\s+/g, '').replace(/\?$/, '')
  const n = name.toLowerCase()
  const q = (s: string) => (dialect === 'dart' ? `'${s}'` : `"${s}"`)
  const strFor = () => (/email|mail/.test(n) ? q('ala@example.com') : /url|link/.test(n) ? q('https://example.com') : /id$|^id|key|code/.test(n) ? q('1') : /name|user|author/.test(n) ? q('Ala') : /date|day/.test(n) ? q('2026-10-08') : q('tekst'))
  const numFor = () => (/price|amount|total|cost/.test(n) ? '9.99' : /age/.test(n) ? '30' : /id$|^id/.test(n) ? '1' : /count|limit|size|len|^n$|max|min/.test(n) ? '3' : /^x$|^y$|value|num|score/.test(n) ? '10' : '5')
  if (/^(string\[\]|Array<string>|List<String>)$/i.test(t)) return /id/.test(n) ? `[${q('1')}, ${q('2')}]` : `[${q('a')}, ${q('b')}]`
  if (/^(number\[\]|Array<number>|List<(int|double|num)>)$/i.test(t)) return '[1, 2, 3]'
  if (/\[\]$|^Array<|^List</.test(t)) return '[]'
  if (/^(string|String)$/.test(t)) return strFor()
  if (/^(number|int|num|bigint)$/.test(t)) return numFor()
  if (/^double$/.test(t)) return '2.5'
  if (/^(boolean|bool)$/.test(t)) return 'true'
  if (/^(Map|Record)/.test(t) || /^\{/.test(t)) return '{}'
  if (/^(Date|DateTime)$/.test(t)) return dialect === 'dart' ? 'DateTime.now()' : 'new Date(0)'
  if (t && /^[A-Z]/.test(t)) return '{}'
  // bez typu: z nazwy
  if (/s$|list|items|ids|arr|values/.test(n) && !/status|class|address|pass/.test(n)) return /id/.test(n) ? `[${q('1')}, ${q('2')}]` : '[1, 2, 3]'
  if (/^(is|has|should|can)[A-Z_]|flag|enabled/.test(name)) return 'true'
  if (/name|text|str|email|url|title|label|msg|message|id$/.test(n)) return strFor()
  return numFor()
}

function findFunctions(src: string, dialect: 'js' | 'dart'): Fn[] {
  const out: Fn[] = []
  const add = (m: RegExpExecArray, name: string, params: string, isAsync: boolean, exported: boolean) => out.push({ name, params, isAsync, exported, pos: m.index })
  if (dialect === 'js') {
    const fnRe = /^(export\s+(?:default\s+)?)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(([^)]*)\)/gm
    for (let m; (m = fnRe.exec(src)); ) add(m, m[3]!, m[4]!, !!m[2], !!m[1])
    const arrowRe = /^(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*(?::[^=]+)?=>/gm
    for (let m; (m = arrowRe.exec(src)); ) add(m, m[2]!, m[4] ?? m[5] ?? '', !!m[3], !!m[1])
  } else {
    const dRe = /^(?:Future<[^>]*>|Stream<[^>]*>|void|int|double|num|String|bool|dynamic|List<[^>]*>|Map<[^>]*>|[A-Z]\w*(?:<[^>]*>)?\??)\s+([a-z_]\w*)\s*\(([^)]*)\)\s*(async\s*)?[{=]/gm
    for (let m; (m = dRe.exec(src)); ) add(m, m[1]!, m[2]!, !!m[3], true)
  }
  return out.sort((a, b) => a.pos - b.pos)
}

/** Czy fragment sam coś wywołuje na najwyższym poziomie (wtedy nie dokładamy wywołania). */
function hasTopLevelCall(src: string, dialect: 'js' | 'dart'): boolean {
  if (dialect === 'dart' && /^\s*(?:Future<void>|void)?\s*main\s*\(/m.test(src)) return true
  return src.split('\n').some(l => /^[A-Za-z_$][\w$.]*\s*\(.*\)\s*;?\s*$/.test(l) && !/^(if|for|while|switch|function|return)\b/.test(l)) || /^(?:await\s+)?[A-Za-z_$][\w$.]*\([^)]*\)\.then\(/m.test(src)
}

/**
 * Wywołanie dla fragmentu, który tylko definiuje funkcje. Wybieramy funkcję, której
 * nikt inny w fragmencie nie woła (zwykle ta „główna”), preferując eksportowaną.
 */
export function autoCall(src: string, dialect: 'js' | 'dart'): AutoCall | null {
  if (hasTopLevelCall(src, dialect)) return null
  const fns = findFunctions(src, dialect)
  if (!fns.length) return null
  const calledInside = (f: Fn) => fns.some(g => g !== f && new RegExp(`\\b${f.name}\\s*\\(`).test(src.slice(g.pos)))
  const roots = fns.filter(f => !calledInside(f))
  const pick = (roots.find(f => f.exported) ?? roots[roots.length - 1] ?? fns[fns.length - 1])!
  const args = splitTop(pick.params).map(p => {
    if (dialect === 'dart') {
      const m = /^(?:required\s+)?(?:final\s+)?([\w<>?, ]+?)\s+(\w+)(?:\s*=.*)?$/.exec(p.replace(/[{}[\]]/g, '').trim())
      return m ? sampleValue(m[2]!, m[1]!, 'dart') : '5'
    }
    const clean = p.replace(/^\.\.\./, '')
    const [lhs, def] = clean.split(/=(.*)/s)
    if (def !== undefined && def.trim()) return def.trim()
    const [nm, ty] = lhs!.split(/:(.*)/s)
    return sampleValue(nm!.replace(/\?$/, '').trim(), (ty ?? '').trim(), 'js')
  })
  const expr = `${pick.name}(${args.join(', ')})`
  const print = dialect === 'dart' ? 'print' : 'console.log'
  return { call: `${print}(${pick.isAsync ? 'await ' : ''}${expr})`, label: expr, name: pick.name }
}

const BUILTIN_CALLS = new Set(['console', 'log', 'print', 'await', 'JSON', 'stringify', 'Math', 'String', 'Number', 'Promise', 'Object', 'Array'])

/** Czy fragment definiuje funkcję (albo klasę) o tej nazwie. */
export function definesName(src: string, name: string, dialect: 'js' | 'dart'): boolean {
  if (findFunctions(src, dialect).some(f => f.name === name)) return true
  const n = name.replace(/[$]/g, '\\$')
  return new RegExp(`\\b(?:class|function)\\s+${n}\\b|\\b(?:const|let|var|final)\\s+${n}\\s*=`).test(src)
}

export type PairCall = { call: string | null; label: string | null; problem: string | null }

/**
 * Jedno wywołanie dla A i B, żeby porównanie miało sens. Bierze wpisane albo automatyczne
 * (najpierw z B, potem z A), ale tylko takie, którego funkcje istnieją w obu wersjach.
 * Gdy takiego nie ma, oddaje `problem` zamiast porównywać błąd ustawienia testu.
 */
export function pairCall(a: string, b: string, dialect: 'js' | 'dart', typed = ''): PairCall {
  const okIn = (call: string) => {
    const names = [...call.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]!).filter(x => !BUILTIN_CALLS.has(x))
    return names.filter(x => !definesName(a, x, dialect) || !definesName(b, x, dialect))
  }
  const t = typed.trim()
  if (t && looksLikeCall(t)) {
    const missing = okIn(t)
    return missing.length ? { call: null, label: t, problem: `\`${missing[0]}\` nie istnieje w obu wersjach, więc to wywołanie nie sprawdzi A i B na tych samych danych.` } : { call: t, label: t, problem: null }
  }
  const ab = autoCall(b, dialect)
  const aa = autoCall(a, dialect)
  if (!ab && !aa) return { call: null, label: null, problem: null }
  const pick = [ab, aa].find((c): c is AutoCall => !!c && !okIn(c.call).length)
  if (pick) return { call: pick.call, label: pick.label, problem: null }
  return {
    call: null,
    label: null,
    problem: `A i B nie mają wspólnej funkcji do uruchomienia (${aa?.name ?? 'brak'} i ${ab?.name ?? 'brak'}), więc porównanie byłoby porównaniem błędów, a nie działania. Wpisz wywołanie, które działa w obu wersjach.`,
  }
}

/** Czy tekst wpisany jako wywołanie wygląda na wywołanie albo instrukcję (a nie np. samą nazwę). */
export function looksLikeCall(text: string): boolean {
  const t = text.trim()
  return /[A-Za-z_$][\w$.]*\s*\(/.test(t) || /[=;]/.test(t)
}
