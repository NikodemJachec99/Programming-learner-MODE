// Dopracowanie 1.5: aktywność plików, oś kroków, skrócony diff, pasek kontekstu,
// laboratorium (pamięć wyników, szybka edycja, decyzja), informacja zwrotna, jeden harmonogram
// animacji i prywatność historii.
import { expect, mock, test } from 'claude-code/testing'
import { EMPTY_ACTIVITY, FLASH_MS, nextChange, newTurn, toneOf, touchEnd, touchStart } from '../hooks/engine/activity'
import { compactDiff } from '../hooks/engine/diff'
import { benchStats, runBench } from '../hooks/engine/bench'
import { decisionFor, decisionPrompt } from '../hooks/engine/decision'
import { EMPTY_FEEDBACK, applyFeedback, detailFor, lessonPrefs, parseFeedback } from '../hooks/engine/feedback'
import { lessonRequest } from '../hooks/engine/lessons'
import { sparkline, turnDelta } from '../hooks/ui/bar'
import { offlineHost, stateOps } from '../hooks/host'
import type { Host } from '../hooks/host'
import { cleanMeta, mentor } from '../hooks/mentor'
import { DEFAULT_LAB, getState, setState } from '../hooks/ui/state'
import { EMPTY_FILES } from '../hooks/engine/files'
import { CONCEPTS } from '../hooks/content/concepts'

