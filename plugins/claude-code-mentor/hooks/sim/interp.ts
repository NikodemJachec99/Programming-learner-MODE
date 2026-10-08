// Deterministyczny interpreter podzbioru JS/TS z zapisem każdego kroku.
// Nie wykonuje kodu projektu w prawdziwym środowisku: wszystko dzieje się
// w tym interpreterze, w pamięci, bez dostępu do plików, sieci i procesów.
//
// Asynchroniczność: każda funkcja async to koprocedura (generator), `await`
// ją zawiesza, a wznowienie trafia do kolejki mikrozadań. setTimeout trafia do
// kolejki makrozadań z wirtualnym zegarem. Kolejność odpowiada specyfikacji
// ECMAScript i HTML dla obsługiwanych konstrukcji.

import type { Expr, FuncNode, Pattern, Program, SpreadEl, Stmt } from './ast'
import { SimSyntaxError } from './lexer'
import { parse } from './parser'
import {
  compare,
  display,
  isRef,
  logFormat,
  looseEquals,
  strictEquals,
  toBoolean,
  toNumber,
  toStr,
  typeOf,
} from './values'
import type { AwaitSignal, Env, JsArray, JsBuiltin, JsClass, JsFunction, JsObject, JsPromise, PromiseReaction, ResumeMsg, Value } from './values'

export type StepKind =
  | 'stmt'
  | 'cond'
  | 'call'
  | 'return'
  | 'loop-end'
  | 'throw'
  | 'catch'
  | 'unwind'
  | 'await'
  | 'task'
  | 'end'

export type Step = {
  i: number
  kind: StepKind
  line: number
  text: string
  why: string
  cond?: { expr: string; detail: string[]; result: boolean }
  vars: Record<string, string>
  changed: string[]
  stack: string[]
  out: number
  queues: { micro: string[]; macro: string[] }
  hypothetical?: boolean
  loop?: { line: number; iteration: number }
}

export type SimResult = {
  ok: boolean
  steps: Step[]
  output: string[]
  error?: { kind: 'syntax' | 'runtime' | 'limit' | 'unsupported'; message: string; line?: number }
  hypotheses: string[]
  lines: string[]
  executedLines: number[]
  skipped: { from: number; to: number; reason: string }[]
  conditions: { key: number; line: number; expr: string; results: boolean[] }[]
  loops: { line: number; iterations: number }[]
  finalVars: Record<string, string>
}

export type SimOptions = { maxSteps?: number; maxIterations?: number }

class JsThrow {
  constructor(
    readonly value: Value,
    readonly line: number,
  ) {}
}
class Unsupported extends Error {}
class StepLimit extends Error {}

type Completion = { type: 'normal' } | { type: 'return'; value: Value } | { type: 'break' } | { type: 'continue' }
const NORMAL: Completion = { type: 'normal' }

type Frame = { id: number; label: string; env: Env; fn?: JsFunction }
type Coroutine = { gen: Generator<AwaitSignal, Value, ResumeMsg>; frames: Frame[]; promise: JsPromise; label: string }
type Task = { label: string; run: () => void; hypothetical?: boolean }
type Macro = Task & { time: number; seq: number; id: number }

const TDZ = Symbol('tdz')
type SlotKind = 'let' | 'const' | 'var' | 'param' | 'func' | 'class'
type Gen<T> = Generator<AwaitSignal, T, ResumeMsg>

export function simulate(source: string, opts: SimOptions = {}): SimResult {
  const lines = source.split(/\r?\n/)
  let program: Program
  try {
    program = parse(source)
  } catch (e) {
    if (e instanceof SimSyntaxError) {
      return emptyResult(lines, { kind: 'syntax', message: e.message, line: e.line })
    }
    return emptyResult(lines, { kind: 'syntax', message: String(e) })
  }
  return new Interpreter(program, lines, opts).run()
}

function emptyResult(lines: string[], error: SimResult['error']): SimResult {
  return { ok: false, steps: [], output: [], error, hypotheses: [], lines, executedLines: [], skipped: [], conditions: [], loops: [], finalVars: {} }
}

class Interpreter {
  private steps: Step[] = []
  private out: string[] = []
  private stack: Frame[] = []
  private micro: Task[] = []
  private macro: Macro[] = []
  private clock = 0
  private seq = 0
  private nextId = 1
  private frameSeq = 0
  private hypotheses = new Set<string>()
  private executed = new Set<number>()
  private skipped: SimResult['skipped'] = []
  private conditions = new Map<number, { key: number; line: number; expr: string; results: boolean[] }>()
  private loops = new Map<number, number>()
  private lastSnap = new Map<number, Record<string, string>>()
  private ctx: string[] = []
  private condTrace: string[] | null = null
  private hypoNow = false
  private maxSteps: number
  private maxIter: number
  private builtins: Env
  private global: Env
  private promises: JsPromise[] = []
  private rng = 42

  constructor(
    private program: Program,
    private lines: string[],
    opts: SimOptions,
  ) {
    this.maxSteps = opts.maxSteps ?? 3000
    this.maxIter = opts.maxIterations ?? 1000
    this.builtins = { vars: new Map(), parent: null, frame: 'builtins' }
    this.global = { vars: new Map(), parent: this.builtins, frame: 'global' }
    this.installBuiltins()
  }

  // ===================== uruchomienie =====================

  run(): SimResult {
    let error: SimResult['error']
    const main: Frame = { id: this.frameSeq++, label: '(program)', env: this.global }
    try {
      const promise = this.newPromise('program')
      const gen = this.mainBody()
      this.startCoroutine({ gen, frames: [main], promise, label: 'program' })
      this.eventLoop()
    } catch (e) {
      error = this.toError(e)
    }
    const unhandled = this.promises.filter(p => p.state === 'rejected' && !p.handled && p.label !== 'program')
    for (const p of unhandled) {
      this.out.push(`Uncaught (in promise) ${display(p.value)}`)
    }
    const programPromise = this.promises.find(p => p.label === 'program')
    if (!error && programPromise?.state === 'rejected') {
      const v = programPromise.value
      error = { kind: 'runtime', message: `Nieobsłużony wyjątek: ${display(v)}`, line: this.lastLine }
    }
    if (!error || error.kind !== 'syntax') {
      this.record('end', this.lastLine, error ? `Program przerwany: ${error.message}` : 'Koniec programu: stos wywołań i obie kolejki są puste.', 'nie ma już nic do wykonania')
    }
    const finalVars = this.snapshot(this.global)
    return {
      ok: !error,
      steps: this.steps,
      output: this.out,
      error,
      hypotheses: [...this.hypotheses],
      lines: this.lines,
      executedLines: [...this.executed].sort((a, b) => a - b),
      skipped: this.skipped,
      conditions: [...this.conditions.values()],
      loops: [...this.loops.entries()].map(([line, iterations]) => ({ line, iterations })),
      finalVars,
    }
  }

  private lastLine = 1
  /** Bieżący zakres leksykalny (blok) do podglądu zmiennych. */
  private curEnv: Env | null = null

  private toError(e: unknown): SimResult['error'] {
    if (e instanceof StepLimit) return { kind: 'limit', message: e.message, line: this.lastLine }
    if (e instanceof Unsupported) return { kind: 'unsupported', message: e.message, line: this.lastLine }
    if (e instanceof JsThrow) return { kind: 'runtime', message: `Nieobsłużony wyjątek: ${display(e.value)}`, line: e.line }
    if (e instanceof SimSyntaxError) return { kind: 'syntax', message: e.message, line: e.line }
    return { kind: 'runtime', message: e instanceof Error ? e.message : String(e), line: this.lastLine }
  }

  private *mainBody(): Gen<Value> {
    this.ctx = ['program wykonuje się od góry do dołu']
    const c = yield* this.execBlock(this.program.body, this.global, false)
    if (c.type === 'return') return c.value
    return undefined
  }

  private eventLoop(): void {
    let guard = 0
    for (;;) {
      if (guard++ > 5000) throw new StepLimit('Zbyt wiele zadań w pętli zdarzeń')
      const m = this.micro.shift()
      if (m) {
        this.hypoNow = !!m.hypothetical
        this.ctx = [`pętla zdarzeń pobrała mikrozadanie: ${m.label}`]
        this.record('task', this.lastLine, `Pętla zdarzeń: stos jest pusty, więc bierze pierwsze mikrozadanie z kolejki: ${m.label}.`, 'mikrozadania (Promise, await) mają pierwszeństwo przed makrozadaniami')
        m.run()
        continue
      }
      if (this.macro.length === 0) break
      this.macro.sort((a, b) => a.time - b.time || a.seq - b.seq)
      const t = this.macro.shift()!
      this.clock = Math.max(this.clock, t.time)
      this.hypoNow = !!t.hypothetical
      this.ctx = [`pętla zdarzeń pobrała makrozadanie: ${t.label}`]
      this.record('task', this.lastLine, `Pętla zdarzeń: kolejka mikrozadań pusta, wirtualny zegar = ${this.clock} ms, uruchamiam makrozadanie: ${t.label}.`, 'makrozadanie (np. setTimeout) czeka, aż stos i kolejka mikrozadań będą puste')
      t.run()
    }
    this.hypoNow = false
  }

  // ===================== zapis kroków =====================

  private snapshot(env: Env): Record<string, string> {
    const out: Record<string, string> = {}
    const chain: Env[] = []
    for (let e: Env | null = env; e && e !== this.builtins; e = e.parent) chain.push(e)
    for (const e of chain.reverse()) {
      for (const [name, slot] of e.vars) {
        if (name === 'this' || name === '__fn') continue
        const v = slot.value as unknown
        out[name] = v === TDZ ? '<TDZ: jeszcze nie zainicjalizowana>' : display(slot.value)
      }
    }
    return out
  }

  private record(kind: StepKind, line: number, text: string, why?: string, extra: Partial<Step> = {}): void {
    if (this.steps.length >= this.maxSteps) {
      throw new StepLimit(`Przekroczono limit ${this.maxSteps} kroków (możliwa nieskończona pętla albo zbyt długi program). Symulacja zatrzymana.`)
    }
    this.lastLine = line
    if (kind !== 'task' && kind !== 'end') this.executed.add(line)
    const frame = this.stack[this.stack.length - 1]
    const env = this.curEnv && frame && this.envInFrame(this.curEnv, frame.env) ? this.curEnv : frame?.env
    const vars = env ? this.snapshot(env) : this.steps.at(-1)?.vars ?? {}
    const prev = frame ? this.lastSnap.get(frame.id) : undefined
    const changed = prev ? Object.keys(vars).filter(k => vars[k] !== prev[k]) : []
    if (frame) this.lastSnap.set(frame.id, vars)
    if (kind === 'stmt' && prev) {
      const diffs = changed.filter(k => k in prev).map(k => `${k}: ${prev[k]} → ${vars[k]}`)
      if (diffs.length) text += ` Zmiana: ${diffs.join('; ')}.`
    }
    this.steps.push({
      i: this.steps.length,
      kind,
      line,
      text,
      why: why ?? this.ctx.at(-1) ?? 'kolejna instrukcja w kolejności wykonywania',
      vars,
      changed,
      stack: this.stack.map(f => f.label),
      out: this.out.length,
      queues: { micro: this.micro.map(t => t.label), macro: [...this.macro].sort((a, b) => a.time - b.time || a.seq - b.seq).map(t => `${t.label} (t=${t.time} ms)`) },
      hypothetical: this.hypoNow || undefined,
      ...extra,
    })
  }

