import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorObservation } from '../../types'
import { conceptById, mentor } from '../mentor'
import { recommend } from '../engine/graph'
import { levelName } from '../engine/lessons'
import { CONCEPTS } from '../content/concepts'
import { ago, badge, label, panel, shortName, shortPath, tags } from './kit'
import type { Kit } from './kit'
import { S } from './state'

const FEED_COLLAPSED = 6

/** Jedna zmiana: plakietka, plik, +/−, czas; pod spodem pojęcia (przygaszone). */
function feedRow(k: Kit, o: MentorObservation, now: number): RenderElement {
  const { Box, Text } = k.E
  const where = o.file ? `${shortPath(o.file, 34)}${o.line ? `:${o.line}` : ''}` : o.summary
  const names = o.concepts.map(id => conceptById(id)).filter(c => c !== undefined).map(c => shortName(c.name))
  return (
    <Box key={`feed-${o.id}`} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" columnGap={1}>
        {badge(k, o.kind, o.failed)}
        <Box flexGrow={1} flexShrink={1}>
          <Text bold wrap="truncate-end">
            {where}
          </Text>
        </Box>
        {o.added > 0 && <Text color="diffAdded">{`+${o.added}`}</Text>}
        {o.removed > 0 && <Text color="diffRemoved">{`−${o.removed}`}</Text>}
        <Text dimColor>{ago(o.ts, now)}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={8}>
        {o.file === null || o.kind === 'error' || o.kind === 'fix' ? <Text dimColor wrap="wrap">{o.summary}</Text> : null}
        {o.preexisting && <Text color="warning">plik miał zmiany sprzed sesji, liczy się tylko zmiana Claude</Text>}
        {tags(k, names)}
      </Box>
    </Box>
  )
}

