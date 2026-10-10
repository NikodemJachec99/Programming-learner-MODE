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
import { HISTORY_TURNS, renderBar } from './ui/bar'
import { AGENTS_PANE, renderAgentsPane, renderFlowBand } from './ui/agents'
import { FILES_PANE, renderFilesPane } from './ui/files'
import { TASKS_PANE, renderTasksPane } from './ui/tasks'
import { newTurn, touchEnd, touchStart } from './engine/activity'
import { agentTool, costOf, describeTool, endAgent, modelName, spawnAgent, stepAgent } from './engine/agents'
import { endTask, outputPathFrom, parseNotification, startTask } from './engine/tasks'
import type { ActKind } from './engine/activity'
import type { BarRow } from './ui/bar'
import { PANE_ID, PANE_TITLE, renderBand, renderPane } from './ui/pane'
import { loadSim } from './ui/sim'
import { getState, S, setState } from './ui/state'
import { tr } from './i18n'

const OBSERVED = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])
/** Narzędzia, których pliki pokazuje mapa aktywności (Read tylko pasywnie, bez wpływu na wiedzę). */
const FILE_TOOLS: Record<string, ActKind | undefined> = { Read: 'read', Edit: 'edit', Write: 'edit', NotebookEdit: 'edit' }

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
    sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
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
        // nowa nazwa pluginu albo stara (claude-code-mentor, przed 1.5.0)
        const key = Object.keys(j.plugins ?? {}).find(k => k.startsWith('code-mentor@')) ?? Object.keys(j.plugins ?? {}).find(k => k.startsWith('claude-code-mentor@'))
        return (key && j.plugins![key]![0]?.version) || null
      } catch {
        return null
      }
    },
    pluginRoot: $.plugin.root,
    fsRead: path => $.fs.read(path),
    fsExists: path => $.fs.exists(path),
    fsList: path => $.fs.list(path),
    openFiles: () => openFilesPane($),
    openTasks: () => $.ui.open({ id: TASKS_PANE, title: tr('Zadania w tle', 'Background tasks') }),
    stopTask: async id => {
      const r = (await $.tool.call({ tool: 'TaskStop', task_id: id } as never).catch(() => null)) as { isError?: true } | null
      if (r && !r.isError) {
        const at = await $.clock.now()
        setState('tasks', list => endTask(list, id, 'killed', at))
        $.ui.invalidate('ui.render')
      }
    },
    run: (argv, init) => $.process.run(argv, init),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: key => $.store.delete(key),
    complete: req => $.model.complete(req),
    log: text => $.ui.log(text, { to: 'debug' }),
    toast: text => $.ui.toast(text),
    openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    openAgents: () => $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') }),
    toggleAgents: () => toggleAgentsPane($),
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
    void mentor.tick(io).catch(err => $.ui.log(`code-mentor: kolejka: ${String(err)}`, { to: 'debug' }))
  })
  void (async () => {
    try {
      await mentor.boot(io, cwd ?? (await $.session.cwd()), surface)
      if (openPane && mentor.getSettings().autoOpen) await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    } catch (err) {
      $.ui.log(`code-mentor: start: ${String(err)}`, { to: 'debug' })
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
    $.ui.log(`code-mentor: pasek kontekstu: ${String(err)}`, { to: 'debug' })
  } finally {
    barBusy = false
  }
}

/** Zapisuje zajętość kontekstu po turze do historii paska (przeżywa przeładowanie moda). */
async function recordTurnUsage($: EngineInterface): Promise<void> {
  await refreshBar($)
  const total = getState('bar').snap?.totalTokens
  if (!total) return
  const sid = await $.session.id()
  setState('bar', x => ({ ...x, history: [...x.history, total].slice(-HISTORY_TURNS) }))
  await $.store.set('bar-history', { sessionId: sid, history: getState('bar').history })
  $.ui.invalidate('ui.render')
}

/** Po przeładowaniu: historia tej samej sesji wraca ze $.store. */
async function loadTurnUsage($: EngineInterface): Promise<void> {
  const saved = (await $.store.get('bar-history')) as { sessionId?: string; history?: number[] } | undefined
  if (!saved?.history || saved.sessionId !== (await $.session.id())) return
  setState('bar', x => (x.history.length ? x : { ...x, history: saved.history!.slice(-HISTORY_TURNS) }))
}


/** Tytuł panelu „Pliki” z nazwą projektu (jak „Files: weather-app”). */
function filesTitle(): string {
  const name = (mentor.projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()
  return name ? `${tr('Pliki', 'Files')}: ${name}` : tr('Pliki', 'Files')
}

function openFilesPane($: EngineInterface) {
  return $.ui.open({ id: FILES_PANE, title: filesTitle() })
}

/** Otwiera panel albo zamyka, gdy już jest otwarty (przyciski na pasku nad promptem). True, gdy otwarty. */
async function togglePane($: EngineInterface, id: string, title: string): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === id)) {
    await $.ui.close({ id })
    return false
  }
  if (id === FILES_PANE) void mentor.files.refresh(ensureSession($))
  await $.ui.open({ id, title })
  return true
}

