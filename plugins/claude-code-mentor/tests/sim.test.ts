// Testy akceptacyjne symulatora (rozszerzenie P0, punkty 1-5).
import { expect, test } from 'claude-code/testing'
import { simulate } from '../hooks/sim/interp'
import { applyEdits, compareRuns, findSites } from '../hooks/sim/variants'
import { evalCond, parseLiteral } from '../hooks/sim/conditions'
import type { Lit } from '../hooks/sim/conditions'

const IF_SRC = 'let x = 7\nif (x < 10) {\n  console.log("if")\n} else {\n  console.log("else")\n}'
const lit = (s: string, lang: 'js' | 'py' | 'php' = 'js'): Lit => {
  const l = parseLiteral(s, lang)
  if ('error' in l) throw new Error(l.error)
  return l
}

test('1: zamiana < na > zmienia wynik warunku i wybraną gałąź', async () => {
  const a = simulate(IF_SRC)
  expect(a.ok).toBe(true)
  expect(a.output).toEqual(['if'])
  const site = findSites(IF_SRC).ops.find(o => o.op === '<')!
  expect(site.line).toBe(2)
  const bSrc = applyEdits(IF_SRC, [{ start: site.start, end: site.end, text: '>' }])
  const b = simulate(bSrc)
  expect(b.output).toEqual(['else'])
  expect(a.conditions[0]!.results).toEqual([true])
  expect(b.conditions[0]!.results).toEqual([false])
  const cmp = compareRuns(a, b, [{ before: '<', after: '>', line: 2 }])
  expect(cmp.same).toBe(false)
  expect(cmp.lines.join(' ')).toMatch(/Linia 2/)
})

test('2: przypadki brzegowe i operatory równości wg semantyki języka', async () => {
  for (const [op, want] of [['<', false], ['>', false], ['<=', true], ['>=', true]] as const) {
    expect(evalCond('js', op, lit('10'), lit('10')).value).toBe(want)
  }
  expect(evalCond('js', '<', lit('7'), lit('10')).value).toBe(true)
  expect(evalCond('js', '>', lit('7'), lit('10')).value).toBe(false)
  expect(evalCond('js', '==', lit('0'), lit('""')).value).toBe(true)
  expect(evalCond('js', '===', lit('0'), lit('""')).value).toBe(false)
  expect(evalCond('js', '==', lit('null'), lit('undefined')).value).toBe(true)
  expect(evalCond('js', '==', lit('null'), lit('0')).value).toBe(false)
  expect(evalCond('js', '<', lit('"10"'), lit('"9"')).value).toBe(true)
  expect(evalCond('js', '<', lit('NaN'), lit('1')).value).toBe(false)
  expect(evalCond('py', '==', lit('1', 'py'), lit('"1"', 'py')).value).toBe(false)
  expect(evalCond('py', '==', lit('1', 'py'), lit('True', 'py')).value).toBe(true)
  const pyErr = evalCond('py', '<', lit('1', 'py'), lit('"1"', 'py'))
  expect(pyErr.value).toBe(null)
  expect(pyErr.error ?? '').toMatch(/TypeError/)
  expect(evalCond('php', '==', lit('0', 'php'), lit('"abc"', 'php')).value).toBe(false)
  expect(evalCond('php', '==', lit('"1e3"', 'php'), lit('"1000"', 'php')).value).toBe(true)
  expect(evalCond('php', '==', lit('null', 'php'), lit('0', 'php')).value).toBe(true)
  expect(evalCond('php', '===', lit('1', 'php'), lit('"1"', 'php')).value).toBe(false)
  const r = simulate('let x = 10\nconsole.log(x < 10, x <= 10, x == "10", x === "10")')
  expect(r.output).toEqual(['false true true false'])
})

test('3: pętla pokazuje co najmniej 5 kolejnych kroków z licznikiem i końcem', async () => {
  const r = simulate('let sum = 0\nfor (let i = 0; i < 5; i++) {\n  sum += i\n}\nconsole.log(sum)')
  expect(r.ok).toBe(true)
  const loopConds = r.steps.filter(s => s.kind === 'cond' && s.loop)
  expect(loopConds.length).toBe(6)
  expect(loopConds.map(s => s.cond!.result)).toEqual([true, true, true, true, true, false])
  expect(loopConds[4]!.vars.i).toBe('4')
  expect(r.steps.filter(s => s.text.startsWith('Krok pętli')).length).toBe(5)
  expect(r.loops).toEqual([{ line: 2, iterations: 5 }])
  expect(r.output).toEqual(['10'])
})

test('4: wywołanie funkcji: argumenty, ramka stosu i zwrócona wartość', async () => {
  const r = simulate('function add(a, b) {\n  return a + b\n}\nconst out = add(2, 3)\nconsole.log(out)')
  const call = r.steps.find(s => s.kind === 'call')!
  expect(call.text).toMatch(/add\(a = 2, b = 3\)/)
  expect(call.vars.a).toBe('2')
  expect(call.stack).toEqual(['(program)', 'add(a = 2, b = 3)'])
  const ret = r.steps.find(s => s.kind === 'return')!
  expect(ret.text).toMatch(/zwraca 5/)
  expect(r.finalVars.out).toBe('5')
})

