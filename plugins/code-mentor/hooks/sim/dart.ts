// Dart w symulatorze. Tłumaczy podzbiór Darta na podzbiór JS, który wykonuje
// interpreter w dialekcie 'dart' (print, int.parse, Future, wyjątki Darta).
// Każdy token zostaje w swojej linii, więc kroki wskazują linie oryginału.
// Czego nie umiemy przetłumaczyć wiernie, zgłaszamy jako nieobsługiwane.

export class DartUnsupported extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message)
  }
}

type Kind = 'ws' | 'nl' | 'com' | 'str' | 'num' | 'id' | 'p'
type Part = { text: string } | { expr: string; line: number }
type Tok = { k: Kind; v: string; line: number; start: number; parts?: Part[]; raw?: boolean; triple?: boolean }

const PUNCT = ['>>>=', '...?', '~/=', '??=', '?..', '...', '~/', '??', '?.', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '..', '<<', '|=', '&=', '^=']

function scan(src: string, line0 = 1): Tok[] {
  const out: Tok[] = []
  let i = 0
  let line = line0
  const push = (k: Kind, v: string, start: number, extra?: Partial<Tok>) => out.push({ k, v, line, start, ...extra })
  while (i < src.length) {
    const c = src[i]!
    const start = i
    if (c === '\n') {
      push('nl', '\n', start)
      line++
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      let j = i
      while (j < src.length && ' \t\r\f'.includes(src[j]!)) j++
      push('ws', src.slice(i, j), start)
      i = j
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i)
      if (j < 0) j = src.length
      push('com', src.slice(i, j), start)
      i = j
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j < 0 ? src.length : j + 2
      const v = src.slice(i, j)
      push('com', v, start)
      line += (v.match(/\n/g) ?? []).length
      i = j
      continue
    }
    const raw = (c === 'r' || c === 'R') && (src[i + 1] === '"' || src[i + 1] === "'") && !/[\w$]/.test(src[i - 1] ?? '')
    if (c === '"' || c === "'" || raw) {
      const q0 = raw ? i + 1 : i
      const q = src[q0]!
      const triple = src.slice(q0, q0 + 3) === q.repeat(3)
      const close = triple ? q.repeat(3) : q
      let j = q0 + close.length
      const parts: Part[] = []
      let text = ''
      let cur = line
      for (;;) {
        if (j >= src.length || (!triple && src[j] === '\n')) throw new DartUnsupported('Niezamknięty napis', line)
        if (src.startsWith(close, j)) {
          j += close.length
          break
        }
        const ch = src[j]!
        if (ch === '\\' && !raw) {
          if (src[j + 1] === '\n') cur++
          text += src.slice(j, j + 2)
          j += 2
          continue
        }
        if (ch === '$' && !raw) {
          if (src[j + 1] === '{') {
            let depth = 1
            let k = j + 2
            while (k < src.length && depth > 0) {
              const d = src[k]!
              if (d === '{') depth++
              else if (d === '}') depth--
              else if (d === '"' || d === "'") {
                const e = src.indexOf(d, k + 1)
                k = e < 0 ? src.length : e
              }
              if (depth > 0) k++
            }
            if (depth > 0) throw new DartUnsupported('Niezamknięte ${…} w napisie', cur)
            if (text) parts.push({ text })
            text = ''
            parts.push({ expr: src.slice(j + 2, k), line: cur })
            j = k + 1
            continue
          }
          const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(j + 1, j + 80))
          if (m) {
            if (text) parts.push({ text })
            text = ''
            parts.push({ expr: m[0], line: cur })
            j += 1 + m[0].length
            continue
          }
        }
        if (ch === '\n') cur++
        text += ch
        j++
      }
      if (text) parts.push({ text })
      push('str', src.slice(i, j), start, { parts, raw, triple })
      line = cur
      i = j
      continue
    }
    const num = /^(0[xX][0-9a-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/.exec(src.slice(i, i + 64))
    if (num && !/[\w$]/.test(src[i - 1] ?? '')) {
      push('num', num[0], start)
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 256))
    if (id) {
      push('id', id[0], start)
      i += id[0].length
      continue
    }
    const p = PUNCT.find(x => src.startsWith(x, i)) ?? c
    push('p', p, start)
    i += p.length
  }
  return out
}

type ClassInfo = { name: string; members: Set<string>; statics: Set<string>; getters: Set<string>; hasSuper: boolean; superName: string | null }
type Ctx = { cls: ClassInfo | null; locals: Set<string> | null }
type Param = { name: string; group: 'pos' | 'opt' | 'named'; isThis: boolean; required: boolean; def: [number, number] | null }

const NOT_TYPE = new Set(['return', 'throw', 'await', 'yield', 'else', 'case', 'default', 'new', 'assert', 'break', 'continue', 'rethrow', 'if', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'in', 'is', 'as', 'this', 'super', 'true', 'false', 'null', 'print'])
const NOT_NAME = new Set([...NOT_TYPE, 'var', 'final', 'const', 'late', 'static', 'get', 'set', 'operator'])
const RESERVED_GETTERS = new Set(['length', 'isEmpty', 'isNotEmpty', 'first', 'last', 'single', 'keys', 'values', 'entries', 'hashCode', 'runtimeType', 'name', 'index', 'message', 'reversed', 'isEven', 'isOdd', 'isNegative', 'sign', 'isNaN', 'inMilliseconds', 'inSeconds', 'inMinutes'])
const EXPR_PREV = new Set(['(', ',', '=', ':', '=>', '[', '??', '?', '&&', '||', '+=', '-=', '??=', '!'])
const BLOCK_PREV = new Set(['else', 'try', 'finally', 'do', 'async'])
const CONTINUE = new Set(['else', 'catch', 'finally', 'on', 'while'])
const CALL_KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'throw', 'else', 'case', 'in', 'is', 'as'])

class Tx {
  private S: number[] = []
  private out: string[]
  private pre: string[]
  private post: string[]
  private owned = new Set<number>()
  private match: number[] = []
  private deferred: (() => void)[] = []
  private exprBraces = new Set<number>()
  hasMain = false

  constructor(
    private toks: Tok[],
    readonly classes: Map<string, ClassInfo>,
    readonly getters: Set<string>,
  ) {
    this.out = toks.map(t => t.v)
    this.pre = toks.map(() => '')
    this.post = toks.map(() => '')
    toks.forEach((t, i) => {
      if (t.k !== 'ws' && t.k !== 'nl' && t.k !== 'com') this.S.push(i)
    })
    const stack: number[] = []
    for (let p = 0; p < this.S.length; p++) {
      const v = this.v(p)
      if (this.t(p).k !== 'p') continue
      if (v === '(' || v === '[' || v === '{') stack.push(p)
      else if (v === ')' || v === ']' || v === '}') {
        const o = stack.pop()
        const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
        if (o === undefined || this.v(o) !== pair[v]) throw new DartUnsupported(`Niesparowany nawias ${v}`, this.t(p).line)
        this.match[o] = p
        this.match[p] = o
      }
    }
    if (stack.length) throw new DartUnsupported(`Niezamknięty nawias ${this.v(stack[stack.length - 1]!)}`, this.t(stack[stack.length - 1]!).line)
  }

