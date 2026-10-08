// Change Lab: prawdziwe przed i po z wyniku narzędzia, lista po turach,
// symulacja obu wersji na tych samych danych, inne podejście tylko po potwierdzeniu.
import { expect, mock, test } from 'claude-code/testing'
import { applyHunks, changeHints, describeChange, groupByTurn, refactorFacts, windowFor } from '../hooks/engine/change'
import type { ChangeMeta } from '../hooks/engine/change'
import { offlineHost, stateOps } from '../hooks/host'
import type { Host } from '../hooks/host'
import { mentor } from '../hooks/mentor'
import { simulate } from '../hooks/sim/interp'
import { DEFAULT_LAB, getState, setState } from '../hooks/ui/state'

const BEFORE = ['export function label(x: number): string {', '  if (x < 10) {', "    return 'mało'", '  }', "  return 'dużo'", '}', '', "console.log('koniec')"].join('\n')
const PATCH = [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-  if (x < 10) {', '+  if (x <= 10) {'] }]
const AFTER = BEFORE.replace('x < 10', 'x <= 10')

function fakeHost(filled: string[] = []): Host {
  return { ...offlineHost({ ...stateOps(() => undefined), now: () => Promise.resolve(1_760_000_000_000) }), fillPrompt: t => (filled.push(t), Promise.resolve(true)) }
}
const edit = (file: string, original: string | null, patch: typeof PATCH, extra: Record<string, unknown> = {}) => ({
  result: { filePath: file, oldString: '', newString: '', originalFile: original, structuredPatch: patch, userModified: false, replaceAll: false, ...extra },
})

test('silnik: patch nakłada się dokładnie, a niezgodny kontekst nie jest zgadywany', async () => {
  expect(applyHunks(BEFORE, PATCH)).toBe(AFTER)
  expect(applyHunks(BEFORE.replace('x < 10', 'y < 10'), PATCH)).toBe(null)
  expect(applyHunks('a\r\nb\r\nc', [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+B'] }])).toBe('a\r\nB\r\nc')
  // okno obejmuje całą funkcję, a nie tylko zmienioną linię
  const w = windowFor(AFTER, 2, 2)
  expect(w.start).toBe(1)
  expect(w.text.split('\n')[0]).toContain('function label')
  expect(w.text.trim().endsWith('}')).toBe(true)
  expect(w.text).not.toContain('koniec')
})

test('silnik: opis zmiany to fakty z diffu (operator, nowe nazwy)', async () => {
  const facts = describeChange(['  if (x < 10) {'], [{ line: 2, text: '  if (x <= 10) {' }], 'ts', () => null, false)
  expect(facts[0]).toBe('Linia 2: operator `<` → `<=` w `if (x <= 10)`.')
  const created = describeChange([], [{ line: 1, text: 'export function total(a: number[]) {' }, { line: 2, text: '  return a.reduce((s, x) => s + x, 0)' }, { line: 3, text: '}' }], 'ts', () => null, true)
  expect(created[0]).toBe('Nowy plik, 3 linii.')
  expect(created.join(' ')).toContain('`total`')
})

test('silnik: zmiany grupują się po turach, najnowsza tura pierwsza', async () => {
  const mk = (id: string, turnKey: string, ts: number): ChangeMeta => ({ id, ts, turnKey, turnLabel: turnKey, tool: 'Edit', kind: 'edit', status: 'ok', file: id, lang: 'ts', line: 1, added: 1, removed: 0, summary: '', concepts: [], facts: [], hasBefore: true, hasAfter: true })
  const g = groupByTurn([mk('b', 's:1', 20), mk('a', 's:1', 10), mk('c', 's:2', 30)])
  expect(g.map(x => x.key)).toEqual(['s:2', 's:1'])
  expect(g[1]!.items.map(x => x.id)).toEqual(['a', 'b'])
})

test('A: edycja istniejącego pliku zapisuje dokładne przed i po z narzędzia', async () => {
  setState('changes', () => [])
  const io = fakeHost()
  mentor.onPrompt('zmień próg na 10 włącznie')
  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/label.ts' }, edit('C:/p/src/label.ts', BEFORE, PATCH))
  const meta = getState('changes')[0]!
  expect(meta.file).toBe('C:/p/src/label.ts')
  expect(meta.turnLabel).toBe('zmień próg na 10 włącznie')
  expect(meta.status).toBe('ok')
  const c = mentor.getChange(meta.id)!
  expect(c.before).toContain('if (x < 10)')
  expect(c.after).toContain('if (x <= 10)')
  expect(c.beforeStart).toBe(1)
  expect(c.facts[0]).toContain('operator `<` → `<=`')
})

test('nowy plik ma "przed" = brak, nieudana edycja i plik wrażliwy nie zostawiają kodu', async () => {
  setState('changes', () => [])
  const io = fakeHost()
  await mentor.onTool(io, 'Write', { file_path: 'C:/p/src/sum.ts', content: 'export const sum = (a: number, b: number) => a + b' }, { result: { type: 'create', filePath: 'C:/p/src/sum.ts', content: 'export const sum = (a: number, b: number) => a + b', structuredPatch: [], originalFile: null } })
  const created = mentor.getChange(getState('changes')[0]!.id)!
  expect(created.kind).toBe('create')
  expect(created.before).toBe(null)
  expect(created.after).toContain('export const sum')

  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/x.ts' }, { isError: true, text: 'String not found' })
  const failed = mentor.getChange(getState('changes')[0]!.id)!
  expect(failed.status).toBe('failed')
  expect(failed.after).toBe(null)

  const secret = 'API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  await mentor.onTool(io, 'Write', { file_path: 'C:/p/.env', content: secret }, { result: { type: 'create', filePath: 'C:/p/.env', content: secret, structuredPatch: [], originalFile: null } })
  const blocked = mentor.getChange(getState('changes')[0]!.id)!
  expect(blocked.status).toBe('blocked')
  expect(JSON.stringify(blocked)).not.toContain('sk-ant')
  expect(JSON.stringify(getState('changes'))).not.toContain('sk-ant')

  // patch niezgodny z originalFile: "po" zostaje puste, nic nie jest odtwarzane
  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/label.ts' }, edit('C:/p/src/label.ts', BEFORE.replace('x < 10', 'q < 10'), PATCH))
  expect(mentor.getChange(getState('changes')[0]!.id)!.after).toBe(null)
})

test('B: laboratorium uruchamia przed i po na tych samych danych, x = 10 wybiera inną gałąź, pliki nietknięte', async () => {
  setState('changes', () => [])
  setState('lab', () => ({ ...DEFAULT_LAB }))
  const io = fakeHost()
  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/label.ts' }, edit('C:/p/src/label.ts', BEFORE, PATCH))
  const id = getState('changes')[0]!.id
  await mentor.openBench(io, id)
  const bench = getState('lab').bench!
  expect(getState('tab')).not.toBe('sim')
  expect(bench.variants.map(v => `${v.id} ${v.label}`)).toEqual(['A przed', 'B po'])
  expect(bench.cases[0]).toBe('label(10)')
  const { runBench } = await import('../hooks/engine/bench')
  const r = runBench(bench.variants, bench.cases, 'js')
  expect(r.cells[0]![0]!.text).toContain('dużo')
  expect(r.cells[0]![1]!.text).toContain('mało')
  expect(r.differs[0]).toBe(true)
  // drugie kliknięcie zamyka
  await mentor.openBench(io, id)
  expect(getState('lab').bench).toBe(null)
})

test('D: inne podejście trafia do Claude dopiero po potwierdzeniu i tylko do pola wiadomości', async () => {
  setState('changes', () => [])
  const filled: string[] = []
  const io = fakeHost(filled)
  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/label.ts' }, edit('C:/p/src/label.ts', BEFORE, PATCH))
  const id = getState('changes')[0]!.id
  setState('lab', () => ({ ...DEFAULT_LAB, selected: id, alt: { status: 'ready', forId: id, items: [{ title: 'Tablica progów', idea: 'Progi w tablicy zamiast if.', code: 'const P = [10]', pros: ['łatwo dodać próg'], cons: ['więcej kodu'], when: 'gdy progów jest wiele' }], message: '' } }))
  // samo wybranie pokazuje potwierdzenie, nic nie wysyła
  setState('lab', l => ({ ...l, confirm: 0 }))
  expect(filled).toEqual([])
  await mentor.handOff(io, id, 0)
  expect(filled.length).toBe(1)
  expect(filled[0]).toContain('Tablica progów')
  expect(filled[0]).toContain('C:/p/src/label.ts')
  // pełny kod wybranej alternatywy, ograniczenia i sprawdzenie, nie sam tytuł
  expect(filled[0]).toContain('const P = [10]')
  expect(filled[0]).toContain('Ograniczenia')
  expect(filled[0]).toContain('testy')
  expect(getState('lab').handed).toContain('Enterem')
})

const PANE = {
  plugin: 'claude-code-mentor',
  component: 'Pane' as const,
  requestId: 'mentor',
  props: { title: 'Mentor', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 140, rows: 50 },
}

test('panel: zmiana Claude pojawia się w Zmianach, otwiera się jednym kliknięciem i otwiera laboratorium', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('tool.call', { tool: 'Edit' }, () => edit('C:/p/src/limits.ts', BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/limits.ts', old_string: 'x < 10', new_string: 'x <= 10' })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-changes' })
    const row = await ui.find({ type: 'Button', text: /limits\.ts/ })
    expect(row).toBeDefined()
    await ui.press({ key: row!.key! })
    expect(await ui.find({ type: 'Text', text: /CO SIĘ ZMIENIŁO/ })).toBeDefined()
    expect(await ui.find({ key: 'lab-run' })).toBeDefined()
    await ui.press({ key: 'lab-v-before' })
    expect(await ui.find({ type: 'Code', text: /x < 10/ })).toBeDefined()
    await ui.press({ key: 'lab-v-after' })
    expect(await ui.find({ type: 'Code', text: /x <= 10/ })).toBeDefined()
    await ui.press({ key: 'lab-run' })
    expect(await ui.find({ key: 'bv-A' })).toBeDefined()
    expect(await ui.find({ key: 'bv-B' })).toBeDefined()
    await ui.press({ key: 'lab-run' })
    expect(await ui.find({ key: 'bv-A' })).toBe(undefined)
    await ui.press({ key: 'lab-back' })
    await ui.unmount()
  }
})

test('panel: pusta historia mówi wprost, co się tu pojawi', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ type: 'Text', text: /Zmiany Claude/ })).toBeDefined()
  await ui.unmount()
})