const PLUGIN = 'claude-code-mentor'
const PANE = (surface: 'desktop' | 'terminal') => ({
  plugin: PLUGIN,
  surface,
  component: 'Pane' as const,
  requestId: 'mentor',
  props: { title: 'Mentor', isFocused: false, bodyColumns: 90, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  viewport: { columns: 160, rows: 60 },
})
const T0 = 1_760_000_000_000
const fakeHost = (filled: string[] = []): Host => ({ ...offlineHost({ ...stateOps(() => undefined), now: () => Promise.resolve(T0) }), fillPrompt: t => (filled.push(t), Promise.resolve(true)) })
const BEFORE = ['export function label(x: number): string {', '  if (x < 10) {', "    return 'mało'", '  }', "  return 'dużo'", '}', '', "console.log('koniec')"].join('\n')
const PATCH = [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-  if (x < 10) {', '+  if (x <= 10) {'] }]
const editResult = (file: string, original: string, patch: typeof PATCH) => ({
  result: { filePath: file, oldString: '', newString: '', originalFile: original, structuredPatch: patch, userModified: false, replaceAll: false },
})

// ---------- aktywność plików (filetree) ----------

test('aktywność: odczyt fioletowy, edycja pomarańczowa, po końcu błysk, potem spokój; błąd zostaje czerwony', () => {
  let a = touchStart(EMPTY_ACTIVITY, 'C:\\p\\src\\a.ts', 'read', 0)
  expect(toneOf(a.files[0]!, 10)).toBe('read')
  a = touchEnd(a, 'C:/p/src/a.ts', 'read', true, 100)
  expect(toneOf(a.files[0]!, 200)).toBe('read')
  expect(toneOf(a.files[0]!, 100 + FLASH_MS + 1)).toBe('idle')
  a = touchStart(a, 'C:/p/src/a.ts', 'edit', 200)
  expect(toneOf(a.files[0]!, 210)).toBe('edit')
  a = touchEnd(a, 'C:/p/src/a.ts', 'edit', true, 300)
  expect(toneOf(a.files[0]!, 400)).toBe('ok')
  expect(a.files[0]!.edits).toBe(1)
  expect(a.files[0]!.reads).toBe(1)
  // nieudana edycja nie udaje sukcesu i nie gaśnie sama
  a = touchStart(a, 'C:/p/src/b.ts', 'edit', 400)
  a = touchEnd(a, 'C:/p/src/b.ts', 'edit', false, 500)
  expect(toneOf(a.files.find(f => f.path.endsWith('b.ts'))!, 500 + 10 * FLASH_MS)).toBe('error')
  expect(a.files.find(f => f.path.endsWith('b.ts'))!.edits).toBe(0)
  // odrzucona: osobny stan
  a = touchStart(a, 'C:/p/src/c.ts', 'edit', 600)
  a = touchEnd(a, 'C:/p/src/c.ts', 'edit', false, 700, true)
  expect(a.files.find(f => f.path.endsWith('c.ts'))!.denied).toBe(true)
  // harmonogram: budzi się na wygaśnięcie błysku, potem nigdy
  expect(nextChange(a, 400, 150)).toBe(300 + FLASH_MS)
  expect(nextChange(a, 300 + FLASH_MS + 1000, 150)).toBe(null)
  expect(newTurn(a).files).toEqual([])
})

test('panel: w Zmianach karta Teraz i „Claude dotknął”: odczyt, edycja i błąd z plakietkami, plik prowadzi do zmiany', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  on('tool.call', { tool: 'Read' }, () => ({ result: { content: 'treść' } }))
  on('tool.call', { tool: 'Edit' }, (_$, e) => ((e as { file_path?: string }).file_path?.endsWith('bad.ts') ? { isError: true as const, result: 'old_string not found', text: 'old_string not found' } : editResult('C:/p/src/good.ts', BEFORE, PATCH)))
  await $.tool.call({ tool: 'Read', file_path: 'C:/p/src/notes.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/good.ts', old_string: 'x < 10', new_string: 'x <= 10' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/bad.ts', old_string: 'nope', new_string: 'x' })
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ type: 'Text', text: 'TERAZ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CLAUDE DOTKNĄŁ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 PLIKI' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Otwarty' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Edytowany' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Błąd' })).toBeDefined()
  // nazwa pliku ze zmianą prowadzi do niej, panel plików jest pod przyciskiem
  expect(await ui.find({ type: 'Button', text: 'good.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'fl-open' })).toBeDefined()
  // błąd nie gaśnie z czasem i nie udaje sukcesu
  await clock.advance(FLASH_MS + 500)
  expect(await ui.find({ type: 'Text', text: 'Błąd' })).toBeDefined()
  await ui.unmount()
})

test('panel Pliki jak w filetree: Teraz z gałęzią, Claude dotknął, drzewo z drogą do plików, git i commit Claude', async ($, on) => {
  const { renderFilesPane } = await import('../hooks/ui/files')
  const lists: Record<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }[]> = {
    'c:/p': [
      { name: 'src', kind: 'dir', size: 0, mtimeMs: T0 },
      { name: 'package.json', kind: 'file', size: 10, mtimeMs: T0 },
      { name: '.gitignore', kind: 'file', size: 10, mtimeMs: T0 },
    ],
    'c:/p/src': [
      { name: 'api', kind: 'dir', size: 0, mtimeMs: T0 },
      { name: 'index.js', kind: 'file', size: 10, mtimeMs: T0 },
    ],
    'c:/p/src/api': [
      { name: 'stations.js', kind: 'file', size: 10, mtimeMs: T0 },
      { name: 'client.js', kind: 'file', size: 10, mtimeMs: T0 },
    ],
  }
  let status = '## main...origin/main [ahead 1]\0 M src/api/client.js\0?? src/new.js\0'
  const ran: string[] = []
  const io: Host = {
    ...fakeHost(),
    sessionRoot: () => Promise.resolve('C:\\p'),
    fsList: p => Promise.resolve(lists[p.replace(/\\/g, '/').toLowerCase()] ?? []),
    run: argv => {
      ran.push(argv.join(' '))
      const stdout = argv.includes('--show-toplevel') ? 'C:/p\n' : argv.includes('--short') ? 'a1c9e42\n' : status
      return Promise.resolve({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    },
  }
  setState('activity', () => ({
    turn: 1,
    files: [
      { path: 'C:/p/src/api/client.js', kind: 'edit' as const, active: false, ok: true, since: T0, at: T0, reads: 1, edits: 1 },
      { path: 'C:/p/src/index.js', kind: 'read' as const, active: false, ok: true, since: T0 - 5, at: T0 - 5, reads: 1, edits: 0 },
    ],
  }))
  await mentor.refreshFiles(io)
  // jeden git status na odświeżenie
  expect(ran.filter(r => r.startsWith('git status')).length).toBe(1)
  on('ui.render', { component: 'Pane', requestId: 'files-test' }, async ($$, e) => renderFilesPane(io, $$.ui.resolve(e) as never, e.surface, 80))
  let ui = await $.ui.mount({ ...PANE('terminal'), requestId: 'files-test' })
  expect(await ui.find({ type: 'Text', text: 'TERAZ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 zmienione pliki' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 PLIKI' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Edytowany' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Otwarty' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'WSZYSTKIE PLIKI' })).toBeDefined()
  // droga do dotkniętego pliku rozwinięta, sąsiedzi widoczni
  expect(await ui.find({ type: 'Text', text: 'stations.js' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'package.json' })).toBeDefined()
  await ui.unmount()
  // commit Claude: plik wszedł, karta i stopka mówią „zacommitowane”
  status = '## main...origin/main [ahead 2]\0'
  await mentor.noteCommit(io)
  ui = await $.ui.mount({ ...PANE('terminal'), requestId: 'files-test' })
  expect(await ui.find({ type: 'Text', text: 'Zacommitowany' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'zacommitowane a1c9e42' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a1c9e42' })).toBeDefined()
  await ui.unmount()
  setState('activity', () => EMPTY_ACTIVITY)
  setState('files', () => EMPTY_FILES)
})

test('pliki: status gita, droga do pliku, filtr nazw z rodzicami, stan dotkniętego pliku', async () => {
  const f = await import('../hooks/engine/files')
  const g = f.parseStatus('## feat/x...origin/feat/x [ahead 2, behind 1]\0 M a/b.ts\0?? c.ts\0D  d.ts\0R  new.ts\0old.ts\0', 'C:/p')
  expect(g.branch).toBe('feat/x')
  expect([g.ahead, g.behind]).toEqual([2, 1])
  expect(g.files).toEqual({ 'c:/p/a/b.ts': 'mod', 'c:/p/c.ts': 'new', 'c:/p/d.ts': 'del', 'c:/p/new.ts': 'mod' })
  expect(f.ancestors('C:/p', 'C:/p/src/api/x.js')).toEqual(['C:/p/src', 'C:/p/src/api'])
  const st = {
    ...f.EMPTY_FILES,
    root: 'C:/p',
    listing: { 'c:/p': [{ name: 'src', kind: 'dir' as const, size: 0, mtimeMs: 0 }, { name: 'z.md', kind: 'file' as const, size: 0, mtimeMs: 0 }], 'c:/p/src': [{ name: 'deep.ts', kind: 'file' as const, size: 0, mtimeMs: 0 }] },
    query: 'deep',
  }
  expect(f.treeRows(st).map(r => r.name)).toEqual(['src', 'deep.ts'])
  const a = { path: 'C:/p/x.ts', kind: 'edit' as const, active: false, ok: true, since: 0, at: 0, reads: 0, edits: 1 }
  expect(f.touchOf(a, null)).toBe('edited')
  expect(f.touchOf(a, { sha: 'abc', files: ['c:/p/x.ts'], at: 0 })).toBe('committed')
  expect(f.touchOf({ ...a, ok: false }, null)).toBe('failed')
  expect(f.touchOf({ ...a, active: true }, null)).toBe('editing')
  expect(f.fileBadge('client.js')).toEqual({ label: 'JS', color: '#e8c547' })
  expect(f.rightNow({ turn: 1, files: [{ ...a, active: true, kind: 'read' }] }, true, 'Read').title).toBe('Claude czyta x.ts')
})

test('lista zmian: zadanie jako karta, każdy plik raz z liczbą edycji i sumą linii, otwiera ostatnią edycję', async ($, on) => {
  const { filesOfTask } = await import('../hooks/ui/changes')
  const base = { turnKey: 't', turnLabel: 'x', tool: 'Edit', kind: 'edit' as const, lang: 'ts', line: 1, summary: '', concepts: [], facts: [], hasBefore: true, hasAfter: true }
  const rows = filesOfTask([
    { ...base, id: 'a', ts: 1, status: 'ok', file: 'src/decree.ts', added: 3, removed: 0 },
    { ...base, id: 'b', ts: 2, status: 'ok', file: 'src/decree.ts', added: 7, removed: 1 },
    { ...base, id: 'c', ts: 3, status: 'failed', file: 'src/bad.ts', added: 0, removed: 0 },
  ])
  expect(rows.map(r => [r.file, r.count, r.added, r.removed, r.last.id, r.failed])).toEqual([
    ['src/decree.ts', 2, 10, 1, 'b', 0],
    ['src/bad.ts', 1, 0, 0, 'c', 1],
  ])
  mock.clock(on, { now: T0 })
  on('tool.call', { tool: 'Edit' }, (_$, e) => editResult(String((e as { file_path?: string }).file_path), BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/one.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/one.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/two.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ type: 'Text', text: '3 edycje w 2 plikach  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '×2' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: 'one.ts' })).filter(b => b.key?.startsWith('open-')).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'TS ' })).toBeDefined()
  await ui.unmount()
})

// ---------- oś kroków i diff ----------

test('panel: edycje po kolei jak w Replay Theater: podsumowanie tury, „Edycja k z N”, diff ze słowami, p i n', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('tool.call', { tool: 'Edit' }, (_$, e) => editResult(String((e as { file_path?: string }).file_path), BEFORE, PATCH))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/one.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/two.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(PANE('desktop'))
  await ui.press({ key: 'tab-changes' })
  await ui.press({ key: (await ui.find({ type: 'Button', text: /two\.ts/ }))!.key! })
  expect(await ui.find({ type: 'Text', text: '2 edycje w 2 plikach' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'EDYCJE PO KOLEI' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'EDYCJA 2 Z 2' })).toBeDefined()
  expect(await ui.find({ type: 'Svg', alt: '1. one.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Svg', alt: /^- {3}if \(x < 10\) \{\n\+ {3}if \(x <= 10\) \{$/ })).toBeDefined()
  await ui.press({ key: 'tl-prev' })
  expect(await ui.find({ type: 'Text', text: 'EDYCJA 1 Z 2' })).toBeDefined()
  await ui.press({ key: 'tl-next' })
  expect(await ui.find({ type: 'Text', text: 'EDYCJA 2 Z 2' })).toBeDefined()
  await ui.unmount()
})

test('diff słów: zmienione słowa z parą linii, spacja między zmienionymi w zakresie, przerwa między miejscami', async () => {
  const { diffRows, wordSpans } = await import('../hooks/engine/worddiff')
  const { diffBoxSvg } = await import('../hooks/ui/replay')
  const a = 'Cold brew is what a lot of people like.'
  const b = 'Cold brew is smoother than iced coffee.'
  const w = wordSpans(a, b)
  expect(w.del.map(([x, y]) => a.slice(x, y))).toEqual(['what a lot of people like'])
  expect(w.add.map(([x, y]) => b.slice(x, y))).toEqual(['smoother than iced coffee'])
  // linia bez nic wspólnego to nowa linia, nie zmiana słów
  expect(wordSpans('abc', 'xyz')).toEqual({ del: [], add: [] })
  const u = ['@@ -1,3 +1,3 @@', "-import { greet } from './greet.js';", "+import { welcome } from './greet.js';", ' ', '-console.log(greet(1));', '+console.log(welcome(1));'].join('\n')
  const { rows } = diffRows(u)
  expect(rows.map(r => r.kind)).toEqual(['-', '+', 'gap', '-', '+'])
  const r1 = rows[1] as { text: string; spans: [number, number][] }
  expect(r1.spans.map(([x, y]) => r1.text.slice(x, y))).toEqual(['welcome'])
  const box = diffBoxSvg(rows, 600)
  expect(diffBoxSvg([{ kind: '+', text: 'a < b', spans: [], line: 1 }], 300).svg).toContain('a &lt; b')
  expect(box.svg).toContain('prefers-color-scheme: dark')
  expect(box.svg).toContain('class="adw"')
})

test('skrócony diff: 1 linia kontekstu, poprawne nagłówki, limit zmian z licznikiem reszty', () => {
  const body = Array.from({ length: 30 }, (_, i) => (i === 5 ? '-a5\n+b5' : i === 20 ? '-a20\n+b20' : ` l${i}`)).join('\n')
  const unified = `@@ -1,30 +1,30 @@\n${body}\n`
  const c = compactDiff(unified, 1, 14)
  expect(c.text).toBe('@@ -5,3 +5,3 @@\n l4\n-a5\n+b5\n l6\n@@ -20,3 +20,3 @@\n l19\n-a20\n+b20\n l21\n')
  expect(c.total).toBe(4)
  expect(c.hidden).toBe(0)
  const capped = compactDiff(unified, 1, 2)
  expect(capped.hidden).toBe(2)
  expect(capped.text.split('\n').filter(l => l.startsWith('@@')).length).toBe(1)
})

// ---------- pasek nad promptem i kontekst ----------

test('pasek nad promptem: Mentor dokłada swój pasek i nie zastępuje treści innego modu', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('session.usage', () => ({ value: { context: { breakdown: { totalTokens: 50_000, maxTokens: 200_000, percentage: 25, categories: [
    { name: 'Messages', tokens: 50_000, color: 'permission', kind: 'used' },
    { name: 'Free space', tokens: 150_000, color: 'subtle', kind: 'free' },
  ] } } } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>INNY-MOD</Text>
  })
  const props = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  await ui.unmount()
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await ui.find({ key: 'open-mentor' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'INNY-MOD' })).toBeDefined()
  await ui.unmount()
})

test('pasek kontekstu: trend 12 tur i zmiana względem poprzedniej', () => {
  expect(sparkline([10_000])).toBe('')
  expect(sparkline([10_000, 20_000, 40_000])).toBe('▂▄█')
  expect(sparkline(Array.from({ length: 20 }, (_, i) => (i + 1) * 1000)).length).toBe(12)
  expect(turnDelta([10_000, 22_300])!.text).toBe('▲ +12.3k')
  expect(turnDelta([22_000, 18_000])!.text).toBe('▼ −4.0k')
  expect(turnDelta([5000, 5010])!.text).toBe('▬ bez zmian')
  expect(turnDelta([5000])).toBe(null)
})

// ---------- laboratorium ----------

test('laboratorium: 4 wersje × 6 przypadków liczone raz; przerysowanie bierze z pamięci, zmiana kodu liczy od nowa', () => {
  const base = 'export function grade(p: number) {\n  if (p >= 90) return "A"\n  if (p >= 50) return "B"\n  return "C"\n}'
  const variants = [
    { id: 'A', label: 'przed', code: base, origin: 'before' as const },
    { id: 'B', label: 'po', code: base.replace('>= 50', '> 50'), origin: 'after' as const },
    { id: 'C', label: 'kopia', code: base.replace('>= 90', '> 90'), origin: 'edit' as const },
    { id: 'D', label: 'alt', code: base.replace('"C"', '"F"'), origin: 'alt' as const },
  ]
  const cases = ['grade(95)', 'grade(90)', 'grade(50)', 'grade(49)', 'grade(0)', 'grade(100)']
  const c0 = benchStats.computed
  const t0 = Date.now()
  const r = runBench(variants, cases, 'js')
  const ms = Date.now() - t0
  expect(benchStats.computed).toBe(c0 + 1)
  expect(r.cells.length).toBe(6)
  expect(r.cells.every(row => row.length === 4 && row.every(c => c.kind === 'ok'))).toBe(true)
  expect(r.cells[2]!.map(c => c.text)).toEqual(['B', 'C', 'B', 'B'])
  expect(r.differs).toEqual([false, true, true, true, true, false])
  // 50 przerysowań (klatki animacji) nie liczy tabeli ponownie
  for (let i = 0; i < 50; i++) runBench(variants, cases, 'js')
  expect(benchStats.computed).toBe(c0 + 1)
  // zmiana kodu albo przypadków unieważnia wynik
  runBench([...variants.slice(0, 3), { ...variants[3]!, code: base }], cases, 'js')
  runBench(variants, [...cases, 'grade(-1)'].slice(1), 'js')
  expect(benchStats.computed).toBe(c0 + 3)
  expect(ms).toBeLessThan(2000)
})

test('decyzja o innym podejściu: różnice z symulatora oznaczone, propozycja AI jako niesprawdzona, polecenie ma te same sekcje', () => {
  const c = { id: 'c1', ts: 0, turn: 1, turnLabel: 'próg włącznie', tool: 'Edit', kind: 'edit', status: 'ok', file: 'C:/p/a.ts', line: 2, lang: 'ts', summary: '', added: 1, removed: 1, concepts: [], facts: [], unified: '', before: BEFORE, beforeStart: 1, after: BEFORE.replace('x < 10', 'x <= 10'), afterStart: 1 } as never
  const alt = { title: 'Tablica progów', idea: 'Progi w tablicy.', code: "export function label(x: number): string {\n  return x <= 9 ? 'mało' : 'dużo'\n}", pros: ['łatwo dodać próg'], cons: ['więcej kodu'], when: 'gdy progów jest wiele' }
  const bench = {
    forId: 'c1', cases: ['label(10)'], sel: 'B', line: 1, error: null, handed: null,
    variants: [{ id: 'B', label: 'po', code: BEFORE.replace('x < 10', 'x <= 10'), origin: 'after' as const }, { id: 'C', label: alt.title, code: alt.code, origin: 'alt' as const }],
  }
  const d = decisionFor(c, alt, bench)
  expect(d.change).toContain('a.ts:2')
  expect(d.keep[0]!.source).toBe('sim')
  expect(d.differences.find(x => x.source === 'sim')!.text).toContain('alternatywa dużo')
  expect(d.differences.filter(x => x.source === 'ai').length).toBe(2)
  expect(d.uncertain.join(' ')).toContain('propozycja AI')
  const none = decisionFor(c, alt, null)
  expect(none.uncertain.join(' ')).toContain('nie porównano')
  const text = decisionPrompt(d, 'ts', alt.code)
  for (const part of ['Zachowaj:', 'Znane różnice:', 'Sprawdzenie:', 'Niepewne', '(symulator)', '(propozycja AI)']) expect(text).toContain(part)
})

test('decyzja: samo wybranie alternatywy nic nie wysyła, polecenie trafia do pola dopiero po zatwierdzeniu', async () => {
  setState('changes', () => [])
  const filled: string[] = []
  const io = fakeHost(filled)
  await mentor.onTool(io, 'Edit', { file_path: 'C:/p/src/label.ts' }, editResult('C:/p/src/label.ts', BEFORE, PATCH))
  const id = getState('changes')[0]!.id
  setState('lab', () => ({ ...DEFAULT_LAB, selected: id, confirm: 0, alt: { status: 'ready', forId: id, items: [{ title: 'Tablica progów', idea: 'Progi w tablicy.', code: 'const P = [10]', pros: ['krótko'], cons: ['nowe'], when: '' }], message: '' } }))
  expect(filled).toEqual([])
  await mentor.handOff(io, id, 0)
  expect(filled.length).toBe(1)
  expect(filled[0]).toContain('Niepewne')
  expect(filled[0]).toContain('const P = [10]')
})

// ---------- informacja zwrotna ----------

test('feedback: jeden głos na lekcję, zmiana zastępuje, preferencje trafiają do lekcji, poziom wiedzy bez zmian', async () => {
  let s = EMPTY_FEEDBACK
  for (let i = 0; i < 3; i++) s = applyFeedback(s, { lessonId: `l${i}`, conceptId: 'closures', projectId: 'p', kind: 'hard', now: i })
  // ten sam głos dwa razy nie mnoży wpisów
  s = applyFeedback(s, { lessonId: 'l2', conceptId: 'closures', projectId: 'p', kind: 'hard', now: 9 })
  expect(s.concepts.closures!.hard!.n).toBe(3)
  // zmiana głosu przenosi licznik
  s = applyFeedback(s, { lessonId: 'l2', conceptId: 'closures', projectId: 'p', kind: 'examples', now: 10 })
  expect(s.concepts.closures!.hard!.n).toBe(2)
  expect(s.concepts.closures!.examples!.n).toBe(1)
  expect(lessonPrefs(s, 'closures', 'p').join(' ')).toContain('za trudne')
  expect(detailFor(s, 'normal', 'closures', 'p')).toBe('short')
  expect(lessonPrefs(EMPTY_FEEDBACK, 'closures', 'p')).toEqual([])
  expect(parseFeedback({ junk: true })).toEqual(EMPTY_FEEDBACK)
  // trafia do polecenia lekcji
  const c = CONCEPTS.find(x => x.id === 'closures')!
  const req = lessonRequest({ concept: c, related: [], obs: { id: 'o', ts: 0, turn: 1, kind: 'edit', tool: 'Edit', file: 'a.ts', line: 1, summary: '', added: 1, removed: 0, lang: 'ts', concepts: [], symbols: [], failed: false, blocked: false, preexisting: false }, snippet: { text: 'x', start: 1, lang: 'ts' }, unified: '', level: 0, levelsByConcept: {}, missingPrereqs: [], taskContext: null, claudeNote: null, settings: { detail: 'normal' } as never, deep: false, prefs: lessonPrefs(s, 'closures', 'p') }, true)
  expect(req.prompt).toContain('Preferencje ucznia')
  // „za proste” na prawdziwej lekcji nie podnosi poziomu
  const io = fakeHost()
  setState('knowledge', () => [{ id: 'closures', level: 1, mastery: 0.2 } as never])
  setState('lesson', () => ({ id: 'L1', title: 't', conceptIds: ['closures'], ts: 0, status: 'read', file: null, line: null, source: 'builtin', body: {} as never, model: null }) as never)
  await mentor.lessonFeedback(io, 'easy')
  expect(getState('knowledge')[0]!.level).toBe(1)
  expect(mentor.feedback.lessons.L1!.kind).toBe('easy')
})

// ---------- harmonogram animacji ----------

test('harmonogram: odtwarzanie dochodzi do końca i się kończy, zmiana zakładki zatrzymuje, bez ruchu nic nie tyka', async () => {
  const io = fakeHost()
  setState('activity', () => EMPTY_ACTIVITY)
  setState('flash', () => null)
  setState('lab', () => ({ ...DEFAULT_LAB }))
  setState('sim', s => ({ ...s, source: 'let a = 1\na = a + 1\nconsole.log(a)', pair: null, edits: [], cursor: 0, playing: false, callArgs: '', mode: 'js' as const, dialect: 'js' as const }))
  setState('tab', () => 'sim')
  const t0 = mentor.animTicks
  await mentor.playSim(io)
  for (let i = 0; i < 50 && getState('sim').playing; i++) await new Promise(r => setTimeout(r, 5))
  expect(getState('sim').playing).toBe(false)
  expect(getState('sim').cursor).toBeGreaterThan(0)
  const ticks = mentor.animTicks - t0
  expect(ticks).toBeLessThan(20)
  // inna zakładka: odtwarzanie kończy się przy pierwszym kroku
  setState('sim', s => ({ ...s, cursor: 0 }))
  setState('tab', () => 'changes')
  await mentor.playSim(io)
  for (let i = 0; i < 50 && getState('sim').playing; i++) await new Promise(r => setTimeout(r, 5))
  expect(getState('sim').playing).toBe(false)
  expect(getState('sim').cursor).toBe(0)
  // nic się nie rusza: pobudka nie tyka
  const t1 = mentor.animTicks
  mentor.wake(io)
  await new Promise(r => setTimeout(r, 20))
  expect(mentor.animTicks).toBe(t1)
})

// ---------- prywatność ----------

test('prywatność: polecenie Bash z tokenem w obserwacji bez tokenu; stara historia czyszczona przy odczycie', async () => {
  const io = fakeHost()
  setState('feed', () => [])
  await mentor.onTool(io, 'Bash', { command: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuv" https://x' }, { isError: true, text: 'error: 401' })
  expect(JSON.stringify(getState('feed'))).not.toContain('abcdefghijklmnop')
  const dirty = { summary: 'api_key = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA1111"', turnLabel: 'wstaw token ghp_abcdefghijklmnopqrstuvwxyz0123', facts: ['Linia 2: wartość `"sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA1111"` → `"x"`.'] }
  const clean = cleanMeta(dirty)
  expect(JSON.stringify(clean)).not.toContain('AAAAAAAAAAAA')
  expect(JSON.stringify(clean)).not.toContain('ghp_abcdefghijklmnop')
})

// ---------- agenci i grafika ----------

test('agenci: start, czynność z narzędzia, koniec z tokenami; rola wybiera strój kraba', async () => {
  const { spawnAgent, agentTool, endAgent, describeTool, modelName, elapsedOf } = await import('../hooks/engine/agents')
  const { costumeOf } = await import('../hooks/ui/crab')
  let list = spawnAgent([], { id: 'a1', agentId: 'a1', type: 'Explore', description: 'Znajdź walidację', model: modelName('claude-haiku-5-5'), at: 0 })
  expect(list[0]!.model).toBe('Haiku 5.5')
  list = agentTool(list, 'a1', describeTool('Grep', { pattern: 'validateEmail' }))
  list = agentTool(list, 'a1', describeTool('Edit', { file_path: 'C:/p/src/forms/register.ts' }))
  expect(list[0]!.now).toBe('edytuje forms/register.ts')
  expect(list[0]!.tools).toBe(2)
  expect(describeTool('Bash', { command: 'npm test -- --watch=false extra args' })).toBe('uruchamia: npm test --')
  list = endAgent(list, 'a1', true, 48_000, 73_000)
  expect(list[0]!.status).toBe('done')
  expect(list[0]!.tokens).toBe(48_000)
  expect(elapsedOf(list[0]!, 999_999)).toBe(73_000)
  expect(endAgent(spawnAgent([], { id: 'b', agentId: 'b', type: 'x', description: '', model: '', at: 0 }), 'b', false, 0, 5)[0]!.status).toBe('failed')
  expect(costumeOf('Explore')).toBe('explore')
  expect(costumeOf('Plan')).toBe('heavy')
  expect(costumeOf('general-purpose')).toBe('careful')
  expect(costumeOf('claude-code-guide')).toBe('fable')
  expect(costumeOf('savvy-flow:savvy-light')).toBe('light')
  expect(costumeOf('my-plugin:something')).toBe('other')
})

test('agenci: krok modelu daje kontekst, tokeny i szacunek kosztu z cennika savvy-progress', async () => {
  const { spawnAgent, stepAgent, endAgent, costOf, ctxPercent, fmtCost } = await import('../hooks/engine/agents')
  let list = spawnAgent([], { id: 'a1', agentId: 'a1', type: 'Explore', description: 'x', model: 'Haiku 5.5', at: 0, turn: 3 })
  expect(list[0]!.turn).toBe(3)
  const u = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 38_000, cache_creation_input_tokens: 0 }
  list = stepAgent(list, 'a1', u, 'claude-haiku-5-5', 'low')
  list = stepAgent(list, 'a1', u, 'claude-haiku-5-5')
  expect(list[0]!.contextTokens).toBe(50_000)
  expect(list[0]!.contextMax).toBe(200_000)
  expect(ctxPercent(list[0]!)).toBe(25)
  expect(list[0]!.tokens).toBe(100_000)
  expect(list[0]!.effort).toBe('low')
  // haiku: 1 / 5 / 0.1 USD za milion
  expect(Math.round(costOf('claude-haiku-5-5', u) * 1e6)).toBe(23_800)
  expect(fmtCost(list[0]!.costUsd)).toBe('$0.05')
  // koniec bez kroków bierze sumę z tury, po krokach zostaje to, co zebrały kroki
  expect(endAgent(list, 'a1', true, 1, 9, 99)[0]!.tokens).toBe(100_000)
})

test('grafika: krab, wiersze agentów, pasek zadania, pasek z pikseli, shimmer i oś to poprawne SVG z wyłączaniem ruchu', async () => {
  const v = await import('../hooks/ui/visuals')
  const sv = await import('../hooks/ui/savvy')
  const { crabSvg } = await import('../hooks/ui/crab')
  const row = sv.agentSvg(600, { costume: 'explore', description: 'Szukaj <walidacji> & testów', role: 'Explore', model: 'Haiku 5.5', status: 'running', steps: 'teraz: czyta a.ts', stats: `ctx 4% · 38k ≈$0.05 ${v.fmtTime(61_000)}`, progress: null, ctx: 4 })
  const flowRow = sv.flowRowSvg({ title: 'Popraw walidację', total: 3, done: 1, running: 2, isFinished: false, label: 'Agenci 1/3' }, 700, true, 'careful')
  expect(flowRow).toContain('Agenci 1/3')
  expect(flowRow).toContain('33%')
  expect(flowRow).toContain('c-careful run')
  expect(sv.headerSvg(400, 'Zadanie', [['Koszt (szac.)', '≈$0.05']])).toContain('Koszt (szac.)')
  expect(v.fmtTime(3_725_000)).toBe('1:02:05')
  for (const svg of [row, flowRow, crabSvg('medium', true), v.pixelBarSvg(0.5, 300, '#d97757', '3/6', true), v.shimmerSvg('a.ts', 'orange').svg]) {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('prefers-reduced-motion')
  }
  expect(row).toContain('Szukaj &lt;walidacji&gt; &amp; testów')
  expect(row).toContain('1:01')
  expect(row).toContain('teraz: czyta a.ts')
  // shimmer w terminalu: pasmo przesuwa się z klatką
  const pal = v.TONES.orange.bright
  expect(v.shimmer(0, 0, 8, pal)).not.toBe(v.shimmer(0, 3, 8, pal))
  expect(v.weather(10).icon).toBe('☀')
  expect(v.weather(95).word).toBe('pełno')
  expect(v.pixelBarText(0.5, 10)).toBe('█████░░░░░')
})

test('panel: subagent z agent.spawn jest w Zmianach, w bocznym panelu Agenci i w pasku zadania nad promptem obok innych modów', async ($, on) => {
  mock.clock(on, { now: T0 })
  on('agent.spawn', () => ({ agentId: 'ag-1', model: 'claude-haiku-5-5' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  await $.agent.spawn({ prompt: 'Znajdź walidację', description: 'Znajdź walidację emaila', subagentType: 'Explore' } as never)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ type: 'Text', text: /AGENCI/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ag-open' })).toBeDefined()
  await ui.unmount()
  const agents = (surface: 'desktop' | 'terminal') => ({ ...PANE(surface), requestId: 'mentor-agents', props: { ...PANE(surface).props, title: 'Agenci', bodyColumns: 60 } })
  const side = await $.ui.mount(agents('terminal'))
  expect(await side.find({ type: 'Text', text: 'Pracują · 1' })).toBeDefined()
  expect(await side.find({ type: 'Text', text: 'Znajdź walidację emaila' })).toBeDefined()
  expect(await side.find({ type: 'Text', text: /Explore · Haiku 5\.5/ })).toBeDefined()
  await side.press({ key: 'ag-compact' })
  expect(await side.find({ type: 'Button', key: 'ag-compact', label: 'Rozwiń' })).toBeDefined()
  await side.press({ key: 'ag-compact' })
  await side.unmount()
  const desk = await $.ui.mount(agents('desktop'))
  expect(await desk.find({ type: 'Svg', alt: /Znajdź walidację emaila: Haiku 5\.5, pracuje/ })).toBeDefined()
  await desk.unmount()
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} } })
  expect(await band.find({ type: 'Text', text: 'Agenci 0/1' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'flow-open', label: '×1' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  // ✕ chowa pasek zadania do następnej tury, treść innych modów zostaje
  await band.press({ key: 'flow-close' })
  expect(await band.find({ type: 'Text', text: 'Agenci 0/1' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  await band.unmount()
})

test('pasek zadania przy zwykłym poleceniu: w trakcie pasmo, kroki, pliki i czas, krab w stroju czynności; po odpowiedzi Gotowe z liniami', async ($, on) => {
  const { renderFlowBand, costumeForTool } = await import('../hooks/ui/agents')
  const { flowRowSvg } = await import('../hooks/ui/savvy')
  expect(costumeForTool('Grep')).toBe('heavy')
  expect(costumeForTool('Edit')).toBe('careful')
  expect(costumeForTool('Bash')).toBe('light')
  const io = fakeHost()
  let isWorking = true
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => (await renderFlowBand(io, $$.ui.resolve(e) as never, e.surface, 100, isWorking)) ?? <></>)
  mentor.onPrompt('Popraw walidację emaila\nszczegóły niżej')
  mentor.startWork(T0 - 42_000)
  mentor.workStep('Read')
  mentor.workStep('Edit')
  setState('activity', a => ({ ...a, files: [{ path: 'src/a.ts', kind: 'edit', active: false, ok: true, since: T0, at: T0, reads: 0, edits: 1 }] }))
  const props = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
  let band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
  expect(await band.find({ type: 'Text', text: 'Popraw walidację emaila' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'Pracuje · 2 kroki · 1 plik' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '0:42' })).toBeDefined()
  await band.unmount()
  // pasmo w SVG ma własną animację i wyłącza się przy ograniczonym ruchu; krab w stroju inżyniera idzie
  const svg = flowRowSvg({ title: 'x', total: 0, done: 0, running: 0, isFinished: false, indeterminate: true, label: 'Pracuje · 2 kroki', right: '0:42' }, 700, true, 'careful')
  expect(svg).toContain('@keyframes sw')
  expect(svg).toContain('.sw{animation:none}')
  expect(svg).toContain('c-careful run')
  expect(svg).toContain('0:42')
  // koniec odpowiedzi: zielony pasek, linie z obserwacji, czas zamrożony
  mentor.work = { ...mentor.work, added: 12, removed: 3 }
  mentor.endWork(T0)
  isWorking = false
  band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...props, isWorking: false } })
  expect(await band.find({ type: 'Text', text: 'Gotowe · +12 −3' })).toBeDefined()
  await band.unmount()
  // ✕ (flowDismissedTurn) chowa pasek do następnego polecenia
  mentor.flowDismissedTurn = mentor.turn
  band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...props, isWorking: false } })
  expect(await band.find({ type: 'Text', text: 'Gotowe · +12 −3' })).toBeUndefined()
  await band.unmount()
  mentor.onPrompt('następne')
  mentor.startWork(T0)
  expect(mentor.flowDismissedTurn).not.toBe(mentor.turn)
  setState('activity', () => EMPTY_ACTIVITY)
})

// ---------- zadania w tle ----------

test('zadania w tle: start z wyniku Bash, ogon wyjścia bez ANSI i sekretów, koniec z powiadomienia', async () => {
  const t = await import('../hooks/engine/tasks')
  expect(t.outputPathFrom('Command running in background with ID: bm7. Output is being written to: C:\\Users\\x\\tasks\\bm7.output. Use Read')).toBe('C:\\Users\\x\\tasks\\bm7.output')
  expect(t.outputPathFrom('Output: /tmp/claude/tasks/ab1.output')).toBe('/tmp/claude/tasks/ab1.output')
  expect(t.outputPathFrom('brak')).toBe(null)
  let list = t.startTask([], { id: 'bm7', command: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuv" x', description: 'Sprawdź API', outputFile: '/tmp/a.output', at: 0 })
  expect(list[0]!.command).not.toContain('abcdefghijklmnop')
  const out = ['start', '\u001b[32mOK\u001b[0m 1/3', 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456', '', 'postęp: 3/3'].join('\n')
  list = t.withOutput(list, 'bm7', out, 1000)
  // 4 ostatnie niepuste linie, bez kodów kolorów, z wyciętym tokenem
  expect(list[0]!.tail).toEqual(['start', 'OK 1/3', 'token=[USUNIĘTO: token GitHub]', 'postęp: 3/3'])
  expect(list[0]!.tail.join(' ')).not.toContain('ghp_abcdefghijklmnop')
  expect(list[0]!.nextReadAt).toBe(1000 + t.readDelay(out.length))
  expect(t.readDelay(50_000)).toBe(2000)
  expect(t.readDelay(5_000_000)).toBe(15000)
  expect(t.nextRead(list)).toBe(list[0]!.nextReadAt)
  const note = t.parseNotification('<task-notification>\n<task-id>bm7</task-id>\n<output-file>/tmp/a.output</output-file>\n<status>failed</status>\n<summary>Background command "x" failed with exit code 1</summary>\n</task-notification>')
  expect(note).toEqual({ id: 'bm7', status: 'failed', summary: 'Background command "x" failed with exit code 1', outputFile: '/tmp/a.output' })
  expect(t.parseNotification('zwykła wiadomość')).toBe(null)
  list = t.endTask(list, 'bm7', 'failed', 5000, note!.summary)
  expect(list[0]!.status).toBe('failed')
  expect(t.nextRead(list)).toBe(null)
  expect(t.endTask(t.startTask([], { id: 'k', command: 'x', outputFile: null, at: 0 }), 'k', 'killed', 1)[0]!.status).toBe('killed')
})

test('panel: zadanie w tle z Bash widać w Zmianach, a jego wyjście dochodzi na żywo', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' }, text: 'Command running in background with ID: bg-1. Output is being written to: C:/tmp/tasks/bg-1.output' }) as never)
  on('fs.read', () => ({ value: 'kompiluję…\n[1/2] gotowe\n[2/2] gotowe' }) as never)
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped', task_id: 'bg-1', task_type: 'local_bash' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Buduję projekt', run_in_background: true } as never)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-changes' })
  // w Zmianach skrót: pracujące zadanie i przycisk do panelu
  expect(await ui.find({ type: 'Text', text: /ZADANIA W TLE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Buduję projekt' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tk-open' })).toBeDefined()
  await ui.unmount()
  // panel „Zadania w tle”: wiersz z komendą, wyjście na żywo, rozwinięte wyjście, zatrzymanie po kliknięciu
  const pane = await $.ui.mount({ ...PANE('terminal'), requestId: 'mentor-tasks', props: { ...PANE('terminal').props, title: 'Zadania w tle' } })
  expect(await pane.find({ type: 'Text', text: 'PRACUJĄ · 1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\$ npm run build/ })).toBeDefined()
  await clock.advance(3000)
  expect(await pane.find({ type: 'Text', text: /│ \[2\/2\] gotowe/ })).toBeDefined()
  await pane.press({ key: 'tp-out-bg-1' })
  expect(await pane.find({ type: 'Text', text: 'kompiluję…' })).toBeDefined()
  await pane.press({ key: 'tp-stop-bg-1' })
  expect(await pane.find({ type: 'Button', text: /SKOŃCZONE · 1/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /zatrzymane · / })).toBeDefined()
  await pane.unmount()
})
