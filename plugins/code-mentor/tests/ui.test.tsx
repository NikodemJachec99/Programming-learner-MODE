// UI i integracja: panel na desktopie i w terminalu, przyciski, symulator
// w panelu, przezroczystość hooków (Mentor nie zmienia wyników narzędzi
// ani odpowiedzi Claude), pasek nad promptem.
import { expect, mock, test } from 'claude-code/testing'
import { findSites } from '../hooks/sim/variants'
import { DEFAULT_SIM } from '../hooks/ui/state'
import { effortFor, modelFor, validModelId } from '../hooks/engine/budget'

const PLUGIN = 'code-mentor'
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
    expect(await ui.find({ key: 'tab-practice' })).toBeDefined()
    expect(await ui.find({ key: 'tab-changes' })).toBeDefined()
    for (const tab of ['sim', 'practice', 'changes'] as const) {
      await ui.press({ key: `tab-${tab}` })
    }
    for (const tab of ['lesson', 'knowledge', 'path', 'settings'] as const) {
      await ui.select({ key: 'tab-more', value: tab })
    }
    expect(await ui.find({ key: 'tg-autoTeach' })).toBeDefined()
    await ui.press({ key: 'tab-sim' })
    expect(await ui.find({ key: 'sim-step' })).toBeDefined()
    await ui.press({ key: 'tab-changes' })
    await ui.unmount()
  }
})