  // ---------- pomocnicze ----------
  private t(p: number): Tok {
    return this.toks[this.S[p] ?? -1] ?? { k: 'p', v: '', line: this.toks[this.toks.length - 1]?.line ?? 1, start: 0 }
  }
  private v(p: number): string {
    return p >= 0 && p < this.S.length ? this.toks[this.S[p]!]!.v : ''
  }
  private isP(p: number, s: string): boolean {
    return p >= 0 && this.t(p).k === 'p' && this.v(p) === s
  }
  private isId(p: number, s?: string): boolean {
    return p >= 0 && p < this.S.length && this.t(p).k === 'id' && (s === undefined || this.v(p) === s)
  }
  private isName(p: number): boolean {
    return this.isId(p) && !NOT_NAME.has(this.v(p))
  }
  private line(p: number): number {
    return this.t(p).line
  }
  private fail(msg: string, p: number): never {
    throw new DartUnsupported(msg, this.line(p))
  }
  private set(p: number, s: string): void {
    this.out[this.S[p]!] = s
  }
  private prepend(p: number, s: string): void {
    this.pre[this.S[p]!] = s + this.pre[this.S[p]!]
  }
  private append(p: number, s: string): void {
    this.post[this.S[p]!] += s
  }
  /** Czyści tokeny [a, b] (pozycje znaczące), zostawia znaki nowej linii. */
  private blank(a: number, b: number, own = true): void {
    if (a > b) return
    for (let i = this.S[a]!; i <= this.S[b]!; i++) {
      const t = this.toks[i]!
      if (t.k === 'nl') continue
      this.out[i] = t.v.replace(/[^\n]/g, '')
      this.pre[i] = ''
      this.post[i] = ''
    }
    if (own) for (let p = a; p <= b; p++) this.owned.add(p)
  }
  private own(a: number, b: number): void {
    for (let p = a; p <= b; p++) this.owned.add(p)
  }
  /** Tekst JS dla zakresu pozycji (po przekształceniach), w jednej linii. */
  private text(a: number, b: number): string {
    let s = ''
    for (let i = this.S[a]!; i <= this.S[b]!; i++) s += this.pre[i]! + this.out[i]! + this.post[i]!
    return s.replace(/\s*\n\s*/g, ' ').trim()
  }
  /** Pierwsza pozycja z danym tokenem na głębokości 0, licząc od p. */
  private find(p: number, end: number, pred: (q: number) => boolean): number {
    for (let q = p; q < end; q++) {
      if (pred(q)) return q
      const v = this.v(q)
      if ((v === '(' || v === '[' || v === '{') && this.t(q).k === 'p') q = this.match[q]!
    }
    return -1
  }
  /** Przecinek na głębokości 0 z pominięciem argumentów typu Map<K, V>. */
  private comma(p: number, end: number): number {
    let angle = 0
    for (let q = p; q < end; q++) {
      if (this.isP(q, '<') && this.isId(q - 1) && this.typeArgsEnd(q) > 0) angle++
      else if (this.isP(q, '>') && angle > 0) angle--
      else if (angle === 0 && this.isP(q, ',')) return q
      const v = this.v(q)
      if ((v === '(' || v === '[' || v === '{') && this.t(q).k === 'p') q = this.match[q]!
    }
    return -1
  }
  private semi(p: number, end: number): number {
    const s = this.find(p, end, q => this.isP(q, ';'))
    if (s < 0) this.fail('Brak średnika na końcu instrukcji', p)
    return s
  }

  /** Koniec typu zaczynającego się w p (pozycja za typem) albo p, gdy to nie typ. */
  private typeEnd(p: number): number {
    if (!this.isId(p) || NOT_TYPE.has(this.v(p))) return p
    let r = p + 1
    if (this.v(p) === 'Function' && this.isP(r, '(')) return this.isP(this.match[r]! + 1, '?') ? this.match[r]! + 2 : this.match[r]! + 1
    if (this.isP(r, '.') && this.isId(r + 1) && !this.isP(r + 2, '(')) r += 2
    if (this.isP(r, '<')) {
      const e = this.typeArgsEnd(r)
      if (e < 0) return p
      r = e
    }
    if (this.isP(r, '?')) r++
    if (this.isId(r, 'Function') && this.isP(r + 1, '(')) {
      r = this.match[r + 1]! + 1
      if (this.isP(r, '?')) r++
    }
    return r
  }
  private typeArgsEnd(r: number): number {
    let d = 0
    for (let x = r; x < this.S.length; x++) {
      if (this.isP(x, '<')) d++
      else if (this.isP(x, '>')) {
        d--
        if (d === 0) return x + 1
      } else if (this.isP(x, '(') && this.isId(x - 1, 'Function')) x = this.match[x]!
      else if (!(this.isId(x) || this.isP(x, ',') || this.isP(x, '.') || this.isP(x, '?'))) return -1
    }
    return -1
  }
  private exprPosition(p: number): boolean {
    if (p === 0) return true
    const prev = p - 1
    if (this.t(prev).k === 'p') return EXPR_PREV.has(this.v(prev))
    return this.isId(prev, 'return') || this.isId(prev, 'await')
  }
  private isClosure(p: number): boolean {
    if (!this.isP(p, '(') || !this.exprPosition(p)) return false
    const a = this.match[p]! + 1
    return this.isP(a, '{') || this.isP(a, '=>') || (this.isId(a, 'async') && (this.isP(a + 1, '{') || this.isP(a + 1, '=>')))
  }
  private isBlockBrace(p: number): boolean {
    const prev = p - 1
    if (prev < 0) return true
    if (this.isP(prev, ')')) return true
    if (this.isId(prev) && BLOCK_PREV.has(this.v(prev))) return true
    return this.isP(prev, ';') || this.isP(prev, '}')
  }
  private skipAnnotation(p: number): number {
    let q = p + 1
    while (this.isId(q) && this.isP(q + 1, '.')) q += 2
    q++
    if (this.isP(q, '(')) q = this.match[q]! + 1
    this.blank(p, q - 1)
    return q
  }

  // ---------- przebieg strukturalny ----------
  program(): void {
    this.collectClasses()
    this.block(0, this.S.length, { cls: null, locals: null }, true)
    this.finish()
    if (this.hasMain) {
      let last = this.S.length - 1
      if (last >= 0) this.append(last, ' main();')
    }
  }
  expression(ctx: Ctx): void {
    this.scan(0, this.S.length, ctx, false)
    this.finish()
  }
  private finish(): void {
    this.passA()
    for (const d of this.deferred) d()
  }

  private collectClasses(): void {
    for (let p = 0; p < this.S.length; p++) {
      if (this.isP(p, '{')) {
        p = this.match[p]!
        continue
      }
      if (!this.isId(p, 'class') || !this.isId(p + 1)) continue
      const name = this.v(p + 1)
      const brace = this.find(p, this.S.length, q => this.isP(q, '{'))
      if (brace < 0) continue
      const ext = this.find(p, brace, q => this.isId(q, 'extends'))
      const cls: ClassInfo = { name, members: new Set(), statics: new Set(), getters: new Set(), hasSuper: ext >= 0, superName: ext >= 0 ? this.v(ext + 1) : null }
      this.classes.set(name, cls)
      let m = brace + 1
      const close = this.match[brace]!
      while (m < close) m = this.member(m, close, cls, false)
      p = close
    }
    // pola i metody klasy bazowej są dostępne bez this. także w podklasie
    for (let round = 0; round < 8; round++) {
      for (const cls of this.classes.values()) {
        const sup = cls.superName ? this.classes.get(cls.superName) : undefined
        if (!sup) continue
        for (const m of sup.members) cls.members.add(m)
        for (const g of sup.getters) cls.getters.add(g)
      }
    }
  }