/** Otwiera panel agentów albo zamyka, gdy już jest (togglePane z savvy-progress). True, gdy otwarty. */
async function toggleAgentsPane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === AGENTS_PANE)) {
    await $.ui.close({ id: AGENTS_PANE })
    return false
  }
  await $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') })
  return true
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
      await $.command.register({
        name: 'mentor-tasks',
        description: 'Mentor: panel zadań w tle (co robią, wyjście na żywo, czas, zatrzymanie)',
        immediate: true,
      })
      await $.command.register({
        name: 'mentor-files',
        description: 'Mentor: panel plików (co Claude teraz robi, czego dotknął, drzewo projektu z gitem)',
        immediate: true,
      })
      await $.command.register({
        name: 'mentor-agents',
        description: 'Mentor: pokaż albo schowaj panel agentów (pracują, skończeni, zadania w tle, kontekst, koszt, czas)',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`code-mentor: rejestracja /mentor: ${String(err)}`, { to: 'debug' })
    }
    // Start w tle: sesja nie czeka na bazę.
    startSession($, e.cwd, e.surface, true)
    void refreshBar($)
    void loadTurnUsage($).catch(() => undefined)
    // licznik cache promptu na pasku: przerysowanie co 5 s, bez wywołań API
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return started
  })

  on('prompt.submit', ($, e, next) => {
    try {
      ensureSession($)
      // koniec zadania w tle: powiadomienie z task-id i statusem (to nie jest polecenie użytkownika)
      const note = e.origin.kind === 'task-notification' ? parseNotification(e.text) : null
      if (note) {
        void (async () => {
          const at = await $.clock.now()
          setState('tasks', list => endTask(list, note.id, note.status, at, note.summary))
          await mentor.anim.readTask(ensureSession($), note.id, note.outputFile)
        })().catch(() => undefined)
      } else if (e.origin.kind !== 'plugin' && e.origin.kind !== 'task-notification') {
        mentor.onPrompt(e.text)
        setState('activity', newTurn)
        void $.clock.now().then(at => {
          mentor.startWork(at)
          mentor.anim.wake(ensureSession($))
        })
      }
    } catch {
      /* obserwacja nie może blokować promptu */
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // aktywność plików (odczyt, edycja): tylko zapis stanu, wynik narzędzia przechodzi bez zmian
    const kind = FILE_TOOLS[String(e.tool)]
    const input = e as unknown as Record<string, unknown>
    const file = kind ? String(input.file_path ?? input.notebook_path ?? '') : ''
    if (kind && file) {
      const t0 = await $.clock.now()
      setState('activity', a => touchStart(a, file, kind, t0))
      $.ui.invalidate('ui.render')
    }
    // co robi subagent (tylko opis czynności; wynik narzędzia bez zmian)
    const agentId = (e as { agentId?: string }).agentId
    if (agentId) {
      setState('agents', list => agentTool(list, agentId, describeTool(String(e.tool), input)))
      $.ui.invalidate('ui.render')
    }
    mentor.workStep(String(e.tool))
    const ran = await next(e)
    // zadania w tle: start (Bash z backgroundTaskId) i zatrzymanie (TaskStop); wynik bez zmian
    if (e.tool === 'Bash') {
      const bgId = ((ran as { result?: { backgroundTaskId?: string } }).result ?? {}).backgroundTaskId
      if (bgId) {
        const t2 = await $.clock.now()
        setState('tasks', list => startTask(list, { id: bgId, command: String(input.command ?? ''), description: String(input.description ?? ''), outputFile: outputPathFrom((ran as { text?: string }).text), at: t2 }))
        mentor.anim.wake(ensureSession($))
      }
    }
    if (e.tool === 'TaskStop' && (input.task_id || input.shell_id)) {
      const t3 = await $.clock.now()
      setState('tasks', list => endTask(list, String(input.task_id ?? input.shell_id), 'killed', t3))
      $.ui.invalidate('ui.render')
    }
    if (kind && file) {
      const r = ran as { isError?: true; deny?: string }
      const t1 = await $.clock.now()
      setState('activity', a => touchEnd(a, file, kind, !r.isError && r.deny === undefined, t1, r.deny !== undefined))
      mentor.anim.wake(ensureSession($))
    }
    // pliki i git: odświeżenie po edycji i komendzie, commit Claude zapamiętany (filetree)
    if (kind === 'edit' || e.tool === 'Bash' || e.tool === 'PowerShell') {
      const r = ran as { isError?: true; deny?: string }
      const fio = ensureSession($)
      if (/\bgit\b[^|;&\n]*\bcommit\b/.test(String(input.command ?? '')) && !r.isError && r.deny === undefined) void mentor.files.noteCommit(fio)
      else mentor.files.soon(fio)
    }
    const io = OBSERVED.has(String(e.tool)) ? ensureSession($) : HOST
    if (io && OBSERVED.has(String(e.tool))) {
      try {
        await mentor.onTool(io, String(e.tool), e as unknown as Record<string, unknown>, ran as { isError?: true; deny?: string; result?: unknown; text?: string })
      } catch (err) {
        $.ui.log(`code-mentor: obserwacja ${String(e.tool)}: ${String(err)}`, { to: 'debug' })
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

  // subagenci: start (agent.spawn), koniec (turn.complete z agentId); zdarzenia przechodzą bez zmian
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    setState('agents', list =>
      spawnAgent(list, { id: started.agentId ?? e.tool_use_id, agentId: started.agentId, type: e.subagentType, description: e.description, model: modelName(started.model ?? ''), at, turn: mentor.turn }),
    )
    mentor.anim.wake(ensureSession($))
    return started
  })

  // każdy krok modelu subagenta: kontekst, tokeny i szacunek kosztu
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId && result.usage) {
      const usage = result.usage
      setState('agents', list => stepAgent(list, e.agentId!, usage, usage.model || e.model, typeof e.effort === 'string' ? e.effort : undefined))
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // boczny panel agentów i zadań w tle
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      openAgents: () => $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') }),
      toggleAgents: () => toggleAgentsPane($),
    })
    return renderAgentsPane(io, $.ui.resolve(e) as El, e.surface, e.props.bodyColumns || 60)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const at = await $.clock.now()
      const u = e.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined
      const tokens = u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0
      const model = (e.usage as { model?: string } | undefined)?.model ?? ''
      setState('agents', list => endAgent(list, e.agentId!, e.reason === 'answer' && !e.isAborted, tokens, at, u ? costOf(model, u) : 0))
      $.ui.invalidate('ui.render')
    }
    const result = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      mentor.endWork(at)
      setState('bar', x => ({ ...x, lastRequestAt: at }))
      // historia paska: zajętość po każdej turze głównej rozmowy, 12 ostatnich, w $.store tej sesji
      void recordTurnUsage($).catch(() => undefined)
    }
    const io = ensureSession($)
    if (e.agentId === undefined && !e.isAborted) {
      void mentor.onTurnComplete(io, e.answer).catch(err => $.ui.log(`code-mentor: analiza tury: ${String(err)}`, { to: 'debug' }))
    }
    return result
  })

  on('command.run', { command: 'mentor-tasks' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === TASKS_PANE)) {
      await $.ui.close({ id: TASKS_PANE })
      return { text: tr('Panel zadań w tle zamknięty.', 'Background tasks panel closed.') }
    }
    await $.ui.open({ id: TASKS_PANE, title: tr('Zadania w tle', 'Background tasks') })
    return { text: tr('Panel zadań w tle otwarty.', 'Background tasks panel opened.') }
  })

  // boczny panel zadań w tle
  on('ui.render', { component: 'Pane', requestId: TASKS_PANE }, async ($, e) => {
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    })
    return renderTasksPane(io, $.ui.resolve(e) as El, e.surface, e.props.bodyColumns || 60)
  })

  on('command.run', { command: 'mentor-files' }, async $ => {
    void mentor.files.refresh(ensureSession($))
    await openFilesPane($)
    return { text: tr('Panel plików otwarty.', 'Files panel opened.') }
  })

  // boczny panel plików (filetree)
  on('ui.render', { component: 'Pane', requestId: FILES_PANE }, async ($, e) => {
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    })
    return renderFilesPane(io, $.ui.resolve(e) as El, e.surface, e.props.bodyColumns || 60)
  })

  on('command.run', { command: 'mentor-agents' }, async $ => {
    const isOpen = await toggleAgentsPane($)
    return { text: isOpen ? tr('Panel agentów otwarty.', 'Agents panel opened.') : tr('Panel agentów zamknięty.', 'Agents panel closed.') }
  })

  on('command.run', { command: 'mentor' }, async ($, e) => {
    ensureSession($)
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      openAgents: () => $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') }),
      toggleAgents: () => toggleAgentsPane($),
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
        await mentor.quiz.startQuiz(io, 'focus')
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
        await mentor.refreshRecap(io)
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
        if (sub === 'diag') await mentor.data.diagnose(io)
        await tab('settings')
        break
      case 'help':
        return { text: HELP }
      default:
        return { text: `Nieznana podkomenda „${sub}”.\n${HELP}` }
    }
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    if (sub === 'pause') return { text: tr('Mentor: automatyczne lekcje wstrzymane.', 'Mentor: automatic lessons paused.') }
    if (sub === 'resume') return { text: tr('Mentor: automatyczne lekcje wznowione.', 'Mentor: automatic lessons resumed.') }
    if (!opened.isPlaced) return { text: `Mentor: panel czeka na miejsce (${opened.reason}).` }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'mentor' }, async ($, e) => {
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      openAgents: () => $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') }),
      toggleAgents: () => toggleAgentsPane($),
      fillPrompt: async text => (await $.prompt.fill({ text })).isFilled,
    })
    return renderPane(io, $.ui.resolve(e) as El, e.surface, e.props.bodyColumns)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const io = scoped({
      ...stateOps(() => $.ui.invalidate('ui.render')),
      now: () => $.clock.now(),
      sleep: ms => $.clock.sleep(ms).then(() => true, () => false),
      openPane: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
      openAgents: () => $.ui.open({ id: AGENTS_PANE, title: tr('Agenci', 'Agents') }),
      toggleAgents: () => toggleAgentsPane($),
    })
    const E = $.ui.resolve(e) as El
    const settings = await io.get(S.settings)
    const bar = getState('bar')
    if (settings.contextBar && !bar.snap) void refreshBar($)
    const tree = await renderBand(io, E)
    const agentsRunning = getState('agents').filter(a => a.status === 'running').length
    const tasksRunning = getState('tasks').filter(t => t.status === 'running').length
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
            // boczne panele otwiera się stąd (same się nie otwierają); liczba przy pracujących
            panes: [
              { key: 'open-agents', label: agentsRunning ? `${tr('Agenci', 'Agents')} ${agentsRunning}` : tr('Agenci', 'Agents'), onPress: () => togglePane($, AGENTS_PANE, tr('Agenci', 'Agents')) },
              { key: 'open-files', label: tr('Pliki', 'Files'), onPress: () => togglePane($, FILES_PANE, filesTitle()) },
              { key: 'open-tasks', label: tasksRunning ? `${tr('Zadania', 'Tasks')} ${tasksRunning}` : tr('Zadania', 'Tasks'), onPress: () => togglePane($, TASKS_PANE, tr('Zadania w tle', 'Background tasks')) },
            ],
            history: bar.history,
          })
        : null
    const crabs = settings.band ? await renderFlowBand(io, E, e.surface, e.props.bodyColumns || 80, e.props.isWorking) : null
    // bez własnej treści Mentor oddaje miejsce temu, co rysuje silnik albo inne pluginy
    if (!tree && !barTree && !crabs) return next(e)
    // z treścią też: to, co narysowały pluginy niżej, zostaje pod paskiem Mentora (nie zastępujemy go)
    const below = await next(e)
    const { Box } = E
    return (
      <Box flexDirection="column">
        {crabs}
        {tree}
        {barTree}
        {below}
      </Box>
    )
  })
}
