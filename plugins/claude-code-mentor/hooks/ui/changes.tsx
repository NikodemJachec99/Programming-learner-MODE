// Zakładka Zmiany (Change Lab): co Claude zmienił, kod przed i po, uruchomienie
// obu wersji w symulatorze i inne podejście. Jeden ekran w dwóch stanach: lista
// albo szczegóły. Domyślnie krótko; więcej dopiero na życzenie.

import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorLab } from '../../types'
import { conceptById, interestingConcepts, mentor } from '../mentor'
import { changeHints, groupByTurn, refactorIds, simDialect } from '../engine/change'
import type { ChangeFull, ChangeMeta } from '../engine/change'
import { codeLanguage } from '../engine/diff'
import { ago, card, code, label, md, muted, shortPath } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { lessonBlock } from './lesson'
import { renderBench } from './bench'
import { fileIcon, renderFilesSummary } from './files'
import { SCOPE_LABEL, scopeOf, teachable } from '../engine/scope'
import { renderReplayDiff, renderReplayHead } from './replay'
import { renderAgents } from './agents'
import { renderTasks } from './tasks'
import { waiting } from './motion'
import { DECISION_SOURCE, decisionFor } from '../engine/decision'
import type { DecisionLine } from '../engine/decision'
import { exampleFor } from '../engine/examples'
import { pairRunnable, runnable } from '../engine/runnable'
import { PLACEMENT, placementSummary } from '../engine/placement'

const FIRST_GROUPS = 6

const conceptNames = (ids: string[], max = 2) =>
  ids
    .map(id => conceptById(id)?.name.replace(/\s*\(.*\)$/, ''))
    .filter((x): x is string => !!x)
    .slice(0, max)

export async function renderChanges(io: Host, k: Kit): Promise<RenderElement> {
  const lab = await io.get(S.lab)
  const placement = await io.get(S.placement)
  if (placement.status === 'running') return renderPlacement(io, k)
  return lab.selected ? renderDetail(io, k, lab, lab.selected) : renderList(io, k, lab)
}

const short = (id: string) => conceptById(id)?.name.replace(/\s*\(.*\)$/, '') ?? id

/** Karta na start: co tu jest i test poziomu. Znika po teście albo po „Pomiń”. */
async function startCard(io: Host, k: Kit, empty: boolean): Promise<RenderElement | null> {
  const { Box, Text, Button } = k.E
  const p = await io.get(S.placement)
  if (p.status === 'done' && p.answers.length === PLACEMENT.length) {
    const r = placementSummary(p.answers, short)
    return card(
      k,
      'success',
      <Text bold>{`Test poziomu: ${r.score}/${PLACEMENT.length}`}</Text>,
      r.known.length > 0 && <Text wrap="wrap">{`Umiesz: ${r.known.join(', ')}.`}</Text>,
      r.learn.length > 0 && <Text wrap="wrap">{`Do nauki: ${r.learn.join(', ')}. Ścieżka zacznie od tego.`}</Text>,
      <Box flexDirection="row" columnGap={1}>
        <Button key="pl-close" plain dimColor onPress={() => io.set(S.placement, x => ({ ...x, answers: [], last: null }))}>
          Zamknij
        </Button>
      </Box>,
    )
  }
  if (p.status !== 'none') return null
  return card(
    k,
    'claude',
    <Text bold>Na start</Text>,
    empty && <Text wrap="wrap">Mentor pokazuje każdą zmianę, którą Claude robi w Twoim kodzie. Poproś Claude o zmianę, kliknij plik na tej liście i wybierz „Wyjaśnij”, „Uruchom” albo „Sprawdź się”.</Text>,
    <Text wrap="wrap">{`Test poziomu: ${PLACEMENT.length} pytań, ok. 2 minuty. Mentor nie będzie tłumaczył tego, co już umiesz.`}</Text>,
    <Box flexDirection="row" columnGap={1} marginTop={1}>
      <Button key="pl-start" variant="primary" onPress={() => mentor.startPlacement(io)}>
        Zrób test
      </Button>
      <Button key="pl-skip" plain dimColor onPress={() => mentor.skipPlacement(io)}>
        Pomiń
      </Button>
    </Box>,
  )
}