  private envInFrame(env: Env, frameEnv: Env): boolean {
    for (let e: Env | null = env; e; e = e.parent) if (e === frameEnv) return true
    return false
  }

  private src(node: { start: number; end: number }): string {
    const s = this.program.source.slice(node.start, node.end).replace(/\s+/g, ' ').trim()
    return s.length > 80 ? s.slice(0, 77) + '…' : s
  }

  private lineRange(node: { start: number; end: number }): { from: number; to: number } {
    const from = this.program.source.slice(0, node.start).split('\n').length
    const to = this.program.source.slice(0, node.end).split('\n').length
    return { from, to }
  }

  private mark(): { out: number; step: number } {
    return { out: this.out.length, step: this.steps.length }
  }

  private describeChanges(before: { out: number; step: number }): string {
    // Wyjście wypisane w krokach wewnętrznych (wywołania, zadania) jest już tam opisane.
    const last = this.steps.at(-1)
    const from = last && last.i >= before.step ? Math.max(before.out, last.out) : before.out
    const outs = this.out.slice(from)
    return outs.length ? ` Wypisano: ${outs.map(o => JSON.stringify(o)).join(', ')}.` : ''
  }

  // ===================== środowisko =====================

  private declare(env: Env, name: string, value: Value, kind: SlotKind): void {
    env.vars.set(name, { value, kind })
  }

  private lookup(env: Env, name: string, line: number): { value: Value; env: Env } {
    for (let e: Env | null = env; e; e = e.parent) {
      const slot = e.vars.get(name)
      if (slot) {
        if ((slot.value as unknown) === TDZ) this.throwError('ReferenceError', `Cannot access '${name}' before initialization (zmienna jest w strefie TDZ: let/const istnieje od początku bloku, ale nie można jej użyć przed linią deklaracji)`, line)
        return { value: slot.value, env: e }
      }
    }
    return this.throwError('ReferenceError', `${name} is not defined`, line)
  }

  private assignVar(env: Env, name: string, value: Value, line: number): void {
    for (let e: Env | null = env; e; e = e.parent) {
      const slot = e.vars.get(name)
      if (slot) {
        if ((slot.value as unknown) === TDZ) this.throwError('ReferenceError', `Cannot access '${name}' before initialization`, line)
        if (slot.kind === 'const') this.throwError('TypeError', `Assignment to constant variable '${name}' (const nie pozwala przypisać nowej wartości)`, line)
        slot.value = value
        return
      }
    }
    this.throwError('ReferenceError', `${name} is not defined (przypisanie do niezadeklarowanej zmiennej; w trybie strict to błąd)`, line)
  }

  private throwError(name: string, message: string, line: number): never {
    throw new JsThrow(this.makeError(name, message), line)
  }

  private makeError(name: string, message: string): JsObject {
    const o = this.newObject('Error')
    o.isError = true
    o.props.set('name', name)
    o.props.set('message', message)
    return o
  }

  private newObject(className?: string): JsObject {
    return { kind: 'object', id: this.nextId++, props: new Map(), proto: null, className }
  }
  private newArray(items: Value[]): JsArray {
    return { kind: 'array', id: this.nextId++, items }
  }
  private builtin(name: string, call: JsBuiltin['call'], props?: Map<string, Value>): JsBuiltin {
    return { kind: 'builtin', id: this.nextId++, name, call, props }
  }
  private fnBuiltin(name: string, f: (thisArg: Value, args: Value[]) => Value): JsBuiltin {
    // eslint-disable-next-line require-yield
    return this.builtin(name, function* (thisArg, args) {
      return f(thisArg, args)
    })
  }

  // ===================== Promise =====================

  private newPromise(label: string): JsPromise {
    const p: JsPromise = { kind: 'promise', id: this.nextId++, state: 'pending', value: undefined, reactions: [], label, handled: false }
    this.promises.push(p)
    return p
  }

  private settle(p: JsPromise, state: 'fulfilled' | 'rejected', value: Value): void {
    if (p.state !== 'pending') return
    p.state = state
    p.value = value
    const reactions = p.reactions
    p.reactions = []
    for (const r of reactions) this.queueReaction(p, r)
  }

  private resolvePromise(p: JsPromise, value: Value): void {
    if (p.state !== 'pending') return
    if (value === p) {
      this.settle(p, 'rejected', this.makeError('TypeError', 'Chaining cycle detected for promise'))
      return
    }
    if (isRef(value) && value.kind === 'promise') {
      // NewPromiseResolveThenableJob: przyjęcie stanu innej obietnicy kosztuje dodatkowe mikrozadanie.
      const inner = value
      this.micro.push({
        label: `przyjęcie stanu obietnicy (${p.label} ← ${inner.label})`,
        run: () => {
          this.then(inner, null, null, null, `przekazanie wyniku do ${p.label}`, (ok, v) => (ok ? this.resolvePromise(p, v) : this.settle(p, 'rejected', v)))
        },
      })
      return
    }
    this.settle(p, 'fulfilled', value)
  }

  private queueReaction(p: JsPromise, r: PromiseReaction): void {
    const hypothetical = this.hypoNow
    this.micro.push({
      label: r.label,
      hypothetical,
      run: () => {
        const ok = p.state === 'fulfilled'
        if (r.resume) {
          r.resume(ok, p.value)
          return
        }
        const handler = ok ? r.onFul : r.onRej
        const target = r.target!
        if (!handler || !(isRef(handler) && (handler.kind === 'function' || handler.kind === 'builtin'))) {
          if (ok) this.resolvePromise(target, p.value)
          else this.settle(target, 'rejected', p.value)
          return
        }
        try {
          const v = this.runSync(this.callFunction(handler, undefined, [p.value], this.lastLine))
          this.resolvePromise(target, v)
        } catch (e) {
          if (e instanceof JsThrow) this.settle(target, 'rejected', e.value)
          else throw e
        }
      },
    })
  }

  private then(p: JsPromise, onFul: Value | null, onRej: Value | null, target: JsPromise | null, label: string, resume?: (ok: boolean, v: Value) => void): void {
    p.handled = true
    const r: PromiseReaction = { onFul, onRej, target, label, resume }
    if (p.state === 'pending') p.reactions.push(r)
    else this.queueReaction(p, r)
  }

  /** Uruchamia generator, który nie może się zawiesić (callback then, kod synchroniczny). */
  private runSync<T>(g: Gen<T>): T {
    const r = g.next()
    if (!r.done) throw new Unsupported('await poza funkcją async nie jest dozwolony')
    return r.value
  }

  // ===================== koprocedury (async) =====================

  private startCoroutine(co: Coroutine): void {
    this.resumeCoroutine(co, undefined)
  }

  private resumeCoroutine(co: Coroutine, msg: ResumeMsg): void {
    const base = this.stack.length
    this.stack.push(...co.frames)
    let r: IteratorResult<AwaitSignal, Value>
    try {
      r = co.gen.next(msg)
    } catch (e) {
      this.stack.length = base
      if (e instanceof JsThrow) {
        this.settle(co.promise, 'rejected', e.value)
        if (co.label !== 'program') {
          this.record('unwind', e.line, `Wyjątek ${display(e.value)} opuścił funkcję async ${co.label}: jej Promise zostaje odrzucona (rejected), a nie rzucona do wywołującego.`, 'nieobsłużony wyjątek w funkcji async zamienia się w odrzuconą obietnicę')
        }
        return
      }
      throw e
    }
    if (r.done) {
      co.frames = []
      this.stack.length = base
      this.resolvePromise(co.promise, r.value)
      return
    }
    // zawieszenie na await
    co.frames = this.stack.splice(base)
    const awaited = r.value.await
    this.then(awaited, null, null, null, `wznowienie ${co.label} po await`, (ok, v) => {
      this.ctx = [`wznowienie ${co.label}: obietnica z await jest już rozstrzygnięta (${ok ? 'fulfilled' : 'rejected'})`]
      this.resumeCoroutine(co, { ok, value: v })
    })
  }

  // ===================== instrukcje =====================

  private hoist(stmts: Stmt[], env: Env, isFunctionScope: boolean): void {
    for (const s of stmts) {
      if (s.type === 'FuncDecl' && s.func.name) {
        this.declare(env, s.func.name, this.makeClosure(s.func, env), 'func')
      } else if (s.type === 'VarDecl' && s.kind !== 'var') {
        for (const d of s.decls) for (const n of this.patternNames(d.name, d.pattern)) env.vars.set(n, { value: TDZ as unknown as Value, kind: s.kind })
      } else if (s.type === 'ClassDecl') {
        env.vars.set(s.name, { value: TDZ as unknown as Value, kind: 'class' })
      }
    }
    if (isFunctionScope) this.hoistVars(stmts, env)
  }

  private hoistVars(stmts: Stmt[], env: Env): void {
    const visit = (s: Stmt | null): void => {
      if (!s) return
      switch (s.type) {
        case 'VarDecl':
          if (s.kind === 'var') for (const d of s.decls) for (const n of this.patternNames(d.name, d.pattern)) if (!env.vars.has(n)) env.vars.set(n, { value: undefined, kind: 'var' })
          break
        case 'If':
          visit(s.cons)
          visit(s.alt)
          break
        case 'While':
        case 'DoWhile':
          visit(s.body)
          break
        case 'For':
          visit(s.init)
          visit(s.body)
          break
        case 'ForOf':
          if (s.kind === 'var' && !env.vars.has(s.name)) env.vars.set(s.name, { value: undefined, kind: 'var' })
          visit(s.body)
          break
        case 'Block':
          s.body.forEach(visit)
          break
        case 'Try':
          s.block.forEach(visit)
          s.handler?.forEach(visit)
          s.finalizer?.forEach(visit)
          break
        case 'Switch':
          s.cases.forEach(c => c.body.forEach(visit))
          break
      }
    }
    stmts.forEach(visit)
  }

  private patternNames(name: string, p?: Pattern): string[] {
    if (!p) return [name]
    if (p.type === 'ArrayPattern') return [...p.names.filter((n): n is string => !!n), ...(p.rest ? [p.rest] : [])]
    return [...p.props.map(x => x.name), ...(p.rest ? [p.rest] : [])]
  }

  private *execBlock(stmts: Stmt[], env: Env, newScope = true): Gen<Completion> {
    const scope: Env = newScope ? { vars: new Map(), parent: env, frame: env.frame } : env
    this.hoist(stmts, scope, !newScope)
    for (const s of stmts) {
      const c = yield* this.exec(s, scope)
      if (c.type !== 'normal') {
        const rest = stmts.slice(stmts.indexOf(s) + 1).filter(x => x.type !== 'FuncDecl' && x.type !== 'Empty')
        if (rest.length && c.type !== 'continue') {
          const first = rest[0]!
          const last = rest[rest.length - 1]!
          this.skipped.push({ ...this.lineRange({ start: first.start, end: last.end }), reason: c.type === 'return' ? 'po return funkcja kończy działanie' : 'po break pętla zostaje przerwana' })
        }
        return c
      }
    }
    return NORMAL
  }