  private block(p: number, end: number, ctx: Ctx, top = false): void {
    while (p < end) p = this.statement(p, end, ctx, top)
  }

  private statement(p: number, end: number, ctx: Ctx, top: boolean): number {
    if (this.isP(p, ';')) return p + 1
    if (this.isP(p, '{')) {
      this.block(p + 1, this.match[p]!, ctx)
      return this.match[p]! + 1
    }
    if (this.isP(p, '@')) return this.skipAnnotation(p)
    const w = this.v(p)
    if (top && ['import', 'export', 'library', 'part', 'typedef'].includes(w) && this.isId(p)) {
      const s = this.semi(p, end)
      this.blank(p, s)
      return s + 1
    }
    if (this.isId(p) && ['mixin', 'extension'].includes(w) && this.isId(p + 1)) this.fail(`${w} nie jest obsługiwane w symulatorze`, p)
    if (this.isId(p) && (w === 'class' || (['abstract', 'sealed', 'base', 'interface', 'final'].includes(w) && this.find(p, Math.min(end, p + 4), q => this.isId(q, 'class')) >= 0))) {
      if (!top) this.fail('Klasa wewnątrz funkcji', p)
      return this.classDecl(p)
    }
    if (this.isId(p, 'enum') && this.isId(p + 1)) return this.enumDecl(p)
    const r = this.varDecl(p, end, ctx, false)
    if (r >= 0) return r
    const f = this.funcDecl(p, end, ctx, top)
    if (f >= 0) return f
    return this.scan(p, end, ctx, true)
  }

  /** Ogólny przegląd instrukcji albo wyrażenia: bloki, zmienne lokalne, this. */
  private scan(p: number, end: number, ctx: Ctx, stmt: boolean): number {
    let depth = 0
    while (p < end) {
      const tk = this.t(p)
      if (tk.k === 'str') {
        this.set(p, this.strJs(tk, ctx))
        p++
        continue
      }
      if (tk.k === 'id') {
        const w = tk.v
        if (w === 'switch' && this.isP(p + 1, '(') && this.isP(this.match[p + 1]! + 1, '{')) {
          if (this.exprPosition(p)) this.fail('Wyrażenie switch (Dart 3) nie jest obsługiwane, użyj instrukcji switch albo if', p)
          const c = this.match[p + 1]!
          this.scan(p + 2, c, ctx, false)
          const close = this.match[c + 1]!
          this.switchBody(c + 1, close, ctx)
          p = close + 1
          if (stmt && depth === 0) return p
          continue
        }
        p = this.ident(p, ctx)
        continue
      }
      if (tk.k === 'p') {
        const v = tk.v
        if (v === '{') {
          const close = this.match[p]!
          const isBlock = this.isBlockBrace(p)
          if (isBlock) this.block(p + 1, close, ctx)
          else {
            this.exprBraces.add(p)
            this.scan(p + 1, close, ctx, false)
          }
          p = close + 1
          if (stmt && depth === 0 && isBlock && !(this.isId(p) && CONTINUE.has(this.v(p)))) return p
          continue
        }
        if (v === '(') {
          if (this.isClosure(p) && ctx.locals) for (const n of this.closureParams(p)) ctx.locals.add(n.name)
          depth++
        } else if (v === '[') depth++
        else if (v === ')' || v === ']') depth--
        else if (v === ';' && stmt && depth === 0) return p + 1
        else if (v === '..' || v === '?..') this.fail('Kaskady (..) nie są obsługiwane, rozpisz wywołania osobno', p)
        else if (v === '...?') this.fail('...? nie jest obsługiwane, użyj ...(lista ?? [])', p)
        else if (v === '~/=') this.fail('~/= nie jest obsługiwane, napisz x = x ~/ y', p)
      }
      p++
    }
    return p
  }

  private ident(p: number, ctx: Ctx): number {
    const w = this.v(p)
    switch (w) {
      case 'for':
        if (this.isId(p - 1, 'await')) this.fail('await for (strumienie) nie jest obsługiwane', p)
        if (this.isP(p - 1, '[') || this.isP(p - 1, ',') || (this.isP(p - 1, '{') && this.exprBraces.has(p - 1))) this.fail('for wewnątrz literału kolekcji nie jest obsługiwane', p)
        if (this.isP(p + 1, '(')) return this.forHeader(p + 1, ctx)
        return p + 1
      case 'if':
        if (this.isP(p - 1, '[') || this.isP(p - 1, ',') || (this.isP(p - 1, '{') && this.exprBraces.has(p - 1))) this.fail('if wewnątrz literału kolekcji nie jest obsługiwane', p)
        return p + 1
      case 'catch':
        if (this.isP(p + 1, '(')) {
          const c = this.match[p + 1]!
          if (this.isId(p + 2)) ctx.locals?.add(this.v(p + 2))
          if (this.isP(p + 3, ',')) this.blank(p + 3, c - 1)
        }
        return p + 1
      case 'on': {
        if (!this.isP(p - 1, '}')) break
        const te = this.typeEnd(p + 1)
        if (this.isId(te, 'catch')) this.blank(p, te - 1)
        else if (this.isP(te, '{')) {
          this.blank(p + 1, te - 1)
          this.set(p, 'catch (_e)')
          this.own(p, p)
        }
        return te
      }
      case 'rethrow':
        this.fail('rethrow nie jest obsługiwane, użyj throw e', p)
      case 'yield':
        this.fail('yield (generatory) nie jest obsługiwane', p)
      case 'async':
      case 'sync':
        if (this.isP(p + 1, '*')) this.fail(`${w}* (generatory, Stream) nie jest obsługiwane`, p)
        return p + 1
    }
    const cls = ctx.cls
    if (cls && !this.isP(p - 1, '.') && !this.isP(p - 1, '?.') && !ctx.locals?.has(w) && !(this.isP(p + 1, ':') && (this.isP(p - 1, '(') || this.isP(p - 1, ',')))) {
      if (cls.statics.has(w)) this.prepend(p, `${cls.name}.`)
      else if (cls.members.has(w)) {
        this.prepend(p, 'this.')
        if (cls.getters.has(w) && !this.isP(p + 1, '(')) this.append(p, '()')
      }
    }
    return p + 1
  }

  private forHeader(open: number, ctx: Ctx): number {
    const close = this.match[open]!
    const inPos = this.find(open + 1, close, q => this.isId(q, 'in'))
    const r = this.varDecl(open + 1, close, ctx, true)
    if (inPos >= 0) {
      this.set(inPos, 'of')
      this.own(inPos, inPos)
      this.scan(inPos + 1, close, ctx, false)
    } else this.scan(r >= 0 ? r : open + 1, close, ctx, false)
    return close + 1
  }

