// Claude Code Mentor: integracja z Claude Code.
// Zasada nadrzędna: Mentor obserwuje, nie ingeruje. Każdy hook przepuszcza
// zdarzenie dalej bez zmian (next(e)), a treści edukacyjne trafiają wyłącznie
// do panelu i paska nad promptem, nigdy do rozmowy ani do kontekstu modelu.
//
// API modów dopuszcza `$` tylko jako `$.rzeczownik.metoda(...)`, dlatego hooki
// budują tu adapter Host z domknięć, a reszta kodu dostaje adapter.

import type { EngineInterface, Register } from 'claude-code'
import type { MentorTab } from '../types'
import { offlineHost, stateOps } from './host'
import type { Host } from './host'
import { mentor } from './mentor'
import type { El } from './ui/kit'
import { renderBar } from './ui/bar'
import type { BarRow } from './ui/bar'
import { PANE_ID, PANE_TITLE, renderBand, renderPane } from './ui/pane'
import { loadSim } from './ui/sim'
import { getState, S, setState } from './ui/state'

const OBSERVED = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])

const HELP = [
  '/mentor            otwiera panel',
  '/mentor explain    pogłębiona lekcja o ostatniej istotnej zmianie',
  '/mentor quiz       ćwiczenie „Sprawdź, czy rozumiem”',
  '/mentor sim [kod | plik:od-do]   symulator (bez argumentu: zaznaczony tekst)',
  '/mentor recap | progress         podsumowanie i postępy',
  '/mentor path       ścieżka nauki i graf pojęć',
  '/mentor pause | resume           wstrzymanie / wznowienie automatycznych lekcji',
  '/mentor settings | diag          ustawienia, dane, diagnostyka',
  '/mentor zmiany    lista zmian Claude (Change Lab)',
  '/mentor pasek [ttl 5|60]         pasek kontekstu: włącz/wyłącz albo czas cache'
].join('\n')

/** Adapter sesji: zbudowany w session.start, używany przez obserwacje i timery. */
let HOST: Host | null = null

/** Adapter na `$` danego zdarzenia (funkcja w tym samym pliku, jak pozwala API modów). */
function makeHost($: EngineInterface): Host {
  return {
    ...stateOps(() => $.ui.invalidate('ui.render')),
    now: () => $.clock.now(),
    sessionId: () => $.session.id(),
    sessionRoot: () => $.session.root(),
    version: async () => (await $.session.version()).version,
    isGitRepo: async () => (await $.session.repo()) !== null,
    surfaces: () => $.session.surfaces(),
    dataDir: async () => {
      const own = await $.env.get('CLAUDE_CODE_MENTOR_DATA')
      if (own) return own
      const local = await $.env.get('LOCALAPPDATA')
      if (local) return `${local.replace(/[\\/]+$/, '')}\\ClaudeCodeMentor`
      const home = await $.env.get('HOME')
      if (!home) return undefined
      const mac = `${home}/Library/Application Support`
      if (await $.fs.exists(mac).catch(() => false)) return `${mac}/ClaudeCodeMentor`
      const xdg = await $.env.get('XDG_DATA_HOME')
      return `${xdg || `${home}/.local/share`}/ClaudeCodeMentor`
    },
    fillPrompt: async text => (await $.prompt.fill({ text })).isFilled,
    installedVersion: async () => {
      const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
      if (!home) return null
      const sep = home.includes('\\') ? '\\' : '/'
      try {
        const j = JSON.parse(await $.fs.read(`${home}${sep}.claude${sep}plugins${sep}installed_plugins.json`)) as { plugins?: Record<string, { version?: string }[]> }
        const key = Object.keys(j.plugins ?? {}).find(k => k.startsWith('claude-code-mentor@'))
        return (key && j.plugins![key]![0]?.version) || null
      } catch {
        return null
      }
    },
    pluginRoot: $.plugin.root,
    fsRead: path => $.fs.read(path),
    fsExists: path => $.fs.exists(path),
    run: (argv, init) => $.process.run(argv, init),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: key => $.store.delete(key),
    complete: req => $.model.complete(req),
    log: text => $.ui.log(text, { to: 'debug' }),
    toast: text => $.ui.toast(text),
    openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    panes: () => $.ui.panes(),
    selection: () => $.ui.selection(),
  }
}

/**
 * Start sesji Mentora: adapter, timer kolejki lekcji, baza. Wołane z session.start,
 * a leniwie z pierwszego zdarzenia po /reload-plugins, które session.start nie wywołuje.
 */
