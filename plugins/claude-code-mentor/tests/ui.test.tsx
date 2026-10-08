// UI i integracja: panel na desktopie i w terminalu, przyciski, symulator
// w panelu, przezroczystość hooków (Mentor nie zmienia wyników narzędzi
// ani odpowiedzi Claude), pasek nad promptem.
import { expect, mock, test } from 'claude-code/testing'
import { findSites } from '../hooks/sim/variants'
import { DEFAULT_SIM } from '../hooks/ui/state'

const PLUGIN = 'claude-code-mentor'
const PANE = (bodyColumns = 72) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'mentor',
  props: { title: 'Mentor', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 160, rows: 50 },
})

test('B: panel rysuje się na desktopie i w terminalu, zakładki działają', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE(), surface })
    expect(await ui.find({ key: 'tab-lesson' })).toBeDefined()
    expect(await ui.find({ key: 'tab-now' })).toBeDefined()
    for (const tab of ['lesson', 'sim', 'practice', 'knowledge', 'path', 'settings', 'now'] as const) {
      await ui.press({ key: `tab-${tab}` })
    }
    await ui.press({ key: 'tab-sim' })
    expect(await ui.find({ key: 'sim-step' })).toBeDefined()
    await ui.press({ key: 'tab-settings' })
    expect(await ui.find({ key: 'tg-autoTeach' })).toBeDefined()
    await ui.press({ key: 'tab-now' })
    await ui.unmount()
  }
})

test('B/P0: symulator w panelu: STEP, BACK, RESET, RUN i podmiana operatora (bez zmiany plików)', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  await ui.press({ key: 'tab-sim' })
  expect(await ui.find({ type: 'Text', text: /Krok 1\// })).toBeDefined()
  await ui.press({ key: 'sim-step' })
  await ui.press({ key: 'sim-step' })
  expect(await ui.find({ type: 'Text', text: /Krok 3\// })).toBeDefined()
  await ui.press({ key: 'sim-back' })
  expect(await ui.find({ type: 'Text', text: /Krok 2\// })).toBeDefined()
  await ui.press({ key: 'sim-run' })
  expect(await ui.find({ type: 'Text', text: /> x jest mniejsze od 10/ })).toBeDefined()
  await ui.press({ key: 'sim-reset' })
  expect(await ui.find({ type: 'Text', text: /Krok 1\// })).toBeDefined()
  // operator < → > : wariant B, inny wynik
  const site = findSites(DEFAULT_SIM.source).ops.find(o => o.op === '<')!
  expect(await ui.find({ key: `op-${site.id}` })).toBeDefined()
  await ui.select({ key: `op-${site.id}`, value: '>' })
  expect(await ui.find({ type: 'Text', text: /Wariant B/ })).toBeDefined()
  await ui.press({ key: 'sim-run' })
  expect(await ui.find({ type: 'Text', text: /> x jest co najmniej 10/ })).toBeDefined()
  await ui.press({ key: 'sim-compare' })
  expect(await ui.find({ type: 'Markdown', text: /Linia 2/ })).toBeDefined()
  await ui.press({ key: 'sim-explain' })
  await ui.press({ key: 'sim-why' })
  await ui.unmount()
})

test('B: eksplorator warunków pokazuje przypadki brzegowe', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  await ui.press({ key: 'tab-sim' })
  await ui.press({ key: 'm-cond' })
  await ui.input({ key: 'cond-left', text: '10' })
  expect(await ui.find({ type: 'Text', text: /10 < 10\s+→\s+false/ })).toBeDefined()
  await ui.select({ key: 'cond-op', value: '<=' })
  expect(await ui.find({ type: 'Text', text: /10 <= 10\s+→\s+true/ })).toBeDefined()
  await ui.unmount()
})

test('J/9: hooki przepuszczają wynik narzędzia i odpowiedź Claude bez zmian', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({
    result: { filePath: 'C:/p/src/a.ts', oldString: 'a', newString: 'b', originalFile: 'x', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-if (x == 1) {}', '+if (x === 1) {', '+}'] }], userModified: false, replaceAll: false },
  }))
  on('turn.complete', () => ({ text: 'ORYGINAŁ' }))
  const r = await $.tool.call({ tool: 'Edit', file_path: 'C:/p/src/a.ts', old_string: 'a', new_string: 'b' })
  expect('result' in r && (r.result as { filePath: string }).filePath).toBe('C:/p/src/a.ts')
  const t = await $.turn.complete({ answer: 'ORYGINAŁ', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(t.text).toBe('ORYGINAŁ')
})

test('pasek nad promptem: bez tematu oddaje pasek silnikowi (nic nie dokłada)', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const hasSurvey of [true, false]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { hasSurvey, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
      expect(await ui.find({ key: 'band-open' })).toBe(undefined)
      expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
      await ui.unmount()
    }
  }
})