  private switchBody(open: number, close: number, ctx: Ctx): void {
    if (this.find(open + 1, close, q => this.isP(q, '=>')) >= 0) this.fail('Wyrażenie switch (Dart 3) nie jest obsługiwane', open)
    let p = open + 1
    let started = false
    let nonEmpty = false
    let terminal = false
    while (p < close) {
      if (this.isId(p, 'case') || this.isId(p, 'default')) {
        if (started && nonEmpty && !terminal) this.prepend(p, 'break; ')
        const colon = this.find(p + 1, close, q => this.isP(q, ':'))
        if (colon < 0) this.fail('Brak dwukropka po case', p)
        if (this.find(p + 1, colon, q => this.isP(q, '||') || this.isP(q, '&&') || this.isId(q, 'when') || this.isId(q, 'var') || this.isId(q, 'final')) >= 0) this.fail('Wzorce w case (Dart 3) nie są obsługiwane', p)
        this.scan(p + 1, colon, ctx, false)
        started = true
        nonEmpty = false
        p = colon + 1
        continue
      }
      nonEmpty = true
      terminal = ['break', 'return', 'throw', 'continue'].includes(this.v(p)) && this.isId(p)
      p = this.statement(p, close, ctx, false)
    }
  }

  private varDecl(p: number, end: number, ctx: Ctx, inFor: boolean): number {
    let q = p
    const late = this.isId(q, 'late')
    if (late) q++
    const mod = this.isId(q) && ['final', 'const', 'var'].includes(this.v(q)) ? this.v(q) : null
    if (mod) q++
    if (!mod && !late && NOT_TYPE.has(this.v(p))) return -1
    if (this.isP(q, '(')) {
      if (mod) this.fail('Destrukturyzacja i rekordy (Dart 3) nie są obsługiwane', q)
      return -1
    }
    const declEnd = (x: number) => this.isP(x, '=') || this.isP(x, ';') || this.isP(x, ',') || (inFor && this.isId(x, 'in'))
    let nameP = -1
    if (this.isName(q) && declEnd(q + 1) && (mod || late)) nameP = q
    else {
      const r = this.typeEnd(q)
      if (r > q && this.isName(r) && declEnd(r + 1)) nameP = r
    }
    if (nameP < 0) return -1
    const hasInit = this.isP(nameP + 1, '=')
    const kw = (mod === 'final' || mod === 'const') && !late && hasInit ? 'const' : 'let'
    this.blank(p, nameP - 1)
    this.set(p, `${kw} `)
    ctx.locals?.add(this.v(nameP))
    if (!hasInit && !late && !inFor) this.append(nameP, ' = null')
    if (inFor) return nameP + 1
    return this.scan(nameP + 1, end, ctx, true)
  }

  private funcDecl(p: number, end: number, ctx: Ctx, top: boolean): number {
    if (NOT_TYPE.has(this.v(p))) return -1
    const r = this.typeEnd(p)
    let nameP = -1
    if (r > p && this.isName(r) && (this.isP(r + 1, '(') || this.isP(r + 1, '<'))) nameP = r
    else if (this.isName(p) && this.isP(p + 1, '(')) nameP = p
    if (nameP < 0) return -1
    let open = nameP + 1
    if (this.isP(open, '<')) {
      const te = this.typeArgsEnd(open)
      if (te < 0) return -1
      open = te
    }
    if (!this.isP(open, '(')) return -1
    const close = this.match[open]!
    let b = close + 1
    let isAsync = false
    if (this.isId(b, 'async')) {
      if (this.isP(b + 1, '*')) this.fail('async* (Stream) nie jest obsługiwane', b)
      isAsync = true
      b++
    }
    if (this.isId(b, 'sync') && this.isP(b + 1, '*')) this.fail('sync* (generatory) nie jest obsługiwane', b)
    if (!this.isP(b, '{') && !this.isP(b, '=>')) return -1
    const name = this.v(nameP)
    if (top && name === 'main') this.hasMain = true
    this.blank(p, open - 1)
    this.set(p, `${isAsync ? 'async ' : ''}function ${name}`)
    if (isAsync) this.blank(b - 1, b - 1)
    return this.body(open, close, b, end, { cls: ctx.cls, locals: new Set(ctx.locals ?? []) })
  }

  /** Parametry i ciało funkcji, metody albo konstruktora. */
  private body(open: number, close: number, b: number, end: number, fctx: Ctx, extraPrologue: () => string = () => ''): number {
    const params = this.params(open, close, fctx)
    for (const x of params) fctx.locals!.add(x.name)
    const header = () => {
      const pos = params.filter(x => x.group !== 'named').map(x => (x.def ? `${x.name} = ${this.text(x.def[0], x.def[1])}` : x.group === 'opt' ? `${x.name} = null` : x.name))
      const named = params.filter(x => x.group === 'named')
      if (named.length) pos.push('named = {}')
      const pro: string[] = []
      for (const x of named) pro.push(`let ${x.name} = "${x.name}" in named ? named.${x.name} : ${x.def ? this.text(x.def[0], x.def[1]) : 'null'};`)
      return { head: `(${pos.join(', ')})`, pro: [extraPrologue(), ...pro, ...params.filter(x => x.isThis).map(x => `this.${x.name} = ${x.name};`)].filter(Boolean).join(' ') }
    }
    this.deferred.push(() => {
      const h = header()
      for (const x of params) if (x.def) this.blank(x.def[0], x.def[1], false)
      this.set(open, h.head)
      if (this.isP(b, '{') && h.pro) this.append(b, ` ${h.pro}`)
      if (this.isP(b, '=>')) this.set(b, `{ ${h.pro ? h.pro + ' ' : ''}return`)
      if (this.isP(b, ';')) this.set(b, ` { ${h.pro} }`)
    })
    if (this.isP(b, '{')) {
      const c = this.match[b]!
      this.block(b + 1, c, fctx)
      return c + 1
    }
    if (this.isP(b, '=>')) {
      const s = this.semi(b + 1, end)
      this.own(b, b)
      this.set(s, '; }')
      this.own(s, s)
      this.scan(b + 1, s, fctx, false)
      return s + 1
    }
    return b + 1
  }

  private params(open: number, close: number, ctx: Ctx): Param[] {
    const out: Param[] = []
    this.blank(open, close)
    let group: Param['group'] = 'pos'
    let p = open + 1
    while (p < close) {
      if (this.isP(p, '[') || this.isP(p, '{')) {
        group = this.isP(p, '[') ? 'opt' : 'named'
        p++
        continue
      }
      if (this.isP(p, ']') || this.isP(p, '}') || this.isP(p, ',')) {
        p++
        continue
      }
      const limit = group === 'pos' ? close : this.find(p, close, q => this.isP(q, ']') || this.isP(q, '}'))
      let itemEnd = this.comma(p, limit < 0 ? close : limit)
      if (itemEnd < 0) itemEnd = limit < 0 ? close : limit
      let x = p
      let required = false
      while (this.isId(x) && ['required', 'final', 'covariant', 'var'].includes(this.v(x)) && x + 1 < itemEnd) {
        if (this.v(x) === 'required') required = true
        x++
      }
      if (this.isId(x, 'super')) this.fail('Parametry super.x nie są obsługiwane, przekaż wartość przez super(...)', x)
      const defAt = this.find(x, itemEnd, q => this.isP(q, '=') || (group === 'named' && this.isP(q, ':')))
      const nameEnd = defAt < 0 ? itemEnd : defAt
      const isThis = this.isId(x, 'this') && this.isP(x + 1, '.')
      const nameP = isThis ? x + 2 : nameEnd - 1
      if (this.isP(nameP, ')')) this.fail('Parametr funkcyjny w starym zapisie, użyj typu Function', nameP)
      if (!this.isId(nameP)) this.fail('Nie rozpoznaję parametru', p)
      const def: [number, number] | null = defAt >= 0 && defAt + 1 <= itemEnd - 1 ? [defAt + 1, itemEnd - 1] : null
      if (def) {
        for (let q = def[0]; q <= def[1]; q++) this.owned.delete(q)
        const nested: Ctx = { cls: ctx.cls, locals: ctx.locals }
        this.scan(def[0], def[1] + 1, nested, false)
        // pole ustawione już przez blank: przywróć tekst wartości domyślnej
        for (let i = this.S[def[0]]!; i <= this.S[def[1]]!; i++) if (this.out[i] === '' && this.toks[i]!.k !== 'nl') this.out[i] = this.toks[i]!.k === 'str' ? this.strJs(this.toks[i]!, nested) : this.toks[i]!.v
      }
      out.push({ name: this.v(nameP), group, isThis, required, def })
      p = itemEnd
    }
    return out
  }

