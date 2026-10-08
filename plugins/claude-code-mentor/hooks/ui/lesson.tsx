import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorLesson, MentorLessonMeta } from '../../types'
import { conceptById, mentor } from '../mentor'
import { codeLanguage } from '../engine/diff'
import { AREA_COLORS, ago, code, md } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { loadSim } from './sim'

type Section = { key: string; title: string; body: string | RenderElement[] }

/** Krótki, rozróżnialny opis lekcji do listy wyboru. */
function lessonLabel(l: MentorLessonMeta, now: number): string {
  const name = (l.conceptIds[0] ? conceptById(l.conceptIds[0])?.name : undefined)?.replace(/\s*\(.*\)$/, '') ?? l.title
  const file = l.file ? l.file.split(/[\\/]/).pop() : 'terminal'
  return `${l.status === 'new' ? '● ' : ''}${name} · ${file} · ${ago(l.ts, now)}`
}

function analysisSections(k: Kit, l: MentorLesson): Section[] {
  const { Box, Text } = k.E
  const b = l.body
  const purpose: RenderElement[] = [
    md(k, b.problem),
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text color="suggestion" bold>
          HIPOTEZA
        </Text>
        <Text wrap="wrap">{b.purpose.likely}</Text>
      </Box>
      {b.purpose.confirmed ? (
        <Box flexDirection="row" columnGap={1}>
          <Text color="success" bold>
            POTWIERDZONE
          </Text>
          <Text wrap="wrap">{b.purpose.confirmed}</Text>
        </Box>
      ) : (
        <Text dimColor>Cel nie jest potwierdzony wprost: to wniosek z kodu.</Text>
      )}
    </Box>,
  ]
  return [
    { key: 'observed', title: 'Co zmieniono', body: b.observed },
    { key: 'where', title: 'Gdzie', body: b.where },
    { key: 'problem', title: 'Po co', body: purpose },
    { key: 'syntax', title: 'Składnia', body: b.syntax },
    { key: 'mechanism', title: 'Jak to działa pod spodem', body: b.mechanism },
    { key: 'deps', title: 'Zależności', body: b.dependencies },
    { key: 'why', title: 'Dlaczego tak', body: b.why },
    ...(b.alternatives !== b.why ? [{ key: 'alt', title: 'Alternatywy', body: b.alternatives }] : []),
    { key: 'pitfalls', title: 'Co może pójść nie tak', body: b.pitfalls },
    { key: 'verify', title: 'Jak to sprawdzić', body: b.verify },
  ]
}

