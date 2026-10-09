// Przykłady do nauki i granica „prawdziwy kod czy przykład”.
import { expect, mock, test } from 'claude-code/testing'
import { EXAMPLES, exampleFor } from '../hooks/engine/examples'
import { pairRunnable, runnable } from '../hooks/engine/runnable'
import { simulate } from '../hooks/sim/interp'

const run = (src: string, dialect: 'js' | 'dart') => simulate(src, { maxSteps: 5000, dialect, stubs: true })

test('każdy przykład wykonuje się w całości: bez błędu, bez założeń i coś wypisuje', () => {
  expect(EXAMPLES.length).toBeGreaterThan(30)
  for (const ex of EXAMPLES) {
    if (ex.widgets) continue
    const b = run(ex.code, ex.dialect)
    if (!b.ok || b.assumed || !b.output.length) throw new Error(`${ex.id}: ${b.error?.message ?? (b.assumed ? 'założenie' : 'nic nie wypisał')}`)
    if (ex.before) {
      // „przed” może celowo kończyć się wyjątkiem (przeróbka go naprawia), ale bez błędu składni i założeń
      const a = run(ex.before, ex.dialect)
      if (a.assumed || a.error?.kind === 'syntax' || a.error?.kind === 'unsupported') throw new Error(`${ex.id} (przed): ${a.error?.message ?? 'założenie'}`)
    }
  }
})

test('przykłady par pokazują różnicę, o którą chodzi', () => {
  const get = (id: string) => EXAMPLES.find(e => e.id === id)!
  const all = get('rf-promise-all')
  expect(run(all.before!, 'js').output).toEqual(['start 1', 'koniec 1', 'start 2', 'koniec 2', '[10, 20]'])
  expect(run(all.code, 'js').output).toEqual(['start 1', 'start 2', 'koniec 1', 'koniec 2', '[10, 20]'])
  const vl = get('rf-var-let')
  expect(run(vl.before!, 'js').output).toEqual(['[3, 3, 3]'])
  expect(run(vl.code, 'js').output).toEqual(['[0, 1, 2]'])
  const nul = get('rf-null-check')
  expect(run(nul.before!, 'js').ok).toBe(false)
  expect(run(nul.code, 'js').output).toEqual(['brak miasta'])
})

test('dobór przykładu: najpierw ta sama przeróbka, potem pojęcie, dla Darta najpierw Dart', () => {
  expect(exampleFor(['promise-all'], ['arrays'], 'js')!.id).toBe('rf-promise-all')
  expect(exampleFor([], ['closures'], 'js')!.id).toBe('closure')
  expect(exampleFor([], ['dart-null-safety'], 'dart')!.dialect).toBe('dart')
  expect(exampleFor([], ['flutter-state'], 'dart')!.id).toBe('dart-flutter')
  expect(exampleFor([], ['nieznane'], 'js')).toBe(null)
})

test('prawdziwy kod: uruchamiamy tylko czysty, zależny od projektu dostaje przykład', () => {
  expect(runnable('export function label(x: number) {\n  return x < 10 ? "mało" : "dużo"\n}', 'js')).toBe(true)
  // nazwy spoza wycinka (db) to zaślepki, czyli założenie
  expect(runnable('export function price(id: string) {\n  return db.get(id) + 1\n}', 'js')).toBe(false)
  // importy i składnia spoza podzbioru
  expect(runnable("import { x } from './y'\nexport function f() {\n  return x\n}", 'js')).toBe(false)
  // para: „przed” może rzucać, „po” musi działać
  expect(pairRunnable('export function f(u: any) {\n  return u.a.b\n}', 'export function f(u: any) {\n  return u?.a?.b ?? 0\n}', 'js')).toBe(true)
})

const PANE = {
  plugin: 'claude-code-mentor',
  component: 'Pane' as const,
  requestId: 'mentor',
  props: { title: 'Mentor', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 140, rows: 50 },
}

test('panel: zmiana zależna od projektu nie ma „Uruchom”, tylko „Zobacz na przykładzie” z notką', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const before = ['export async function loadAll(ids: string[]) {', '  const out = []', '  for (const id of ids) {', '    out.push(await api.get(id))', '  }', '  return out', '}'].join('\n')
  const patch = [{ oldStart: 2, oldLines: 5, newStart: 2, newLines: 1, lines: ['-  const out = []', '-  for (const id of ids) {', '-    out.push(await api.get(id))', '-  }', '-  return out', '+  return Promise.all(ids.map(id => api.get(id)))'] }]
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'C:/p/src/load.ts', oldString: '', newString: '', originalFile: before, structuredPatch: patch, userModified: false, replaceAll: false } }))
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/load.ts', old_string: 'x', new_string: 'y' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-changes' })
  const row = await ui.find({ type: 'Button', text: /load\.ts/ })
  await ui.press({ key: row!.key! })
  expect(await ui.find({ key: 'lab-run' })).toBe(undefined)
  expect(await ui.find({ key: 'lab-example' })).toBeDefined()
  await ui.press({ key: 'lab-example' })
  expect(await ui.find({ type: 'Text', text: /przykład: await w pętli → Promise\.all/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /kolejność wypisów/ })).toBeDefined()
  expect(await ui.find({ key: 'pair-a' })).toBeDefined()
  expect(await ui.find({ key: 'sim-step' })).toBeDefined()
  await ui.unmount()
})