  private closureParams(p: number): { name: string; from: number; to: number; def: number }[] {
    const close = this.match[p]!
    const out: { name: string; from: number; to: number; def: number }[] = []
    let x = p + 1
    while (x < close) {
      if (this.isP(x, '{') || this.isP(x, '[')) this.fail('Parametry nazwane i opcjonalne w funkcji anonimowej nie są obsługiwane', x)
      let e = this.comma(x, close)
      if (e < 0) e = close
      const d = this.find(x, e, q => this.isP(q, '='))
      const nameP = (d < 0 ? e : d) - 1
      if (this.isId(nameP)) out.push({ name: this.v(nameP), from: x, to: nameP - 1, def: d })
      x = e + 1
    }
    return out
  }

  private classDecl(p: number): number {
    let q = p
    while (!this.isId(q, 'class')) q++
    this.blank(p, q - 1)
    const name = this.v(q + 1)
    const cls = this.classes.get(name)!
    const brace = this.find(q, this.S.length, x => this.isP(x, '{'))
    let r = q + 2
    if (this.isP(r, '<')) this.blank(r, this.typeArgsEnd(r) - 1)
    const ext = this.find(q, brace, x => this.isId(x, 'extends'))
    if (this.find(q, brace, x => this.isId(x, 'with')) >= 0) this.fail('Mixiny (with) nie są obsługiwane', q)
    if (ext >= 0) {
      const te = this.typeEnd(ext + 1)
      this.blank(ext + 2, te - 1)
      r = te
    }
    const impl = this.find(q, brace, x => this.isId(x, 'implements'))
    if (impl >= 0) this.blank(impl, brace - 1)
    this.own(q, brace)
    const close = this.match[brace]!
    const statics: { name: string; def: [number, number] | null }[] = []
    let m = brace + 1
    while (m < close) m = this.member(m, close, cls, true, statics)
    if (statics.length) {
      this.deferred.push(() => {
        const parts = statics.map(s => `${name}.${s.name} = ${s.def ? this.text(s.def[0], s.def[1]) : 'null'};`)
        for (const s of statics) if (s.def) this.blank(s.def[0], s.def[1], false)
        this.append(close, ` ${parts.join(' ')}`)
      })
    }
    return close + 1
  }

  private member(m: number, close: number, cls: ClassInfo, emit: boolean, statics: { name: string; def: [number, number] | null }[] = []): number {
    let q = m
    if (this.isP(q, ';')) return q + 1
    while (this.isP(q, '@')) {
      if (emit) q = this.skipAnnotation(q)
      else {
        q++
        while (this.isId(q) && this.isP(q + 1, '.')) q += 2
        q++
        if (this.isP(q, '(')) q = this.match[q]! + 1
      }
    }
    let isStatic = false
    let late = false
    while (this.isId(q) && ['static', 'late', 'final', 'const', 'var', 'external', 'covariant', 'abstract'].includes(this.v(q)) && !this.isP(q + 1, '(')) {
      if (this.v(q) === 'static') isStatic = true
      if (this.v(q) === 'late') late = true
      if (this.v(q) === 'external') this.fail('external nie jest obsługiwane', q)
      q++
    }
    const fctx = (): Ctx => ({ cls, locals: new Set() })
    // factory Klasa.nazwa(...) => metoda statyczna
    if (this.isId(q, 'factory')) {
      if (!(this.isId(q + 1, cls.name) && this.isP(q + 2, '.') && this.isId(q + 3) && this.isP(q + 4, '('))) this.fail('Konstruktor factory bez nazwy nie jest obsługiwany, użyj factory Klasa.nazwa(...)', q)
      const name = this.v(q + 3)
      if (!emit) {
        cls.statics.add(name)
        return this.memberEnd(q + 4)
      }
      this.blank(m, q + 2)
      this.set(q + 3, `static ${name}`)
      const close2 = this.match[q + 4]!
      return this.body(q + 4, close2, close2 + 1, close, fctx())
    }
    // konstruktor
    if (this.isId(q, cls.name) && (this.isP(q + 1, '(') || this.isP(q + 1, '.'))) {
      if (this.isP(q + 1, '.')) this.fail(`Nazwany konstruktor ${cls.name}.${this.v(q + 2)} nie jest obsługiwany, użyj factory albo zwykłego konstruktora`, q)
      if (!emit) return this.memberEnd(q + 1)
      return this.ctor(m, q, close, cls)
    }
    const r = this.typeEnd(q)
    // getter
    let getP = -1
    if (this.isId(q, 'get') && this.isName(q + 1) && !this.isP(q + 1, '(')) getP = q
    else if (r > q && this.isId(r, 'get') && this.isName(r + 1)) getP = r
    if (getP >= 0) {
      const name = this.v(getP + 1)
      if (!emit) {
        ;(isStatic ? cls.statics : cls.members).add(name)
        cls.getters.add(name)
        if (!RESERVED_GETTERS.has(name)) this.getters.add(name)
        return this.memberEnd(getP + 2)
      }
      this.blank(m, getP)
      this.set(getP + 1, `${isStatic ? 'static ' : ''}${this.isId(getP + 2, 'async') ? 'async ' : ''}${name}()`)
      let b = getP + 2
      if (this.isId(b, 'async')) {
        this.blank(b, b)
        b++
      }
      return this.getterBody(b, close, fctx())
    }
    if (this.isId(q, 'set') || (r > q && this.isId(r, 'set'))) this.fail('Settery (set) nie są obsługiwane, użyj zwykłej metody', q)
    if (this.isId(q, 'operator') || (r > q && this.isId(r, 'operator'))) this.fail('Przeciążanie operatorów nie jest obsługiwane', q)
    // metoda
    let nameP = -1
    if (r > q && this.isName(r) && (this.isP(r + 1, '(') || this.isP(r + 1, '<'))) nameP = r
    else if (this.isName(q) && (this.isP(q + 1, '(') || (this.isP(q + 1, '<') && this.isP(this.typeArgsEnd(q + 1), '(')))) nameP = q
    if (nameP >= 0) {
      const name = this.v(nameP)
      let open = nameP + 1
      if (this.isP(open, '<')) open = this.typeArgsEnd(open)
      if (!emit) {
        ;(isStatic ? cls.statics : cls.members).add(name)
        return this.memberEnd(open)
      }
      const c = this.match[open]!
      let b = c + 1
      const isAsync = this.isId(b, 'async')
      if (isAsync) {
        if (this.isP(b + 1, '*')) this.fail('async* (Stream) nie jest obsługiwane', b)
        b++
      }
      if (this.isP(b, ';')) {
        this.blank(m, b)
        return b + 1
      }
      this.blank(m, open - 1)
      this.set(nameP, `${isStatic ? 'static ' : ''}${isAsync ? 'async ' : ''}${name}`)
      if (isAsync) this.blank(b - 1, b - 1)
      return this.body(open, c, b, close, fctx())
    }
    // pole
    let fieldP = -1
    const declEnd = (x: number) => this.isP(x, '=') || this.isP(x, ';') || this.isP(x, ',')
    if (r > q && this.isName(r) && declEnd(r + 1)) fieldP = r
    else if (this.isName(q) && declEnd(q + 1)) fieldP = q
    if (fieldP < 0) this.fail('Nie rozpoznaję tej składowej klasy', q)
    const s = this.semi(fieldP, close)
    const decls: { nameP: number; def: [number, number] | null }[] = []
    let x = fieldP
    while (x < s) {
      const e0 = this.comma(x, s)
      const e = e0 < 0 ? s : e0
      decls.push({ nameP: x, def: this.isP(x + 1, '=') ? [x + 2, e - 1] : null })
      x = e + 1
    }
    if (!emit) {
      for (const d of decls) (isStatic ? cls.statics : cls.members).add(this.v(d.nameP))
      return s + 1
    }
    const plain: Ctx = { cls: null, locals: null }
    if (isStatic) {
      this.blank(m, s)
      for (const d of decls) {
        if (d.def) {
          for (let y = d.def[0]; y <= d.def[1]; y++) this.owned.delete(y)
          this.scan(d.def[0], d.def[1] + 1, plain, false)
          for (let i = this.S[d.def[0]]!; i <= this.S[d.def[1]]!; i++) if (this.toks[i]!.k !== 'nl' && this.out[i] === '') this.out[i] = this.toks[i]!.k === 'str' ? this.strJs(this.toks[i]!, plain) : this.toks[i]!.v
        }
        statics.push({ name: this.v(d.nameP), def: d.def })
      }
      return s + 1
    }
    this.blank(m, fieldP - 1)
    for (const d of decls) {
      if (!d.def && !late) this.append(d.nameP, ' = null')
      if (d.def) this.scan(d.def[0], d.def[1] + 1, plain, false)
    }
    for (let y = fieldP; y < s; y++) if (this.isP(y, ',') && decls.some(d => d.def ? d.def[1] + 1 === y : d.nameP + 1 === y)) this.set(y, ';')
    return s + 1
  }