  private *exec(s: Stmt, env: Env): Gen<Completion> {
    this.curEnv = env
    const c = yield* this.execInner(s, env)
    this.curEnv = env
    return c
  }

  private *execInner(s: Stmt, env: Env): Gen<Completion> {
    switch (s.type) {
      case 'Empty':
      case 'FuncDecl':
        return NORMAL
      case 'Block':
        return yield* this.execBlock(s.body, env)
      case 'VarDecl': {
        const before = this.mark()
        const parts: string[] = []
        for (const d of s.decls) {
          let v: Value = undefined
          if (d.init) v = yield* this.eval(d.init, env)
          if (d.pattern) {
            yield* this.bindPattern(d.pattern, v, env, s.kind, s.line)
            parts.push(`destrukturyzacja ${this.patternNames(d.name, d.pattern).join(', ')}`)
          } else {
            if (s.kind === 'var') this.setVarDecl(env, d.name, v)
            else this.declare(env, d.name, v, s.kind)
            parts.push(`${d.name} = ${display(v)}`)
          }
        }
        this.record('stmt', s.line, `${s.kind} ${parts.join(', ')}: nowa zmienna w ${s.kind === 'var' ? 'zakresie funkcji (var)' : 'zakresie bloku (' + s.kind + ')'}.${this.describeChanges(before)}`)
        return NORMAL
      }
      case 'ClassDecl': {
        const cls = yield* this.makeClass(s, env)
        env.vars.set(s.name, { value: cls, kind: 'class' })
        this.record('stmt', s.line, `Deklaracja klasy ${s.name}: powstaje konstruktor i prototyp z metodami ${s.methods.map(m => m.name).join(', ') || '(brak)'}.`)
        return NORMAL
      }
      case 'Expr': {
        const before = this.mark()
        const v = yield* this.eval(s.expr, env)
        const isCallStmt = s.expr.type === 'Call' || (s.expr.type === 'Await' && s.expr.arg.type === 'Call')
        this.record('stmt', s.line, `${this.src(s.expr)}${!isCallStmt && s.expr.type !== 'Assign' && s.expr.type !== 'Update' ? ` → ${display(v)}` : ''}.${this.describeChanges(before)}`)
        return NORMAL
      }
      case 'Return': {
        const v = s.arg ? yield* this.eval(s.arg, env) : undefined
        this.lastLine = s.line
        this.executed.add(s.line)
        return { type: 'return', value: v }
      }
      case 'Throw': {
        const v = yield* this.eval(s.arg, env)
        this.record('throw', s.line, `throw: rzucono ${display(v)}. Wykonanie przerywa się i szuka najbliższego try/catch, idąc w górę stosu wywołań.`)
        throw new JsThrow(v, s.line)
      }
      case 'If': {
        const result = yield* this.evalCondition(s.test, env, s.line)
        const consRange = this.lineRange(s.cons)
        const altRange = s.alt ? this.lineRange(s.alt) : null
        const expr = this.src(s.test)
        const branchText = result
          ? `wykonuję blok if (linie ${consRange.from}-${consRange.to})${altRange ? `, pomijam else (linie ${altRange.from}-${altRange.to})` : ''}`
          : `pomijam blok if (linie ${consRange.from}-${consRange.to})${altRange ? `, wykonuję else (linie ${altRange.from}-${altRange.to})` : ', nie ma else, więc idę dalej'}`
        this.recordCond(s.line, expr, result, `Warunek if (${expr}) → ${result}: ${branchText}.`)
        if (result && altRange) this.skipped.push({ ...altRange, reason: `warunek ${expr} był true, więc else pominięto` })
        if (!result) this.skipped.push({ ...consRange, reason: `warunek ${expr} był false, więc blok if pominięto` })
        const branch = result ? s.cons : s.alt
        if (!branch) return NORMAL
        this.ctx.push(`warunek ${expr} w linii ${s.line} dał ${result}, więc wykonuje się ${result ? 'blok if' : 'blok else'}`)
        try {
          return yield* this.exec(branch, env)
        } finally {
          this.ctx.pop()
        }
      }
      case 'While':
      case 'DoWhile': {
        let iteration = 0
        const expr = this.src(s.test)
        for (;;) {
          if (s.type === 'While' || iteration > 0) {
            const ok = yield* this.evalCondition(s.test, env, s.line)
            this.recordCond(s.line, expr, ok, ok ? `Warunek pętli ${s.type === 'While' ? 'while' : 'do…while'} (${expr}) → true: zaczynam iterację ${iteration + 1}.` : `Warunek pętli (${expr}) → false: koniec pętli po ${iteration} iteracjach.`, { line: s.line, iteration: iteration + (ok ? 1 : 0) })
            if (!ok) break
          }
          iteration++
          this.bumpLoop(s.line, iteration)
          this.ctx.push(`iteracja ${iteration} pętli z linii ${s.line}`)
          let c: Completion
          try {
            c = yield* this.exec(s.body, env)
          } finally {
            this.ctx.pop()
          }
          if (c.type === 'break') {
            this.record('loop-end', s.line, `break: wychodzę z pętli w iteracji ${iteration}.`)
            break
          }
          if (c.type === 'return') return c
        }
        if (iteration === 0) this.skipped.push({ ...this.lineRange(s.body), reason: `warunek ${expr} był false od początku, ciało pętli nie wykonało się ani razu` })
        return NORMAL
      }
      case 'For': {
        const loopEnv: Env = { vars: new Map(), parent: env, frame: env.frame }
        if (s.init) {
          if (s.init.type === 'VarDecl' && s.init.kind !== 'var') this.hoist([s.init], loopEnv, false)
          yield* this.exec(s.init, loopEnv)
        }
        let iteration = 0
        const expr = s.test ? this.src(s.test) : 'true'
        for (;;) {
          if (s.test) {
            this.curEnv = loopEnv
            const ok = yield* this.evalCondition(s.test, loopEnv, s.line)
            this.recordCond(s.line, expr, ok, ok ? `Warunek pętli for (${expr}) → true: zaczynam iterację ${iteration + 1}.` : `Warunek pętli for (${expr}) → false: koniec pętli po ${iteration} iteracjach.`, { line: s.line, iteration: iteration + (ok ? 1 : 0) })
            if (!ok) break
          }
          iteration++
          this.bumpLoop(s.line, iteration)
          // let w for: każda iteracja ma własną kopię zmiennej (ważne dla domknięć)
          const iterEnv: Env = { vars: new Map(), parent: loopEnv.parent, frame: env.frame }
          for (const [k, v] of loopEnv.vars) iterEnv.vars.set(k, { ...v })
          this.ctx.push(`iteracja ${iteration} pętli for z linii ${s.line}`)
          let c: Completion
          try {
            c = yield* this.exec(s.body, iterEnv)
          } finally {
            this.ctx.pop()
          }
          for (const [k, v] of iterEnv.vars) loopEnv.vars.set(k, { ...v })
          if (c.type === 'break') {
            this.record('loop-end', s.line, `break: wychodzę z pętli for w iteracji ${iteration}.`)
            break
          }
          if (c.type === 'return') return c
          if (s.update) {
            this.curEnv = loopEnv
            yield* this.eval(s.update, loopEnv)
            this.curEnv = loopEnv
            this.record('stmt', s.line, `Krok pętli: ${this.src(s.update)} (wykonuje się po każdej iteracji, przed ponownym sprawdzeniem warunku).`, `koniec iteracji ${iteration}`)
          }
        }
        if (iteration === 0) this.skipped.push({ ...this.lineRange(s.body), reason: `warunek ${expr} był false od początku` })
        return NORMAL
      }
      case 'ForOf': {
        const iterable = yield* this.eval(s.iter, env)
        let items: Value[]
        if (s.isIn) {
          if (isRef(iterable) && iterable.kind === 'object') items = [...iterable.props.keys()]
          else if (isRef(iterable) && iterable.kind === 'array') items = iterable.items.map((_, i) => String(i))
          else items = []
        } else items = this.iterate(iterable, s.line)
        let iteration = 0
        for (const item of items) {
          iteration++
          if (iteration > this.maxIter) throw new StepLimit(`Pętla w linii ${s.line} przekroczyła ${this.maxIter} iteracji`)
          this.bumpLoop(s.line, iteration)
          const iterEnv: Env = { vars: new Map(), parent: env, frame: env.frame }
          if (s.pattern) yield* this.bindPattern(s.pattern, item, iterEnv, s.kind, s.line)
          else if (s.kind === 'var') this.assignVar(env, s.name, item, s.line)
          else this.declare(iterEnv, s.name, item, s.kind)
          this.curEnv = iterEnv
          this.record('cond', s.line, `Iteracja ${iteration} z ${items.length}: ${s.pattern ? 'element' : s.name} = ${display(item)} (for…${s.isIn ? 'in iteruje po kluczach' : 'of iteruje po wartościach'}).`, undefined, { loop: { line: s.line, iteration } })
          this.ctx.push(`iteracja ${iteration} pętli for…${s.isIn ? 'in' : 'of'} z linii ${s.line}`)
          let c: Completion
          try {
            c = yield* this.exec(s.body, iterEnv)
          } finally {
            this.ctx.pop()
          }
          if (c.type === 'break') {
            this.record('loop-end', s.line, `break: wychodzę z pętli w iteracji ${iteration}.`)
            break
          }
          if (c.type === 'return') return c
        }
        if (iteration === items.length) this.record('loop-end', s.line, `Koniec pętli for…${s.isIn ? 'in' : 'of'}: przetworzono ${items.length} element(ów).`)
        return NORMAL
      }
      case 'Break':
        this.executed.add(s.line)
        return { type: 'break' }
      case 'Continue':
        this.executed.add(s.line)
        this.record('stmt', s.line, 'continue: pomijam resztę tej iteracji i przechodzę do następnej.')
        return { type: 'continue' }
      case 'Try': {
        let completion: Completion = NORMAL
        try {
          completion = yield* this.execBlock(s.block, env)
        } catch (e) {
          if (!(e instanceof JsThrow) || !s.handler) {
            if (s.finalizer) {
              this.record('stmt', s.line, 'finally: wykonuje się zawsze, także gdy wyjątek leci dalej.')
              const f = yield* this.execBlock(s.finalizer, env)
              if (f.type !== 'normal') return f
            }
            throw e
          }
          const catchEnv: Env = { vars: new Map(), parent: env, frame: env.frame }
          if (s.param) this.declare(catchEnv, s.param, e.value, 'let')
          this.curEnv = catchEnv
          this.record('catch', s.line, `catch: złapano ${display(e.value)} rzucone w linii ${e.line}. Program nie kończy się błędem, tylko wykonuje blok catch.`)
          this.ctx.push(`obsługa wyjątku z linii ${e.line}`)
          try {
            completion = yield* this.execBlock(s.handler, catchEnv)
          } finally {
            this.ctx.pop()
          }
        }
        if (s.finalizer) {
          this.record('stmt', s.line, 'finally: blok wykonuje się zawsze, niezależnie od wyjątku.')
          const f = yield* this.execBlock(s.finalizer, env)
          if (f.type !== 'normal') return f
        }
        return completion
      }
      case 'Switch': {
        const d = yield* this.eval(s.disc, env)
        let matched = false
        const scope: Env = { vars: new Map(), parent: env, frame: env.frame }
        for (const c of s.cases) {
          if (!matched) {
            if (c.test) {
              const v = yield* this.eval(c.test, scope)
              matched = strictEquals(d, v)
              this.recordCond(c.line, `${display(d)} === ${display(v)}`, matched, `switch: ${display(d)} === ${display(v)} → ${matched}${matched ? ', wchodzę w ten case' : ''}.`)
            }
          }
          if (!matched) continue
          for (const st of c.body) {
            const r = yield* this.exec(st, scope)
            if (r.type === 'break') return NORMAL
            if (r.type !== 'normal') return r
          }
        }
        if (!matched) {
          const def = s.cases.find(c => !c.test)
          if (def) {
            this.record('stmt', def.line, 'switch: żaden case nie pasuje, wchodzę w default.')
            let started = false
            for (const c of s.cases) {
              if (c === def) started = true
              if (!started) continue
              for (const st of c.body) {
                const r = yield* this.exec(st, scope)
                if (r.type === 'break') return NORMAL
                if (r.type !== 'normal') return r
              }
            }
          }
        }
        return NORMAL
      }
    }
  }