async function renderPlacement(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const p = await io.get(S.placement)
  const q = PLACEMENT[p.index]
  if (!q) return muted(k, 'Liczę wynik…')
  const prev = p.last ? PLACEMENT[p.last.index] : undefined
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>Test poziomu</Text>
        <Text dimColor>{`${p.index + 1}/${PLACEMENT.length}`}</Text>
      </Box>
      {prev && p.last && (
        <Text color={p.last.correct ? 'success' : 'warning'} wrap="wrap">
          {`${p.last.correct ? 'Dobrze.' : `Nie, poprawnie: ${prev.options[prev.answer]}.`} ${prev.explain}`}
        </Text>
      )}
      <Box marginTop={1}>
        <Text wrap="wrap">Co wypisze ten kod?</Text>
      </Box>
      {code(k, q.code, codeLanguage('js'), 1)}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {q.options.map((o, i) => (
          <Button key={`pl-o-${i}`} onPress={() => mentor.answerPlacement(io, i)}>
            {o}
          </Button>
        ))}
      </Box>
      <Box marginTop={1}>
        <Button key="pl-cancel" plain dimColor onPress={() => mentor.skipPlacement(io)}>
          Przerwij test
        </Button>
      </Box>
    </Box>
  )
}

async function renderList(io: Host, k: Kit, lab: MentorLab): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const changes = await io.get(S.changes)
  const now = await io.now()
  const groups = groupByTurn(changes)
  const start = await startCard(io, k, !groups.length)
  const fileMap = await renderFilesSummary(io, k)
  const agentsView = await renderAgents(io, k)
  const tasksView = await renderTasks(io, k)
  if (!groups.length) {
    return (
      <Box flexDirection="column">
        <Text bold>Zmiany Claude</Text>
        {agentsView}
        {tasksView}
        {fileMap}
        {start ?? (
          <Text dimColor wrap="wrap">
            Tu pojawi się każda zmiana, którą Claude zrobi w plikach. Kliknij ją, żeby zobaczyć kod przed i po, wyjaśnienie i uruchomienie obu wersji.
          </Text>
        )}
      </Box>
    )
  }
  const shown = groups.slice(0, lab.showAll ? 30 : FIRST_GROUPS)
  const openGroups = new Set((await io.get(S.view)).openSections)
  const focus = await io.get(S.focus)
  const fc = focus ? conceptById(focus.conceptId) : undefined
  // ostatnie zadanie jednym zdaniem: co, ile zmian, ile plików, kiedy
  const last = groups[0]!
  const learnItems = last.items.filter(c => teachable(scopeOf(c.file, mentor.projectRoot)))
  const okItems = learnItems.filter(c => c.status === 'ok')
  const files = new Set(learnItems.map(c => c.file)).size
  const failed = learnItems.filter(c => c.status === 'failed').length
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text bold wrap="truncate-end">{last.label ? `„${last.label}”` : 'Zmiany Claude'}</Text>
        <Box flexShrink={0}>
          <Text dimColor>{ago(last.ts, now)}</Text>
        </Box>
      </Box>
      <Text wrap="wrap">
        <Text>{`${okItems.length} ${okItems.length === 1 ? 'zmiana' : okItems.length < 5 && okItems.length > 1 ? 'zmiany' : 'zmian'} w ${files} ${files === 1 ? 'pliku' : 'plikach'}`}</Text>
        <Text color="success">{`  +${okItems.reduce((s, c) => s + c.added, 0)}`}</Text>
        <Text color="error">{` −${okItems.reduce((s, c) => s + c.removed, 0)}`}</Text>
        {failed > 0 && <Text color="error">{`  · nieudane: ${failed}`}</Text>}
      </Text>
      {agentsView}
      {tasksView}
      {fileMap}
      {start}
      {fc && focus && (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text dimColor>Warto zrozumieć:</Text>
          <Text color="claude">{fc.name.replace(/\s*\(.*\)$/, '')}</Text>
          {focus.file && <Text dimColor>{`w ${shortPath(focus.file, 32)}`}</Text>}
        </Box>
      )}
      {shown.map(g => taskCard(io, k, g, now, openGroups))}
      {groups.length > FIRST_GROUPS && (
        <Box marginTop={1}>
          <Button key="lab-more" plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, showAll: !l.showAll }))}>
            {lab.showAll ? 'Pokaż mniej' : `Starsze (${groups.length - FIRST_GROUPS})`}
          </Button>
        </Box>
      )}
    </Box>
  )
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

