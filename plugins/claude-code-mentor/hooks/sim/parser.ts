// Parser podzbioru JS/TS (rekurencyjne zejście + precedence climbing).
// Adnotacje typów TS są pomijane: symulator wykonuje semantykę JS,
// bo TypeScript po kompilacji jest JavaScriptem.

import type { Expr, FuncNode, ObjProp, Param, Pattern, Program, SpreadEl, Stmt } from './ast'
import { SimSyntaxError, tokenize } from './lexer'
import type { Token } from './lexer'

const BIN_PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '===': 7,
  '!==': 7,
  '<': 8,
  '>': 8,
  '<=': 8,
  '>=': 8,
  instanceof: 8,
  in: 8,
  '<<': 9,
  '>>': 9,
  '>>>': 9,
  '+': 10,
  '-': 10,
  '*': 11,
  '/': 11,
  '%': 11,
  '**': 12,
}

type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '&=', '|=', '^='])

export function parse(source: string): Program {
  const p = new Parser(source)
  return { body: p.program(), source }
}

/** Parsuje pojedyncze wyrażenie (np. warunek w eksploratorze warunków). */
export function parseExpression(source: string): Expr {
  const p = new Parser(source)
  const e = p.expression()
  p.expectEof()
  return e
}

class Parser {
  private toks: Token[]
  private i = 0
  private noIn = false

  constructor(private src: string) {
    this.toks = tokenize(src)
  }