test('podpowiedzi do zmiany: najpierw linia, potem rodzaj zmiany, nigdy nowy kod', async () => {
  const c = { unified: '@@ -2,1 +2,1 @@\n-  if (x < 10) {\n+  if (x <= 10) {', facts: ['Linia 2: operator `<` → `<=` w `if (x <= 10)`.'], added: 1, removed: 1 }
  const h = changeHints(c)
  expect(h[0]).toBe('Zmiana zaczyna się w linii 2.')
  expect(h[1]).toBe('Linia 2: operator `<` → `?`.')
  expect(h.join(' ')).not.toContain('<=')
})

function quizState(hints: string[] = []) {
  setState('quizKey', () => ({ id: 'q1', conceptId: 'equality', kind: 'choice', answer: 2, explain: '=== porównuje bez konwersji typów.', misconceptionByOption: {}, rubric: null, expected: null }))
  setState('quiz', () => ({
    question: { id: 'q1', conceptId: 'equality', kind: 'choice', source: 'builtin', prompt: 'Co zwróci `"5" === 5`?', code: null, codeLang: 'js', codeStart: 1, file: null, options: ['true', 'błąd', 'false', 'undefined'] },
    answer: '', status: 'asking', verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null, hints, revealed: false,
  }))
}

test('ćwiczenia: podpowiedzi stopniowe, nigdy nie wskazują poprawnej, odsłonięcie bez wpływu na poziom', async () => {
  const io = fakeHost()
  quizState()
  await mentor.quizHint(io)
  await mentor.quizHint(io)
  const hints = getState('quiz')!.hints!
  expect(hints.length).toBe(2)
  expect(hints[0]).toContain('Pomyśl o tym')
  expect(hints[1]).toMatch(/^To na pewno nie [ABD]/)
  expect(hints[1]).not.toContain('C')
  await mentor.quizReveal(io)
  const q = getState('quiz')!
  expect(q.status).toBe('graded')
  expect(q.revealed).toBe(true)
  expect(q.verdict).toBe(null)
  expect(q.levelChange).toBe(null)
  expect(q.feedback).toContain('C. false')
  // po odsłonięciu nie da się już „odpowiedzieć” na punkty
  await mentor.answer(io, 2)
  expect(getState('quiz')!.verdict).toBe(null)
})

