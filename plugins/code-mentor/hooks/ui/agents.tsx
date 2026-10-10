// Agenci jak w claude-kit/savvy-progress (MIT, (c) 2026 johnnyvizz): boczny panel „Agenci”
// (kafelki, Pracują, Skończeni, zadania w tle) i pasek zadania nad promptem. Rysunki w savvy.ts.
// W Zmianach zostaje skrót: rząd krabów i przycisk do panelu.

import type { Elements, RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { AgentRun } from '../engine/agents'
import { ctxPercent, elapsedOf, fmtCost } from '../engine/agents'
import { COSTUME_COLOR, costumeOf } from './crab'
import type { Costume } from './crab'
import type { El, Kit } from './kit'
import { label } from './kit'
import { spin } from './motion'
import { FLOW_ACCENT, FLOW_DONE, agentSvg, compactSvg, flowBarText, flowRowSvg, headerHeight, headerSvg } from './savvy'
import type { AgentRow, Flow } from './savvy'
import { S } from './state'
import { renderTasks } from './tasks'
import { fmtTime, fmtTokens } from './visuals'
import { mentor } from '../mentor'
import { plural as tplural, tr } from '../i18n'

export const AGENTS_PANE = 'mentor-agents'

const row = (a: AgentRun, now: number): AgentRow => ({
  costume: costumeOf(a.type),
  description: a.description || a.type,
  role: a.type,
  model: a.model,
  effort: a.effort,
  status: a.status,
  steps: a.status === 'running' ? (a.now ? `${tr('teraz', 'now')}: ${a.now}` : tr('zaczyna…', 'starting…')) : a.status === 'done' ? tr(`${a.tools} narzędzi · gotowe`, `${a.tools} tools · done`) : tr('przerwany', 'stopped'),
  stats: `ctx ${ctxPercent(a)}% · ${fmtTokens(a.contextTokens)}${a.costUsd ? ` ≈${fmtCost(a.costUsd)}` : ''} ${fmtTime(elapsedOf(a, now))}`,
  progress: a.status === 'done' ? 1 : null,
  ctx: ctxPercent(a),
})

const totals = (list: readonly AgentRun[], now: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = list.length ? Math.min(...list.map(a => a.startedAt)) : now
  const end = list.length ? Math.max(...list.map(a => a.endedAt ?? Math.max(now, a.startedAt))) : now
  return { cost, tokens, time: end - start }
}

/** Boczny panel „Agenci”: tytuł zadania, kafelki, pracujący, skończeni (zwijani) i zadania w tle. */
export async function renderAgentsPane(io: Host, E: El, surface: string, cols: number): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const list = await io.get(S.agents)
  const now = await io.now()
  const v = await io.get(S.view)
  const isCompact = v.openSections.includes('agents-compact')
  const isDoneCollapsed = v.openSections.includes('agents-done-collapsed')
  const toggle = (key: string) => () => io.set(S.view, x => ({ ...x, openSections: x.openSections.includes(key) ? x.openSections.filter(s => s !== key) : [...x.openSections, key] }))
  const running = list.filter(a => a.status === 'running').reverse()
  const finished = list.filter(a => a.status !== 'running').reverse()
  const t = totals(list, now)
  const title = mentor.turnTitle() ?? ''
  const k: Kit = { E, cols, surface: surface as Kit['surface'] }
  const tasks = await renderTasks(io, k)
  const compactBtn = <Button key="ag-compact" label={isCompact ? tr('Rozwiń', 'Expand') : tr('Zwiń', 'Collapse')} plain onPress={toggle('agents-compact')} />
  const doneBtn = <Button key="ag-done" label={`${isDoneCollapsed ? '▸' : '▾'} ${tr('Skończeni', 'Finished')} · ${finished.length}`} plain onPress={toggle('agents-done-collapsed')} />
  const empty = !list.length
  const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${tr('tokenów', 'tokens')}, ${fmtTime(t.time)}`
  if (surface === 'desktop' || surface === 'vscode') {
    const { Svg } = E as Elements['desktop']
    const W = Math.max(240, Math.min(900, cols * 8 - 8))
    if (isCompact) {
      return (
        <Box flexDirection="column" gap={1}>
          <Svg source={compactSvg(W, list.map(a => ({ costume: costumeOf(a.type), status: a.status })), `≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}`)} alt={`${list.length} ${tr('agentów', 'agents')}, ${summary}`} width={W} height={32} />
          {compactBtn}
          {tasks}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Svg source={headerSvg(W, title, [[tr('Koszt (szac.)', 'Cost (est.)'), '≈' + fmtCost(t.cost)], [tr('Tokeny', 'Tokens'), fmtTokens(t.tokens)], [tr('Czas', 'Time'), fmtTime(t.time)]])} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
        {compactBtn}
        {empty && <Text dimColor>Jeszcze żadnych subagentów w tej sesji.</Text>}
        {running.length > 0 && <Text dimColor>{`Pracują · ${running.length}`}</Text>}
        {running.map(a => (
          <Svg key={a.id} source={agentSvg(W, row(a, now))} alt={`${a.description}: ${a.model}, ${tr('pracuje', 'working')}${a.now ? `, ${a.now}` : ''}`} width={W} height={66} />
        ))}
        {finished.length > 0 && doneBtn}
        {!isDoneCollapsed &&
          finished.map(a => <Svg key={a.id} source={agentSvg(W, row(a, now))} alt={`${a.description}: ${a.model}, ${a.status === 'done' ? tr('skończył', 'finished') : tr('błąd', 'error')}`} width={W} height={66} />)}
        {tasks}
      </Box>
    )
  }
  // terminal: te same treści w tekście
  const barW = Math.max(6, Math.min(20, cols - 34))
  const line = (a: AgentRun) => {
    const color = COSTUME_COLOR[costumeOf(a.type)]
    const ctx = ctxPercent(a)
    const filled = Math.round((barW * ctx) / 100)
    return (
      <Box key={a.id} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={color}>▣</Text>
          <Text bold wrap="truncate-end">
            {a.description || a.type}
          </Text>
          <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">{`  ${a.type} · ${a.model}${a.effort ? ` · ${a.effort}` : ''}`}</Text>
        {a.status === 'running' && a.now && <Text wrap="truncate-end">{`  teraz: ${a.now}`}</Text>}
        <Text wrap="truncate-end">
          {'  '}
          <Text dimColor>{'█'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled))}</Text>
          <Text dimColor>{` ctx ${ctx}% · ${fmtTokens(a.contextTokens)} ≈${fmtCost(a.costUsd)} ${fmtTime(elapsedOf(a, now))}`}</Text>
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">
          {title}
        </Text>
        {compactBtn}
      </Box>
      <Text dimColor>{`≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} ${tr('tokenów', 'tokens')} · ${fmtTime(t.time)}`}</Text>
      {isCompact ? (
        <Text wrap="truncate-end">
          {list.map(a => (
            <Text key={a.id} color={COSTUME_COLOR[costumeOf(a.type)]}>
              {a.status === 'running' ? '● ' : a.status === 'done' ? '✓ ' : '✗ '}
            </Text>
          ))}
        </Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {empty && <Text dimColor>Jeszcze żadnych subagentów w tej sesji.</Text>}
          {running.length > 0 && <Text dimColor>{`Pracują · ${running.length}`}</Text>}
          {running.map(line)}
          {finished.length > 0 && doneBtn}
          {!isDoneCollapsed && finished.map(line)}
        </Box>
      )}
      {tasks}
    </Box>
  )
}

/** Skrót w Zmianach: rząd krabów, podsumowanie i przycisk do bocznego panelu. */
export async function renderAgents(io: Host, k: Kit): Promise<RenderElement | null> {
  const { Box, Text, Button } = k.E
  const list = await io.get(S.agents)
  if (!list.length) return null
  const now = await io.now()
  const running = list.filter(a => a.status === 'running')
  const t = totals(list, now)
  const open = <Button key="ag-open" plain onPress={() => io.openAgents()}>{tr('Otwórz panel agentów →', 'Open the agents panel →')}</Button>
  if (k.surface === 'desktop' || k.surface === 'vscode') {
    const { Svg } = k.E as Elements['desktop']
    const W = Math.max(240, Math.min(820, k.cols * 8 - 8))
    return (
      <Box flexDirection="column">
        {label(k, tr('Agenci', 'Agents'), running.length ? `${running.length} ${tr('pracuje', 'working')}` : tr('wszyscy skończyli', 'all finished'))}
        <Svg source={compactSvg(W, list.map(a => ({ costume: costumeOf(a.type), status: a.status })), `≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}`)} alt={`${list.length} ${tr('agentów', 'agents')}, ${running.length} ${tr('pracuje', 'working')}`} width={W} height={32} />
        {open}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {label(k, tr('Agenci', 'Agents'), `${list.length} · ${tr('pracuje', 'working')} ${running.length} · ≈${fmtCost(t.cost)} · ${fmtTime(t.time)}`)}
      <Text wrap="truncate-end">
        {list.map(a => (
          <Text key={a.id} color={COSTUME_COLOR[costumeOf(a.type)]}>
            {a.status === 'running' ? `${spin(mentor.anim.frame)} ` : a.status === 'done' ? '✓ ' : '✗ '}
          </Text>
        ))}
        <Text dimColor>{running.map(a => a.now ?? a.description).join(' · ')}</Text>
      </Text>
      {open}
    </Box>
  )
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

/** Kostium kraba z tego, co Claude robi teraz: lupa przy czytaniu, klucz przy edycji, flaga przy komendach. */
export function costumeForTool(tool: string): Costume {
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return 'heavy'
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool)) return 'careful'
  if (/^(Bash|PowerShell|TaskStop)$/.test(tool)) return 'light'
  if (/^Web/.test(tool)) return 'fable'
  if (tool === 'Agent' || tool === 'Task') return 'explore'
  return tool ? 'medium' : 'other'
}

/**
 * Pasek nad promptem (savvy-progress) przy każdym poleceniu. Z subagentami: „Agenci k/n” i procent.
 * Bez nich: w trakcie pasmo pikseli jedzie po pasku (nie znamy końca, więc bez procentu), kroki,
 * pliki i czas; po odpowiedzi zielony pasek z „Gotowe · +A −R”. Krab ubiera się w to, co Claude robi.
 * ✕ chowa pasek do następnego polecenia.
 */
export async function renderFlowBand(io: Host, E: El, surface: string, columns: number, isWorking = false): Promise<RenderElement | null> {
  const { Box, Text, Button } = E
  if (mentor.flowDismissedTurn === mentor.turn) return null
  const all = await io.get(S.agents)
  const turnAgents = all.filter(a => a.turn === mentor.turn)
  const w = mentor.work
  const ownTurn = w.turn === mentor.turn && w.startedAt > 0
  if (!turnAgents.length && !(ownTurn && (isWorking || w.endedAt === null || w.steps > 0))) return null
  const now = await io.now()
  const elapsed = ownTurn ? fmtTime((w.endedAt ?? now) - w.startedAt) : ''
  const working = isWorking || (ownTurn && w.endedAt === null)
  const files = (await io.get(S.activity)).files.filter(x => x.edits > 0).length
  const title = mentor.turnTitle() ?? tr('Zadanie', 'Task')
  let f: Flow
  let costume: Costume
  if (turnAgents.length) {
    const done = turnAgents.filter(a => a.status !== 'running').length
    const runningN = turnAgents.length - done
    f = { title, total: turnAgents.length, done, running: runningN, isFinished: runningN === 0 && !working, label: runningN === 0 ? (working ? `${tr('Agenci', 'Agents')} ${done}/${done}` : tr('Gotowe', 'Done')) : `${tr('Agenci', 'Agents')} ${done}/${turnAgents.length}` }
    costume = costumeOf(turnAgents.find(a => a.status === 'running')?.type ?? turnAgents[0]!.type)
  } else if (working) {
    const parts = [w.steps ? `${tr('Pracuje', 'Working')} · ${w.steps} ${tplural(w.steps, ['krok', 'kroki', 'kroków'], ['step', 'steps'])}` : tr('Myśli…', 'Thinking…')]
    if (files) parts.push(`${files} ${tplural(files, ['plik', 'pliki', 'plików'], ['file', 'files'])}`)
    f = { title, total: 0, done: 0, running: 0, isFinished: false, indeterminate: true, label: parts.join(' · '), right: elapsed }
    costume = costumeForTool(w.tool)
  } else {
    const label = w.added || w.removed ? `${tr('Gotowe', 'Done')} · +${w.added} −${w.removed}` : `${tr('Gotowe', 'Done')} · ${w.steps} ${tplural(w.steps, ['krok', 'kroki', 'kroków'], ['step', 'steps'])}`
    f = { title, total: 1, done: 1, running: 0, isFinished: true, label, right: elapsed }
    costume = 'other'
  }
  const percent = f.right ?? `${Math.round((f.done / Math.max(1, f.total)) * 100)}%`
  const crewButton = turnAgents.length ? <Button key="flow-open" label={`×${turnAgents.length}`} plain onPress={() => void io.toggleAgents()} /> : null
  const dismiss = (
    <Button
      key="flow-close"
      label="✕"
      plain
      role="dismiss"
      onPress={() => {
        mentor.flowDismissedTurn = mentor.turn
        io.invalidate()
      }}
    />
  )
  if (surface === 'desktop' || surface === 'vscode') {
    const { Svg } = E as Elements['desktop']
    // ok. 8 px CSS na kolumnę; reszta na ×N, ✕ i odstępy (jak w savvy-progress)
    const W = Math.max(180, Math.min(1600, (columns || 100) * 8 - (crewButton ? 96 : 60)))
    return (
      <Box key="flow" flexDirection="row" alignItems="center" gap={1}>
        <Svg source={flowRowSvg(f, W, working, costume)} alt={`${f.title}: ${f.label}, ${percent}`} width={W} height={22} />
        {crewButton}
        {dismiss}
      </Box>
    )
  }
  const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(columns / 3)))
  const width = Math.max(6, Math.min(40, columns - titleW - 32))
  const color = f.isFinished ? FLOW_DONE : FLOW_ACCENT
  const bar = f.indeterminate ? sweepText(width, Math.floor(now / 300)) : flowBarText(f, width)
  return (
    <Box key="flow" flexDirection="row" gap={2}>
      <Box width={titleW} flexShrink={0}>
        <Text color={color}>● </Text>
        <Text wrap="truncate-end">{f.title}</Text>
      </Box>
      <Text color={color}>{bar}</Text>
      <Text bold>{f.label}</Text>
      <Text dimColor>{percent}</Text>
      <Text color={COSTUME_COLOR[costume] === COSTUME_COLOR.other ? '#D97757' : COSTUME_COLOR[costume]}>▣</Text>
      {crewButton}
      {dismiss}
    </Box>
  )
}

/** Terminal: pasmo █ jadące po ░ (klatka z harmonogramu), odpowiednik pasma pikseli. */
function sweepText(width: number, frame: number): string {
  const seg = Math.max(2, Math.round(width * 0.28))
  const span = width + seg
  const head = frame % span
  let out = ''
  for (let i = 0; i < width; i++) {
    const d = head - i
    out += d >= 0 && d < seg ? (d < seg / 3 ? '█' : '▓') : '░'
  }
  return out
}