  private bumpLoop(line: number, iteration: number): void {
    if (iteration > this.maxIter) throw new StepLimit(`Pętla w linii ${line} przekroczyła ${this.maxIter} iteracji (prawdopodobnie nieskończona: sprawdź, czy warunek kiedyś stanie się false).`)
    this.loops.set(line, iteration)
  }

  private recordCond(line: number, expr: string, result: boolean, text: string, loop?: Step['loop']): void {
    const detail = this.lastCondDetail
    this.record('cond', line, text, undefined, { cond: { expr, detail, result }, loop })
  }

  private lastCondDetail: string[] = []

  private *evalCondition(test: Expr, env: Env, line: number): Gen<boolean> {
    const outer = this.condTrace
    const trace: string[] = []
    this.condTrace = trace
    let v: Value
    try {
      v = yield* this.eval(test, env)
    } finally {
      this.condTrace = outer
    }
    const b = toBoolean(v)
    if (!(typeof v === 'boolean')) trace.push(`wartość ${display(v)} nie jest boolean: w warunku liczy się jej prawdziwość (truthy/falsy) → ${b}`)
    this.lastCondDetail = trace
    const key = test.start
    const entry = this.conditions.get(key) ?? { key, line, expr: this.src(test), results: [] }
    entry.results.push(b)
    this.conditions.set(key, entry)
    return b
  }

  private iterate(v: Value, line: number): Value[] {
    if (typeof v === 'string') return [...v]
    if (isRef(v) && v.kind === 'array') return [...v.items]
    if (isRef(v) && v.kind === 'object' && v.internal instanceof Map) return [...v.internal.entries()].map(([k, x]) => this.newArray([k as Value, x]))
    if (isRef(v) && v.kind === 'object' && v.internal instanceof Set) return [...v.internal.values()] as Value[]
    return this.throwError('TypeError', `${display(v)} is not iterable`, line)
  }

  private *bindPattern(p: Pattern, v: Value, env: Env, kind: 'let' | 'const' | 'var', line: number): Gen<void> {
    if (p.type === 'ArrayPattern') {
      const items = this.iterate(v, line)
      p.names.forEach((n, i) => {
        if (n) kind === 'var' ? this.setVarDecl(env, n, items[i]) : this.declare(env, n, items[i], kind)
      })
      if (p.rest) this.declare(env, p.rest, this.newArray(items.slice(p.names.length)), kind)
      return
    }
    if (v === null || v === undefined) this.throwError('TypeError', `Cannot destructure '${display(v)}' as it is ${display(v)}.`, line)
    const used = new Set<string>()
    for (const prop of p.props) {
      let x = this.getMember(v, prop.key, line)
      if (x === undefined && prop.default) x = yield* this.eval(prop.default, env)
      used.add(prop.key)
      kind === 'var' ? this.setVarDecl(env, prop.name, x) : this.declare(env, prop.name, x, kind)
    }
    if (p.rest && isRef(v) && v.kind === 'object') {
      const o = this.newObject()
      for (const [k, x] of v.props) if (!used.has(k)) o.props.set(k, x)
      this.declare(env, p.rest, o, kind)
    }
  }

  private setVarDecl(env: Env, name: string, v: Value): void {
    for (let e: Env | null = env; e; e = e.parent) {
      const slot = e.vars.get(name)
      if (slot && slot.kind === 'var') {
        slot.value = v
        return
      }
    }
    this.declare(env, name, v, 'var')
  }

  // ===================== funkcje i klasy =====================

  private makeClosure(node: FuncNode, env: Env): JsFunction {
    return { kind: 'function', id: this.nextId++, name: node.name ?? '', node, env }
  }

  private *makeClass(s: Extract<Stmt, { type: 'ClassDecl' }>, env: Env): Gen<JsClass> {
    let superClass: JsClass | null = null
    if (s.superClass) {
      const sc = yield* this.eval(s.superClass, env)
      if (!(isRef(sc) && sc.kind === 'class')) this.throwError('TypeError', 'Class extends value is not a constructor', s.line)
      superClass = sc
    }
    const proto = this.newObject(s.name + '.prototype')
    proto.proto = superClass ? superClass.proto : null
    const cls: JsClass = { kind: 'class', id: this.nextId++, name: s.name, ctor: s.ctor, env, proto, superClass, fields: s.fields, statics: new Map() }
    for (const m of s.methods) {
      const f = this.makeClosure(m.func, env)
      f.name = m.name
      f.homeClass = cls
      f.isMethod = true
      if (m.isStatic) cls.statics.set(m.name, f)
      else proto.props.set(m.name, f)
    }
    return cls
  }

  private frameLabel(name: string, params: string[], args: Value[]): string {
    const parts = params.map((p, i) => `${p} = ${display(args[i])}`)
    const s = `${name || '(anonimowa)'}(${parts.join(', ')})`
    return s.length > 70 ? s.slice(0, 67) + '…)' : s
  }

  private *callFunction(fn: Value, thisArg: Value, args: Value[], line: number, displayName?: string): Gen<Value> {
    if (!isRef(fn) || (fn.kind !== 'function' && fn.kind !== 'builtin' && fn.kind !== 'class')) {
      return this.throwError('TypeError', `${displayName ?? display(fn)} is not a function`, line)
    }
    if (fn.kind === 'builtin') return yield* fn.call(thisArg, args)
    if (fn.kind === 'class') return this.throwError('TypeError', `Class constructor ${fn.name} cannot be invoked without 'new'`, line)
    if (this.stack.length > 200) this.throwError('RangeError', 'Maximum call stack size exceeded (w symulatorze limit 200 ramek; w Node/przeglądarce około 10 000)', line)
    const node = fn.node
    if (node.isAsync) {
      const promise = this.newPromise(`${fn.name || 'async'}()`)
      const co: Coroutine = { gen: this.invokeBody(fn, thisArg, args, line, true), frames: [], promise, label: `${fn.name || 'funkcji async'}` }
      this.startCoroutine(co)
      return promise
    }
    return yield* this.invokeBody(fn, thisArg, args, line, false)
  }

  private *invokeBody(fn: JsFunction, thisArg: Value, args: Value[], callLine: number, isAsync: boolean): Gen<Value> {
    const node = fn.node
    const env: Env = { vars: new Map(), parent: fn.env, frame: fn.name }
    if (!node.isArrow) {
      env.vars.set('this', { value: thisArg, kind: 'param' })
      env.vars.set('__fn', { value: fn, kind: 'param' })
    }
    const names: string[] = []
    for (let i = 0; i < node.params.length; i++) {
      const p = node.params[i]!
      let v: Value
      if (p.rest) v = this.newArray(args.slice(i))
      else {
        v = args[i]
        if (v === undefined && p.default) v = yield* this.eval(p.default, env)
      }
      env.vars.set(p.name, { value: v, kind: 'param' })
      names.push(p.name)
    }
    const frame: Frame = { id: this.frameSeq++, label: this.frameLabel(fn.name, names, names.map(n => env.vars.get(n)!.value)), env, fn }
    const callerEnv = this.curEnv
    this.curEnv = env
    this.stack.push(frame)
    this.ctx.push(`wywołanie ${frame.label} z linii ${callLine}`)
    this.record('call', node.line, `Wywołanie ${frame.label}${isAsync ? ' (funkcja async: wykonuje się synchronicznie do pierwszego await, a wywołujący od razu dostaje Promise)' : ''}. Nowa ramka na stosie, parametry dostają wartości argumentów.`, `funkcję wywołano w linii ${callLine}`)
    let result: Value = undefined
    try {
      if (Array.isArray(node.body)) {
        const c = yield* this.execBlock(node.body, env, false)
        if (c.type === 'return') result = c.value
      } else {
        result = yield* this.eval(node.body, env)
      }
      this.record('return', this.lastLine, `${fn.name || 'Funkcja'} zwraca ${display(result)}${isAsync ? ' (w funkcji async wynik trafia do jej Promise)' : ''}. Ramka zdjęta ze stosu, wynik wraca do miejsca wywołania (linia ${callLine}).`, `koniec funkcji ${fn.name || '(anonimowej)'}`)
    } catch (e) {
      if (e instanceof JsThrow && !isAsync) {
        this.record('unwind', e.line, `Wyjątek ${display(e.value)} nie został złapany w ${fn.name || 'funkcji'}: ramka zdjęta ze stosu, wyjątek leci do wywołującego (linia ${callLine}).`, 'propagacja wyjątku w górę stosu wywołań')
      }
      throw e
    } finally {
      this.ctx.pop()
      const idx = this.stack.lastIndexOf(frame)
      if (idx >= 0) this.stack.splice(idx, 1)
      this.curEnv = callerEnv
    }
    return result
  }

  private *construct(callee: Value, args: Value[], line: number): Gen<Value> {
    if (isRef(callee) && callee.kind === 'builtin') {
      const ctor = callee.props?.get('__construct')
      if (ctor && isRef(ctor) && ctor.kind === 'builtin') return yield* ctor.call(undefined, args)
    }
    if (!isRef(callee) || callee.kind !== 'class') {
      if (isRef(callee) && callee.kind === 'function' && !callee.node.isArrow) {
        const obj = this.newObject(callee.name)
        const r = yield* this.callFunction(callee, obj, args, line)
        return isRef(r) ? r : obj
      }
      return this.throwError('TypeError', `${display(callee)} is not a constructor`, line)
    }
    const obj = this.newObject(callee.name)
    obj.proto = callee.proto
    yield* this.initInstance(callee, obj, args, line)
    return obj
  }

  private *initInstance(cls: JsClass, obj: JsObject, args: Value[], line: number): Gen<void> {
    if (!cls.ctor && cls.superClass) yield* this.initInstance(cls.superClass, obj, args, line)
    const fieldEnv: Env = { vars: new Map([['this', { value: obj as Value, kind: 'param' as const }]]), parent: cls.env, frame: cls.name }
    for (const f of cls.fields) obj.props.set(f.name, f.init ? yield* this.eval(f.init, fieldEnv) : undefined)
    if (cls.ctor) {
      const ctor = this.makeClosure(cls.ctor, cls.env)
      ctor.name = `${cls.name}.constructor`
      ctor.homeClass = cls
      yield* this.callFunction(ctor, obj, args, line)
    }
  }

