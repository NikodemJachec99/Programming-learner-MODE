// Lexer podzbioru JavaScript/TypeScript dla symulatora.
// Każdy token zna swoją pozycję w źródle, bo warianty "what-if" podmieniają
// operatory i literały dokładnie w tym miejscu, bez zgadywania.

export type TokenType = 'num' | 'str' | 'template' | 'regex' | 'ident' | 'kw' | 'punct' | 'eof'

export type TemplatePart = { kind: 'text'; text: string } | { kind: 'expr'; source: string; offset: number }

export type Token = {
  type: TokenType
  value: string
  start: number
  end: number
  line: number
  col: number
  /** Tylko dla 'template': części tekstu i wyrażeń. */
  parts?: TemplatePart[]
  /** Tylko dla 'regex': flagi (np. g, i). Wzorzec jest w `value`. */
  flags?: string
  /** Czy przed tokenem był znak nowej linii (dla ASI po return). */
  nlBefore: boolean
}

export class SimSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(message)
  }
}

const KEYWORDS = new Set([
  'let', 'const', 'var', 'function', 'return', 'if', 'else', 'while', 'do', 'for', 'of', 'in',
  'break', 'continue', 'true', 'false', 'null', 'undefined', 'typeof', 'async', 'await',
  'throw', 'try', 'catch', 'finally', 'new', 'class', 'extends', 'this', 'super', 'switch',
  'case', 'default', 'import', 'export', 'from', 'interface', 'type', 'enum', 'void', 'delete',
  'instanceof',
])

/** Po tych słowach kluczowych `/` zaczyna wyrażenie regularne, a nie dzielenie. */
const REGEX_AFTER_KW = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'await', 'instanceof'])

/** Czy w tym miejscu `/` otwiera literał regex: na początku wyrażenia, a nie po wartości. */
function regexAllowed(prev: Token | undefined): boolean {
  if (!prev) return true
  if (prev.type === 'punct') return ![')', ']', '}', '++', '--'].includes(prev.value)
  if (prev.type === 'kw') return REGEX_AFTER_KW.has(prev.value)
  return false
}

const PUNCTS = [
  '>>>=', '===', '!==', '**=', '...', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '**', '<<', '>>', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '=', '!', '?', ':',
  '.', '&', '|', '^', '~', '@',
]

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  let nl = false
  const err = (msg: string): never => {
    throw new SimSyntaxError(msg, line, i - lineStart + 1)
  }
  const push = (type: TokenType, value: string, start: number, extra?: Partial<Token>) => {
    out.push({ type, value, start, end: i, line: startLine, col: start - startLineStart + 1, nlBefore: nl, ...extra })
    nl = false
  }
  let startLine = 1
  let startLineStart = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '\n') {
      i++
      line++
      lineStart = i
      nl = true
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++
          lineStart = i + 1
          nl = true
        }
        i++
      }
      i += 2
      continue
    }
    startLine = line
    startLineStart = lineStart
    const start = i
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      if (c === '0' && /[xXbBoO]/.test(src[i + 1] ?? '')) {
        i += 2
        while (/[0-9a-fA-F_]/.test(src[i] ?? '')) i++
      } else {
        while (/[0-9_]/.test(src[i] ?? '')) i++
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
          i++
          while (/[0-9_]/.test(src[i] ?? '')) i++
        }
        if (/[eE]/.test(src[i] ?? '')) {
          i++
          if (/[+-]/.test(src[i] ?? '')) i++
          while (/[0-9]/.test(src[i] ?? '')) i++
        }
      }
      if (src[i] === 'n') err('BigInt nie jest obsługiwany w symulatorze')
      push('num', src.slice(start, i).replace(/_/g, ''), start)
      continue
    }
    if (/[A-Za-z_$À-ɏ]/.test(c)) {
      while (/[A-Za-z0-9_$À-ɏ]/.test(src[i] ?? '')) i++
      const word = src.slice(start, i)
      push(KEYWORDS.has(word) ? 'kw' : 'ident', word, start)
      continue
    }
    if (c === '"' || c === "'") {
      i++
      let s = ''
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\n') err('Niezamknięty napis')
        if (src[i] === '\\') {
          s += unescape(src[i + 1] ?? '')
          i += 2
        } else {
          s += src[i]
          i++
        }
      }
      if (src[i] !== c) err('Niezamknięty napis')
      i++
      push('str', s, start)
      continue
    }
    if (c === '`') {
      i++
      const parts: TemplatePart[] = []
      let text = ''
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          text += unescape(src[i + 1] ?? '')
          i += 2
          continue
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          if (text) parts.push({ kind: 'text', text })
          text = ''
          i += 2
          const exprStart = i
          let depth = 1
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            if (depth > 0) i++
          }
          parts.push({ kind: 'expr', source: src.slice(exprStart, i), offset: exprStart })
          i++
          continue
        }
        if (src[i] === '\n') {
          line++
          lineStart = i + 1
        }
        text += src[i]
        i++
      }
      if (src[i] !== '`') err('Niezamknięty template literal')
      i++
      if (text) parts.push({ kind: 'text', text })
      push('template', src.slice(start, i), start, { parts })
      continue
    }
    if (c === '/' && regexAllowed(out[out.length - 1])) {
      i++
      let inClass = false
      while (i < src.length && (src[i] !== '/' || inClass)) {
        if (src[i] === '\n') err('Niezamknięte wyrażenie regularne')
        if (src[i] === '\\') i++
        else if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        i++
      }
      if (src[i] !== '/') err('Niezamknięte wyrażenie regularne')
      const body = src.slice(start + 1, i)
      i++
      const fs = i
      while (/[a-z]/.test(src[i] ?? '')) i++
      const flags = src.slice(fs, i)
      try {
        new RegExp(body, flags)
      } catch {
        err(`Niepoprawne wyrażenie regularne /${body}/${flags}`)
      }
      push('regex', body, start, { flags })
      continue
    }
    const p = PUNCTS.find(p => src.startsWith(p, i))
    if (!p) err(`Nieznany znak '${c}'`)
    i += p!.length
    push('punct', p!, start)
  }
  startLine = line
  startLineStart = lineStart
  out.push({ type: 'eof', value: '', start: i, end: i, line, col: i - lineStart + 1, nlBefore: nl })
  return out
}

function unescape(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case 'r':
      return '\r'
    case '0':
      return '\0'
    default:
      return ch
  }
}