function layerSections(l: MentorLesson): Section[] {
  const L = l.body.layers
  return [
    { key: 'l-intuition', title: '1 · Intuicja', body: L.intuition || '_Pominięta: znasz już podstawy tego pojęcia._' },
    { key: 'l-code', title: '2 · Twój kod', body: L.code },
    { key: 'l-mechanism', title: '3 · Mechanizm', body: L.mechanism },
    { key: 'l-why', title: '4 · Dlaczego', body: L.why },
    { key: 'l-practice', title: '5 · Gdzie się przyda', body: L.practice },
    { key: 'l-check', title: '6 · Sprawdź się', body: L.check },
  ]
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
    options.length > 0 ? (
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

  if (!lesson) {
    return (
      <Box flexDirection="column">
        {picker}
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginTop={1}>
          <Text bold>Brak otwartej lekcji</Text>
          <Text dimColor wrap="wrap">
            Lekcje powstają same po istotnych zmianach w kodzie albo na żądanie: /mentor explain.
          </Text>
        </Box>
        {job.state !== 'idle' && <Text color="suggestion">{job.message}</Text>}
      </Box>
    )
  }

  const b = lesson.body
  const main = lesson.conceptIds[0] ? conceptById(lesson.conceptIds[0]) : undefined
  const accent = (main && AREA_COLORS[main.area]) ?? 'claude'
  const isJs = b.lang === 'js' || b.lang === 'ts'
  const open = new Set(view.openSections)
  const toggle = (key: string) => () =>
    io.set(S.view, v => ({ ...v, openSections: v.openSections.includes(key) ? v.openSections.filter(x => x !== key) : [...v.openSections, key] }))
  const secs = view.lessonMode === 'points' ? analysisSections(k, lesson) : layerSections(lesson)
  const firstSentence = b.observed.split(/(?<=\.)\s/)[0] ?? b.observed
  const others = lesson.conceptIds.slice(1, 4).map(id => conceptById(id)?.name.replace(/\s*\(.*\)$/, '') ?? id)

  return (
    <Box flexDirection="column">
      {picker}

      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
        <Text bold wrap="wrap">
          {main?.name ?? lesson.title}
        </Text>
        <Text dimColor wrap="wrap">
          {`${lesson.file ? `${lesson.file}${lesson.line ? `:${lesson.line}` : ''} · ` : ''}${lesson.source === 'model' ? `AI ${lesson.model ?? ''}`.trim() : 'lekcja wbudowana'} · ${ago(lesson.ts, now)}`}
        </Text>
        <Box marginTop={1}>{md(k, firstSentence)}</Box>
        {others.length > 0 && <Text dimColor wrap="wrap">{`Też w tej zmianie: ${others.join(', ')}`}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
          <Button key="l-quiz" variant="primary" onPress={() => mentor.startQuiz(io, 'concept', lesson.conceptIds[0])}>
            Sprawdź, czy rozumiem
          </Button>
          {isJs && b.snippet && (
            <Button key="l-sim" plain dimColor onPress={() => loadSim(io, b.snippet, `lekcja: ${lesson.title}`)}>
              Symuluj
            </Button>
          )}
          <Button key="l-deep" plain dimColor onPress={() => mentor.requestLesson(io, lesson.conceptIds[0], true)}>
            Pogłęb
          </Button>
          {lesson.status !== 'read' && (
            <Button key="l-read" plain dimColor onPress={() => mentor.markRead(io)}>
              Przeczytane
            </Button>
          )}
        </Box>
      </Box>

      {b.missingPrereqs.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          <Text color="warning">Najpierw podstawy:</Text>
          {b.missingPrereqs.map(id => (
            <Button key={`pre-${id}`} plain onPress={() => mentor.requestLesson(io, id, false)}>
              {conceptById(id)?.name.replace(/\s*\(.*\)$/, '') ?? id}
            </Button>
          ))}
        </Box>
      )}

      {b.snippet ? <Box marginTop={1}>{code(k, b.snippet, codeLanguage(b.lang), b.snippetStart, b.file)}</Box> : null}

      <Box flexDirection="row" columnGap={1} marginTop={1}>
        <Button key="mode-points" variant={view.lessonMode === 'points' ? 'primary' : undefined} dimColor={view.lessonMode !== 'points'} onPress={() => io.set(S.view, v => ({ ...v, lessonMode: 'points' as const }))}>
          Analiza zmiany
        </Button>
        <Button key="mode-layers" variant={view.lessonMode === 'layers' ? 'primary' : undefined} dimColor={view.lessonMode !== 'layers'} onPress={() => io.set(S.view, v => ({ ...v, lessonMode: 'layers' as const }))}>
          Nauka warstwami
        </Button>
      </Box>

      {secs.map(s => {
        if (typeof s.body === 'string' && !s.body.trim()) return null
        const isOpen = open.has(s.key)
        return (
          <Box key={`sec-${s.key}`} flexDirection="column" marginTop={1}>
            <Button key={`sec-btn-${s.key}`} plain dimColor={!isOpen} onPress={toggle(s.key)}>
              {`${isOpen ? '▾' : '▸'}  ${s.title}`}
            </Button>
            {isOpen && (
              <Box flexDirection="column" paddingLeft={3}>
                {typeof s.body === 'string' ? md(k, s.body) : s.body}
              </Box>
            )}
          </Box>
        )
      })}

      {(b.uncertainty.length > 0 || b.simplifications.length > 0) && (
        <Box key="sec-unc" flexDirection="column" marginTop={1}>
          <Button key="sec-btn-unc" plain dimColor onPress={toggle('unc')}>
            {`${open.has('unc') ? '▾' : '▸'}  Niepewność i uproszczenia (${b.uncertainty.length + b.simplifications.length})`}
          </Button>
          {open.has('unc') && (
            <Box flexDirection="column" paddingLeft={3}>
              {b.uncertainty.map(u => (
                <Text dimColor wrap="wrap">{`• ${u}`}</Text>
              ))}
              {b.simplifications.map(u => (
                <Text dimColor wrap="wrap">{`≈ ${u}`}</Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {job.state === 'working' && (
        <Text color="suggestion" wrap="wrap">
          {job.message}
        </Text>
      )}
    </Box>
  )
}