  // ===================== wyrażenia =====================

  private *evalArgs(args: (Expr | SpreadEl)[], env: Env): Gen<Value[]> {
    const out: Value[] = []
    for (const a of args) {
      if (a.type === 'Spread') out.push(...this.iterate(yield* this.eval(a.arg, env), a.line))
      else out.push(yield* this.eval(a, env))
    }
    return out
  }

  private note(s: string): void {
    this.condTrace?.push(s)
  }

  private *eval(e: Expr, env: Env): Gen<Value> {
    switch (e.type) {
      case 'Num':
        return e.value
      case 'Str':
        return e.value
      case 'Bool':
        return e.value
      case 'Null':
        return null
      case 'Undef':
        return undefined
      case 'Template': {
        let s = ''
        for (const p of e.parts) s += p.kind === 'text' ? p.text : toStr(yield* this.eval(p.expr, env))
        return s
      }
      case 'Ident':
        if (e.name === 'super') throw new Unsupported('super poza wywołaniem super(...) lub super.metoda() nie jest obsługiwane')
        return this.lookup(env, e.name, e.line).value
      case 'This': {
        for (let x: Env | null = env; x; x = x.parent) {
          const slot = x.vars.get('this')
          if (slot) return slot.value
        }
        return undefined
      }
      case 'Array':
        return this.newArray(yield* this.evalArgs(e.items, env))
      case 'Object': {
        const o = this.newObject()
        for (const p of e.props) {
          if (p.spread) {
            const src = yield* this.eval(p.value, env)
            if (isRef(src) && src.kind === 'object') for (const [k, v] of src.props) o.props.set(k, v)
            else if (isRef(src) && src.kind === 'array') src.items.forEach((v, i) => o.props.set(String(i), v))
            continue
          }
          const key = p.computed ? toStr(yield* this.eval(p.computed, env)) : p.key
          const v = yield* this.eval(p.value, env)
          if (isRef(v) && v.kind === 'function' && !v.name) v.name = key
          if (isRef(v) && v.kind === 'function' && p.value.type === 'Func' && !p.value.isArrow) v.isMethod = true
          o.props.set(key, v)
        }
        return o
      }
      case 'Func': {
        const f = this.makeClosure(e, env)
        return f
      }
      case 'Member': {
        if (e.object.type === 'Ident' && e.object.name === 'super') {
          const fn = this.currentFn(env)
          const sup = fn?.homeClass?.superClass
          if (!sup) throw new Unsupported('super.metoda() poza klasą dziedziczącą')
          return this.getMember(sup.proto, toStr(yield* this.eval(e.prop, env)), e.line)
        }
        const obj = yield* this.eval(e.object, env)
        if (e.optional && (obj === null || obj === undefined)) {
          this.note(`${this.src(e.object)} jest ${display(obj)}, więc ?. zwraca undefined zamiast rzucać błąd`)
          return undefined
        }
        const key = e.computed ? yield* this.eval(e.prop, env) : (e.prop as { value: string }).value
        return this.getMember(obj, typeof key === 'number' ? key : toStr(key), e.line, this.src(e.object))
      }
      case 'Call':
        return yield* this.evalCall(e, env)
      case 'New': {
        const callee = yield* this.eval(e.callee, env)
        const args = yield* this.evalArgs(e.args, env)
        return yield* this.construct(callee, args, e.line)
      }
      case 'Unary': {
        if (e.op === 'typeof' && e.arg.type === 'Ident') {
          try {
            return typeOf(this.lookup(env, e.arg.name, e.line).value)
          } catch (err) {
            if (err instanceof JsThrow) return 'undefined'
            throw err
          }
        }
        if (e.op === 'delete') {
          if (e.arg.type === 'Member') {
            const obj = yield* this.eval(e.arg.object, env)
            const key = e.arg.computed ? toStr(yield* this.eval(e.arg.prop, env)) : (e.arg.prop as { value: string }).value
            if (isRef(obj) && obj.kind === 'object') return obj.props.delete(key)
          }
          return true
        }
        const v = yield* this.eval(e.arg, env)
        switch (e.op) {
          case '!': {
            const r = !toBoolean(v)
            this.note(`!${display(v)} → ${r}${typeof v !== 'boolean' ? ` (${display(v)} jest ${toBoolean(v) ? 'truthy' : 'falsy'})` : ''}`)
            return r
          }
          case '-':
            return -toNumber(v)
          case '+':
            return toNumber(v)
          case '~':
            return ~toNumber(v)
          case 'typeof':
            return typeOf(v)
          case 'void':
            return undefined
        }
        throw new Unsupported(`Operator ${e.op}`)
      }
      case 'Update': {
        const old = toNumber(yield* this.eval(e.arg, env))
        const nv = e.op === '++' ? old + 1 : old - 1
        yield* this.assignTo(e.arg, nv, env, e.line)
        return e.prefix ? nv : old
      }
      case 'Binary': {
        const l = yield* this.eval(e.left, env)
        const r = yield* this.eval(e.right, env)
        return this.binop(e.op, l, r, e.line)
      }
      case 'Logical': {
        const l = yield* this.eval(e.left, env)
        if (e.op === '&&') {
          if (!toBoolean(l)) {
            this.note(`lewa strona && (${this.src(e.left)}) jest ${display(l)} (falsy): && zwraca ją od razu i NIE sprawdza prawej strony (short-circuit)`)
            return l
          }
          const r = yield* this.eval(e.right, env)
          this.note(`lewa strona && jest truthy, więc wynikiem jest prawa strona: ${display(r)}`)
          return r
        }
        if (e.op === '||') {
          if (toBoolean(l)) {
            this.note(`lewa strona || (${this.src(e.left)}) jest ${display(l)} (truthy): || zwraca ją od razu i NIE sprawdza prawej strony (short-circuit)`)
            return l
          }
          const r = yield* this.eval(e.right, env)
          this.note(`lewa strona || jest falsy, więc wynikiem jest prawa strona: ${display(r)}`)
          return r
        }
        if (l !== null && l !== undefined) {
          this.note(`?? : lewa strona to ${display(l)} (nie null/undefined), zwracam ją`)
          return l
        }
        const r = yield* this.eval(e.right, env)
        this.note(`?? : lewa strona to ${display(l)}, więc biorę prawą: ${display(r)}`)
        return r
      }
      case 'Cond': {
        const t = yield* this.eval(e.test, env)
        this.note(`operator ?: warunek ${this.src(e.test)} → ${toBoolean(t)}, wybieram ${toBoolean(t) ? 'pierwszą' : 'drugą'} gałąź`)
        return yield* this.eval(toBoolean(t) ? e.cons : e.alt, env)
      }
      case 'Assign': {
        if (e.op === '=') {
          const v = yield* this.eval(e.value, env)
          yield* this.assignTo(e.target, v, env, e.line)
          return v
        }
        const cur = yield* this.eval(e.target, env)
        if (e.op === '&&=' || e.op === '||=' || e.op === '??=') {
          const skip = e.op === '&&=' ? !toBoolean(cur) : e.op === '||=' ? toBoolean(cur) : cur !== null && cur !== undefined
          if (skip) return cur
          const v = yield* this.eval(e.value, env)
          yield* this.assignTo(e.target, v, env, e.line)
          return v
        }
        const rhs = yield* this.eval(e.value, env)
        const v = this.binop(e.op.slice(0, -1), cur, rhs, e.line)
        yield* this.assignTo(e.target, v, env, e.line)
        return v
      }
      case 'Await': {
        const v = yield* this.eval(e.arg, env)
        const p = isRef(v) && v.kind === 'promise' ? v : this.resolvedPromise(v)
        const fnName = this.stack.at(-1)?.fn?.name ?? 'program'
        this.record('await', e.line, `await ${this.src(e.arg)}: ${p.state === 'pending' ? 'obietnica jeszcze trwa (pending)' : `obietnica już ${p.state === 'fulfilled' ? 'spełniona' : 'odrzucona'}, ale i tak`} → funkcja ${fnName} zawiesza się, a sterowanie wraca do wywołującego. Wątek NIE jest blokowany: reszta programu działa dalej. Kontynuacja trafi do kolejki mikrozadań, gdy obietnica się rozstrzygnie.`, 'await zawsze oddaje sterowanie przynajmniej na jedno mikrozadanie')
        const msg = yield { await: p, label: fnName }
        this.curEnv = env
        if (!msg) throw new Unsupported('Wewnętrzny błąd wznowienia await')
        if (!msg.ok) throw new JsThrow(msg.value, e.line)
        return msg.value
      }
      case 'Seq': {
        let v: Value = undefined
        for (const x of e.items) v = yield* this.eval(x, env)
        return v
      }
    }
  }

  private currentFn(env: Env): JsFunction | undefined {
    for (let x: Env | null = env; x; x = x.parent) {
      const slot = x.vars.get('__fn')
      if (slot && isRef(slot.value) && slot.value.kind === 'function') return slot.value
    }
    return undefined
  }

  private resolvedPromise(v: Value): JsPromise {
    const p = this.newPromise(`Promise.resolve(${display(v)})`)
    p.state = 'fulfilled'
    p.value = v
    return p
  }