  private get t(): Token {
    return this.toks[this.i]!
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)]!
  }
  private is(value: string, type?: Token['type']): boolean {
    const t = this.t
    return t.value === value && (type ? t.type === type : t.type === 'punct' || t.type === 'kw')
  }
  private eat(value: string): boolean {
    if (this.is(value)) {
      this.i++
      return true
    }
    return false
  }
  private fail(msg: string, tok: Token = this.t): never {
    throw new SimSyntaxError(msg, tok.line, tok.col)
  }
  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`Oczekiwano '${value}', jest '${this.t.value || 'koniec kodu'}'`)
    return this.toks[this.i++]!
  }
  private ident(): Token {
    const t = this.t
    // Część słów kluczowych bywa nazwą (of, from, type, async).
    if (t.type === 'ident' || (t.type === 'kw' && ['of', 'from', 'type', 'async', 'default'].includes(t.value))) {
      this.i++
      return t
    }
    return this.fail(`Oczekiwano nazwy, jest '${t.value || 'koniec kodu'}'`)
  }
  expectEof(): void {
    if (this.t.type !== 'eof') this.fail(`Nieoczekiwany token '${this.t.value}'`)
  }
  private semi(): void {
    if (this.eat(';')) return
    if (this.t.type === 'eof' || this.is('}') || this.t.nlBefore) return
    this.fail(`Brakuje ';' przed '${this.t.value}'`)
  }
  private prevEnd(): number {
    return this.toks[this.i - 1]?.end ?? 0
  }

  // ---------- typy TS (pomijane) ----------

  private skipType(stops: string[]): void {
    let depth = 0
    const startI = this.i
    while (this.t.type !== 'eof') {
      const v = this.t.type === 'punct' ? this.t.value : ''
      if (depth === 0 && stops.includes(v) && this.i > startI) return
      if (depth === 0 && this.i > startI && this.t.nlBefore) return
      if (depth === 0 && stops.includes(v) && v !== '{' && v !== '(' && v !== '[') return
      if (v === '(' || v === '[' || v === '{' || v === '<') depth++
      else if (v === ')' || v === ']' || v === '}' || v === '>') {
        if (depth === 0) return
        depth--
      } else if (v === '=>' && depth === 0 && !stops.includes('=>')) {
        // typ funkcyjny: (a: T) => R
      }
      this.i++
    }
  }
  private maybeTypeAnnotation(stops: string[]): void {
    if (this.is(':')) {
      this.i++
      this.skipType(stops)
    }
  }
  private skipTypeParams(): void {
    if (!this.is('<')) return
    let depth = 0
    do {
      if (this.is('<')) depth++
      else if (this.is('>')) depth--
      else if (this.is('>>')) depth -= 2
      this.i++
    } while (depth > 0 && this.t.type !== 'eof')
  }

  // ---------- instrukcje ----------

  program(): Stmt[] {
    const body: Stmt[] = []
    while (this.t.type !== 'eof') {
      const s = this.statement()
      if (s) body.push(s)
    }
    return body
  }

  private block(): Stmt[] {
    this.expect('{')
    const body: Stmt[] = []
    while (!this.is('}')) {
      if (this.t.type === 'eof') this.fail("Brakuje '}'")
      const s = this.statement()
      if (s) body.push(s)
    }
    this.expect('}')
    return body
  }

  private statement(): Stmt | null {
    const t = this.t
    const base = { start: t.start, line: t.line }
    const fin = (s: DOmit<Stmt, 'end'>): Stmt => ({ ...s, end: this.prevEnd() }) as Stmt

    if (t.type === 'punct' && t.value === '{') {
      const body = this.block()
      return fin({ ...base, type: 'Block', body })
    }
    if (this.eat(';')) return null
    if (t.type === 'punct' && t.value === '@') this.fail('Dekoratory nie są obsługiwane')
    if (t.type === 'kw') {
      switch (t.value) {
        case 'import': {
          // import ... from '...'; pomijamy, zależności nie są dostępne w piaskownicy
          while (this.t.type !== 'eof' && !this.is(';')) {
            const wasSpecifier = this.t.type === 'str'
            this.i++
            if (wasSpecifier) break
          }
          this.eat(';')
          return null
        }
        case 'export': {
          this.i++
          this.eat('default')
          return this.statement()
        }
        case 'interface': {
          this.i++
          this.ident()
          this.skipTypeParams()
          if (this.eat('extends')) this.skipType(['{'])
          this.skipBalanced()
          return null
        }
        case 'type': {
          if (this.peek().type === 'ident') {
            this.i += 2
            this.skipTypeParams()
            this.expect('=')
            this.skipType([';'])
            this.eat(';')
            return null
          }
          break
        }
        case 'enum':
          this.fail('enum nie jest obsługiwany w symulatorze')
          break
        case 'let':
        case 'const':
        case 'var': {
          const decl = this.varDecl()
          this.semi()
          return fin(decl)
        }
        case 'function':
          return fin({ ...base, type: 'FuncDecl', func: this.functionExpr(false) })
        case 'async':
          if (this.peek().value === 'function' && !this.peek().nlBefore) {
            this.i++
            return fin({ ...base, type: 'FuncDecl', func: this.functionExpr(true) })
          }
          break
        case 'class':
          return fin(this.classDecl())
        case 'return': {
          this.i++
          let arg: Expr | null = null
          if (!this.is(';') && !this.is('}') && this.t.type !== 'eof' && !this.t.nlBefore) arg = this.expression()
          this.semi()
          return fin({ ...base, type: 'Return', arg })
        }
        case 'if': {
          this.i++
          this.expect('(')
          const test = this.expression()
          this.expect(')')
          const cons = this.statement() ?? this.empty()
          let alt: Stmt | null = null
          if (this.eat('else')) alt = this.statement() ?? this.empty()
          return fin({ ...base, type: 'If', test, cons, alt })
        }
        case 'while': {
          this.i++
          this.expect('(')
          const test = this.expression()
          this.expect(')')
          const body = this.statement() ?? this.empty()
          return fin({ ...base, type: 'While', test, body })
        }
        case 'do': {
          this.i++
          const body = this.statement() ?? this.empty()
          this.expect('while')
          this.expect('(')
          const test = this.expression()
          this.expect(')')
          this.eat(';')
          return fin({ ...base, type: 'DoWhile', test, body })
        }
        case 'for':
          return fin(this.forStmt())
        case 'break':
          this.i++
          this.semi()
          return fin({ ...base, type: 'Break' })
        case 'continue':
          this.i++
          this.semi()
          return fin({ ...base, type: 'Continue' })
        case 'throw': {
          this.i++
          const arg = this.expression()
          this.semi()
          return fin({ ...base, type: 'Throw', arg })
        }
        case 'try': {
          this.i++
          const block = this.block()
          let param: string | null = null
          let handler: Stmt[] | null = null
          let finalizer: Stmt[] | null = null
          if (this.eat('catch')) {
            if (this.eat('(')) {
              param = this.ident().value
              this.maybeTypeAnnotation([')'])
              this.expect(')')
            }
            handler = this.block()
          }
          if (this.eat('finally')) finalizer = this.block()
          if (!handler && !finalizer) this.fail('try bez catch i finally')
          return fin({ ...base, type: 'Try', block, param, handler, finalizer })
        }
        case 'switch': {
          this.i++
          this.expect('(')
          const disc = this.expression()
          this.expect(')')
          this.expect('{')
          const cases: { test: Expr | null; body: Stmt[]; line: number }[] = []
          while (!this.is('}')) {
            const line = this.t.line
            let test: Expr | null = null
            if (this.eat('case')) test = this.expression()
            else this.expect('default')
            this.expect(':')
            const body: Stmt[] = []
            while (!this.is('case') && !this.is('default') && !this.is('}')) {
              const s = this.statement()
              if (s) body.push(s)
            }
            cases.push({ test, body, line })
          }
          this.expect('}')
          return fin({ ...base, type: 'Switch', disc, cases })
        }
      }
    }
    const expr = this.expression()
    this.semi()
    return fin({ ...base, type: 'Expr', expr })
  }

  private empty(): Stmt {
    return { type: 'Empty', start: this.t.start, end: this.t.start, line: this.t.line }
  }

  private skipBalanced(): void {
    this.expect('{')
    let depth = 1
    while (depth > 0 && this.t.type !== 'eof') {
      if (this.is('{')) depth++
      else if (this.is('}')) depth--
      this.i++
    }
  }

  private pattern(): Pattern {
    if (this.eat('[')) {
      const names: (string | null)[] = []
      let rest: string | undefined
      while (!this.is(']')) {
        if (this.is(',')) {
          names.push(null)
          this.i++
          continue
        }
        if (this.eat('...')) rest = this.ident().value
        else names.push(this.ident().value)
        if (!this.is(']')) this.expect(',')
      }
      this.expect(']')
      return { type: 'ArrayPattern', names, rest }
    }
    this.expect('{')
    const props: { key: string; name: string; default?: Expr }[] = []
    let rest: string | undefined
    while (!this.is('}')) {
      if (this.eat('...')) {
        rest = this.ident().value
      } else {
        const key = this.ident().value
        let name = key
        if (this.eat(':')) name = this.ident().value
        let def: Expr | undefined
        if (this.eat('=')) def = this.assign()
        props.push({ key, name, default: def })
      }
      if (!this.is('}')) this.expect(',')
    }
    this.expect('}')
    return { type: 'ObjectPattern', props, rest }
  }

  private varDecl(): Extract<Stmt, { type: 'VarDecl' }> {
    const t = this.t
    const kind = t.value as 'let' | 'const' | 'var'
    this.i++
    const decls: { name: string; init: Expr | null; pattern?: Pattern }[] = []
    do {
      let name: string
      let pattern: Pattern | undefined
      if (this.is('[') || this.is('{')) {
        pattern = this.pattern()
        name = pattern.type === 'ArrayPattern' ? '[…]' : '{…}'
      } else {
        name = this.ident().value
      }
      this.eat('!')
      this.maybeTypeAnnotation(['=', ';', ',', ')'])
      let init: Expr | null = null
      if (this.eat('=')) init = this.assign()
      decls.push({ name, init, pattern })
    } while (this.eat(','))
    return { type: 'VarDecl', kind, decls, start: t.start, end: this.prevEnd(), line: t.line }
  }

  private forStmt(): Stmt {
    const t = this.t
    this.i++
    if (this.is('await')) this.fail('for await nie jest obsługiwane')
    this.expect('(')
    const base = { start: t.start, line: t.line }
    if ((this.is('let') || this.is('const') || this.is('var')) && (this.peek(2).value === 'of' || this.peek(2).value === 'in' || this.peek().value === '[' || this.peek().value === '{')) {
      const save = this.i
      const kind = this.t.value as 'let' | 'const' | 'var'
      this.i++
      let name = ''
      let pattern: Pattern | undefined
      if (this.is('[') || this.is('{')) {
        pattern = this.pattern()
        name = '…'
      } else name = this.ident().value
      if (this.is('of') || this.is('in')) {
        const isIn = this.t.value === 'in'
        this.i++
        const iter = this.expression()
        this.expect(')')
        const body = this.statement() ?? this.empty()
        return { ...base, type: 'ForOf', kind, name, pattern, iter, body, isIn, end: this.prevEnd() }
      }
      this.i = save
    }
    let init: Stmt | null = null
    if (!this.is(';')) {
      if (this.is('let') || this.is('const') || this.is('var')) {
        this.noIn = true
        init = this.varDecl()
        this.noIn = false
      } else {
        const st = this.t
        const e = this.expression()
        init = { type: 'Expr', expr: e, start: st.start, end: this.prevEnd(), line: st.line }
      }
    }
    this.expect(';')
    const test = this.is(';') ? null : this.expression()
    this.expect(';')
    const update = this.is(')') ? null : this.expression()
    this.expect(')')
    const body = this.statement() ?? this.empty()
    return { ...base, type: 'For', init, test, update, body, end: this.prevEnd() }
  }

  private classDecl(): Extract<Stmt, { type: 'ClassDecl' }> {
    const t = this.t
    this.i++
    const name = this.ident().value
    this.skipTypeParams()
    let superClass: Expr | null = null
    if (this.eat('extends')) superClass = this.leftHandSide()
    if (this.eat('implements' as never)) this.skipType(['{'])
    while (this.t.type === 'ident' && this.t.value === 'implements') {
      this.i++
      this.skipType(['{'])
    }
    this.expect('{')
    let ctor: FuncNode | null = null
    const methods: { name: string; func: FuncNode; isStatic: boolean }[] = []
    const fields: { name: string; init: Expr | null }[] = []
    while (!this.is('}')) {
      if (this.eat(';')) continue
      let isStatic = false
      let isAsync = false
      while (this.t.type === 'ident' && ['public', 'private', 'protected', 'readonly', 'static', 'override'].includes(this.t.value)) {
        if (this.t.value === 'static') isStatic = true
        this.i++
      }
      if (this.is('async') && this.peek().value !== '(') {
        isAsync = true
        this.i++
      }
      if (this.is('#' as never)) this.fail('Pola prywatne # nie są obsługiwane')
      const mt = this.t
      const mname = this.ident().value
      this.eat('?')
      this.eat('!')
      if (this.is('(') || this.is('<')) {
        const func = this.functionRest(mname, isAsync, mt)
        if (mname === 'constructor') ctor = func
        else methods.push({ name: mname, func, isStatic })
      } else {
        this.maybeTypeAnnotation(['=', ';', '}'])
        let init: Expr | null = null
        if (this.eat('=')) init = this.assign()
        this.eat(';')
        fields.push({ name: mname, init })
      }
    }
    this.expect('}')
    return { type: 'ClassDecl', name, superClass, ctor, methods, fields, start: t.start, end: this.prevEnd(), line: t.line }
  }

  // ---------- funkcje ----------

  private functionExpr(isAsync: boolean): FuncNode {
    const t = this.expect('function')
    this.eat('*') && this.fail('Generatory nie są obsługiwane w symulatorze', t)
    let name: string | null = null
    if (!this.is('(') && !this.is('<')) name = this.ident().value
    return this.functionRest(name, isAsync, t)
  }

  private params(): Param[] {
    this.expect('(')
    const params: Param[] = []
    while (!this.is(')')) {
      const rest = this.eat('...')
      if (this.is('{') || this.is('[')) this.fail('Destrukturyzacja w parametrach nie jest obsługiwana')
      // modyfikatory parametrów konstruktora TS
      while (this.t.type === 'ident' && ['public', 'private', 'protected', 'readonly'].includes(this.t.value) && this.peek().type === 'ident') this.i++
      const name = this.ident().value
      this.eat('?')
      this.maybeTypeAnnotation([',', ')', '='])
      let def: Expr | undefined
      if (this.eat('=')) def = this.assign()
      params.push({ name, default: def, rest })
      if (!this.is(')')) this.expect(',')
    }
    this.expect(')')
    return params
  }

  private functionRest(name: string | null, isAsync: boolean, t: Token): FuncNode {
    this.skipTypeParams()
    const params = this.params()
    if (this.is(':')) {
      this.i++
      if (this.is('{')) this.skipBalanced()
      this.skipType(['{'])
    }
    const body = this.block()
    return { type: 'Func', name, params, body, isArrow: false, isAsync, start: t.start, end: this.prevEnd(), line: t.line }
  }

  private isArrowAhead(): boolean {
    // ( ... ) => albo ( ... ): Typ =>
    if (!this.is('(')) return false
    let depth = 0
    let j = this.i
    for (; j < this.toks.length; j++) {
      const v = this.toks[j]!
      if (v.type === 'punct' && (v.value === '(' || v.value === '[' || v.value === '{')) depth++
      else if (v.type === 'punct' && (v.value === ')' || v.value === ']' || v.value === '}')) {
        depth--
        if (depth === 0) break
      } else if (v.type === 'eof') return false
    }
    const next = this.toks[j + 1]
    if (!next) return false
    if (next.value === '=>') return true
    if (next.value === ':') {
      // typ zwracany: szukamy => przed ; lub {
      for (let k = j + 2; k < this.toks.length; k++) {
        const v = this.toks[k]!
        if (v.value === '=>') return true
        if (v.value === ';' || v.type === 'eof' || (v.value === '{' && this.toks[k - 1]!.value !== ':')) return false
      }
    }
    return false
  }

  private arrow(isAsync: boolean, t: Token): FuncNode {
    let params: Param[]
    if (this.is('(')) {
      params = this.params()
      if (this.is(':')) {
        this.i++
        this.skipType(['=>'])
      }
    } else {
      params = [{ name: this.ident().value }]
    }
    this.expect('=>')
    let body: Stmt[] | Expr
    if (this.is('{')) body = this.block()
    else body = this.assign()
    return { type: 'Func', name: null, params, body, isArrow: true, isAsync, start: t.start, end: this.prevEnd(), line: t.line }
  }

  // ---------- wyrażenia ----------

  expression(): Expr {
    const t = this.t
    const first = this.assign()
    if (!this.is(',')) return first
    const items = [first]
    while (this.eat(',')) items.push(this.assign())
    return { type: 'Seq', items, start: t.start, end: this.prevEnd(), line: t.line }
  }

  private assign(): Expr {
    const t = this.t
    if (this.is('async') && !this.peek().nlBefore && (this.peek().type === 'ident' && this.peek(2).value === '=>')) {
      this.i++
      return this.arrow(true, t)
    }
    if (this.is('async') && this.peek().value === '(') {
      const save = this.i
      this.i++
      if (this.isArrowAhead()) return this.arrow(true, t)
      this.i = save
    }
    if (t.type === 'ident' && this.peek().value === '=>') return this.arrow(false, t)
    if (this.isArrowAhead()) return this.arrow(false, t)

    const left = this.conditional()
    if (this.t.type === 'punct' && ASSIGN_OPS.has(this.t.value)) {
      const op = this.t.value
      if (left.type !== 'Ident' && left.type !== 'Member') this.fail('Nieprawidłowy cel przypisania')
      this.i++
      const value = this.assign()
      return { type: 'Assign', op, target: left, value, start: t.start, end: this.prevEnd(), line: t.line }
    }
    return left
  }

  private conditional(): Expr {
    const t = this.t
    const test = this.binary(0)
    if (!this.is('?')) return test
    this.i++
    const cons = this.assign()
    this.expect(':')
    const alt = this.assign()
    return { type: 'Cond', test, cons, alt, start: t.start, end: this.prevEnd(), line: t.line }
  }

  private binary(minPrec: number): Expr {
    const t = this.t
    let left = this.unary()
    for (;;) {
      const tok = this.t
      if (tok.type === 'ident' && tok.value === 'as') {
        // TS: wyrażenie `as Typ` nie zmienia wartości
        this.i++
        this.skipType([';', ',', ')', ']', '}', '=', '?', ':', '&&', '||', '??', '+', '-', '*', '/', '===', '!==', '==', '!=', '<', '>', '<=', '>='])
        continue
      }
      const op = tok.value
      const isOp = (tok.type === 'punct' || (tok.type === 'kw' && (op === 'instanceof' || op === 'in'))) && op in BIN_PREC
      if (!isOp) break
      if (op === 'in' && this.noIn) break
      const prec = BIN_PREC[op]!
      if (prec < minPrec) break
      this.i++
      const right = this.binary(op === '**' ? prec : prec + 1)
      const node = { start: t.start, end: this.prevEnd(), line: tok.line, left, right, opStart: tok.start }
      left = op === '&&' || op === '||' || op === '??' ? { ...node, type: 'Logical', op } : { ...node, type: 'Binary', op }
    }
    return left
  }

  private unary(): Expr {
    const t = this.t
    if (t.type === 'punct' && ['!', '-', '+', '~'].includes(t.value)) {
      this.i++
      const arg = this.unary()
      return { type: 'Unary', op: t.value, arg, start: t.start, end: this.prevEnd(), line: t.line }
    }
    if (t.type === 'kw' && (t.value === 'typeof' || t.value === 'void' || t.value === 'delete')) {
      this.i++
      const arg = this.unary()
      return { type: 'Unary', op: t.value, arg, start: t.start, end: this.prevEnd(), line: t.line }
    }
    if (t.type === 'kw' && t.value === 'await') {
      this.i++
      const arg = this.unary()
      return { type: 'Await', arg, start: t.start, end: this.prevEnd(), line: t.line }
    }
    if (t.type === 'punct' && (t.value === '++' || t.value === '--')) {
      this.i++
      const arg = this.unary()
      return { type: 'Update', op: t.value, prefix: true, arg, start: t.start, end: this.prevEnd(), line: t.line }
    }
    const e = this.postfix()
    return e
  }

  private postfix(): Expr {
    const t = this.t
    const e = this.leftHandSide()
    if (this.t.type === 'punct' && (this.t.value === '++' || this.t.value === '--') && !this.t.nlBefore) {
      const op = this.t.value as '++' | '--'
      this.i++
      return { type: 'Update', op, prefix: false, arg: e, start: t.start, end: this.prevEnd(), line: t.line }
    }
    return e
  }

  private args(): (Expr | SpreadEl)[] {
    this.expect('(')
    const args: (Expr | SpreadEl)[] = []
    while (!this.is(')')) {
      const st = this.t
      if (this.eat('...')) {
        const arg = this.assign()
        args.push({ type: 'Spread', arg, start: st.start, end: this.prevEnd(), line: st.line })
      } else args.push(this.assign())
      if (!this.is(')')) this.expect(',')
    }
    this.expect(')')
    return args
  }

  private leftHandSide(): Expr {
    const t = this.t
    let e: Expr
    if (this.is('new')) {
      this.i++
      const callee = this.primaryWithMembers()
      const args = this.is('(') ? this.args() : []
      e = { type: 'New', callee, args, start: t.start, end: this.prevEnd(), line: t.line }
    } else e = this.primary()
    return this.members(e, t, true)
  }

  private primaryWithMembers(): Expr {
    const t = this.t
    return this.members(this.primary(), t, false)
  }

  private members(e: Expr, t: Token, allowCalls: boolean): Expr {
    for (;;) {
      if (this.is('.') || this.is('?.')) {
        const optional = this.t.value === '?.'
        this.i++
        if (optional && this.is('(')) {
          const args = this.args()
          e = { type: 'Call', callee: e, args, optional: true, start: t.start, end: this.prevEnd(), line: t.line }
          continue
        }
        if (optional && this.is('[')) {
          this.i++
          const prop = this.expression()
          this.expect(']')
          e = { type: 'Member', object: e, prop, computed: true, optional: true, start: t.start, end: this.prevEnd(), line: t.line }
          continue
        }
        const nt = this.t
        if (nt.type !== 'ident' && nt.type !== 'kw') this.fail('Oczekiwano nazwy właściwości')
        this.i++
        e = { type: 'Member', object: e, prop: { type: 'Str', value: nt.value, start: nt.start, end: nt.end, line: nt.line }, computed: false, optional, start: t.start, end: this.prevEnd(), line: t.line }
      } else if (this.is('[') && !this.t.nlBefore) {
        this.i++
        const prop = this.expression()
        this.expect(']')
        e = { type: 'Member', object: e, prop, computed: true, optional: false, start: t.start, end: this.prevEnd(), line: t.line }
      } else if (allowCalls && this.is('(') ) {
        const args = this.args()
        e = { type: 'Call', callee: e, args, optional: false, start: t.start, end: this.prevEnd(), line: t.line }
      } else if (this.is('!') && !this.t.nlBefore && (this.peek().value === '.' || this.peek().value === ')' || this.peek().value === ';' || this.peek().value === ',' || this.peek().value === '[')) {
        this.i++ // TS non-null assertion
      } else if (this.t.type === 'template' && allowCalls) {
        this.fail('Tagged templates nie są obsługiwane')
      } else break
    }
    return e
  }

  private primary(): Expr {
    const t = this.t
    const at = { start: t.start, end: t.end, line: t.line }
    switch (t.type) {
      case 'num':
        this.i++
        return { ...at, type: 'Num', value: Number(t.value), raw: t.value }
      case 'str':
        this.i++
        return { ...at, type: 'Str', value: t.value }
      case 'regex':
        this.i++
        return { ...at, type: 'Regex', pattern: t.value, flags: t.flags ?? '' }
      case 'template': {
        this.i++
        const parts = (t.parts ?? []).map(p =>
          p.kind === 'text' ? p : { kind: 'expr' as const, expr: shiftLines(parseExpression(p.source), t.line) },
        )
        return { ...at, type: 'Template', parts }
      }
      case 'ident':
        this.i++
        return { ...at, type: 'Ident', name: t.value }
      case 'kw':
        switch (t.value) {
          case 'true':
          case 'false':
            this.i++
            return { ...at, type: 'Bool', value: t.value === 'true' }
          case 'null':
            this.i++
            return { ...at, type: 'Null' }
          case 'undefined':
            this.i++
            return { ...at, type: 'Undef' }
          case 'this':
            this.i++
            return { ...at, type: 'This' }
          case 'function':
            return this.functionExpr(false)
          case 'async':
            if (this.peek().value === 'function') {
              this.i++
              return this.functionExpr(true)
            }
            this.i++
            return { ...at, type: 'Ident', name: 'async' }
          case 'of':
          case 'from':
          case 'type':
            this.i++
            return { ...at, type: 'Ident', name: t.value }
          case 'class':
            this.fail('Wyrażenie class nie jest obsługiwane (użyj deklaracji class)')
            break
          case 'super':
            this.i++
            return { ...at, type: 'Ident', name: 'super' }
        }
        break
      case 'punct':
        if (t.value === '(') {
          this.i++
          const e = this.expression()
          this.expect(')')
          return e
        }
        if (t.value === '[') {
          this.i++
          const items: (Expr | SpreadEl)[] = []
          while (!this.is(']')) {
            const st = this.t
            if (this.eat('...')) items.push({ type: 'Spread', arg: this.assign(), start: st.start, end: this.prevEnd(), line: st.line })
            else items.push(this.assign())
            if (!this.is(']')) this.expect(',')
          }
          this.expect(']')
          return { type: 'Array', items, start: t.start, end: this.prevEnd(), line: t.line }
        }
        if (t.value === '{') {
          this.i++
          const props: ObjProp[] = []
          while (!this.is('}')) {
            if (this.eat('...')) {
              props.push({ key: '', value: this.assign(), spread: true })
            } else if (this.is('[')) {
              this.i++
              const computed = this.assign()
              this.expect(']')
              this.expect(':')
              props.push({ key: '', computed, value: this.assign() })
            } else {
              const kt = this.t
              let isAsync = false
              if (kt.type === 'kw' && kt.value === 'async' && this.peek().value !== ':' && this.peek().value !== '(' && this.peek().value !== ',') {
                isAsync = true
                this.i++
              }
              const key = this.t.type === 'str' || this.t.type === 'num' ? this.toks[this.i++]!.value : this.anyName()
              if (this.is('(')) {
                props.push({ key, value: this.functionRest(key, isAsync, kt) })
              } else if (this.eat(':')) {
                props.push({ key, value: this.assign() })
              } else {
                props.push({ key, value: { type: 'Ident', name: key, start: kt.start, end: kt.end, line: kt.line } })
              }
            }
            if (!this.is('}')) this.expect(',')
          }
          this.expect('}')
          return { type: 'Object', props, start: t.start, end: this.prevEnd(), line: t.line }
        }
        if (t.value === '<') this.fail('JSX nie jest obsługiwany w symulatorze')
        break
    }
    return this.fail(`Nieoczekiwany token '${t.value || 'koniec kodu'}'`)
  }

  private anyName(): string {
    const t = this.t
    if (t.type === 'ident' || t.type === 'kw') {
      this.i++
      return t.value
    }
    return this.fail('Oczekiwano nazwy właściwości')
  }
}

function shiftLines(e: Expr, line: number): Expr {
  // Wyrażenia w ${} dziedziczą linię template literalu.
  return { ...e, line }
}