function startSession($: EngineInterface, cwd: string | null, surface: string | null, openPane: boolean): Host {
  const io = makeHost($)
  HOST = io
  $.clock.every(3000, () => {
    void mentor.tick(io).catch(err => $.ui.log(`claude-code-mentor: kolejka: ${String(err)}`, { to: 'debug' }))
  })
  void (async () => {
    try {
      await mentor.boot(io, cwd ?? (await $.session.cwd()), surface)
      if (openPane && mentor.getSettings().autoOpen) await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    } catch (err) {
      $.ui.log(`claude-code-mentor: start: ${String(err)}`, { to: 'debug' })
    }
  })()
  return io
}

/** Adapter sesji albo start, gdy moduł przeładowano bez session.start. */
function ensureSession($: EngineInterface): Host {
  return HOST ?? startSession($, null, null, false)
}

/** Adapter jednego zdarzenia: jego własne get/set/now (i UI) na bazie adaptera sesji. */
function scoped(over: Partial<Host> & Pick<Host, 'get' | 'set' | 'now' | 'invalidate'>): Host {
  return { ...(HOST ?? offlineHost(over)), ...over }
}

let barBusy = false
let barDirty = false

/** Rozkład okna kontekstu jak w /context (szacunek lokalny, bez wywołania API) do paska nad promptem. */
async function refreshBar($: EngineInterface): Promise<void> {
  if (barBusy) {
    barDirty = true
    return
  }
  barBusy = true
  try {
    do {
      barDirty = false
      const usage = await $.session.usage({ breakdown: 'summary' })
      const b = usage.context.breakdown
      if (!b) continue
      const rows: BarRow[] = b.categories
        .filter((c: { kind: string; tokens: number }) => c.kind !== 'deferred' && c.tokens > 0)
        .map((c: { name: string; tokens: number; color: string; kind: string }) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind as BarRow['kind'] }))
      setState('bar', x => ({ ...x, snap: { rows, totalTokens: b.totalTokens, maxTokens: b.maxTokens, percentage: b.percentage } }))
      $.ui.invalidate('ui.render')
    } while (barDirty)
  } catch (err) {
    $.ui.log(`claude-code-mentor: pasek kontekstu: ${String(err)}`, { to: 'debug' })
  } finally {
    barBusy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({
        name: 'mentor',
        description: 'Mentor: panel nauki programowania (lekcje, symulator, ćwiczenia, postępy)',
        argumentHint: '[explain|quiz|sim|recap|progress|path|pause|resume|settings|help]',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`claude-code-mentor: rejestracja /mentor: ${String(err)}`, { to: 'debug' })
    }
    // Start w tle: sesja nie czeka na bazę.
    startSession($, e.cwd, e.surface, true)
    void refreshBar($)
    // licznik cache promptu na pasku: przerysowanie co 5 s, bez wywołań API
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return started
  })

  on('prompt.submit', ($, e, next) => {
    try {
      ensureSession($)
      if (e.origin.kind !== 'plugin') mentor.onPrompt(e.text)
    } catch {
      /* obserwacja nie może blokować promptu */
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const io = OBSERVED.has(String(e.tool)) ? ensureSession($) : HOST
    if (io && OBSERVED.has(String(e.tool))) {
      try {
        await mentor.onTool(io, String(e.tool), e as unknown as Record<string, unknown>, ran as { isError?: true; deny?: string; result?: unknown; text?: string })
      } catch (err) {
        $.ui.log(`claude-code-mentor: obserwacja ${String(e.tool)}: ${String(err)}`, { to: 'debug' })
      }
    }
    return ran
  })

  // Rozkład kontekstu się zmienił (odpowiedź, kompakcja): pasek czyta go ponownie.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) void refreshBar($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      setState('bar', x => ({ ...x, lastRequestAt: at }))
    }
    const io = ensureSession($)
    if (e.agentId === undefined && !e.isAborted) {
      void mentor.onTurnComplete(io, e.answer).catch(err => $.ui.log(`claude-code-mentor: analiza tury: ${String(err)}`, { to: 'debug' }))
    }
    return result
  })

  on('command.run', { command: 'mentor' }, async ($, e) => {
    ensureSession($)
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      selection: () => $.ui.selection(),
      fsRead: path => $.fs.read(path),
    })
    const args = e.args.trim()
    const sub = (args.split(/\s+/)[0] ?? '').toLowerCase()
    const rest = args.slice(sub.length).trim()
    const tab = (t: MentorTab) => io.set(S.tab, () => t)
    switch (sub) {
      case '':
      case 'open':
        void mentor.checkVersion(io)
        break
      case 'pasek':
      case 'bar': {
        const words = rest.split(/\s+/).filter(Boolean)
        if (words[0] === 'ttl') {
          const minutes = Number(words[1])
          if (minutes !== 5 && minutes !== 60) return { text: 'Użycie: /mentor pasek ttl 5  albo  /mentor pasek ttl 60' }
          await mentor.setSettings(io, { cacheTtl: minutes })
          return { text: `Mentor: czas cache promptu ${minutes} min.` }
        }
        const enable = !(await io.get(S.settings)).contextBar
        await mentor.setSettings(io, { contextBar: enable })
        if (enable) void refreshBar($)
        return { text: enable ? 'Mentor: pasek kontekstu włączony.' : 'Mentor: pasek kontekstu wyłączony.' }
      }
      case 'changes':
      case 'zmiany':
        await io.set(S.lab, l => ({ ...l, selected: null }))
        await tab('changes')
        break
      case 'explain':
        await mentor.requestLesson(io, undefined, true)
        await tab('lesson')
        break
      case 'quiz':
        await mentor.startQuiz(io, 'focus')
        break
      case 'sim': {
        let source = rest
        let origin = 'wpisany kod'
        const ref = /^(.+?):(\d+)(?:-(\d+))?$/.exec(rest)
        if (ref && !rest.includes('\n') && !/[;{}()=]/.test(ref[1]!)) {
          try {
            const text = await io.fsRead(ref[1]!)
            const from = Number(ref[2])
            const to = Number(ref[3] ?? ref[2])
            source = text.split('\n').slice(from - 1, to).join('\n')
            origin = `${ref[1]}:${from}-${to}`
          } catch (err) {
            await mentor.notice(io, `Nie mogę odczytać ${ref[1]}: ${String(err)}`)
          }
        } else if (!rest) {
          const sel = await io.selection().catch(() => undefined)
          if (sel?.text.trim()) {
            source = sel.text
            origin = 'zaznaczony tekst'
          }
        }
        if (source.trim()) await loadSim(io, source, origin, ref && /\.dart$/i.test(ref[1]!) ? 'dart' : undefined)
        else await tab('sim')
        break
      }
      case 'recap':
      case 'progress':
        await mentor.refreshKnowledge(io)
        await tab('knowledge')
        break
      case 'path':
      case 'graph':
        await tab('path')
        break
      case 'pause':
        await mentor.setSettings(io, { paused: true })
        break
      case 'resume':
        await mentor.setSettings(io, { paused: false })
        break
      case 'settings':
      case 'diag':
        if (sub === 'diag') await mentor.diagnose(io)
        await tab('settings')
        break
      case 'help':
        return { text: HELP }
      default:
        return { text: `Nieznana podkomenda „${sub}”.\n${HELP}` }
    }
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    if (sub === 'pause') return { text: 'Mentor: automatyczne lekcje wstrzymane.' }
    if (sub === 'resume') return { text: 'Mentor: automatyczne lekcje wznowione.' }
    if (!opened.isPlaced) return { text: `Mentor: panel czeka na miejsce (${opened.reason}).` }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'mentor' }, async ($, e) => {
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      fillPrompt: async text => (await $.prompt.fill({ text })).isFilled,
    })
    return renderPane(io, $.ui.resolve(e) as El, e.surface, e.props.bodyColumns)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    })
    const E = $.ui.resolve(e) as El
    const settings = await io.get(S.settings)
    const bar = getState('bar')
    if (settings.contextBar && !bar.snap) void refreshBar($)
    const tree = await renderBand(io, E)
    const barTree =
      settings.contextBar && bar.snap && bar.snap.rows.length
        ? renderBar(E, {
            snap: bar.snap,
            columns: e.props.bodyColumns || e.viewport?.columns || 80,
            isWorking: e.props.isWorking,
            ttlMinutes: Number(settings.cacheTtl) === 5 ? 5 : 60,
            lastRequestAt: bar.lastRequestAt,
            now: await $.clock.now(),
            Svg: e.surface === 'desktop' || e.surface === 'vscode' ? $.ui.resolve({ ...e, surface: 'desktop' as const }).Svg : undefined,
            onMentor: () => io.openPane(),
          })
        : null
    // bez własnej treści Mentor oddaje miejsce temu, co rysuje silnik albo inne pluginy
    if (!tree && !barTree) return next(e)
    const { Box } = E
    return (
      <Box flexDirection="column">
        {tree}
        {barTree ?? (await next(e))}
      </Box>
    )
  })
}