  private binop(op: string, l: Value, r: Value, line: number): Value {
    switch (op) {
      case '+': {
        const pl = isRef(l) ? this.toPrim(l) : l
        const pr = isRef(r) ? this.toPrim(r) : r
        if (typeof pl === 'string' || typeof pr === 'string') {
          this.note(`+ z napisem: łączenie tekstu ${display(pl)} + ${display(pr)} → ${JSON.stringify(toStr(pl) + toStr(pr))}`)
          return toStr(pl) + toStr(pr)
        }
        return toNumber(pl) + toNumber(pr)
      }
      case '-':
        return toNumber(l) - toNumber(r)
      case '*':
        return toNumber(l) * toNumber(r)
      case '/':
        return toNumber(l) / toNumber(r)
      case '%':
        return toNumber(l) % toNumber(r)
      case '**':
        return toNumber(l) ** toNumber(r)
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const trace: string[] = []
        const res = compare(op, l, r, trace)
        trace.forEach(t => this.note(t))
        this.note(`${display(l)} ${op} ${display(r)} → ${res}`)
        return res
      }
      case '===':
      case '!==': {
        const eq = strictEquals(l, r)
        const res = op === '===' ? eq : !eq
        if (typeOf(l) !== typeOf(r) || (l === null) !== (r === null)) this.note(`${op} nie konwertuje typów: ${typeOf(l === null ? null : l)} vs ${typeOf(r === null ? null : r)} → różne typy, więc ${op === '===' ? 'false' : 'true'}`)
        else if (typeof l === 'number' && Number.isNaN(l)) this.note('NaN nie jest równe niczemu, nawet sobie')
        this.note(`${display(l)} ${op} ${display(r)} → ${res}`)
        return res
      }
      case '==':
      case '!=': {
        const trace: string[] = []
        const eq = looseEquals(l, r, trace)
        trace.forEach(t => this.note(`== konwersja: ${t}`))
        const res = op === '==' ? eq : !eq
        this.note(`${display(l)} ${op} ${display(r)} → ${res}`)
        return res
      }
      case 'instanceof': {
        if (!isRef(r) || r.kind !== 'class') {
          if (isRef(r) && r.kind === 'builtin' && r.name === 'Error') return isRef(l) && l.kind === 'object' && !!l.isError
          if (isRef(r) && r.kind === 'builtin' && r.name === 'Array') return isRef(l) && l.kind === 'array'
          return this.throwError('TypeError', "Right-hand side of 'instanceof' is not callable", line)
        }
        if (!isRef(l) || l.kind !== 'object') return false
        for (let p = l.proto; p; p = p.proto) if (p === r.proto) return true
        return false
      }
      case 'in': {
        if (!isRef(r)) return this.throwError('TypeError', "Cannot use 'in' operator on a primitive", line)
        const k = toStr(l)
        if (r.kind === 'object') return r.props.has(k)
        if (r.kind === 'array') return k === 'length' || (Number(k) >= 0 && Number(k) < r.items.length)
        return false
      }
      case '&':
        return toNumber(l) & toNumber(r)
      case '|':
        return toNumber(l) | toNumber(r)
      case '^':
        return toNumber(l) ^ toNumber(r)
      case '<<':
        return toNumber(l) << toNumber(r)
      case '>>':
        return toNumber(l) >> toNumber(r)
      case '>>>':
        return toNumber(l) >>> toNumber(r)
    }
    throw new Unsupported(`Operator ${op} nie jest obsługiwany`)
  }

  private toPrim(v: Value): Value {
    if (isRef(v) && v.kind === 'object' && v.className === 'Date') return toStr(v.props.get('__iso'))
    if (isRef(v) && v.kind === 'object' && v.internal instanceof Map) return '[object Map]'
    return isRef(v) && v.kind === 'array' ? v.items.map(x => (x === null || x === undefined ? '' : toStr(x))).join(',') : isRef(v) && v.kind === 'object' && !v.isError ? '[object Object]' : toStr(v)
  }

  private *assignTo(target: Expr, v: Value, env: Env, line: number): Gen<void> {
    if (target.type === 'Ident') {
      this.assignVar(env, target.name, v, line)
      return
    }
    if (target.type === 'Member') {
      const obj = yield* this.eval(target.object, env)
      const key = target.computed ? yield* this.eval(target.prop, env) : (target.prop as { value: string }).value
      this.setMember(obj, key, v, line)
      return
    }
    throw new Unsupported('Nieobsługiwany cel przypisania')
  }

  private setMember(obj: Value, key: Value, v: Value, line: number): void {
    if (obj === null || obj === undefined) this.throwError('TypeError', `Cannot set properties of ${display(obj)} (setting '${toStr(key)}')`, line)
    if (!isRef(obj)) return // przypisanie do prymitywu jest ignorowane (poza strict)
    if (obj.kind === 'array') {
      if (key === 'length') {
        obj.items.length = toNumber(v)
        return
      }
      const idx = typeof key === 'number' ? key : Number(toStr(key))
      if (Number.isInteger(idx) && idx >= 0) {
        while (obj.items.length < idx) obj.items.push(undefined)
        obj.items[idx] = v
        return
      }
      throw new Unsupported('Nienumeryczne właściwości tablic nie są obsługiwane')
    }
    if (obj.kind === 'object') {
      obj.props.set(toStr(key), v)
      return
    }
    if (obj.kind === 'class') {
      obj.statics.set(toStr(key), v)
      return
    }
    throw new Unsupported(`Przypisanie właściwości do ${obj.kind}`)
  }

  private *evalCall(e: Extract<Expr, { type: 'Call' }>, env: Env): Gen<Value> {
    // super(...) w konstruktorze
    if (e.callee.type === 'Ident' && e.callee.name === 'super') {
      const fn = this.currentFn(env)
      const sup = fn?.homeClass?.superClass
      if (!sup) throw new Unsupported('super() poza konstruktorem klasy dziedziczącej')
      const thisObj = this.lookupThis(env)
      const args = yield* this.evalArgs(e.args, env)
      if (isRef(thisObj) && thisObj.kind === 'object') yield* this.initInstance(sup, thisObj, args, e.line)
      return undefined
    }
    let thisArg: Value = undefined
    let fn: Value
    let name = this.src(e.callee)
    if (e.callee.type === 'Member') {
      const m = e.callee
      if (m.object.type === 'Ident' && m.object.name === 'super') {
        const f = this.currentFn(env)
        const sup = f?.homeClass?.superClass
        if (!sup) throw new Unsupported('super.metoda() poza klasą dziedziczącą')
        thisArg = this.lookupThis(env)
        fn = this.getMember(sup.proto, toStr((m.prop as { value: string }).value), e.line)
      } else {
        thisArg = yield* this.eval(m.object, env)
        if (m.optional && (thisArg === null || thisArg === undefined)) return undefined
        const key = m.computed ? yield* this.eval(m.prop, env) : (m.prop as { value: string }).value
        fn = this.getMember(thisArg, typeof key === 'number' ? key : toStr(key), e.line, this.src(m.object))
      }
    } else {
      fn = yield* this.eval(e.callee, env)
      name = e.callee.type === 'Ident' ? e.callee.name : name
    }
    if (e.optional && (fn === null || fn === undefined)) return undefined
    const args = yield* this.evalArgs(e.args, env)
    if (isRef(fn) && fn.kind === 'function' && fn.node.isArrow) thisArg = undefined
    return yield* this.callFunction(fn, thisArg, args, e.line, name)
  }

  private lookupThis(env: Env): Value {
    for (let x: Env | null = env; x; x = x.parent) {
      const slot = x.vars.get('this')
      if (slot) return slot.value
    }
    return undefined
  }

  // ===================== właściwości =====================

  private getMember(obj: Value, key: string | number, line: number, objSrc?: string): Value {
    if (obj === null || obj === undefined) {
      return this.throwError('TypeError', `Cannot read properties of ${display(obj)} (reading '${key}')${objSrc ? ` – ${objSrc} jest ${display(obj)}` : ''}`, line)
    }
    const k = String(key)
    if (typeof obj === 'string') return this.stringMember(obj, k)
    if (typeof obj === 'number') return this.numberMember(obj, k)
    if (typeof obj === 'boolean') return undefined
    switch (obj.kind) {
      case 'array':
        return this.arrayMember(obj, k)
      case 'object': {
        if (obj.internal) return this.collectionMember(obj, k)
        if (obj.props.has(k)) return this.bindIfMethod(obj.props.get(k), obj)
        for (let p = obj.proto; p; p = p.proto) if (p.props.has(k)) return this.bindIfMethod(p.props.get(k), obj)
        if (k === 'hasOwnProperty') return this.fnBuiltin('hasOwnProperty', (_t, a) => obj.props.has(toStr(a[0])))
        return undefined
      }
      case 'promise':
        return this.promiseMember(obj, k)
      case 'class':
        if (obj.statics.has(k)) return obj.statics.get(k)
        if (k === 'name') return obj.name
        return undefined
      case 'builtin':
        if (k === 'name') return obj.name
        return obj.props?.get(k)
      case 'function':
        if (k === 'name') return obj.name
        if (k === 'length') return obj.node.params.length
        if (k === 'call') return this.builtin('call', (_t, a) => this.callFunction(obj, a[0], a.slice(1), line))
        if (k === 'apply') return this.builtin('apply', (_t, a) => this.callFunction(obj, a[0], isRef(a[1]) && a[1].kind === 'array' ? a[1].items : [], line))
        if (k === 'bind') {
          return this.fnBuiltin('bind', (_t, a) => {
            const thisArg = a[0]
            const pre = a.slice(1)
            return this.builtin(`bound ${obj.name}`, (_tt, args) => this.callFunction(obj, thisArg, [...pre, ...args], line))
          })
        }
        return undefined
    }
  }

  private bindIfMethod(v: Value, _obj: JsObject): Value {
    return v
  }

  private stringMember(s: string, k: string): Value {
    if (k === 'length') return s.length
    if (/^\d+$/.test(k)) return s[Number(k)]
    const S = (name: string, f: (args: Value[]) => Value) => this.fnBuiltin(name, (_t, a) => f(a))
    switch (k) {
      case 'toUpperCase':
        return S(k, () => s.toUpperCase())
      case 'toLowerCase':
        return S(k, () => s.toLowerCase())
      case 'trim':
        return S(k, () => s.trim())
      case 'includes':
        return S(k, a => s.includes(toStr(a[0])))
      case 'startsWith':
        return S(k, a => s.startsWith(toStr(a[0])))
      case 'endsWith':
        return S(k, a => s.endsWith(toStr(a[0])))
      case 'indexOf':
        return S(k, a => s.indexOf(toStr(a[0])))
      case 'slice':
        return S(k, a => s.slice(a[0] === undefined ? undefined : toNumber(a[0]), a[1] === undefined ? undefined : toNumber(a[1])))
      case 'substring':
        return S(k, a => s.substring(toNumber(a[0]), a[1] === undefined ? undefined : toNumber(a[1])))
      case 'split':
        return S(k, a => this.newArray(s.split(a[0] === undefined ? (undefined as unknown as string) : toStr(a[0]))))
      case 'replace':
        return S(k, a => s.replace(toStr(a[0]), toStr(a[1])))
      case 'replaceAll':
        return S(k, a => s.split(toStr(a[0])).join(toStr(a[1])))
      case 'padStart':
        return S(k, a => s.padStart(toNumber(a[0]), a[1] === undefined ? ' ' : toStr(a[1])))
      case 'padEnd':
        return S(k, a => s.padEnd(toNumber(a[0]), a[1] === undefined ? ' ' : toStr(a[1])))
      case 'repeat':
        return S(k, a => s.repeat(toNumber(a[0])))
      case 'charAt':
        return S(k, a => s.charAt(toNumber(a[0] ?? 0)))
      case 'at':
        return S(k, a => s.at(toNumber(a[0])))
      case 'concat':
        return S(k, a => s + a.map(toStr).join(''))
      case 'toString':
        return S(k, () => s)
    }
    return undefined
  }

  private numberMember(n: number, k: string): Value {
    if (k === 'toFixed') return this.fnBuiltin(k, (_t, a) => n.toFixed(toNumber(a[0] ?? 0)))
    if (k === 'toString') return this.fnBuiltin(k, (_t, a) => n.toString(a[0] === undefined ? 10 : toNumber(a[0])))
    return undefined
  }

  private arrayMember(arr: JsArray, k: string): Value {
    if (k === 'length') return arr.items.length
    if (/^\d+$/.test(k)) return arr.items[Number(k)]
    const self = this
    const cb = (name: string, f: (fn: Value, args: Value[]) => Gen<Value>) => this.builtin(name, (_t, a) => f(a[0], a))
    const call = (fn: Value, x: Value, i: number) => self.callFunction(fn, undefined, [x, i, arr], self.lastLine, 'callback')
    switch (k) {
      case 'push':
        return this.fnBuiltin(k, (_t, a) => arr.items.push(...a))
      case 'pop':
        return this.fnBuiltin(k, () => arr.items.pop())
      case 'shift':
        return this.fnBuiltin(k, () => arr.items.shift())
      case 'unshift':
        return this.fnBuiltin(k, (_t, a) => arr.items.unshift(...a))
      case 'includes':
        return this.fnBuiltin(k, (_t, a) => arr.items.some(x => strictEquals(x, a[0]) || (Number.isNaN(x) && Number.isNaN(a[0]))))
      case 'indexOf':
        return this.fnBuiltin(k, (_t, a) => arr.items.findIndex(x => strictEquals(x, a[0])))
      case 'join':
        return this.fnBuiltin(k, (_t, a) => arr.items.map(x => (x === null || x === undefined ? '' : toStr(x))).join(a[0] === undefined ? ',' : toStr(a[0])))
      case 'slice':
        return this.fnBuiltin(k, (_t, a) => this.newArray(arr.items.slice(a[0] === undefined ? undefined : toNumber(a[0]), a[1] === undefined ? undefined : toNumber(a[1]))))
      case 'splice':
        return this.fnBuiltin(k, (_t, a) => this.newArray(arr.items.splice(toNumber(a[0]), a[1] === undefined ? arr.items.length : toNumber(a[1]), ...a.slice(2))))
      case 'concat':
        return this.fnBuiltin(k, (_t, a) => this.newArray(arr.items.concat(...a.map(x => (isRef(x) && x.kind === 'array' ? x.items : [x])))))
      case 'reverse':
        return this.fnBuiltin(k, () => (arr.items.reverse(), arr))
      case 'at':
        return this.fnBuiltin(k, (_t, a) => arr.items.at(toNumber(a[0])))
      case 'flat':
        return this.fnBuiltin(k, () => this.newArray(arr.items.flatMap(x => (isRef(x) && x.kind === 'array' ? x.items : [x]))))
      case 'fill':
        return this.fnBuiltin(k, (_t, a) => (arr.items.fill(a[0]), arr))
      case 'forEach':
        return cb(k, function* (fn) {
          for (let i = 0; i < arr.items.length; i++) yield* call(fn, arr.items[i], i)
          return undefined
        })
      case 'map':
        return cb(k, function* (fn) {
          const out: Value[] = []
          for (let i = 0; i < arr.items.length; i++) out.push(yield* call(fn, arr.items[i], i))
          return self.newArray(out)
        })
      case 'filter':
        return cb(k, function* (fn) {
          const out: Value[] = []
          for (let i = 0; i < arr.items.length; i++) if (toBoolean(yield* call(fn, arr.items[i], i))) out.push(arr.items[i])
          return self.newArray(out)
        })
      case 'find':
        return cb(k, function* (fn) {
          for (let i = 0; i < arr.items.length; i++) if (toBoolean(yield* call(fn, arr.items[i], i))) return arr.items[i]
          return undefined
        })
      case 'findIndex':
        return cb(k, function* (fn) {
          for (let i = 0; i < arr.items.length; i++) if (toBoolean(yield* call(fn, arr.items[i], i))) return i
          return -1
        })
      case 'some':
        return cb(k, function* (fn) {
          for (let i = 0; i < arr.items.length; i++) if (toBoolean(yield* call(fn, arr.items[i], i))) return true
          return false
        })
      case 'every':
        return cb(k, function* (fn) {
          for (let i = 0; i < arr.items.length; i++) if (!toBoolean(yield* call(fn, arr.items[i], i))) return false
          return true
        })
      case 'reduce':
        return this.builtin(k, function* (_t, a) {
          const fn = a[0]
          let i = 0
          let acc: Value
          if (a.length > 1) acc = a[1]
          else {
            if (arr.items.length === 0) self.throwError('TypeError', 'Reduce of empty array with no initial value', self.lastLine)
            acc = arr.items[0]
            i = 1
          }
          for (; i < arr.items.length; i++) acc = yield* self.callFunction(fn, undefined, [acc, arr.items[i], i, arr], self.lastLine, 'reducer')
          return acc
        })
      case 'sort':
        return this.builtin(k, function* (_t, a) {
          const fn = a[0]
          // sortowanie przez wstawianie: deterministyczne i stabilne, jak w specyfikacji (stabilność od ES2019)
          const items = arr.items
          for (let i = 1; i < items.length; i++) {
            const x = items[i]
            let j = i - 1
            for (; j >= 0; j--) {
              let c: number
              if (fn === undefined) c = toStr(items[j]) > toStr(x) ? 1 : -1
              else c = toNumber(yield* self.callFunction(fn, undefined, [items[j], x], self.lastLine, 'comparator'))
              if (c > 0) items[j + 1] = items[j]
              else break
            }
            items[j + 1] = x
          }
          return arr
        })
    }
    return undefined
  }

  private collectionMember(obj: JsObject, k: string): Value {
    const self = this
    const store = obj.internal!
    if (store instanceof Map) {
      switch (k) {
        case 'size':
          return store.size
        case 'get':
          return this.fnBuiltin(k, (_t, a) => store.get(a[0]))
        case 'set':
          return this.fnBuiltin(k, (_t, a) => (store.set(a[0], a[1]), obj))
        case 'has':
          return this.fnBuiltin(k, (_t, a) => store.has(a[0]))
        case 'delete':
          return this.fnBuiltin(k, (_t, a) => store.delete(a[0]))
        case 'clear':
          return this.fnBuiltin(k, () => (store.clear(), undefined))
        case 'keys':
          return this.fnBuiltin(k, () => this.newArray([...store.keys()]))
        case 'values':
          return this.fnBuiltin(k, () => this.newArray([...store.values()]))
        case 'entries':
          return this.fnBuiltin(k, () => this.newArray([...store.entries()].map(([a, b]) => this.newArray([a, b]))))
        case 'forEach':
          return this.builtin(k, function* (_t, a) {
            for (const [key, v] of store) yield* self.callFunction(a[0], undefined, [v, key, obj], self.lastLine)
            return undefined
          })
      }
      return undefined
    }
    switch (k) {
      case 'size':
        return store.size
      case 'add':
        return this.fnBuiltin(k, (_t, a) => (store.add(a[0]), obj))
      case 'has':
        return this.fnBuiltin(k, (_t, a) => store.has(a[0]))
      case 'delete':
        return this.fnBuiltin(k, (_t, a) => store.delete(a[0]))
      case 'clear':
        return this.fnBuiltin(k, () => (store.clear(), undefined))
      case 'values':
      case 'keys':
        return this.fnBuiltin(k, () => this.newArray([...store.values()]))
      case 'forEach':
        return this.builtin(k, function* (_t, a) {
          for (const v of store) yield* self.callFunction(a[0], undefined, [v, v, obj], self.lastLine)
          return undefined
        })
    }
    return undefined
  }

  private promiseMember(p: JsPromise, k: string): Value {
    const self = this
    if (k === 'then' || k === 'catch' || k === 'finally') {
      return this.fnBuiltin(k, (_t, a) => {
        const target = self.newPromise(`${p.label}.${k}()`)
        const cbName = (v: Value) => (isRef(v) && v.kind === 'function' && v.name ? v.name : 'callback')
        if (k === 'then') self.then(p, a[0] ?? null, a[1] ?? null, target, `${k}-callback ${cbName(a[0])} (obietnica ${p.label})`)
        else if (k === 'catch') self.then(p, null, a[0] ?? null, target, `catch-callback ${cbName(a[0])} (obietnica ${p.label})`)
        else {
          const f = a[0]
          self.then(p, null, null, null, `finally-callback (obietnica ${p.label})`, (ok, v) => {
            try {
              self.runSync(self.callFunction(f, undefined, [], self.lastLine))
              ok ? self.resolvePromise(target, v) : self.settle(target, 'rejected', v)
            } catch (e) {
              if (e instanceof JsThrow) self.settle(target, 'rejected', e.value)
              else throw e
            }
          })
        }
        return target
      })
    }
    return undefined
  }

  // ===================== wbudowane =====================

  private installBuiltins(): void {
    const g = (name: string, v: Value) => this.builtins.vars.set(name, { value: v, kind: 'const' })
    const self = this
    const consoleObj = this.newObject('console')
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
      consoleObj.props.set(m, this.fnBuiltin(`console.${m}`, (_t, a) => {
        self.out.push((m === 'error' || m === 'warn' ? `[${m}] ` : '') + logFormat(a))
        return undefined
      }))
    }
    g('console', consoleObj)

    const math = this.newObject('Math')
    const mf = (name: string, f: (...n: number[]) => number) => math.props.set(name, this.fnBuiltin(`Math.${name}`, (_t, a) => f(...a.map(toNumber))))
    mf('floor', Math.floor)
    mf('ceil', Math.ceil)
    mf('round', Math.round)
    mf('abs', Math.abs)
    mf('max', Math.max)
    mf('min', Math.min)
    mf('sqrt', Math.sqrt)
    mf('pow', Math.pow)
    mf('trunc', Math.trunc)
    mf('sign', Math.sign)
    math.props.set('PI', Math.PI)
    math.props.set('random', this.fnBuiltin('Math.random', () => {
      self.hypotheses.add('Math.random() zwraca w symulatorze stały, powtarzalny ciąg liczb pseudolosowych. W prawdziwym programie każde uruchomienie da inne wartości.')
      self.rng = (self.rng * 1103515245 + 12345) % 2147483648
      return self.rng / 2147483648
    }))
    g('Math', math)

    g('String', this.fnBuiltin('String', (_t, a) => toStr(a[0])))
    g('Number', this.builtin('Number', function* (_t, a) {
      return toNumber(a[0])
    }, new Map<string, Value>([
      ['isInteger', this.fnBuiltin('Number.isInteger', (_t, a) => typeof a[0] === 'number' && Number.isInteger(a[0]))],
      ['isNaN', this.fnBuiltin('Number.isNaN', (_t, a) => typeof a[0] === 'number' && Number.isNaN(a[0]))],
      ['parseFloat', this.fnBuiltin('Number.parseFloat', (_t, a) => parseFloat(toStr(a[0])))],
    ])))
    g('Boolean', this.fnBuiltin('Boolean', (_t, a) => toBoolean(a[0])))
    g('parseInt', this.fnBuiltin('parseInt', (_t, a) => parseInt(toStr(a[0]), a[1] === undefined ? undefined : toNumber(a[1]))))
    g('parseFloat', this.fnBuiltin('parseFloat', (_t, a) => parseFloat(toStr(a[0]))))
    g('isNaN', this.fnBuiltin('isNaN', (_t, a) => Number.isNaN(toNumber(a[0]))))
    g('NaN', NaN)
    g('Infinity', Infinity)

    const toJson = (v: Value): unknown => {
      if (v === undefined || (isRef(v) && (v.kind === 'function' || v.kind === 'builtin'))) return undefined
      if (!isRef(v)) return v
      if (v.kind === 'array') return v.items.map(x => toJson(x) ?? null)
      if (v.kind === 'object') {
        const o: Record<string, unknown> = {}
        for (const [k, x] of v.props) {
          const j = toJson(x)
          if (j !== undefined) o[k] = j
        }
        return o
      }
      return {}
    }
    const fromJson = (j: unknown): Value => {
      if (Array.isArray(j)) return self.newArray(j.map(fromJson))
      if (j && typeof j === 'object') {
        const o = self.newObject()
        for (const [k, x] of Object.entries(j)) o.props.set(k, fromJson(x))
        return o
      }
      return j as Value
    }
    const json = this.newObject('JSON')
    json.props.set('stringify', this.fnBuiltin('JSON.stringify', (_t, a) => JSON.stringify(toJson(a[0]), null, a[2] === undefined ? undefined : toNumber(a[2]))))
    json.props.set('parse', this.fnBuiltin('JSON.parse', (_t, a) => {
      try {
        return fromJson(JSON.parse(toStr(a[0])))
      } catch {
        return self.throwError('SyntaxError', `Unexpected token in JSON: ${toStr(a[0]).slice(0, 30)}`, self.lastLine)
      }
    }))
    g('JSON', json)

    g('Object', this.builtin('Object', function* () {
      return self.newObject()
    }, new Map<string, Value>([
      ['keys', this.fnBuiltin('Object.keys', (_t, a) => this.newArray(isRef(a[0]) && a[0].kind === 'object' ? [...a[0].props.keys()] : isRef(a[0]) && a[0].kind === 'array' ? a[0].items.map((_, i) => String(i)) : []))],
      ['values', this.fnBuiltin('Object.values', (_t, a) => this.newArray(isRef(a[0]) && a[0].kind === 'object' ? [...a[0].props.values()] : isRef(a[0]) && a[0].kind === 'array' ? [...a[0].items] : []))],
      ['entries', this.fnBuiltin('Object.entries', (_t, a) => this.newArray(isRef(a[0]) && a[0].kind === 'object' ? [...a[0].props.entries()].map(([k, v]) => this.newArray([k, v])) : []))],
      ['assign', this.fnBuiltin('Object.assign', (_t, a) => {
        const t = a[0]
        if (isRef(t) && t.kind === 'object') for (const s of a.slice(1)) if (isRef(s) && s.kind === 'object') for (const [k, v] of s.props) t.props.set(k, v)
        return t
      })],
      ['freeze', this.fnBuiltin('Object.freeze', (_t, a) => {
        self.hypotheses.add('Object.freeze jest w symulatorze tylko zaznaczony: zamrożenie nie blokuje zapisu. W prawdziwym JS zapis do zamrożonego obiektu jest ignorowany (albo rzuca TypeError w trybie strict).')
        return a[0]
      })],
    ])))

    g('Array', this.builtin('Array', function* (_t, a) {
      return self.newArray(a.length === 1 && typeof a[0] === 'number' ? new Array<Value>(a[0]).fill(undefined) : a)
    }, new Map<string, Value>([
      ['isArray', this.fnBuiltin('Array.isArray', (_t, a) => isRef(a[0]) && a[0].kind === 'array')],
      ['from', this.builtin('Array.from', function* (_t, a) {
        const src = a[0]
        let items: Value[]
        if (isRef(src) && src.kind === 'object' && src.props.has('length') && !src.internal) items = new Array<Value>(toNumber(src.props.get('length'))).fill(undefined)
        else items = self.iterate(src, self.lastLine)
        if (a[1]) {
          const out: Value[] = []
          for (let i = 0; i < items.length; i++) out.push(yield* self.callFunction(a[1], undefined, [items[i], i], self.lastLine))
          return self.newArray(out)
        }
        return self.newArray(items)
      })],
    ])))

    const errorCtor = (name: string) =>
      this.builtin(name, function* (_t, a) {
        return self.makeError(name, a[0] === undefined ? '' : toStr(a[0]))
      }, new Map<string, Value>([['__construct', this.fnBuiltin(`new ${name}`, (_t, a) => self.makeError(name, a[0] === undefined ? '' : toStr(a[0])))]]))
    g('Error', errorCtor('Error'))
    g('TypeError', errorCtor('TypeError'))
    g('RangeError', errorCtor('RangeError'))

    const collection = (kind: 'Map' | 'Set') =>
      this.builtin(kind, function* () {
        return self.throwError('TypeError', `Constructor ${kind} requires 'new'`, self.lastLine)
      }, new Map<string, Value>([['__construct', this.fnBuiltin(`new ${kind}`, (_t, a) => {
        const o = self.newObject(kind)
        if (kind === 'Map') {
          const m = new Map<Value, Value>()
          if (a[0] !== undefined) for (const e of self.iterate(a[0], self.lastLine)) if (isRef(e) && e.kind === 'array') m.set(e.items[0], e.items[1])
          o.internal = m
        } else {
          o.internal = new Set<Value>(a[0] === undefined ? [] : self.iterate(a[0], self.lastLine))
        }
        return o
      })]]))
    g('Map', collection('Map'))
    g('Set', collection('Set'))

    // ---- Promise ----
    const promiseStatics = new Map<string, Value>([
      ['resolve', this.fnBuiltin('Promise.resolve', (_t, a) => (isRef(a[0]) && a[0].kind === 'promise' ? a[0] : self.resolvedPromise(a[0])))],
      ['reject', this.fnBuiltin('Promise.reject', (_t, a) => {
        const p = self.newPromise(`Promise.reject(${display(a[0])})`)
        p.state = 'rejected'
        p.value = a[0]
        return p
      })],
      ['all', this.fnBuiltin('Promise.all', (_t, a) => {
        const items = self.iterate(a[0], self.lastLine)
        const target = self.newPromise('Promise.all')
        const results: Value[] = new Array<Value>(items.length).fill(undefined)
        let left = items.length
        if (left === 0) self.resolvePromise(target, self.newArray([]))
        items.forEach((it, i) => {
          const p = isRef(it) && it.kind === 'promise' ? it : self.resolvedPromise(it)
          self.then(p, null, null, null, `Promise.all: element ${i} gotowy`, (ok, v) => {
            if (!ok) return self.settle(target, 'rejected', v)
            results[i] = v
            if (--left === 0) self.resolvePromise(target, self.newArray(results))
          })
        })
        return target
      })],
      ['race', this.fnBuiltin('Promise.race', (_t, a) => {
        const target = self.newPromise('Promise.race')
        self.iterate(a[0], self.lastLine).forEach((it, i) => {
          const p = isRef(it) && it.kind === 'promise' ? it : self.resolvedPromise(it)
          self.then(p, null, null, null, `Promise.race: element ${i}`, (ok, v) => (ok ? self.resolvePromise(target, v) : self.settle(target, 'rejected', v)))
        })
        return target
      })],
      ['__construct', this.builtin('new Promise', function* (_t, a) {
        const p = self.newPromise('new Promise')
        const resolve = self.fnBuiltin('resolve', (_tt, x) => (self.resolvePromise(p, x[0]), undefined))
        const reject = self.fnBuiltin('reject', (_tt, x) => (self.settle(p, 'rejected', x[0]), undefined))
        try {
          yield* self.callFunction(a[0], undefined, [resolve, reject], self.lastLine, 'executor')
        } catch (e) {
          if (e instanceof JsThrow) self.settle(p, 'rejected', e.value)
          else throw e
        }
        return p
      })],
    ])
    g('Promise', this.builtin('Promise', function* () {
      return self.throwError('TypeError', "Promise constructor cannot be invoked without 'new'", self.lastLine)
    }, promiseStatics))

    g('queueMicrotask', this.fnBuiltin('queueMicrotask', (_t, a) => {
      const f = a[0]
      self.micro.push({ label: `queueMicrotask(${isRef(f) && f.kind === 'function' && f.name ? f.name : 'callback'})`, run: () => self.runTask(f) })
      return undefined
    }))
    g('setTimeout', this.fnBuiltin('setTimeout', (_t, a) => {
      const f = a[0]
      const ms = Math.max(0, toNumber(a[1] ?? 0) || 0)
      const id = self.seq + 1
      self.macro.push({ label: `setTimeout(${isRef(f) && f.kind === 'function' && f.name ? f.name : 'callback'}, ${ms})`, time: self.clock + ms, seq: self.seq++, id, run: () => self.runTask(f, a.slice(2)) })
      if (ms === 0) self.hypotheses.add('setTimeout(…, 0) nie uruchamia funkcji natychmiast: trafia do kolejki makrozadań i czeka, aż stos i mikrozadania się opróżnią. W przeglądarce opóźnienie bywa dodatkowo podbijane do ≥ 4 ms przy zagnieżdżonych timerach.')
      return id
    }))
    g('clearTimeout', this.fnBuiltin('clearTimeout', (_t, a) => {
      const i = self.macro.findIndex(m => m.id === a[0])
      if (i >= 0) self.macro.splice(i, 1)
      return undefined
    }))
    g('setInterval', this.fnBuiltin('setInterval', () => {
      throw new Unsupported('setInterval nie jest obsługiwany w symulatorze (użyj setTimeout)')
    }))
    g('fetch', this.fnBuiltin('fetch', (_t, a) => {
      const url = toStr(a[0])
      self.hypotheses.add(`fetch(${JSON.stringify(url)}) nie wysyła prawdziwego żądania. Symulator ZAKŁADA odpowiedź 200 po 100 ms wirtualnego czasu z przykładowym JSON. W rzeczywistości czas i wynik zależą od sieci i serwera, a żądanie może się nie udać.`)
      const p = self.newPromise(`fetch(${url.length > 30 ? url.slice(0, 27) + '…' : url})`)
      self.macro.push({
        label: `odpowiedź sieci dla fetch (założenie)`,
        hypothetical: true,
        time: self.clock + 100,
        seq: self.seq++,
        id: -1,
        run: () => {
          const res = self.newObject('Response')
          res.props.set('ok', true)
          res.props.set('status', 200)
          const body = self.newObject()
          body.props.set('id', 1)
          body.props.set('name', 'przykład')
          res.props.set('json', self.fnBuiltin('json', () => self.resolvedPromise(body)))
          res.props.set('text', self.fnBuiltin('text', () => self.resolvedPromise('{"id":1,"name":"przykład"}')))
          self.resolvePromise(p, res)
        },
      })
      return p
    }))
    const dateNow = this.fnBuiltin('Date.now', () => {
      self.hypotheses.add('Date.now() zwraca w symulatorze wirtualny czas (start 0 ms, rośnie tylko przy timerach). Prawdziwy zegar zależy od chwili uruchomienia.')
      return self.clock
    })
    g('Date', this.builtin('Date', function* () {
      return new Date(self.clock).toISOString()
    }, new Map<string, Value>([
      ['now', dateNow],
      ['__construct', this.fnBuiltin('new Date', (_t, a) => {
        const d = self.newObject('Date')
        const t = a[0] === undefined ? self.clock : typeof a[0] === 'number' ? a[0] : Date.parse(toStr(a[0]))
        if (a[0] === undefined) self.hypotheses.add('new Date() bez argumentu używa w symulatorze wirtualnego czasu 1970-01-01T00:00:00Z + upływ timerów.')
        d.props.set('__iso', Number.isNaN(t) ? 'Invalid Date' : new Date(t).toISOString())
        d.props.set('getTime', self.fnBuiltin('getTime', () => t))
        d.props.set('toISOString', self.fnBuiltin('toISOString', () => new Date(t).toISOString()))
        return d
      })],
    ])))
  }

  private runTask(f: Value, args: Value[] = []): void {
    try {
      this.runSync(this.callFunction(f, undefined, args, this.lastLine, 'callback'))
    } catch (e) {
      if (e instanceof JsThrow) {
        this.out.push(`Uncaught ${display(e.value)}`)
        this.record('unwind', e.line, `Wyjątek ${display(e.value)} nie został złapany w zadaniu z kolejki: w Node kończy proces, w przeglądarce trafia do konsoli jako Uncaught.`)
        return
      }
      throw e
    }
  }
}
