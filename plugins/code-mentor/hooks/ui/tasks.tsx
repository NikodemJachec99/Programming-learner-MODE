// Zadania w tle (komendy Bash uruchomione w tle), w stylu wierszy savvy-progress i kolorów filetree.
// Boczny panel „Zadania w tle”: kafelki (pracują, skończone, czas), sekcja Pracują z animowanym
// wierszem (terminal z mrugającym kursorem, pasek „trwa”, ostatnie linie wyjścia na żywo), rozwijane
// wyjście i „Zatrzymaj” (TaskStop dopiero po kliknięciu), zwijana sekcja Skończone ze stanem i czasem.
// W Zmianach i w panelu agentów zostaje skrót z przyciskiem do panelu.

import type { Elements, RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { BgTask } from '../engine/tasks'
import { mentor } from '../mentor'
import type { El, Kit } from './kit'
import { label } from './kit'
import { spin } from './motion'
import { headerHeight, headerSvg, statusMarkSvg } from './savvy'
import { S } from './state'
import { fmtTime, taskRowHeight, taskRowSvg } from './visuals'
import type { TaskView } from './visuals'
import { plural as tplural, tr } from '../i18n'

export const TASKS_PANE = 'mentor-tasks'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const elapsed = (t: BgTask, now: number) => (t.endedAt ?? Math.max(now, t.startedAt)) - t.startedAt
const view = (t: BgTask, now: number): TaskView => ({ title: t.description, command: t.command, status: t.status, elapsedMs: elapsed(t, now), tail: t.tail, summary: t.summary })
const GLYPH = { completed: '✓', failed: '✗', killed: '⊘' } as const
const STATE = {
  get completed() {
    return tr('gotowe', 'done')
  },
  get failed() {
    return tr('błąd', 'error')
  },
  get killed() {
    return tr('zatrzymane', 'stopped')
  },
}
const isDesk = (surface: string) => surface === 'desktop' || surface === 'vscode'
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

/** Skończone zadanie w jednym wierszu: znacznik stanu, opis, komenda, stan i czas, linia podziału. */
export function taskDoneSvg(W: number, t: TaskView): string {
  const textW = W - 34 - 12
  const state = `${STATE[t.status as keyof typeof STATE] ?? STATE.completed} · ${fmtTime(t.elapsedMs)}`
  const stateW = state.length * 6.4 + 8
  const fit = (s: string, size: number, maxW: number) => {
    const max = Math.max(4, Math.floor(maxW / (size * 0.56)))
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }
  const color = t.status === 'failed' ? '#D0453F' : t.status === 'killed' ? '#9a9a96' : '#3B9C5F'
  const mark = t.status === 'killed' ? `<circle cx="13" cy="15" r="6" fill="none" stroke="#9a9a96" stroke-width="1.6"/><path d="M9 19l8-8" stroke="#9a9a96" stroke-width="1.6"/>` : statusMarkSvg(13, 15, t.status === 'failed' ? 'failed' : 'done', color)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="44" viewBox="0 0 ${W} 44"><style>.t{fill:#1f1f1f}.s{fill:#6b6b68}.ln{stroke:#e4e4e1}@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.ln{stroke:#333331}}</style>${mark}<text class="t" x="34" y="19" font-family="${FONT}" font-size="13" font-weight="600">${xml(fit(t.title || t.command, 13, textW - stateW))}</text><text x="${34 + textW}" y="19" text-anchor="end" font-family="${FONT}" font-size="11" fill="${color}" font-variant-numeric="tabular-nums">${xml(state)}</text><text class="s" x="34" y="35" font-family="${MONO}" font-size="11">${xml(fit(t.title ? `$ ${t.command}` : (t.summary ?? ''), 11, textW))}</text><line class="ln" x1="0" y1="43.5" x2="${W}" y2="43.5"/></svg>`
}

/** Rozwinięte wyjście: dłuższy ogon w ramce z czcionką o stałej szerokości. */
function outputBox(E: El, t: BgTask, key: string): RenderElement {
  const { Box, Text } = E
  const lines = t.lines?.length ? t.lines : t.tail
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
      {lines.length ? (
        lines.map((l, i) => (
          <Text key={`${key}-${i}`} dimColor={i < lines.length - 1} wrap="truncate-end">
            {l}
          </Text>
        ))
      ) : (
        <Text dimColor>{t.status === 'running' ? tr('czekam na wyjście…', 'waiting for output…') : tr('bez wyjścia', 'no output')}</Text>
      )}
    </Box>
  )
}

/** Boczny panel „Zadania w tle”. */
export async function renderTasksPane(io: Host, E: El, surface: string, cols: number): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const list = await io.get(S.tasks)
  const now = await io.now()
  const v = await io.get(S.view)
  const open = new Set(v.openSections)
  const toggle = (key: string) => () => io.set(S.view, x => ({ ...x, openSections: x.openSections.includes(key) ? x.openSections.filter(s => s !== key) : [...x.openSections, key] }))
  const running = list.filter(t => t.status === 'running').reverse()
  const done = list.filter(t => t.status !== 'running').reverse()
  const doneOpen = !open.has('tasks-done-collapsed')
  const failed = done.filter(t => t.status === 'failed').length
  const total = list.reduce((s, t) => s + elapsed(t, now), 0)
  const desk = isDesk(surface)
  const W = Math.max(240, Math.min(900, cols * 8 - 8))
  const Svg = desk ? (E as Elements['desktop']).Svg : null
  const actions = (t: BgTask) => (
    <Box key={`tp-a-${t.id}`} flexDirection="row" columnGap={1} marginBottom={open.has(`task-out-${t.id}`) ? 0 : 1}>
      <Button key={`tp-out-${t.id}`} plain dimColor onPress={toggle(`task-out-${t.id}`)}>
        {open.has(`task-out-${t.id}`) ? tr('▾ wyjście', '▾ output') : tr('▸ wyjście', '▸ output')}
      </Button>
      {t.status === 'running' && (
        <Button key={`tp-stop-${t.id}`} plain dimColor onPress={() => io.stopTask(t.id)}>
          {tr('■ Zatrzymaj', '■ Stop')}
        </Button>
      )}
    </Box>
  )
  const runningRow = (t: BgTask) => {
    const tv = view(t, now)
    return (
      <Box key={`tp-r-${t.id}`} flexDirection="column">
        {Svg ? (
          <Svg key={`tp-svg-${t.id}`} source={taskRowSvg(W, tv)} alt={`${t.description || t.command}: ${tr('trwa', 'running')} ${fmtTime(tv.elapsedMs)}. ${t.tail.join(' / ')}`} width={W} height={taskRowHeight(tv)} />
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Text color="claude">{spin(mentor.anim.frame)}</Text>
              <Text bold wrap="truncate-end">
                {t.description || t.command}
              </Text>
              <Box flexGrow={1} />
              <Text dimColor>{`${tr('trwa', 'running')} ${fmtTime(tv.elapsedMs)}`}</Text>
            </Box>
            {t.description ? <Text dimColor wrap="truncate-end">{`  $ ${t.command}`}</Text> : null}
            {(t.tail.length ? t.tail : [tr('czekam na wyjście…', 'waiting for output…')]).map((l, i, all) => (
              <Text key={`tp-l-${t.id}-${i}`} dimColor={i < all.length - 1} wrap="truncate-end">{`  │ ${l}`}</Text>
            ))}
          </Box>
        )}
        {actions(t)}
        {open.has(`task-out-${t.id}`) && outputBox(E, t, `tp-o-${t.id}`)}
      </Box>
    )
  }
  const doneRow = (t: BgTask) => {
    const tv = view(t, now)
    return (
      <Box key={`tp-d-${t.id}`} flexDirection="column">
        {Svg ? (
          <Svg key={`tp-dsvg-${t.id}`} source={taskDoneSvg(W, tv)} alt={`${t.description || t.command}: ${STATE[t.status as keyof typeof STATE]} · ${fmtTime(tv.elapsedMs)}`} width={W} height={44} />
        ) : (
          <Box flexDirection="row" columnGap={1}>
            <Text color={t.status === 'completed' ? 'success' : t.status === 'failed' ? 'error' : 'subtle'}>{GLYPH[t.status as keyof typeof GLYPH]}</Text>
            <Text wrap="truncate-end">{t.description || t.command}</Text>
            <Box flexGrow={1} />
            <Text dimColor>{`${STATE[t.status as keyof typeof STATE]} · ${fmtTime(tv.elapsedMs)}`}</Text>
          </Box>
        )}
        <Button key={`tp-dout-${t.id}`} plain dimColor onPress={toggle(`task-out-${t.id}`)}>
          {open.has(`task-out-${t.id}`) ? tr('▾ wyjście', '▾ output') : tr('▸ wyjście', '▸ output')}
        </Button>
        {open.has(`task-out-${t.id}`) && outputBox(E, t, `tp-do-${t.id}`)}
      </Box>
    )
  }
  const summary = `${running.length} ${tplural(running.length, ['pracuje', 'pracują', 'pracuje'], ['running', 'running'])}, ${done.length} ${tplural(done.length, ['skończone', 'skończone', 'skończonych'], ['finished', 'finished'])}${failed ? `, ${failed} ${tr('z błędem', 'with errors')}` : ''}`
  return (
    <Box flexDirection="column">
      {Svg ? (
        <Svg key="tp-head" source={headerSvg(W, '', [[tr('Pracują', 'Running'), String(running.length)], [failed ? tr(`Skończone, ${failed} z błędem`, `Finished, ${failed} failed`) : tr('Skończone', 'Finished'), String(done.length)], [tr('Czas razem', 'Total time'), fmtTime(total)]])} alt={summary} width={W} height={headerHeight('')} />
      ) : (
        <Text dimColor>{`${summary} · ${fmtTime(total)}`}</Text>
      )}
      {!list.length && <Text dimColor>{tr('Jeszcze żadnych zadań w tle w tej sesji. Pojawią się, gdy Claude uruchomi komendę w tle.', 'No background tasks in this session yet. They show up when Claude runs a command in the background.')}</Text>}
      {running.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor bold>{`${tr('PRACUJĄ', 'RUNNING')} · ${running.length}`}</Text>
        </Box>
      )}
      {running.map(runningRow)}
      {done.length > 0 && (
        <Box marginTop={1}>
          <Button key="tp-done" plain dimColor onPress={toggle('tasks-done-collapsed')}>
            {`${doneOpen ? '▾' : '▸'} ${tr('SKOŃCZONE', 'FINISHED')} · ${done.length}`}
          </Button>
        </Box>
      )}
      {doneOpen && done.map(doneRow)}
    </Box>
  )
}

