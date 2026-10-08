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
import { exampleFor } from '../engine/examples'
import { runnable } from '../engine/runnable'

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
    { key: 'mechanism', title: 'Jak to działa', body: b.mechanism },
    { key: 'pitfalls', title: 'Na co uważać', body: b.pitfalls },
    { key: 'verify', title: 'Jak to sprawdzić', body: b.verify },
  ]
  const more = [
    b.problem && `**Po co.** ${b.problem}${b.purpose.likely ? ` _Hipoteza: ${b.purpose.likely}_` : ''}${b.purpose.confirmed ? ` _Potwierdzone: ${b.purpose.confirmed}_` : ''}`,
    b.syntax && `**Składnia.** ${b.syntax}`,
    b.why && `**Dlaczego tak.** ${b.why}`,
    b.alternatives && b.alternatives !== b.why && `**Alternatywy.** ${b.alternatives}`,
    b.dependencies && `**Zależności.** ${b.dependencies}`,
    ...b.uncertainty.map(u => `_Niepewne: ${u}_`),
    ...b.simplifications.map(u => `_Uproszczenie: ${u}_`),
  ].filter((x): x is string => !!x && !!x.trim())
  const fus = lesson.followUps ?? []
  const fuBusy = fus.some(f => f.status === 'loading')

  return (
    <Box flexDirection="column">
      <Text bold wrap="wrap">
        {main?.name.replace(/\s*\(.*\)$/, '') ?? lesson.title}
      </Text>
      <Text dimColor wrap="wrap">
        {`${lesson.file ? `${lesson.file}${lesson.line ? `:${lesson.line}` : ''} · ` : ''}${lesson.source === 'model' ? 'lekcja AI' : 'lekcja wbudowana'} · ${ago(lesson.ts, now)}`}
      </Text>
      <Box marginTop={1}>{md(k, first)}</Box>
      {b.missingPrereqs.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color="warning">Najpierw:</Text>
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
            {`${open.has('more') ? '▾' : '▸'}  Więcej`}
          </Button>
          {open.has('more') && <Box flexDirection="column" paddingLeft={3}>{more.map((t, i) => md(k, t, `more-${i}`))}</Box>}
        </Box>
      )}
      {fus.map(f => (
        <Box key={`fu-${f.kind}`} flexDirection="column" borderStyle="round" borderColor={f.status === 'loading' ? 'subtle' : 'suggestion'} paddingX={1} marginTop={1}>
          <Text bold>{f.title}</Text>
          {f.status === 'loading' ? <Text dimColor>Piszę… zwykle 10 do 30 s</Text> : md(k, f.text)}
          {f.note && <Text dimColor wrap="wrap">{f.note}</Text>}
        </Box>
      ))}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {withCode && (
          <Button key="l-quiz" variant="primary" onPress={() => mentor.startQuiz(io, 'concept', lesson.conceptIds[0])}>
            Sprawdź się
          </Button>
        )}
        <Button key="l-under" onPress={() => (fuBusy ? undefined : mentor.lessonFollowUp(io, 'under'))}>
          Co jest pod spodem
        </Button>
        {canSim && withCode && (
          <Button key="l-sim" onPress={() => (example ? mentor.showExample(io, example) : loadSim(io, b.snippet, `lekcja: ${main?.name.replace(/\s*\(.*\)$/, '') ?? lesson.title}`, b.lang))}>
            {example ? 'Na przykładzie' : 'Krok po kroku'}
          </Button>
        )}
        <Button key="l-example" onPress={() => (fuBusy ? undefined : mentor.lessonFollowUp(io, 'example'))}>
          Inny przykład
        </Button>
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
          <Text color="suggestion" wrap="wrap">{`${job.message} Zwykle 10 do 30 s.`}</Text>
        ) : (
          <Text dimColor wrap="wrap">Tu są lekcje o Twoim kodzie. Najszybciej: w zakładce Zmiany wybierz zmianę i kliknij „Wyjaśnij”.</Text>
        )}
      </Box>
    )
  }
  if (lesson.status === 'new') void mentor.markRead(io)
  return (
    <Box flexDirection="column">
      {picker}
      {busy && <Text color="suggestion" wrap="wrap">{`${job.message} Zwykle 10 do 30 s.`}</Text>}
      <Box marginTop={picker ? 1 : 0}>{lessonBlock(io, k, lesson, new Set(view.openSections), now)}</Box>
    </Box>
  )
}
