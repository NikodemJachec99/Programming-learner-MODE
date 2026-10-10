// Naprawa wycinka kodu przed symulacją. Lekcja albo zaznaczenie to często środek
// funkcji: zaczyna się od zamknięcia `}`, ma `catch` bez `try` albo nie domyka
// bloków. Dokładamy tylko brakujące nawiasy (w tych samych liniach, więc numery
// się nie przesuwają) i mówimy wprost, co zostało dodane.

import { parse } from './parser'

const parses = (src: string): boolean => {
  try {
    parse(src)
    return true
  } catch {
    return false
  }
}

/** Domyka nawiasy klamrowe wycinka. Działa na JS/TS i Darcie (ta sama składnia bloków). */
export function healBraces(src: string): { source: string; notes: string[] } {
  const lines = src.split('\n')
  const notes = new Set<string>()
  let prefix = ''
  let depth = 0
  let inTemplate = false
  let inBlockComment = false
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!
    let quote: string | null = null
    for (let j = 0; j < line.length; j++) {
      const c = line[j]!
      const n = line[j + 1]
      if (inBlockComment) {
        if (c === '*' && n === '/') {
          inBlockComment = false
          j++
        }
        continue
      }
      if (inTemplate) {
        if (c === '\\') j++
        else if (c === '`') inTemplate = false
        continue
      }
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = null
        continue
      }
      if (c === '/' && n === '/') break
      if (c === '/' && n === '*') {
        inBlockComment = true
        j++
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        continue
      }
      if (c === '`') {
        inTemplate = true
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        if (depth > 0) {
          depth--
          continue
        }
        const rest = line.slice(j + 1)
        if (/^\s*(catch|finally|on\s+\w+\s+catch|on\s+\w+\s*\{)\b/.test(rest)) {
          prefix += 'try { '
          notes.add('dodane `try {` przed osieroconym `catch`')
        } else if (/^\s*else\b/.test(rest)) {
          prefix += 'if (true) { '
          notes.add('dodane `if (true) {` przed osieroconym `else`')
        } else {
          line = `${line.slice(0, j)} ${line.slice(j + 1)}`
          notes.add('pominięte `}` zamykające blok spoza wycinka')
        }
      }
    }
    lines[i] = line
  }
  if (prefix) lines[0] = prefix + lines[0]
  if (depth > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${'}'.repeat(depth)}`
    notes.add(`domknięte ${depth} ${depth === 1 ? 'otwarty blok' : 'otwarte bloki'} na końcu`)
  }
  return { source: lines.join('\n'), notes: [...notes] }
}

/** Wycinek JS/TS gotowy do symulacji albo oryginał, gdy naprawa nic nie daje. */
export function healJs(src: string): { source: string; notes: string[] } {
  if (parses(src)) return { source: src, notes: [] }
  const b = healBraces(src)
  if (parses(b.source)) return b
  // ostatnia próba: cały wycinek jako ciało funkcji async (np. return poza funkcją w wyrażeniu)
  const lines = b.source.split('\n')
  lines[0] = `(async () => { ${lines[0]}`
  lines[lines.length - 1] = `${lines[lines.length - 1]} })()`
  const wrapped = lines.join('\n')
  if (parses(wrapped)) return { source: wrapped, notes: [...b.notes, 'wycinek uruchomiony jako ciało funkcji async'] }
  return { source: src, notes: [] }
}