/** Skrót w Zmianach i w panelu agentów: pracujące zadania z ostatnią linią i przycisk do panelu. */
export async function renderTasks(io: Host, k: Kit): Promise<RenderElement | null> {
  const { Box, Text, Button } = k.E
  const list = await io.get(S.tasks)
  if (!list.length) return null
  const now = await io.now()
  const running = list.filter(t => t.status === 'running').reverse()
  const done = list.filter(t => t.status !== 'running')
  const head = label(k, tr('Zadania w tle', 'Background tasks'), running.length ? `${running.length} ${tr('trwa', 'running')} · ${done.length} ${tr('skończone', 'finished')}` : `${done.length} ${tr('skończone', 'finished')}`)
  const open = (
    <Button key="tk-open" plain dimColor onPress={() => void io.openTasks()}>
      {tr('Otwórz zadania w tle →', 'Open background tasks →')}
    </Button>
  )
  if (isDesk(k.surface)) {
    const { Svg } = k.E as Elements['desktop']
    const W = Math.max(260, Math.min(820, k.cols * 8 - 8))
    return (
      <Box flexDirection="column">
        {head}
        {running.map(t => {
          const tv = view(t, now)
          return <Svg key={`tk-${t.id}`} source={taskRowSvg(W, tv)} alt={`${t.description || t.command}: ${tr('trwa', 'running')}. ${t.tail.join(' / ')}`} width={W} height={taskRowHeight(tv)} />
        })}
        {open}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {head}
      {running.map(t => (
        <Box key={`tk-${t.id}`} flexDirection="row" columnGap={1}>
          <Text color="claude">{spin(mentor.anim.frame)}</Text>
          <Text bold wrap="truncate-end">
            {t.description || t.command}
          </Text>
          <Text dimColor wrap="truncate-end">{t.tail[t.tail.length - 1] ?? ''}</Text>
          <Box flexGrow={1} />
          <Text dimColor>{fmtTime(elapsed(t, now))}</Text>
        </Box>
      ))}
      {open}
    </Box>
  )
}