test('ćwiczenia: poprawna odpowiedź po podpowiedzi liczy się jako częściowa', async () => {
  const io = fakeHost()
  quizState(['Pomyśl o tym: …'])
  await mentor.answer(io, 2)
  expect(getState('quiz')!.verdict).toBe('partial')
  quizState()
  await mentor.answer(io, 2)
  expect(getState('quiz')!.verdict).toBe('correct')
})

test('panel: „Sprawdź się” bez symulatora to zgadywanie: kod przed, podpowiedź i dopiero potem prawdziwy diff', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  // Python nie idzie przez symulator, więc „Sprawdź się” przechodzi w zgadywanie zmiany
  on('tool.call', { tool: 'Edit' }, () => edit('C:/p/src/guess.py', BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/guess.py', old_string: 'x < 10', new_string: 'x <= 10' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  const row = await ui.find({ type: 'Button', text: /guess\.py/ })
  await ui.press({ key: row!.key! })
  await ui.press({ key: 'lab-quiz' })
  expect(await ui.find({ type: 'Code', text: /x < 10/ })).toBeDefined()
  expect(await ui.find({ type: 'Code', text: /x <= 10/ })).toBe(undefined)
  await ui.press({ key: 'lab-g-hint' })
  expect(await ui.find({ type: 'Markdown', text: /linii 2/ })).toBeDefined()
  await ui.press({ key: 'lab-g-reveal' })
  expect(await ui.find({ type: 'Code', text: /x <= 10/ })).toBeDefined()
  await ui.unmount()
})

test('wersje: nowsza instalacja jest wykrywana, ta sama i starsza nie', async () => {
  const { isNewer } = await import('../hooks/version')
  expect(isNewer('1.4.0', '1.3.0')).toBe(true)
  expect(isNewer('1.10.0', '1.9.3')).toBe(true)
  expect(isNewer('1.3.0', '1.3.0')).toBe(false)
  expect(isNewer('1.2.9', '1.3.0')).toBe(false)
})

test('niespójny nagłówek hunka z narzędzia nie wywraca rysowania diffu', async () => {
  const { factsFromPatch } = await import('../hooks/engine/diff')
  const f = factsFromPatch([{ oldStart: 2, oldLines: 6, newStart: 2, newLines: 9, lines: ['-a', '-b', '+c', String.fromCharCode(92) + ' No newline at end of file'] }])
  expect(f.unified).toBe('@@ -2,2 +2,1 @@\n-a\n-b\n+c')
})

test('„Sprawdź się” w zmianie TS: pytanie o wynik po zmianie, odpowiedź policzona z pary przed/po', async () => {
  const { changeQuestion } = await import('../hooks/engine/changequiz')
  const c = { id: 'c1', ts: 0, turn: 1, turnLabel: null, tool: 'Edit', kind: 'edit', status: 'ok', file: 'a.ts', line: 2, lang: 'ts', summary: '', added: 1, removed: 1, concepts: ['conditionals'], facts: [], unified: '', before: BEFORE, beforeStart: 1, after: AFTER, afterStart: 1 } as never
  const built = changeQuestion('q1', c, 'conditionals')!
  expect(built.question.kind).toBe('predict')
  expect(built.question.code).toBe(AFTER)
  const right = built.question.options![built.key.answer as number]!
  expect(right).toContain('koniec')
  expect(built.question.prompt).toContain('Przed zmianą wynik był')
  // bez kodu przed nie ma z czym porównać
  expect(changeQuestion('q2', { ...(c as object), before: null } as never, 'conditionals')).toBe(null)
})

test('panel: „Wyjaśnij” pokazuje wyjaśnienie pod kodem zmiany, bez przełączania zakładki', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('tool.call', { tool: 'Edit' }, () => edit('C:/p/src/explain.ts', BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/explain.ts', old_string: 'x < 10', new_string: 'x <= 10' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  const row = await ui.find({ type: 'Button', text: /explain\.ts/ })
  await ui.press({ key: row!.key! })
  await ui.press({ key: 'lab-lesson' })
  for (let i = 0; i < 40 && !(await ui.find({ key: 'l-under' })); i++) await new Promise(r => setTimeout(r, 25))
  expect(await ui.find({ key: 'l-under' })).toBeDefined()
  expect(await ui.find({ key: 'lab-back' })).toBeDefined()
  await ui.press({ key: 'lab-lesson' })
  expect(await ui.find({ key: 'l-under' })).toBe(undefined)
  await ui.unmount()
})

test('„Co się zmieniło” rozpoznaje typowe przeróbki, a zwykła zmiana nic nie udaje', () => {
  const all = refactorFacts(['for (const id of ids) {', '  out.push(await load(id))', '}'], ['const out = await Promise.all(ids.map(id => load(id)))'], 'ts')
  expect(all[0]).toContain('Promise.all')
  const map = refactorFacts(['const r = []', 'for (const x of xs) {', '  r.push(x * 2)', '}'], ['const r = xs.map(x => x * 2)'], 'ts')
  expect(map[0]).toContain('map')
  expect(refactorFacts(['load().then(r => use(r))'], ['const r = await load()', 'use(r)'], 'ts')[0]).toContain('await')
  expect(refactorFacts(['const r = load()'], ['try {', '  const r = load()', '} catch (e) {', '  log(e)', '}'], 'ts')[0]).toContain('try')
  expect(refactorFacts(['return user.name'], ['return user?.name ?? "?"'], 'ts')[0]).toContain('null')
  expect(refactorFacts(['var n = 1'], ['let n = 1'], 'js')[0]).toContain('var')
  expect(refactorFacts(['Future.forEach'], ['await Future.wait(ids.map(load))'], 'dart')).toEqual([])
  expect(refactorFacts(['for (final id in ids) {', '  out.add(await load(id));', '}'], ['final out = await Future.wait(ids.map(load));'], 'dart')[0]).toContain('Future.wait')
  // zmiana operatora to nie przeróbka
  expect(refactorFacts(['if (x < 10) {'], ['if (x <= 10) {'], 'ts')).toEqual([])
  const facts = describeChange(['for (const id of ids) {', '  out.push(await load(id))', '}'], [{ line: 1, text: 'const out = await Promise.all(ids.map(id => load(id)))' }], 'ts', () => 'X', false)
  expect(facts[0]).toContain('Promise.all')
})

test('test poziomu: każda poprawna odpowiedź zgadza się z tym, co naprawdę wypisuje kod', async () => {
  const { PLACEMENT } = await import('../hooks/engine/placement')
  const { simulate } = await import('../hooks/sim/interp')
  expect(PLACEMENT.length).toBe(6)
  for (const q of PLACEMENT) {
    const r = simulate(q.code, { maxSteps: 2000 })
    expect(r.ok).toBe(true)
    const out = r.output.join(' ').replace(/\s+/g, ' ').replace(/\[\s*/g, '[').replace(/\s*\]/g, ']')
    expect(out).toBe(q.options[q.answer]!)
    expect(new Set(q.options).size).toBe(q.options.length)
  }
})

test('panel: karta na start prowadzi przez test poziomu i znika po wyniku', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const { PLACEMENT } = await import('../hooks/engine/placement')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  await ui.press({ key: 'pl-start' })
  expect(await ui.find({ type: 'Text', text: /^1\/6/ })).toBeDefined()
  for (let i = 0; i < PLACEMENT.length; i++) await ui.press({ key: `pl-o-${i === 0 ? 0 : PLACEMENT[i]!.answer}` })
  expect(await ui.find({ type: 'Text', text: /Test poziomu: 5\/6/ })).toBeDefined()
  expect(await ui.find({ key: 'pl-start' })).toBe(undefined)
  await ui.press({ key: 'pl-close' })
  expect(await ui.find({ type: 'Text', text: /Test poziomu: / })).toBe(undefined)
  await ui.unmount()
})

test('sekret w zmienionym literale nie trafia do opisu zmiany ani do listy, także bez zapisu kodu', async () => {
  const KEY_OLD = 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA1111'
  const KEY_NEW = 'sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB2222'
  const PW_NEW = 'hunter2hunter2'
  const before = [`const client = make("${KEY_OLD}")`, 'const password = "stare-haslo-1"'].join('\n')
  const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [`-const client = make("${KEY_OLD}")`, '-const password = "stare-haslo-1"', `+const client = make("${KEY_NEW}")`, `+const password = "${PW_NEW}"`] }]
  for (const saveChanges of [true, false]) {
    setState('changes', () => [])
    await mentor.setSettings(fakeHost(), { saveChanges })
    await mentor.onTool(fakeHost(), 'Edit', { file_path: 'C:/p/src/client.ts' }, edit('C:/p/src/client.ts', before, patch))
    const meta = getState('changes')[0]!
    const full = mentor.getChange(meta.id)!
    const all = JSON.stringify({ meta, full, feed: getState('feed').slice(0, 3) })
    expect(all).not.toContain('BBBBBBBBBBBB')
    expect(all).not.toContain('AAAAAAAAAAAA')
    expect(all).not.toContain(PW_NEW)
  }
  await mentor.setSettings(fakeHost(), { saveChanges: true })
})

