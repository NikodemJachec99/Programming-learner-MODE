// Lekcja: krótko na start, szczegóły po rozwinięciu. Ten sam blok pokazuje
// zakładka Lekcje i szczegóły zmiany w zakładce Zmiany.
import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorLesson, MentorLessonMeta } from '../../types'
import { conceptById, mentor } from '../mentor'
import { codeLanguage } from '../engine/diff'
import { ago, code, md } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { loadSim } from './sim'
import { waiting } from './motion'
import { FEEDBACK_KINDS, FEEDBACK_LABEL } from '../engine/feedback'
import { exampleFor } from '../engine/examples'
import { runnable } from '../engine/runnable'
import { plural, tr } from '../i18n'

/** Krótki, rozróżnialny opis lekcji do listy wyboru. */
function lessonLabel(l: MentorLessonMeta, now: number): string {
  const name = (l.conceptIds[0] ? conceptById(l.conceptIds[0])?.name : undefined)?.replace(/\s*\(.*\)$/, '') ?? l.title
  const file = l.file ? l.file.split(/[\\/]/).pop() : 'terminal'
  return `${l.status === 'new' ? '● ' : ''}${name} · ${file} · ${ago(l.ts, now)}`
}

/**
 * Treść lekcji: jedno zdanie, kod, 3 rozwijane sekcje i dopytania pod spodem.
 * `withCode: false` w szczegółach zmiany: kod, „Sprawdź się” i uruchomienie są tam już wyżej.
 */