/** Pliki zadania: każdy raz, z liczbą edycji i sumą linii; kliknięcie otwiera ostatnią edycję pliku. */
export function filesOfTask(items: readonly ChangeMeta[]): { file: string; last: ChangeMeta; count: number; added: number; removed: number; failed: number; ok: number }[] {
  const by = new Map<string, { file: string; last: ChangeMeta; count: number; added: number; removed: number; failed: number; ok: number }>()
  for (const c of items) {
    const key = (c.file || '(plik)').replace(/\\/g, '/').toLowerCase()
    const r = by.get(key) ?? { file: c.file || '(plik)', last: c, count: 0, added: 0, removed: 0, failed: 0, ok: 0 }
    r.count++
    if (c.status === 'ok') {
      r.ok++
      r.added += c.added
      r.removed += c.removed
    } else r.failed++
    if (c.ts >= r.last.ts) r.last = c
    by.set(key, r)
  }
  return [...by.values()]
}

const TASK_ROWS = 8

/** Wiersz pliku w karcie zadania: ikona, nazwa (otwiera ostatnią edycję), katalog, ×N, +/− albo stan. */
function fileRow(io: Host, k: Kit, f: ReturnType<typeof filesOfTask>[number], key: string, i: number, quiet: boolean): RenderElement {
  const { Box, Text, Button } = k.E
  const name = f.file.replace(/\\/g, '/').split('/').pop() || f.file
  const parts = f.file.replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean)
  const d = parts.join('/')
  const dir = d.length > 28 ? `…/${parts.slice(-2).join('/')}` : d
  const reverted = f.ok === 0 && f.last.status === 'reverted'
  return (
    <Box key={`tf-${key}-${i}`} flexDirection="row" columnGap={1} alignItems="center">
      {fileIcon(k.E, k.surface, name, `tf-i-${key}-${i}`)}
      <Button key={`open-${f.last.id}`} plain dimColor={quiet || reverted} onPress={() => mentor.openChange(io, f.last.id)}>
        {name}
      </Button>
      {dir ? (
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-start">
            {dir}
          </Text>
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {f.count > 1 && <Text dimColor>{`×${f.count}`}</Text>}
      {f.ok > 0 ? (
        <Text dimColor={quiet}>
          <Text color={quiet ? undefined : 'success'}>{`+${f.added}`}</Text>
          <Text color={quiet ? undefined : 'error'}>{` −${f.removed}`}</Text>
        </Text>
      ) : (
        <Text color={f.last.status === 'failed' ? 'error' : undefined} dimColor={f.last.status !== 'failed'}>
          {f.last.status === 'failed' ? '✗ nie weszła' : reverted ? '↩ cofnięta' : '⊘ wrażliwy'}
        </Text>
      )}
    </Box>
  )
}

/** Zadanie (jedno polecenie) jako karta: polecenie, czas, ile edycji i linii, potem pliki jak w filetree. */
function taskCard(io: Host, k: Kit, g: { key: string; label: string | null; ts: number; items: ChangeMeta[] }, now: number, open: Set<string>): RenderElement {
  const { Box, Text, Button } = k.E
  // kod i konfiguracja projektu na wierzchu; pliki robocze Claude i notatki zwinięte pod spodem
  const learn = (c: ChangeMeta) => teachable(scopeOf(c.file, mentor.projectRoot))
  const extra = filesOfTask(g.items.filter(c => !learn(c)))
  const extraOpen = open.has(`task-x-${g.key}`)
  const extraToggle = extra.length ? (
    <Button key={`task-x-${g.key}`} plain dimColor onPress={() => io.set(S.view, v => ({ ...v, openSections: extraOpen ? v.openSections.filter(s => s !== `task-x-${g.key}`) : [...v.openSections, `task-x-${g.key}`] }))}>
      {`${extraOpen ? '▾' : '▸'} ${[...new Set(extra.map(f => SCOPE_LABEL[scopeOf(f.file, mentor.projectRoot)]))].join(' i ')} · ${extra.length}`}
    </Button>
  ) : null
  const files = filesOfTask(g.items.filter(learn))
  if (!files.length) {
    // samo zaplecze Claude: jedna cicha linia zamiast karty
    return (
      <Box key={`g-${g.key}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Text dimColor wrap="truncate-end">
            {g.label ? `„${g.label}”` : 'Bez polecenia'}
          </Text>
          <Box flexShrink={0}>
            <Text dimColor>{ago(g.ts, now)}</Text>
          </Box>
        </Box>
        {extraToggle}
        {extraOpen && extra.map((f, i) => fileRow(io, k, f, `${g.key}-x`, i, true))}
      </Box>
    )
  }
  const edits = files.reduce((s, f) => s + f.count, 0)
  const added = files.reduce((s, f) => s + f.added, 0)
  const removed = files.reduce((s, f) => s + f.removed, 0)
  const failed = files.reduce((s, f) => s + f.failed, 0)
  const all = open.has(`task-${g.key}`)
  const shown = all ? files : files.slice(0, TASK_ROWS)
  return (
    <Box key={`g-${g.key}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text bold wrap="truncate-end">
          {g.label ? `„${g.label}”` : 'Bez polecenia'}
        </Text>
        <Box flexShrink={0}>
          <Text dimColor>{ago(g.ts, now)}</Text>
        </Box>
      </Box>
      <Text>
        <Text dimColor>{`${edits} ${plural(edits, 'edycja', 'edycje', 'edycji')} w ${files.length} ${files.length === 1 ? 'pliku' : 'plikach'}  `}</Text>
        <Text color="success">{`+${added}`}</Text>
        <Text color="error">{` −${removed}`}</Text>
        {failed > 0 && <Text color="error">{`  · nieudane: ${failed}`}</Text>}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {shown.map((f, i) => fileRow(io, k, f, g.key, i, false))}
      </Box>
      {extraToggle}
      {extraOpen && extra.map((f, i) => fileRow(io, k, f, `${g.key}-x`, i, true))}
      {files.length > TASK_ROWS && (
        <Button key={`task-more-${g.key}`} plain dimColor onPress={() => io.set(S.view, v => ({ ...v, openSections: all ? v.openSections.filter(s => s !== `task-${g.key}`) : [...v.openSections, `task-${g.key}`] }))}>
          {all ? 'Mniej' : `+ ${files.length - TASK_ROWS} ${plural(files.length - TASK_ROWS, 'plik', 'pliki', 'plików')} więcej`}
        </Button>
      )}
    </Box>
  )
}

async function renderDetail(io: Host, k: Kit, lab: MentorLab, id: string): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const now = await io.now()
  const meta = (await io.get(S.changes)).find(x => x.id === id)
  const c: ChangeFull | null = mentor.getChange(id)
  const back = (
    <Button key="lab-back" plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, selected: null, confirm: null, guess: null }))}>
      ← Wszystkie zmiany
    </Button>
  )
  const m = c ?? meta
  if (!m) return <Box flexDirection="column">{back}{muted(k, lab.loading ? 'Wczytuję…' : lab.error ?? 'Nie znalazłem tej zmiany.')}</Box>

  const lang = codeLanguage(m.lang)
  const kindLabel = m.status === 'failed' ? 'nieudana' : m.status === 'blocked' ? 'plik wrażliwy' : m.kind === 'create' ? 'nowy plik' : m.kind === 'config' ? 'konfiguracja' : 'edycja'
  const sim = simDialect(m.lang)
  // prawdziwy kod tylko wtedy, gdy wykona się bez błędu składni, dopisków i założeń
  const canRun = !!c?.after && !!sim && (c.before ? pairRunnable(c.before, c.after, sim) : runnable(c.after, sim))
  const view = lab.view === 'before' && !c?.before ? 'diff' : lab.view

  const allChanges = await io.get(S.changes)
  // wygląd Replay Theater: tura, edycje po kolei, „Edycja k z N”
  const header = (
    <Box flexDirection="column">
      {back}
      {m.turnLabel ? (
        <Text dimColor wrap="truncate-end">{`„${m.turnLabel}”  ·  ${ago(m.ts, now)}`}</Text>
      ) : null}
      {renderReplayHead(io, k, allChanges, m)}
      {m.status !== 'ok' && <Text dimColor>{kindLabel}</Text>}
    </Box>
  )

  if (m.status !== 'ok') {
    return (
      <Box flexDirection="column">
        {header}
        {card(k, m.status === 'failed' ? 'warning' : 'subtle', <Text wrap="wrap">{m.status === 'failed' ? 'Ta zmiana nie weszła do pliku: Claude dostał odmowę albo narzędzie zgłosiło błąd. Kod się nie zmienił.' : m.status === 'reverted' ? 'Ta zmiana nie została w kodzie: przed końcem zadania plik wrócił do poprzedniej wersji albo został usunięty. Mentor nie robi z niej lekcji ani ćwiczeń.' : 'To plik z danymi wrażliwymi (np. .env albo klucze). Mentor nie zapisuje ani nie analizuje jego treści.'}</Text>)}
      </Box>
    )
  }

  // „Zgadnij zmianę”: widać tylko kod przed i polecenie, podpowiedzi stopniowo, potem prawdziwy diff
  const guess = lab.guess?.id === id ? lab.guess : null
  const canGuess = !!c?.before && !!c.unified
  if (guess && !guess.revealed && c?.before) {
    const all = changeHints(c)
    return (
      <Box flexDirection="column">
        {header}
        {label(k, 'Zgadnij zmianę')}
        <Text wrap="wrap">{m.turnLabel ? `Polecenie: „${m.turnLabel}”. Jak zmieniłbyś ten kod? Pomyśl, zanim odsłonisz.` : 'Co Claude zmienił w tym kodzie? Pomyśl, zanim odsłonisz.'}</Text>
        {code(k, c.before, lang, c.beforeStart, m.file)}
        {guess.hints.map((h, i) => md(k, `**Podpowiedź ${i + 1}:** ${h}`, `gh-${i}`))}
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Button key="lab-g-reveal" variant="primary" onPress={() => io.set(S.lab, l => ({ ...l, guess: null, view: 'diff' as const }))}>
            Pokaż zmianę
          </Button>
          {guess.hints.length < all.length && (
            <Button key="lab-g-hint" onPress={() => io.set(S.lab, l => (l.guess ? { ...l, guess: { ...l.guess, hints: all.slice(0, l.guess.hints.length + 1) } } : l))}>
              Podpowiedź
            </Button>
          )}
          <Button key="lab-g-cancel" plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, guess: null }))}>
            Anuluj
          </Button>
        </Box>
      </Box>
    )
  }

  // przełącznik widoku kodu: zmiany, przed, po
  const seg = (key: MentorLab['view'], text: string, enabled: boolean) => (
    <Button
      key={`lab-v-${key}`}
      variant={view === key ? 'primary' : undefined}
      plain={view === key ? undefined : true}
      dimColor={view !== key || !enabled}
      onPress={() => (enabled ? io.set(S.lab, l => ({ ...l, view: key })) : undefined)}
    >
      {text}
    </Button>
  )
  let codeView: RenderElement
  let provenance: string
  if (lab.loading && !c) {
    codeView = muted(k, 'Wczytuję kod…')
    provenance = ''
  } else if (!c || (!c.unified && !c.after)) {
    codeView = muted(k, 'Kod tej zmiany nie jest zapisany (wyłączone „Zapisuj kod zmian” albo starsza wersja Mentora).')
    provenance = ''
  } else if (view === 'split' && c.before && c.after) {
    // szeroki panel: przed i po obok siebie
    codeView = (
      <Box flexDirection="row" columnGap={1}>
        <Box flexDirection="column" width="50%">
          <Text color="error" dimColor>przed</Text>
          {code(k, c.before, lang, c.beforeStart, m.file)}
        </Box>
        <Box flexDirection="column" width="50%">
          <Text color="success" dimColor>po</Text>
          {code(k, c.after, lang, c.afterStart, m.file)}
        </Box>
      </Box>
    )
    provenance = 'Przed i po prosto z narzędzia Claude.'
  } else if (view === 'diff' || view === 'split') {
    // najpierw same zmiany ze zmienionymi słowami; kontekst i cały diff na żądanie (Replay Theater)
    codeView = c.unified ? renderReplayDiff(io, k, allChanges, m, c.unified, !!lab.fullDiff) : code(k, c.after ?? '', lang, c.afterStart, m.file)
    provenance = c.unified ? 'Dokładny diff z narzędzia Claude.' : 'Cały nowy plik.'
  } else if (view === 'before') {
    codeView = code(k, c.before ?? '', lang, c.beforeStart, m.file)
    provenance = 'Plik sprzed zmiany, prosto z narzędzia Claude.'
  } else {
    codeView = code(k, c.after ?? '', lang, c.afterStart, m.file)
    provenance = 'Plik po zmianie.'
  }
  const beforeNote = !c ? null : m.kind === 'create' ? 'Przed tą zmianą pliku nie było.' : !c.before ? 'Narzędzie nie przekazało poprzedniej wersji (np. bardzo duży plik), więc widok „Przed” jest niedostępny.' : null

  const facts = c?.facts ?? m.facts
  const levels = Object.fromEntries((await io.get(S.knowledge)).map(r => [r.id, r.level]))
  const concepts = conceptNames(interestingConcepts(m.concepts, levels), 3)
  const explaining = lab.lessonFor === id
  const benchOpen = lab.bench?.forId === id && canRun
  const example = c?.after
    ? exampleFor(refactorIds((c.before ?? '').split('\n'), c.after.split('\n'), m.lang), [...interestingConcepts(m.concepts, levels, true), ...m.concepts], sim)
    : null
  const job = await io.get(S.job)
  const lesson = await io.get(S.lesson)
  const view2 = await io.get(S.view)
  const shownLesson = explaining && lab.lessonId && lesson?.id === lab.lessonId ? lesson : null
  const lessonView = !explaining ? null : shownLesson ? (
    <Box flexDirection="column" marginTop={1}>
      {label(k, 'Wyjaśnienie')}
      {lessonBlock(io, k, shownLesson, new Set(view2.openSections), now, false)}
    </Box>
  ) : (
    <Box marginTop={1}>
      {job.state === 'error' ? <Text color="error" wrap="wrap">{`✗ ${job.message}`}</Text> : waiting(k, job.state === 'working' || job.state === 'queued' ? `${job.message} Zwykle 10 do 30 s.` : 'Piszę wyjaśnienie…', mentor.frame, 'lab-wait')}
    </Box>
  )
  // tylko kod i konfiguracja projektu uczą; pliki robocze Claude i notatki bez lekcji i ćwiczeń
  const learnHere = mentor.teachableChange(m)
  const scopeNote = learnHere ? null : scopeOf(m.file, mentor.projectRoot) === 'work' ? 'Plik roboczy Claude (scratchpad, plik tymczasowy, pamięć, wynik builda), nie Twój kod. Mentor nie robi z niego lekcji ani ćwiczeń.' : 'Notatki albo dane, nie kod. Mentor nie robi z nich lekcji ani ćwiczeń.'
  const actions = !learnHere ? muted(k, scopeNote ?? '') : (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {m.concepts.length > 0 && !!c && (
        <Button key="lab-lesson" variant={explaining ? undefined : 'primary'} onPress={() => mentor.lessonForChange(io, id)}>
          {explaining ? 'Schowaj wyjaśnienie' : 'Wyjaśnij'}
        </Button>
      )}
      {canRun && (
        <Button key="lab-run" variant={benchOpen ? 'primary' : undefined} onPress={() => mentor.openBench(io, id)}>
          {benchOpen ? 'Zamknij laboratorium' : c?.before ? '▶ Uruchom i porównaj' : '▶ Uruchom'}
        </Button>
      )}
      {example && (
        <Button key="lab-example" onPress={() => mentor.showExample(io, example)}>
          Zobacz na przykładzie
        </Button>
      )}
      {(canGuess || canRun || m.concepts.length > 0) && !!c && (
        <Button key="lab-quiz" onPress={() => mentor.quizForChange(io, id)}>
          Sprawdź się
        </Button>
      )}
      <Button key="lab-alt" plain dimColor onPress={() => mentor.requestAlternatives(io, id)}>
        Inne podejście
      </Button>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {header}
      {lab.error && <Text color="error" wrap="wrap">{lab.error}</Text>}
      {facts.length > 0 && label(k, 'Co się zmieniło')}
      {facts.length > 0 && md(k, facts.map(f => `- ${f}`).join('\n'))}
      {learnHere && concepts.length > 0 && <Text dimColor wrap="wrap">{`Warto zrozumieć: ${concepts.join(', ')}`}</Text>}
      <Box flexDirection="row" columnGap={1} marginTop={1}>
        {seg('diff', 'Zmiany', true)}
        {seg('before', 'Przed', !!c?.before)}
        {seg('after', 'Po', !!c?.after)}
        {k.cols >= 110 && !!c?.before && !!c?.after && seg('split', 'Obok', true)}
      </Box>
      {codeView}
      {provenance ? muted(k, provenance) : null}
      {beforeNote ? muted(k, beforeNote) : null}
      {actions}
      {benchOpen && sim && lab.bench && <Box marginTop={1}>{renderBench(io, k, lab.bench, m.file, m.lang, sim)}</Box>}
      {lessonView}
      {learnHere && !canRun && example && muted(k, `Ten kod zależy od reszty projektu, więc nie uruchamiam go w symulatorze. „Zobacz na przykładzie” pokazuje sam mechanizm: ${example.label}.`)}
      {renderAlternatives(io, k, lab, id, m.lang)}
    </Box>
  )
}