test('A i B bez wspólnej funkcji: brak porównania zamiast porównania błędów', async () => {
  const { pairCall } = await import('../hooks/sim/autocall')
  const same = pairCall('function f(x: number) { return x }', 'function f(x: number) { return x * 2 }', 'js')
  expect(same.problem).toBe(null)
  expect(same.call).toContain('f(')
  const renamed = pairCall('function total(xs: number[]) { return 0 }', 'function sum(xs: number[]) { return 0 }', 'js')
  expect(renamed.call).toBe(null)
  expect(renamed.problem).toContain('nie mają wspólnej funkcji')
  // wpisane wywołanie musi istnieć w obu wersjach
  expect(pairCall('function total(a) {}', 'function sum(a) {}', 'js', 'console.log(sum(2))').problem).toContain('sum')
  expect(pairCall('function total(a) {}', 'function sum(a) {}', 'js', 'console.log(sum(2))').call).toBe(null)
})

test('pytanie ze zmiany nie powstaje, gdy wynik zależy od zaślepki albo założenia', async () => {
  const { changeQuestion } = await import('../hooks/engine/changequiz')
  const base = { id: 'c1', ts: 0, turn: 1, turnLabel: null, tool: 'Edit', kind: 'edit', status: 'ok', file: 'a.ts', line: 1, lang: 'ts', summary: '', added: 1, removed: 1, concepts: [], facts: [], unified: '', beforeStart: 1, afterStart: 1 }
  const stubbed = { ...base, before: 'export function price(id: string) {\n  return db.get(id) + 1\n}', after: 'export function price(id: string) {\n  return db.get(id) + 2\n}' }
  expect(changeQuestion('q', stubbed as never, 'functions')).toBe(null)
  const random = { ...base, before: 'console.log(Math.random() > 2)', after: 'console.log(Math.random() > 3)' }
  expect(changeQuestion('q', random as never, 'functions')).toBe(null)
  // bez założeń pytanie jest
  const plain = { ...base, before: 'export function f(n: number) {\n  return n + 1\n}', after: 'export function f(n: number) {\n  return n + 2\n}' }
  expect(changeQuestion('q', plain as never, 'functions')).not.toBe(null)
})