export function lessonBlock(io: Host, k: Kit, lesson: MentorLesson, open: Set<string>, now: number, withCode = true): RenderElement {
  const { Box, Text, Button } = k.E
  const b = lesson.body
  const main = lesson.conceptIds[0] ? conceptById(lesson.conceptIds[0]) : undefined
  const dialect = b.lang === 'dart' ? 'dart' : b.lang === 'js' || b.lang === 'ts' ? 'js' : null
  // kod z projektu tylko gdy wykona się czysto; inaczej przykład tego samego pojęcia
  const ownRuns = !!dialect && !!b.snippet && runnable(b.snippet, dialect)
  const example = ownRuns ? null : exampleFor([], lesson.conceptIds, dialect)
  const canSim = ownRuns || !!example
  const toggle = (key: string) => () => io.set(S.view, v => ({ ...v, openSections: v.openSections.includes(key) ? v.openSections.filter(x => x !== key) : [...v.openSections, key] }))
  const first = b.observed.split(/(?<=\.)\s/)[0] ?? b.observed
  const sections: { key: string; title: string; body: string }[] = [
    { key: 'mechanism', title: tr('Jak to działa', 'How it works'), body: b.mechanism },
    { key: 'pitfalls', title: tr('Na co uważać', 'Watch out for'), body: b.pitfalls },
    { key: 'verify', title: tr('Jak to sprawdzić', 'How to check it'), body: b.verify },
  ]
  const more = [
    b.problem && `**${tr('Po co.', 'Why.')}** ${b.problem}${b.purpose.likely ? ` _${tr('Hipoteza', 'Hypothesis')}: ${b.purpose.likely}_` : ''}${b.purpose.confirmed ? ` _${tr('Potwierdzone', 'Confirmed')}: ${b.purpose.confirmed}_` : ''}`,
    b.syntax && `**${tr('Składnia.', 'Syntax.')}** ${b.syntax}`,
    b.why && `**${tr('Dlaczego tak.', 'Why this way.')}** ${b.why}`,
    b.alternatives && b.alternatives !== b.why && `**${tr('Alternatywy.', 'Alternatives.')}** ${b.alternatives}`,
    b.dependencies && `**${tr('Zależności.', 'Dependencies.')}** ${b.dependencies}`,
    ...b.uncertainty.map(u => `_${tr('Niepewne', 'Uncertain')}: ${u}_`),
    ...b.simplifications.map(u => `_${tr('Uproszczenie', 'Simplification')}: ${u}_`),
  ].filter((x): x is string => !!x && !!x.trim())
  const fus = lesson.followUps ?? []
  const vote = mentor.feedback.lessons[lesson.id]?.kind
  const fuBusy = fus.some(f => f.status === 'loading')

  return (
    <Box flexDirection="column">
      <Text bold wrap="wrap">
        {main?.name.replace(/\s*\(.*\)$/, '') ?? lesson.title}
      </Text>
      <Text dimColor wrap="wrap">
        {`${lesson.file ? `${lesson.file}${lesson.line ? `:${lesson.line}` : ''} · ` : ''}${lesson.source === 'model' ? tr('lekcja AI', 'AI lesson') : tr('lekcja wbudowana', 'built-in lesson')} · ${ago(lesson.ts, now)}`}
      </Text>
      {b.task && b.task.files.length > 0 && (
        // lekcja z całego zadania: co Claude zrobił, a mechanizm na jednej, konkretnej edycji
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          <Text dimColor bold>
            {tr('Z ZADANIA', 'FROM THE TASK')}
          </Text>
          {b.task.label && (
            <Text bold wrap="truncate-end">
              {`„${b.task.label}”`}
            </Text>
          )}
          <Text>
            <Text dimColor>{`${b.task.edits} ${plural(b.task.edits, ['edycja', 'edycje', 'edycji'], ['edit', 'edits'])} ${tr('w', 'in')} ${b.task.files.length} ${plural(b.task.files.length, ['pliku', 'plikach', 'plikach'], ['file', 'files'])}  `}</Text>
            <Text color="success">{`+${b.task.added}`}</Text>
            <Text color="error">{` −${b.task.removed}`}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {b.task.files.map(f => f.replace(/\\/g, '/').split('/').pop()).join(' · ')}
          </Text>
          {main && <Text wrap="wrap">{`${tr('Kluczowy mechanizm', 'Key mechanism')}: ${main.name.replace(/\s*\(.*\)$/, '')}`}</Text>}
          {b.task.changeId && (
            <Button key="l-task-open" plain dimColor onPress={() => mentor.openChange(io, b.task!.changeId!)}>
              {tr('Zobacz edycję →', 'See the edit →')}
            </Button>
          )}
        </Box>
      )}
      <Box marginTop={1}>{md(k, first)}</Box>
      {b.missingPrereqs.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color="warning">{tr('Najpierw:', 'First:')}</Text>
          {b.missingPrereqs.map(id => (
            <Button key={`pre-${id}`} plain onPress={() => mentor.requestLesson(io, id, false)}>
              {conceptById(id)?.name.replace(/\s*\(.*\)$/, '') ?? id}
            </Button>
          ))}
        </Box>
      )}
      {withCode && b.snippet ? <Box marginTop={1}>{code(k, b.snippet, codeLanguage(b.lang), b.snippetStart, b.file)}</Box> : null}
      {sections
        .filter(s => s.body && s.body.trim())
        .map(s => (
          <Box key={`sec-${s.key}`} flexDirection="column" marginTop={1}>
            <Button key={`sec-btn-${s.key}`} plain dimColor={!open.has(s.key)} onPress={toggle(s.key)}>
              {`${open.has(s.key) ? '▾' : '▸'}  ${s.title}`}
            </Button>
            {open.has(s.key) && <Box paddingLeft={3}>{md(k, s.body)}</Box>}
          </Box>
        ))}
      {more.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Button key="sec-btn-more" plain dimColor={!open.has('more')} onPress={toggle('more')}>
            {`${open.has('more') ? '▾' : '▸'}  ${tr('Więcej', 'More')}`}
          </Button>
          {open.has('more') && <Box flexDirection="column" paddingLeft={3}>{more.map((t, i) => md(k, t, `more-${i}`))}</Box>}
        </Box>
      )}
      {fus.map(f => (
        <Box key={`fu-${f.kind}`} flexDirection="column" borderStyle="round" borderColor={f.status === 'loading' ? 'subtle' : 'suggestion'} paddingX={1} marginTop={1}>
          <Text bold>{f.title}</Text>
          {f.status === 'loading' ? waiting(k, 'Piszę… zwykle 10 do 30 s', mentor.anim.frame, `fu-wait-${f.kind}`) : md(k, f.text)}
          {f.note && <Text dimColor wrap="wrap">{f.note}</Text>}
        </Box>
      ))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {withCode && (
          <Button key="l-quiz" variant="primary" onPress={() => mentor.quiz.startQuiz(io, 'concept', lesson.conceptIds[0])}>
            {tr('Sprawdź się', 'Check yourself')}
          </Button>
        )}
        <Button key="l-under" onPress={() => (fuBusy ? undefined : mentor.lessonFollowUp(io, 'under'))}>
          {tr('Co jest pod spodem', 'What’s underneath')}
        </Button>
        {canSim && withCode && (
          <Button key="l-sim" onPress={() => (example ? mentor.showExample(io, example) : loadSim(io, b.snippet, `${tr('lekcja', 'lesson')}: ${main?.name.replace(/\s*\(.*\)$/, '') ?? lesson.title}`, b.lang))}>
            {example ? tr('Na przykładzie', 'With an example') : tr('Krok po kroku', 'Step by step')}
          </Button>
        )}
        <Button key="l-example" onPress={() => (fuBusy ? undefined : mentor.lessonFollowUp(io, 'example'))}>
          {tr('Inny przykład', 'Another example')}
        </Button>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        <Text dimColor>{vote ? tr('✓ zapamiętane:', '✓ saved:') : tr('Jak było?', 'How was it?')}</Text>
        {FEEDBACK_KINDS.map(kind => (
          <Button key={`l-fb-${kind}`} plain dimColor={vote !== kind} onPress={() => (fuBusy ? undefined : mentor.lessonFeedback(io, kind))}>
            {FEEDBACK_LABEL[kind]}
          </Button>
        ))}
      </Box>
    </Box>
  )
}