/**
 * Karta decyzji przed poproszeniem Claude o inne podejście (wzorzec Blast Radius): czego dotyczy,
 * co zachować, różnice ze źródłem (symulator / propozycja AI), testy i niepewności.
 * Bezpieczny wybór ma fokus; nic się nie zmienia, dopóki polecenie nie zostanie wysłane.
 */
function decisionCard(io: Host, k: Kit, lab: MentorLab, id: string, i: number): RenderElement | null {
  const { Box, Text, Button } = k.E
  const c = mentor.getChange(id)
  const alt = lab.alt.items[i]
  if (!c || !alt) return null
  const d = decisionFor(c, alt, lab.bench)
  const row = (title: string, body: RenderElement | RenderElement[]) => (
    <Box key={`dc-${title}`} flexDirection="row" columnGap={1}>
      <Box width={12} flexShrink={0}>
        <Text dimColor>{title}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {body}
      </Box>
    </Box>
  )
  const lines = (xs: DecisionLine[], key: string) =>
    xs.map((x, j) => (
      <Text key={`${key}-${j}`} wrap="wrap">
        <Text>{x.text}</Text>
        <Text color={x.source === 'sim' ? 'success' : x.source === 'ai' ? 'warning' : undefined} dimColor={x.source === 'none'}>{`  ${x.source === 'sim' ? '✓ ' : ''}${DECISION_SOURCE[x.source]}`}</Text>
      </Text>
    ))
  return card(
    k,
    'warning',
    <Text bold>{`⚠ Decyzja: przepisać zmianę na „${alt.title}”`}</Text>,
    row('Zmiana', <Text wrap="truncate-start">{d.change}</Text>),
    row('Podejście', <Text wrap="wrap">{d.approach}</Text>),
    row('Zachowaj', lines(d.keep, 'dk')),
    d.differences.length > 0 && row('Różnice', lines(d.differences, 'dd')),
    row('Sprawdzenie', d.checks.map((x, j) => <Text key={`dt-${j}`} wrap="wrap">{`- ${x}`}</Text>)),
    row('Niepewne', d.uncertain.map((x, j) => <Text key={`du-${j}`} dimColor wrap="wrap">{`? ${x}`}</Text>)),
    <Text dimColor italic wrap="wrap">Wybranie podejścia nic nie zmienia. Wstawię to jako polecenie w pole wiadomości; kod zmieni się dopiero, gdy wyślesz je Enterem.</Text>,
    <Box flexDirection="row" columnGap={1}>
      <Button key={`alt-${i}-cancel`} autoFocus hotkey="1" onPress={() => io.set(S.lab, l => ({ ...l, confirm: null }))}>
        Anuluj
      </Button>
      <Button key={`alt-${i}-go`} hotkey="2" onPress={() => mentor.handOff(io, id, i)}>
        Wstaw polecenie dla Claude
      </Button>
    </Box>,
  )
}