test('laboratorium: wersje A/B/C na jawnych przypadkach, edycja tylko kopii, brak funkcji to nie wynik', async () => {
  const { runBench, replaceLine, insertLineAfter, deleteLine, nextVariantId, validCase, regressionPrompt } = await import('../hooks/engine/bench')
  const A = 'function sum(xs: number[]) {\n  let s = 0\n  for (const x of xs) s += x\n  return s\n}'
  const B = 'function sum(xs: number[]) {\n  return xs.reduce((s, x) => s + x, 0)\n}'
  let C = replaceLine(B, 2, '  return xs.reduce((s, x) => s + x, 1)')
  const variants = [
    { id: 'A', label: 'przed', code: A, origin: 'before' as const },
    { id: 'B', label: 'po', code: B, origin: 'after' as const },
    { id: 'C', label: 'kopia B', code: C, origin: 'edit' as const },
    { id: 'D', label: 'inna nazwa', code: 'function total(xs: number[]) { return 0 }', origin: 'alt' as const },
  ]
  const r = runBench(variants, ['sum([1, 2, 3])', 'sum([])'], 'js')
  expect(r.cells[0]!.map(c => c.text)).toEqual(['6', '6', '7', 'brak `sum` w tej wersji'])
  expect(r.cells[0]![3]!.kind).toBe('missing')
  expect(r.differs).toEqual([true, true])
  expect(runBench(variants.slice(0, 2), ['sum([1, 2, 3])'], 'js').differs).toEqual([false])
  // edycja linii
  C = insertLineAfter(C, 1, '  // nowa')
  expect(C.split('\n')[1]).toBe('  // nowa')
  expect(deleteLine(C, 2).split('\n').length).toBe(3)
  expect(nextVariantId(variants)).toBe(null)
  expect(nextVariantId(variants.slice(0, 2))).toBe('C')
  expect(validCase('sum')).toContain('nie jest wywołanie')
  expect(validCase('sum([1])')).toBe(null)
  // prośba o sprawdzenie w projekcie: przewidywanie wersji po, kopia jako kod do testu, bez zmian w produkcji
  const prompt = regressionPrompt('C:/p/sum.ts', 'ts', variants, ['sum([1, 2, 3])'], r.cells)
  expect(prompt).toContain('`sum([1, 2, 3])` → 6')
  expect(prompt).toContain('s + x, 1')
  expect(prompt).toContain('Nie zmieniaj kodu produkcyjnego')
})

