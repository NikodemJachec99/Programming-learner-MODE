// Zakładka Zmiany (Change Lab): co Claude zmienił, kod przed i po, uruchomienie
// obu wersji w symulatorze i inne podejście. Jeden ekran w dwóch stanach: lista
// albo szczegóły. Domyślnie krótko; więcej dopiero na życzenie.

import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorLab } from '../../types'
import { conceptById, interestingConcepts, mentor } from '../mentor'
import { changeHints, groupByTurn, simDialect } from '../engine/change'
import type { ChangeFull, ChangeMeta } from '../engine/change'
import { codeLanguage } from '../engine/diff'
import { ago, card, code, label, md, muted, shortPath } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { lessonBlock } from './lesson'
import { PLACEMENT, placementSummary } from '../engine/placement'

const FIRST_GROUPS = 6

const icon = (c: ChangeMeta) => (c.status === 'failed' ? '✗' : c.status === 'blocked' ? '⊘' : c.kind === 'create' ? '＋' : '✎')
const iconColor = (c: ChangeMeta) => (c.status === 'failed' ? 'error' : c.status === 'blocked' ? 'subtle' : c.kind === 'create' ? 'success' : 'suggestion')
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
  const levels = Object.fromEntries((await io.get(S.knowledge)).map(r => [r.id, r.level]))
  const start = await startCard(io, k, !groups.length)
  if (!groups.length) {
    return (
      <Box flexDirection="column">
        <Text bold>Zmiany Claude</Text>
        {start ?? (
          <Text dimColor wrap="wrap">
            Tu pojawi się każda zmiana, którą Claude zrobi w plikach. Kliknij ją, żeby zobaczyć kod przed i po, wyjaśnienie i uruchomienie obu wersji.
          </Text>
        )}
      </Box>
    )
  }
  const shown = groups.slice(0, lab.showAll ? 30 : FIRST_GROUPS)
  const focus = await io.get(S.focus)
  const fc = focus ? conceptById(focus.conceptId) : undefined
  const fileWidth = Math.max(16, Math.min(48, k.cols - 26))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>Zmiany Claude</Text>
        <Text dimColor>kliknij plik</Text>
      </Box>
      {start}
      {fc && focus && (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text dimColor>Warto zrozumieć:</Text>
          <Text color="claude">{fc.name.replace(/\s*\(.*\)$/, '')}</Text>
          {focus.file && <Text dimColor>{`w ${shortPath(focus.file, 32)}`}</Text>}
        </Box>
      )}
      {shown.map(g => (
        <Box key={`g-${g.key}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text color="claude" wrap="truncate-end">
              {g.label ? `„${g.label}”` : 'Bez polecenia'}
            </Text>
            <Box flexShrink={0}>
              <Text dimColor>{ago(g.ts, now)}</Text>
            </Box>
          </Box>
          {g.items.map(c => (
            <Box key={`row-${c.id}`} flexDirection="row" columnGap={1} flexWrap="nowrap">
              <Text color={iconColor(c)}>{icon(c)}</Text>
              <Button key={`open-${c.id}`} plain onPress={() => mentor.openChange(io, c.id)}>
                {shortPath(c.file || '(plik)', fileWidth)}
              </Button>
              {c.status === 'ok' ? (
                <Text wrap="truncate-end">
                  <Text color="success">{`+${c.added}`}</Text>
                  <Text color="error">{` −${c.removed}`}</Text>
                  <Text dimColor>{conceptNames(interestingConcepts(c.concepts, levels)).length ? `  ${conceptNames(interestingConcepts(c.concepts, levels)).join(', ')}` : ''}</Text>
                </Text>
              ) : (
                <Text dimColor wrap="truncate-end">
                  {c.status === 'failed' ? 'nie weszła do pliku' : 'plik wrażliwy, bez kodu'}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      ))}
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

async function renderDetail(io: Host, k: Kit, lab: MentorLab, id: string): Promise<RenderElement> {
  const { Box, Text, Button, Code } = k.E
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
  const canRun = !!c?.after && !!sim
  const view = lab.view === 'before' && !c?.before ? 'diff' : lab.view

  const header = (
    <Box flexDirection="column">
      {back}
      <Text bold wrap="wrap">
        {`${m.file}${m.line ? `:${m.line}` : ''}`}
      </Text>
      <Text dimColor wrap="wrap">
        {[kindLabel, m.status === 'ok' ? `+${m.added} −${m.removed}` : null, ago(m.ts, now), m.turnLabel ? `„${m.turnLabel}”` : null].filter(Boolean).join('  ·  ')}
      </Text>
    </Box>
  )

  if (m.status !== 'ok') {
    return (
      <Box flexDirection="column">
        {header}
        {card(k, m.status === 'failed' ? 'warning' : 'subtle', <Text wrap="wrap">{m.status === 'failed' ? 'Ta zmiana nie weszła do pliku: Claude dostał odmowę albo narzędzie zgłosiło błąd. Kod się nie zmienił.' : 'To plik z danymi wrażliwymi (np. .env albo klucze). Mentor nie zapisuje ani nie analizuje jego treści.'}</Text>)}
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
  } else if (view === 'diff') {
    codeView = c.unified ? <Code source={c.unified} format="diff" language={lang} path={m.file} wrap="wrap" /> : code(k, c.after ?? '', lang, c.afterStart, m.file)
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
      {job.state === 'error' ? <Text color="warning" wrap="wrap">{job.message}</Text> : <Text color="suggestion" wrap="wrap">{job.state === 'working' || job.state === 'queued' ? `${job.message} Zwykle 10 do 30 s.` : 'Piszę wyjaśnienie…'}</Text>}
    </Box>
  )
  const actions = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {m.concepts.length > 0 && !!c && (
        <Button key="lab-lesson" variant={explaining ? undefined : 'primary'} onPress={() => mentor.lessonForChange(io, id)}>
          {explaining ? 'Schowaj wyjaśnienie' : 'Wyjaśnij'}
        </Button>
      )}
      {canRun && (
        <Button key="lab-run" onPress={() => mentor.runChange(io, id)}>
          {c?.before ? '▶ Uruchom przed i po' : '▶ Uruchom'}
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
      {concepts.length > 0 && <Text dimColor wrap="wrap">{`Warto zrozumieć: ${concepts.join(', ')}`}</Text>}
      <Box flexDirection="row" columnGap={1} marginTop={1}>
        {seg('diff', 'Zmiany', true)}
        {seg('before', 'Przed', !!c?.before)}
        {seg('after', 'Po', !!c?.after)}
      </Box>
      {codeView}
      {provenance ? muted(k, provenance) : null}
      {beforeNote ? muted(k, beforeNote) : null}
      {actions}
      {lessonView}
      {!sim && muted(k, 'Symulator wykonuje JS, TS i Darta. Tu zostaje porównanie kodu.')}
      {renderAlternatives(io, k, lab, id, m.lang)}
    </Box>
  )
}

function renderAlternatives(io: Host, k: Kit, lab: MentorLab, id: string, langId: string): RenderElement | null {
  const { Box, Text, Button } = k.E
  const alt = lab.alt
  if (alt.forId !== id || alt.status === 'idle') return null
  if (alt.status === 'loading') return <Box marginTop={1}>{muted(k, 'Szukam innego podejścia… (zapytanie AI, liczy się do dziennego limitu)')}</Box>
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
            card(
              k,
              'claude',
              <Text wrap="wrap">Wstawię do pola wiadomości prośbę do Claude o to podejście. Kod się nie zmieni, dopóki nie wyślesz jej Enterem.</Text>,
              <Box flexDirection="row" columnGap={1}>
                <Button key={`alt-${i}-go`} variant="primary" onPress={() => mentor.handOff(io, id, i)}>
                  Wstaw do pola wiadomości
                </Button>
                <Button key={`alt-${i}-cancel`} plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, confirm: null }))}>
                  Anuluj
                </Button>
              </Box>,
            )
          ) : (
            <Box flexDirection="row" columnGap={1}>
              {sim && (
                <Button key={`alt-${i}-sim`} plain onPress={() => mentor.compareAlternative(io, id, i)}>
                  Porównaj w symulatorze
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