function renderAlternatives(io: Host, k: Kit, lab: MentorLab, id: string, langId: string): RenderElement | null {
  const { Box, Text, Button } = k.E
  const alt = lab.alt
  if (alt.forId !== id || alt.status === 'idle') return null
  if (alt.status === 'loading') return <Box marginTop={1}>{waiting(k, 'Szukam innego podejścia… (zapytanie AI, liczy się do dziennego limitu)', mentor.frame, 'alt-wait')}</Box>
  if (alt.status === 'error') return <Box marginTop={1}><Text color="warning" wrap="wrap">{alt.message}</Text></Box>
  const sim = simDialect(langId)
  return (
    <Box flexDirection="column">
      {label(k, 'Inne podejście', 'propozycja AI, niesprawdzona')}
      {alt.message && <Text dimColor wrap="wrap">{alt.message}</Text>}
      {alt.items.map((a, i) => (
        <Box key={`alt-${i}`} flexDirection="column" marginTop={1}>
          <Text bold wrap="wrap">{`${i + 1}. ${a.title}`}</Text>
          <Text wrap="wrap">{a.idea}</Text>
          {code(k, a.code, codeLanguage(langId))}
          {a.pros.map((p, j) => (
            <Text key={`alt-${i}-p-${j}`} color="success" wrap="wrap">{`+ ${p}`}</Text>
          ))}
          {a.cons.map((p, j) => (
            <Text key={`alt-${i}-c-${j}`} color="warning" wrap="wrap">{`− ${p}`}</Text>
          ))}
          {a.when && <Text dimColor wrap="wrap">{`Kiedy: ${a.when}`}</Text>}
          {lab.confirm === i ? (
            decisionCard(io, k, lab, id, i)
          ) : (
            <Box flexDirection="row" columnGap={1}>
              {sim && (
                <Button key={`alt-${i}-sim`} plain onPress={() => mentor.benchAddAlt(io, id, i)}>
                  Dodaj do laboratorium
                </Button>
              )}
              <Button key={`alt-${i}-pick`} plain onPress={() => io.set(S.lab, l => ({ ...l, confirm: i, handed: null }))}>
                Poproś Claude o to
              </Button>
            </Box>
          )}
        </Box>
      ))}
      {lab.handed && (
        <Box marginTop={1}>
          <Text color="success" wrap="wrap">{lab.handed}</Text>
        </Box>
      )}
    </Box>
  )
}