  private memberEnd(open: number): number {
    let b = this.isP(open, '(') ? this.match[open]! + 1 : open
    while (this.isId(b) || this.isP(b, '*')) b++
    if (this.isP(b, ':')) b = this.find(b, this.S.length, x => this.isP(x, '{') || this.isP(x, ';') || this.isP(x, '=>'))
    if (this.isP(b, '{')) return this.match[b]! + 1
    if (this.isP(b, '=>')) return this.semi(b, this.S.length) + 1
    if (this.isP(b, ';')) return b + 1
    return this.fail('Nie rozpoznaję tej składowej klasy', open)
  }

  private getterBody(b: number, close: number, ctx: Ctx): number {
    if (this.isP(b, '=>')) {
      const s = this.semi(b + 1, close)
      this.set(b, '{ return')
      this.set(s, '; }')
      this.own(b, b)
      this.own(s, s)
      this.scan(b + 1, s, ctx, false)
      return s + 1
    }
    if (this.isP(b, '{')) {
      const c = this.match[b]!
      this.block(b + 1, c, ctx)
      return c + 1
    }
    return this.fail('Nie rozpoznaję ciała gettera', b)
  }

  private ctor(m: number, q: number, close: number, cls: ClassInfo): number {
    const open = q + 1
    const c = this.match[open]!
    let b = c + 1
    const inits: { name: string; def: [number, number] }[] = []
    let superArgs: [number, number] | null = null
    let hasSuperCall = false
    const ctx: Ctx = { cls: null, locals: new Set() }
    if (this.isP(b, ':')) {
      const e = this.find(b, close, x => this.isP(x, '{') || this.isP(x, ';'))
      let x = b + 1
      while (x < e) {
        let ie = this.find(x, e, y => this.isP(y, ','))
        if (ie < 0) ie = e
        if (this.isId(x, 'super') && this.isP(x + 1, '(')) {
          hasSuperCall = true
          const so = x + 1
          if (this.match[so]! - 1 >= so + 1) superArgs = [so + 1, this.match[so]! - 1]
        } else if (this.isId(x, 'assert')) {
          // asercje w liście inicjalizacyjnej pomijamy
        } else {
          const t0 = this.isId(x, 'this') && this.isP(x + 1, '.') ? x + 2 : x
          if (!this.isId(t0) || !this.isP(t0 + 1, '=')) this.fail('Nie rozpoznaję listy inicjalizacyjnej konstruktora', x)
          inits.push({ name: this.v(t0), def: [t0 + 2, ie - 1] })
        }
        x = ie + 1
      }
      this.blank(b, e - 1)
      b = e
    }
    this.blank(m, q)
    this.set(q, 'constructor')
    const scanRange = (r: [number, number]) => {
      for (let y = r[0]; y <= r[1]; y++) this.owned.delete(y)
      this.scan(r[0], r[1] + 1, ctx, false)
      for (let i = this.S[r[0]]!; i <= this.S[r[1]]!; i++) if (this.toks[i]!.k !== 'nl' && this.out[i] === '') this.out[i] = this.toks[i]!.k === 'str' ? this.strJs(this.toks[i]!, ctx) : this.toks[i]!.v
    }
    if (superArgs) scanRange(superArgs)
    for (const i of inits) scanRange(i.def)
    const pro = () => {
      const parts: string[] = []
      if (hasSuperCall || cls.hasSuper) parts.push(`super(${superArgs ? this.text(superArgs[0], superArgs[1]) : ''});`)
      for (const i of inits) parts.push(`this.${i.name} = ${this.text(i.def[0], i.def[1])};`)
      if (superArgs) this.blank(superArgs[0], superArgs[1], false)
      for (const i of inits) this.blank(i.def[0], i.def[1], false)
      return parts.join(' ')
    }
    // super() musi być pierwsze, więc prolog listy inicjalizacyjnej idzie przed przypisaniami this.x = x
    let first = ''
    const r = this.body(open, c, b, close, { cls, locals: ctx.locals }, () => first)
    const last = this.deferred.pop()!
    this.deferred.push(() => {
      first = pro()
      last()
    })
    return r
  }