test('B/P0: symulator w panelu: STEP, BACK, RESET, RUN i podmiana operatora (bez zmiany plików)', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  await ui.press({ key: 'tab-sim' })
  expect(await ui.find({ type: 'Text', text: /[▰▱] 1\/\d+$/ })).toBeDefined()
  await ui.press({ key: 'sim-step' })
  await ui.press({ key: 'sim-step' })
  expect(await ui.find({ type: 'Text', text: /[▰▱] 3\/\d+$/ })).toBeDefined()
  await ui.press({ key: 'sim-back' })
  expect(await ui.find({ type: 'Text', text: /[▰▱] 2\/\d+$/ })).toBeDefined()
  await ui.press({ key: 'sim-run' })
  expect(await ui.find({ type: 'Text', text: /> x jest mniejsze od 10/ })).toBeDefined()
  await ui.press({ key: 'sim-reset' })
  expect(await ui.find({ type: 'Text', text: /[▰▱] 1\/\d+$/ })).toBeDefined()
  // operator < → > : wariant B, inny wynik
  const site = findSites(DEFAULT_SIM.source).ops.find(o => o.op === '<')!
  await ui.press({ key: 'sim-whatif' })
  expect(await ui.find({ key: `op-${site.id}` })).toBeDefined()
  await ui.select({ key: `op-${site.id}`, value: '>' })
  expect(await ui.find({ type: 'Text', text: /^B: zmieniony/ })).toBeDefined()
  await ui.press({ key: 'sim-run' })
  expect(await ui.find({ type: 'Text', text: /> x jest co najmniej 10/ })).toBeDefined()
  await ui.press({ key: 'sim-compare' })
  expect(await ui.find({ type: 'Markdown', text: /Linia 2/ })).toBeDefined()
  await ui.press({ key: 'sim-compare' })
  await ui.press({ key: 'sim-reset' })
  await ui.press({ key: 'sim-step' })
  await ui.press({ key: 'sim-explain' })
  expect(await ui.find({ type: 'Markdown', text: /Instrukcja warunkowa/ })).toBeDefined()
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

test('pasek kontekstu jest częścią Mentora: kategorie, procent, licznik cache, przycisk Mentor i przyciski paneli', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  on('session.usage', () => ({ value: {
    context: { breakdown: { totalTokens: 120_000, maxTokens: 200_000, percentage: 60, categories: [
      { name: 'System prompt', tokens: 20_000, color: 'inactive', kind: 'used' },
      { name: 'Messages', tokens: 100_000, color: 'permission', kind: 'used' },
      { name: 'Free space', tokens: 80_000, color: 'subtle', kind: 'free' },
    ] } },
  } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  for (const surface of ['desktop', 'terminal'] as const) {
    const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 90, scroll: { offset: 0, bodyRows: 3 }, view: {} }
    let ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })
    await ui.unmount()
    ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })
    expect(await ui.find({ key: 'open-mentor' })).toBeDefined()
    // boczne panele otwiera się z paska (same się nie otwierają)
    expect(await ui.find({ key: 'open-agents' })).toBeDefined()
    expect(await ui.find({ key: 'open-files' })).toBeDefined()
    expect(await ui.find({ key: 'open-tasks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60% 120k\/200k/ })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})

test('ustawienia: 3 najważniejsze na wierzchu, reszta dopiero w „Zaawansowane”', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  await ui.select({ key: 'tab-more', value: 'settings' })
  expect(await ui.find({ key: 'tg-autoTeach' })).toBeDefined()
  expect(await ui.find({ key: 'tg-contextBar' })).toBeDefined()
  expect(await ui.find({ key: 's-cost' })).toBeDefined()
  expect(await ui.find({ key: 'tg-paused' })).toBe(undefined)
  expect(await ui.find({ key: 'd-wipe' })).toBe(undefined)
  await ui.press({ key: 'set-adv' })
  expect(await ui.find({ key: 'tg-paused' })).toBeDefined()
  expect(await ui.find({ key: 'd-wipe' })).toBeDefined()
  // Moja wiedza bez danych: żadnych pustych filtrów
  await ui.select({ key: 'tab-more', value: 'knowledge' })
  expect(await ui.find({ key: 'kf-0' })).toBe(undefined)
  expect(await ui.find({ key: 'kf-4' })).toBe(undefined)
  await ui.unmount()
})

test('symulator: „Odtwórz” przechodzi kod sam krok po kroku, pauza zatrzymuje, na końcu „jeszcze raz”', async ($, on) => {
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  await ui.press({ key: 'tab-sim' })
  await ui.press({ key: 'sim-reset' })
  await ui.press({ key: 'sim-play' })
  expect(await ui.find({ key: 'sim-play', text: /Pauza/ })).toBeDefined()
  await clock.advance(17000)
  const mid = (await ui.find({ type: 'Text', text: /[▰▱] \d+\/\d+$/ }))!.text!
  const at = Number(/(\d+)\/\d+$/.exec(mid)![1])
  expect(at).toBeGreaterThan(1)
  // pauza: kursor stoi mimo upływu czasu
  await ui.press({ key: 'sim-play' })
  await clock.advance(20000)
  expect(await ui.find({ type: 'Text', text: new RegExp(`[▰▱] ${at}/[0-9]+$`) })).toBeDefined()
  // wznowienie do końca
  await ui.press({ key: 'sim-play' })
  await clock.advance(120000)
  expect(await ui.find({ key: 'sim-play', text: /jeszcze raz/ })).toBeDefined()
  // tempo: domyślnie wolno, przełącznik idzie po kolei
  expect(await ui.find({ key: 'sim-speed', text: /wolno/ })).toBeDefined()
  await ui.press({ key: 'sim-speed' })
  expect(await ui.find({ key: 'sim-speed', text: /średnio/ })).toBeDefined()
  await ui.press({ key: 'sim-speed' })
  await ui.press({ key: 'sim-speed' })
  expect(await ui.find({ type: 'Text', text: /> x jest mniejsze od 10/ })).toBeDefined()
  await ui.unmount()
})

test('język: English w Ustawieniach przełącza interfejs, polski wraca', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount({ ...PANE(), surface: 'terminal' })
  await ui.select({ key: 'tab-more', value: 'settings' })
  expect(await ui.find({ key: 's-language' })).toBeDefined()
  await ui.select({ key: 's-language', value: 'en' })
  expect(await ui.find({ type: 'Button', key: 'tab-changes', text: 'Changes' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tab-practice', text: 'Practice' })).toBeDefined()
  await ui.press({ key: 'tab-changes' })
  expect(await ui.find({ type: 'Text', text: 'Claude’s changes' })).toBeDefined()
  await ui.select({ key: 'tab-more', value: 'settings' })
  await ui.select({ key: 's-language', value: 'pl' })
  expect(await ui.find({ type: 'Button', key: 'tab-changes', text: 'Zmiany' })).toBeDefined()
  await ui.unmount()
})

test('model: konkretna wersja zamiast aliasu, effort tylko gdy nie domyślny', () => {
  expect(modelFor({ model: 'haiku', modelId: '' })).toBe('haiku')
  expect(modelFor({ model: 'haiku', modelId: ' claude-sonnet-5-5 ' })).toBe('claude-sonnet-5-5')
  expect(modelFor({ model: 'opus', modelId: 'zła nazwa; rm -rf' })).toBe('opus')
  expect(validModelId('claude-opus-5-5[1m]')).toBe(true)
  expect(validModelId('us.anthropic.claude-sonnet-5-5-v1:0')).toBe(true)
  expect(validModelId('a b')).toBe(false)
  expect(effortFor({ effort: 'default' })).toBe(undefined)
  expect(effortFor({})).toBe(undefined)
  expect(effortFor({ effort: 'low' })).toBe('low')
})

test('ustawienia: wersja modelu i effort w Zaawansowanych, zła nazwa odrzucona', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE(), surface })
    await ui.select({ key: 'tab-more', value: 'settings' })
    expect(await ui.find({ key: 's-modelId' })).toBe(undefined)
    await ui.press({ key: 'set-adv' })
    expect(await ui.find({ type: 'Text', text: /Puste: alias „haiku”/ })).toBeDefined()
    await ui.input({ key: 's-modelId', text: 'claude-sonnet-5-5' })
    expect(await ui.find({ type: 'Text', text: /Lekcje idą do claude-sonnet-5-5/ })).toBeDefined()
    await ui.input({ key: 's-modelId', text: 'zła nazwa' })
    expect(await ui.find({ type: 'Text', text: /to nie jest identyfikator modelu/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Lekcje idą do claude-sonnet-5-5/ })).toBeDefined()
    await ui.select({ key: 's-effort', value: 'low' })
    expect(await ui.find({ key: 's-effort' })).toBeDefined()
    await ui.input({ key: 's-modelId', text: '' })
    expect(await ui.find({ type: 'Text', text: /Puste: alias „haiku”/ })).toBeDefined()
    await ui.select({ key: 's-effort', value: 'default' })
    await ui.press({ key: 'n-close' })
    await ui.press({ key: 'set-adv' })
    await ui.unmount()
  }
})