export async function renderLesson(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button, Select } = k.E
  const lesson = await io.get(S.lesson)
  const list = await io.get(S.lessons)
  const view = await io.get(S.view)
  const job = await io.get(S.job)
  const now = await io.now()

  const idx = lesson ? list.findIndex(l => l.id === lesson.id) : -1
  const go = (n: MentorLessonMeta | undefined) => () => (n ? mentor.openLesson(io, n.id) : undefined)
  const options = [...(lesson && idx < 0 ? [{ value: lesson.id, label: lessonLabel(lesson, now) }] : []), ...list.slice(0, 20).map(l => ({ value: l.id, label: lessonLabel(l, now) }))]
  const picker =
    options.length > 1 ? (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button key="ls-prev" plain dimColor onPress={go(list[idx + 1])}>
          ◀
        </Button>
        <Select key="ls-pick" value={lesson?.id ?? options[0]!.value} options={options} onSelect={id => mentor.openLesson(io, id)} />
        <Button key="ls-next" plain dimColor onPress={go(idx > 0 ? list[idx - 1] : undefined)}>
          ▶
        </Button>
      </Box>
    ) : null
  const busy = job.state === 'working' || job.state === 'queued'

  if (!lesson) {
    return (
      <Box flexDirection="column">
        {picker}
        {busy ? (
          waiting(k, `${job.message} ${tr('Zwykle 10 do 30 s.', 'Usually 10 to 30 s.')}`, mentor.anim.frame, 'ls-wait')
        ) : (
          <Text dimColor wrap="wrap">{tr('Tu są lekcje o Twoim kodzie. Najszybciej: w zakładce Zmiany wybierz zmianę i kliknij „Wyjaśnij”.', 'Lessons about your code live here. Fastest: in Changes pick a change and click “Explain”.')}</Text>
        )}
      </Box>
    )
  }
  if (lesson.status === 'new') void mentor.markRead(io)
  return (
    <Box flexDirection="column">
      {picker}
      {busy && waiting(k, `${job.message} ${tr('Zwykle 10 do 30 s.', 'Usually 10 to 30 s.')}`, mentor.anim.frame, 'ls-wait2')}
      <Box marginTop={picker ? 1 : 0}>{lessonBlock(io, k, lesson, new Set(view.openSections), now)}</Box>
    </Box>
  )
}