export async function renderNow(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const boot = await io.get(S.boot)
  const feed = await io.get(S.feed)
  const focus = await io.get(S.focus)
  const job = await io.get(S.job)
  const knowledge = await io.get(S.knowledge)
  const settings = await io.get(S.settings)
  const view = await io.get(S.view)
  const lessons = await io.get(S.lessons)
  const now = await io.now()
  const due = knowledge.filter(r => r.due)
  const levels = Object.fromEntries(knowledge.map(r => [r.id, r.level]))
  const counts: Record<string, number> = {}
  for (const o of feed) for (const c of o.concepts) counts[c] = (counts[c] ?? 0) + 1
  const mechanisms = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const focusConcept = focus ? conceptById(focus.conceptId) : undefined
  const recs = recommend(CONCEPTS, knowledge, counts, 3)
  const shownFeed = view.feedExpanded ? feed : feed.slice(0, FEED_COLLAPSED)
  const lastLesson = lessons[0]

  const status = settings.paused ? { text: 'pauza', color: 'warning' } : settings.autoTeach ? { text: 'nauka automatyczna', color: 'success' } : { text: 'tylko na żądanie', color: 'subtle' }

  return (
    <Box flexDirection="column">
      {/* kontekst: projekt i tryb, jedna cicha linia */}
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor wrap="truncate-end">
          {boot.project ? shortPath(boot.project.root, 30) : '—'}
        </Text>
        <Text color={status.color}>●</Text>
        <Text dimColor>{status.text}</Text>
      </Box>

      {boot.status !== 'ready' &&
        panel(
          k,
          false,
          <Text color={boot.status === 'starting' ? 'subtle' : 'warning'}>{boot.status === 'starting' ? 'Uruchamiam bazę wiedzy…' : 'Tryb awaryjny: zapisy czekają w buforze'}</Text>,
          ...boot.messages.slice(0, 3).map(m => (
            <Text dimColor wrap="wrap">
              {m}
            </Text>
          )),
        )}

      {/* najważniejsza rzecz teraz: jedyny akcent na ekranie */}
      {focus && focusConcept
        ? panel(
            k,
            true,
            <Text dimColor bold>
              NAJWAŻNIEJSZE TERAZ
            </Text>,
            <Text bold wrap="wrap">
              {shortName(focusConcept.name)}
            </Text>,
            <Text dimColor wrap="wrap">
              {[focus.file ? `${shortPath(focus.file, 30)}${focus.line ? `:${focus.line}` : ''}` : null, `Twój poziom: ${levelName(levels[focusConcept.id] ?? 0).toLowerCase()}`].filter(Boolean).join(' · ')}
            </Text>,
            focus.missingPrereqs.length > 0 && (
              <Text color="warning" wrap="wrap">
                {`Najpierw: ${focus.missingPrereqs.map(id => shortName(conceptById(id)?.name ?? id)).join(' · ')}`}
              </Text>
            ),
            <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
              <Button key="now-lesson" variant="primary" onPress={() => mentor.requestLesson(io, focus.conceptId, false)}>
                Wyjaśnij
              </Button>
              <Button key="now-quiz" plain dimColor onPress={() => mentor.startQuiz(io, 'concept', focus.conceptId)}>
                Sprawdź się
              </Button>
              <Button key="now-sim" plain dimColor onPress={() => io.set(S.tab, () => 'sim' as const)}>
                Symulator
              </Button>
            </Box>,
          )
        : panel(
            k,
            false,
            <Text bold>Gotowe do nauki</Text>,
            <Text dimColor wrap="wrap">
              Gdy Claude zmieni kod, zobaczysz tu, co się stało i co warto zrozumieć.
            </Text>,
          )}

      {/* stan pracy: jedna linia */}
      {job.state === 'working' || job.state === 'queued' ? (
        <Text color="suggestion" wrap="wrap">{`${job.state === 'working' ? '◌' : '…'} ${job.message}`}</Text>
      ) : job.state === 'error' ? (
        <Text color="error" wrap="wrap">{job.message}</Text>
      ) : lastLesson && now - lastLesson.ts < 30 * 60000 ? (
        <Box flexDirection="row" columnGap={1}>
          <Text color="success">✓</Text>
          <Text dimColor wrap="truncate-end">{`Gotowa lekcja: ${shortName(conceptById(lastLesson.conceptIds[0] ?? '')?.name ?? lastLesson.title)}`}</Text>
          <Button key="now-open-lesson" plain onPress={() => mentor.openLesson(io, lastLesson.id)}>
            Otwórz
          </Button>
        </Box>
      ) : null}

      {due.length > 0 && (
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Text color="warning">{`${due.length} ${due.length === 1 ? 'powtórka czeka' : 'powtórki czekają'}`}</Text>
          <Button key="now-review" plain onPress={() => mentor.startQuiz(io, 'review')}>
            Zrób teraz
          </Button>
        </Box>
      )}

      {mechanisms.length > 0 && label(k, 'W tej sesji')}
      {mechanisms.length > 0 && (
        <Text wrap="wrap">
          {mechanisms.map(([id, n], i) => {
            const c = conceptById(id)
            return (
              <Text>
                <Text>{c ? shortName(c.name) : id}</Text>
                <Text dimColor>{` ${n}${i < mechanisms.length - 1 ? '   ' : ''}`}</Text>
              </Text>
            )
          })}
        </Text>
      )}

      {label(k, 'Ostatnie zmiany', feed.length ? String(feed.length) : undefined)}
      {feed.length === 0 ? (
        <Text dimColor>Jeszcze nic w tej sesji.</Text>
      ) : (
        <Box flexDirection="column">{shownFeed.map(o => feedRow(k, o, now))}</Box>
      )}
      {feed.length > FEED_COLLAPSED && (
        <Box marginTop={1}>
          <Button key="feed-toggle" plain dimColor onPress={() => io.set(S.view, v => ({ ...v, feedExpanded: !v.feedExpanded }))}>
            {view.feedExpanded ? 'Zwiń' : `Pokaż wszystkie (${feed.length})`}
          </Button>
        </Box>
      )}

      {!focus && recs.length > 0 && label(k, 'Następne kroki')}
      {!focus &&
        recs.map(r => (
          <Box key={`rec-${r.id}`} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" columnGap={1}>
              <Text bold>{shortName(r.name)}</Text>
              <Button key={`rec-go-${r.id}`} plain dimColor onPress={() => mentor.requestLesson(io, r.id, false)}>
                Lekcja
              </Button>
            </Box>
            <Text dimColor wrap="wrap">
              {r.reason}
            </Text>
          </Box>
        ))}
    </Box>
  )
}