  private enumDecl(p: number): number {
    const name = this.v(p + 1)
    const brace = p + 2
    if (!this.isP(brace, '{')) this.fail('Nie rozpoznaję enuma', p)
    const close = this.match[brace]!
    const items: string[] = []
    for (let x = brace + 1; x < close; x++) {
      if (this.isP(x, ';') || this.isP(x, '(')) this.fail('Rozszerzone enumy (pola, konstruktory) nie są obsługiwane', x)
      if (this.isId(x)) items.push(this.v(x))
    }
    this.blank(p, close)
    this.set(p, `class ${name} { constructor(name, index) { this.name = name; this.index = index; } toString() { return "${name}." + this.name; } }`)
    this.append(close, ` ${items.map((x, i) => `${name}.${x} = new ${name}("${x}", ${i});`).join(' ')} ${name}.values = [${items.map(x => `${name}.${x}`).join(', ')}];`)
    return close + 1
  }

  // ---------- napisy ----------
  strJs(t: Tok, ctx: Ctx | null): string {
    const parts = t.parts ?? []
    if (!t.triple && parts.every(x => 'text' in x)) {
      const text = parts.map(x => ('text' in x ? x.text : '')).join('')
      if (t.raw) return JSON.stringify(text)
      let s = ''
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        if (ch === '\\') {
          s += text.slice(i, i + 2)
          i++
        } else s += ch === '"' ? '\\"' : ch
      }
      return `"${s}"`
    }
    let body = ''
    for (const part of t.parts ?? []) {
      if ('text' in part) {
        if (t.raw) body += part.text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
        else {
          let s = ''
          for (let i = 0; i < part.text.length; i++) {
            const ch = part.text[i]!
            if (ch === '\\') {
              s += part.text.slice(i, i + 2)
              i++
            } else if (ch === '`') s += '\\`'
            else s += ch
          }
          body += s
        }
      } else body += '${' + transpileExpr(part.expr, ctx ?? { cls: null, locals: null }, part.line, this.classes, this.getters) + '}'
    }
    if (t.triple && /^[ \t]*\r?\n/.test(body)) body = '\\' + body.replace(/^[ \t]*/, '')
    return '`' + body + '`'
  }

  // ---------- przebieg wyrażeń ----------
  private passA(): void {
    for (let p = 0; p < this.S.length; p++) {
      if (this.owned.has(p)) continue
      const tk = this.t(p)
      if (tk.k === 'str' && this.out[this.S[p]!] === tk.v) this.set(p, this.strJs(tk, null))
      if (tk.k === 'num' && tk.v.includes('_')) this.set(p, tk.v.replace(/_/g, ''))
      if (tk.k === 'p') {
        switch (tk.v) {
          case '==':
            this.set(p, '===')
            break
          case '!=':
            this.set(p, '!==')
            break
          case '~/': {
            let L = this.operandStart(p - 1)
            while (['*', '/', '%', '~/'].some(o => this.isP(L - 1, o))) L = this.operandStart(L - 2)
            this.prepend(L, 'intDiv(')
            this.set(p, ',')
            this.append(this.operandEnd(p + 1), ')')
            break
          }
          case '!': {
            const prev = p - 1
            if (prev >= 0 && this.S[prev]! === this.S[p]! - 1 && (this.isId(prev) || this.isP(prev, ')') || this.isP(prev, ']')) && !NOT_TYPE.has(this.v(prev))) {
              this.prepend(this.operandStart(prev), 'nullCheck(')
              this.set(p, ')')
            }
            break
          }
          case '<': {
            if (!(this.isId(p - 1) || this.exprPosition(p))) break
            const e = this.typeArgsEnd(p)
            if (e > 0 && (this.isP(e, '(') || this.isP(e, '[') || this.isP(e, '{') || (this.isP(e, '.') && this.isId(p - 1)))) this.blank(p, e - 1, false)
            break
          }
          case '(':
            if (this.isClosure(p)) this.closure(p)
            else if (this.isId(p - 1) ? !CALL_KW.has(this.v(p - 1)) : this.isP(p - 1, ')') || this.isP(p - 1, ']') || this.isP(p - 1, '>')) this.namedArgs(p)
            break
          case '{':
            if (this.exprBraces.has(p)) this.literal(p)
            break
        }
      } else if (tk.k === 'id') {
        const w = tk.v
        const afterOperand = this.isId(p - 1) || this.isP(p - 1, ')') || this.isP(p - 1, ']') || this.t(p - 1).k === 'num' || this.t(p - 1).k === 'str'
        if (w === 'is' && afterOperand) {
          const neg = this.isP(p + 1, '!')
          const ts = neg ? p + 2 : p + 1
          const te = this.typeEnd(ts)
          if (te > ts) {
            this.prepend(this.operandStart(p - 1), `${neg ? '!' : ''}isType(`)
            this.set(p, `, "${this.v(ts)}")`)
            this.blank(p + 1, te - 1, false)
            p = te - 1
          }
        } else if (w === 'as' && afterOperand) {
          const te = this.typeEnd(p + 1)
          if (te > p + 1) {
            this.blank(p, te - 1, false)
            p = te - 1
          }
        } else if (w === 'const' || w === 'new') {
          if (w === 'const') this.set(p, '')
        } else if (this.getters.has(w) && (this.isP(p - 1, '.') || this.isP(p - 1, '?.')) && !this.isP(p + 1, '(') && !this.isP(p + 1, '=')) {
          this.append(p, '()')
        }
      }
    }
  }

  private operandStart(q: number): number {
    for (;;) {
      if (this.isP(q, ')') || this.isP(q, ']')) {
        q = this.match[q]!
        if (this.isId(q - 1) && !CALL_KW.has(this.v(q - 1))) q--
        else if (this.isP(q - 1, ')') || this.isP(q - 1, ']')) {
          q--
          continue
        }
      }
      if ((this.isP(q - 1, '.') || this.isP(q - 1, '?.')) && q - 2 >= 0) {
        q -= 2
        continue
      }
      if (this.isP(q - 1, '-') && (q - 2 < 0 || (this.t(q - 2).k === 'p' && !this.isP(q - 2, ')') && !this.isP(q - 2, ']')))) q--
      return q
    }
  }

  private operandEnd(q: number): number {
    if (this.isP(q, '-') || this.isP(q, '!')) q++
    if (this.isP(q, '(') || this.isP(q, '[')) q = this.match[q]!
    for (;;) {
      if (this.isP(q + 1, '(') || this.isP(q + 1, '[')) q = this.match[q + 1]!
      else if ((this.isP(q + 1, '.') || this.isP(q + 1, '?.')) && this.isId(q + 2)) q += 2
      else if (this.isP(q + 1, '!') && this.S[q + 1]! === this.S[q]! + 1) q++
      else return q
    }
  }

  private closure(p: number): void {
    const close = this.match[p]!
    for (const prm of this.closureParams(p)) if (prm.to >= prm.from) this.blank(prm.from, prm.to, false)
    let a = close + 1
    if (this.isId(a, 'async')) {
      this.blank(a, a, false)
      this.prepend(p, 'async ')
      a++
    }
    if (this.isP(a, '{')) this.prepend(a, '=> ')
  }

  private namedArgs(p: number): void {
    const close = this.match[p]!
    let first = -1
    let x = p + 1
    while (x < close) {
      let e = this.find(x, close, q => this.isP(q, ','))
      if (e < 0) e = close
      const named = this.isId(x) && this.isP(x + 1, ':')
      if (named && first < 0) first = x
      if (!named && first >= 0 && x < e) this.fail('Argument pozycyjny po nazwanym nie jest obsługiwany', x)
      x = e + 1
    }
    if (first < 0) return
    this.prepend(first, '{ ')
    this.prepend(close, ' }')
  }

  private literal(p: number): void {
    const close = this.match[p]!
    if (close === p + 1) return
    const items: [number, number][] = []
    let x = p + 1
    while (x < close) {
      let e = this.find(x, close, q => this.isP(q, ','))
      if (e < 0) e = close
      if (x < e) items.push([x, e - 1])
      x = e + 1
    }
    const colon = (it: [number, number]) => this.find(it[0], it[1] + 1, q => this.isP(q, ':'))
    if (items.some(it => colon(it) >= 0)) {
      for (const it of items) {
        const c = colon(it)
        if (c < 0) continue
        const k = this.t(it[0]).k
        if (c === it[0] + 1 && (k === 'str' || k === 'num')) continue
        this.prepend(it[0], '[')
        this.prepend(c, ']')
      }
      return
    }
    this.set(p, 'Set.of([')
    this.set(close, '])')
  }

  // ---------- wynik ----------
  result(): { js: string; map: { js: [number, number]; dart: [number, number] }[] } {
    let js = ''
    const map: { js: [number, number]; dart: [number, number] }[] = []
    for (let i = 0; i < this.toks.length; i++) {
      js += this.pre[i]!
      const t = this.toks[i]!
      if (t.k !== 'ws' && t.k !== 'nl' && t.k !== 'com' && this.out[i]) map.push({ js: [js.length, js.length + this.out[i]!.length], dart: [t.start, t.start + t.v.length] })
      js += this.out[i]! + this.post[i]!
    }
    return { js, map }
  }
}