test('5: podmiana operatora tworzy nowy tekst, oryginał zostaje nietknięty', async () => {
  const original = IF_SRC
  const copy = String(IF_SRC)
  const site = findSites(original).ops[0]!
  const b = applyEdits(original, [{ start: site.start, end: site.end, text: '>=' }])
  expect(original).toBe(copy)
  expect(b).toMatch(/x >= 10/)
  expect(original).toMatch(/x < 10/)
})

test('async/await: kolejność zgodna z event loop (mikro przed makro)', async () => {
  const r = simulate('console.log("A")\nsetTimeout(() => console.log("T"), 0)\nPromise.resolve().then(() => console.log("P"))\nasync function f() {\n  console.log("F1")\n  await null\n  console.log("F2")\n}\nf()\nconsole.log("B")')
  expect(r.output).toEqual(['A', 'F1', 'B', 'P', 'F2', 'T'])
  expect(r.steps.some(s => s.kind === 'await')).toBe(true)
  expect(r.steps.some(s => s.kind === 'task' && /mikrozadanie/.test(s.text))).toBe(true)
})

test('return obietnicy z async: dodatkowe mikrozadania (zgodnie ze specyfikacją)', async () => {
  const r = simulate('async function a() { return Promise.resolve(1) }\nasync function b() { return 1 }\na().then(() => console.log("a"))\nb().then(() => console.log("b"))')
  expect(r.output).toEqual(['b', 'a'])
})

test('wyjątek: propagacja przez stos i catch', async () => {
  const r = simulate('function f(n) {\n  if (n > 2) throw new Error("za duże")\n  return n\n}\ntry {\n  f(5)\n} catch (e) {\n  console.log(e.message)\n}')
  expect(r.output).toEqual(['za duże'])
  expect(r.steps.map(s => s.kind)).toContain('unwind')
  expect(r.steps.map(s => s.kind)).toContain('catch')
})

test('hipotezy: fetch jest oznaczony jako założenie, nie fakt', async () => {
  const r = simulate('async function load() {\n  const res = await fetch("https://example.com/api")\n  console.log(res.status)\n}\nload()')
  expect(r.hypotheses.join(' ')).toMatch(/nie wysyła prawdziwego żądania/)
  expect(r.steps.some(s => s.hypothetical === true)).toBe(true)
  expect(r.output).toEqual(['200'])
})

test('nieskończona pętla jest zatrzymana limitem, bez zawieszenia', async () => {
  const r = simulate('let i = 0\nwhile (i < 10) {\n  console.log(i)\n}')
  expect(r.ok).toBe(false)
  expect(r.error?.kind).toBe('limit')
})

test('TypeScript: adnotacje typów są pomijane', async () => {
  const r = simulate('interface P { x: number }\nfunction dbl(n: number): number {\n  return n * 2\n}\nconst v: number = dbl(21) as number\nconsole.log(v)')
  expect(r.ok).toBe(true)
  expect(r.output).toEqual(['42'])
})

test('let w pętli for: każda iteracja ma własne powiązanie (domknięcia)', async () => {
  const r = simulate('const fs = []\nfor (let i = 0; i < 3; i++) {\n  fs.push(() => i)\n}\nconsole.log(fs.map(f => f()).join(","))')
  expect(r.output).toEqual(['0,1,2'])
})

test('wycinek z lekcji: domknięte bloki i zaślepki zamiast błędu składni lub ReferenceError', async () => {
  const { simulateCached } = await import('../hooks/ui/simcache')
  const { healJs } = await import('../hooks/sim/heal')
  const frag = '    if (base) await $.fs.write(`${base}/x.json`, JSON.stringify(state))\n  } catch (err) {\n    state.error = String(err)\n  }'
  const healed = healJs(frag)
  expect(healed.source.split('\n').length).toBe(frag.split('\n').length)
  expect(healed.source.startsWith('try { ')).toBe(true)
  const r = simulateCached(frag, 'js')
  expect(r.ok).toBe(true)
  expect(r.hypotheses.join(' ')).toContain('`base`, `$`, `state`')
  expect(r.hypotheses.join(' ')).toContain('try {')
  const loop = simulateCached("      } else {\n        console.log('b')\n      }\n    }\n    for (let i = 0; i < 3; i++) {\n      console.log(i)", 'js')
  expect(loop.ok).toBe(true)
  expect(loop.output).toEqual(['0', '1', '2'])
  // bez trybu zaślepek semantyka JS zostaje: nieznana nazwa to ReferenceError
  expect(simulate('console.log(nieMa)').error?.message).toMatch(/ReferenceError: nieMa is not defined/)
})