test('panel: „Uruchom i porównaj” otwiera laboratorium w Zmianach, przypadek i kopia działają bez zmiany zakładki', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('tool.call', { tool: 'Edit' }, () => edit('C:/p/src/bench.ts', BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/bench.ts', old_string: 'x < 10', new_string: 'x <= 10' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  const row = await ui.find({ type: 'Button', text: /bench\.ts/ })
  await ui.press({ key: row!.key! })
  await ui.press({ key: 'lab-run' })
  expect(await ui.find({ type: 'Text', text: /różne wyniki/ })).toBeDefined()
  await ui.input({ key: 'bench-case', text: 'label(3)', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /^label\(3\)$/ })).toBeDefined()
  await ui.press({ key: 'bv-copy' })
  expect(await ui.find({ key: 'bv-C' })).toBeDefined()
  expect(await ui.find({ key: 'bench-line' })).toBeDefined()
  await ui.press({ key: 'bench-step' })
  expect(await ui.find({ key: 'sim-step' })).toBeDefined()
  await ui.unmount()
})

test('laboratorium na prawdziwym kodzie z regex i trimEnd (factsFromPatch z diff.ts)', async () => {
  const { runBench } = await import('../hooks/engine/bench')
  const code = [
    'export function facts(lines: string[]) {',
    String.raw`  const text = lines.join('\n').replace(/\n+$/, '')`,
    '  return { n: lines.length, text: text.trimEnd() }',
    '}',
  ].join('\n')
  const r = runBench([{ id: 'B', label: 'po', code, origin: 'after' }], ['facts([])', 'facts(["a ", "", ""])'], 'js')
  expect(r.cells[0]![0]!.kind).toBe('ok')
  expect(r.cells[1]![0]!.text).toContain('text: "a"')
})

test('„Warto zrozumieć” nie pokazuje podstaw, gdy w zmianie nic więcej nie ma; lekcja i tak ma o czym być', async () => {
  const { interestingConcepts } = await import('../hooks/mentor')
  expect(interestingConcepts(['variables', 'functions'], {})).toEqual([])
  expect(interestingConcepts(['variables', 'functions'], {}, true)).toEqual(['variables'])
  expect(interestingConcepts(['variables', 'async-await'], {})).toEqual(['async-await'])
  expect(interestingConcepts(['async-await'], { 'async-await': 3 })).toEqual([])
})