function transpileExpr(src: string, ctx: Ctx, line: number, classes: Map<string, ClassInfo>, getters: Set<string>): string {
  const tx = new Tx(scan(src, line), classes, getters)
  tx.expression(ctx)
  return tx.result().js.replace(/\n/g, ' ')
}

export type DartTranspile = { ok: true; js: string; map: { js: [number, number]; dart: [number, number] }[] } | { ok: false; error: string; line: number }

export function dartToJs(src: string): DartTranspile {
  try {
    const tx = new Tx(scan(src), new Map(), new Set())
    tx.program()
    const r = tx.result()
    return { ok: true, js: r.js, map: r.map }
  } catch (e) {
    if (e instanceof DartUnsupported) return { ok: false, error: e.message, line: e.line }
    return { ok: false, error: e instanceof Error ? e.message : String(e), line: 1 }
  }
}

/** Czy tekst wygląda na Darta (a nie JS/TS). */
export function looksLikeDart(src: string): boolean {
  let dart = 0
  let js = 0
  if (/\bvoid\s+main\s*\(/.test(src)) dart += 3
  if (/^\s*import\s+['"](package|dart):/m.test(src)) dart += 3
  if (/\b(final|late)\s+[A-Za-z_]/.test(src)) dart += 2
  if (/(^|[;{]\s*)(int|double|String|bool|num|List<[^>]*>|Map<[^>]*>)\s+[a-z_]\w*\s*[=;]/m.test(src)) dart += 2
  if (/\bprint\s*\(/.test(src)) dart += 1
  if (/\b(Widget\s+build|StatelessWidget|StatefulWidget|setState\s*\()/.test(src)) dart += 3
  if (/\bFuture<|\bawait\s+Future\./.test(src)) dart += 2
  if (/'[^'\n]*\$[A-Za-z_{][^'\n]*'/.test(src)) dart += 1
  if (/~\//.test(src)) dart += 2
  if (/\bconsole\.\w+\(|\bfunction\b|\b(let|const)\s+\w+\s*=|=>\s*\{[^}]*\bconst\b|===|!==|\bundefined\b|\brequire\(/.test(src)) js += 3
  return dart >= 2 && dart > js
}

/** Kod interfejsu Fluttera: drzewo widgetów, nie da się go wykonać bez silnika. */
export function isFlutterUi(src: string): boolean {
  return /\b(StatelessWidget|StatefulWidget|Widget\s+build\s*\(|runApp\s*\(|MaterialApp\s*\(|Scaffold\s*\()/.test(src)
}

const NOT_WIDGETS = new Set(['EdgeInsets', 'TextStyle', 'Colors', 'Color', 'BorderRadius', 'Radius', 'Border', 'BorderSide', 'BoxDecoration', 'BoxShadow', 'Offset', 'Size', 'Duration', 'Icons', 'FontWeight', 'TextEditingController', 'ThemeData', 'ColorScheme', 'Key', 'ValueKey', 'GlobalKey', 'MaterialPageRoute', 'Uri', 'DateTime', 'Future', 'Stream', 'List', 'Map', 'Set', 'Alignment', 'MainAxisAlignment', 'CrossAxisAlignment', 'BoxConstraints', 'RoundedRectangleBorder', 'LinearGradient', 'Navigator', 'MediaQuery', 'Theme', 'Exception', 'FormatException', 'StateError', 'ArgumentError', 'Curves', 'TextAlign', 'BoxFit'])

export type WidgetNode = { name: string; line: number; depth: number; slot: string | null }

/** Drzewo widgetów z kodu Fluttera: zagnieżdżone wywołania konstruktorów. */
export function widgetTree(src: string, limit = 60): WidgetNode[] {
  let toks: Tok[]
  try {
    toks = scan(src).filter(t => t.k !== 'ws' && t.k !== 'nl' && t.k !== 'com')
  } catch {
    return []
  }
  const out: WidgetNode[] = []
  const stack: number[] = []
  let parens = 0
  for (let i = 0; i < toks.length && out.length < limit; i++) {
    const t = toks[i]!
    if (t.k === 'p' && (t.v === '(' || t.v === '[')) parens++
    else if (t.k === 'p' && (t.v === ')' || t.v === ']')) {
      parens--
      while (stack.length && stack[stack.length - 1]! > parens) stack.pop()
    }
    if (t.k !== 'id' || !/^[A-Z]/.test(t.v) || NOT_WIDGETS.has(t.v)) continue
    let j = i + 1
    let name = t.v
    if (toks[j]?.v === '.' && toks[j + 1]?.k === 'id' && toks[j + 2]?.v === '(') {
      name += `.${toks[j + 1]!.v}`
      j += 2
    }
    if (toks[j]?.v !== '(' || toks[i - 1]?.v === '.' || toks[i - 1]?.v === 'class' || toks[i - 1]?.v === 'extends' || toks[i - 1]?.v === 'new') continue
    const back = toks[i - 1]?.v === 'const' || toks[i - 1]?.v === 'new' ? 2 : 1
    const prev = toks[i - back]
    const slot = prev?.v === ':' && toks[i - back - 1]?.k === 'id' ? toks[i - back - 1]!.v : prev?.v === '[' || prev?.v === ',' ? (stack.length ? 'children' : null) : null
    if (prev?.v === 'return' || prev?.v === '=>' || stack.length || slot) {
      out.push({ name, line: t.line, depth: stack.length, slot })
      stack.push(parens + 1)
    }
    i = j - 1
  }
  return out
}
