import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorTab } from '../../types'
import { conceptById, mentor } from '../mentor'
import { recommend } from '../engine/graph'
import { CONCEPTS } from '../content/concepts'
import { AREA_COLORS, KIND_ICON, ago, card, conceptChip, muted, section, shortPath } from './kit'
import type { Kit } from './kit'
import { S } from './state'

export async function renderNow(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const boot = await io.get(S.boot)
  const feed = await io.get(S.feed)
  const focus = await io.get(S.focus)
  const job = await io.get(S.job)
  const knowledge = await io.get(S.knowledge)
  const settings = await io.get(S.settings)
  const now = await io.now()
  const go = (tab: MentorTab) => () => io.set(S.tab, () => tab)
  const due = knowledge.filter(r => r.due)
  const focusConcept = focus ? conceptById(focus.conceptId) : undefined
  const projectCounts: Record<string, number> = {}
  for (const o of feed) for (const c of o.concepts) projectCounts[c] = (projectCounts[c] ?? 0) + 1
  const mechanisms = Object.entries(projectCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const recs = focus ? [] : recommend(CONCEPTS, knowledge, projectCounts, 3)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text dimColor>Projekt:</Text>
        <Text bold>{boot.project?.name ?? '—'}</Text>
        <Text dimColor>{boot.project?.isGit ? '(git)' : ''}</Text>
        <Text color={settings.paused ? 'warning' : settings.autoTeach ? 'success' : 'inactive'}>{settings.paused ? '● pauza' : settings.autoTeach ? '● nauka automatyczna' : '○ tylko na żądanie'}</Text>
      </Box>
      {boot.status !== 'ready' && card(k, boot.status === 'starting' ? 'subtle' : 'warning', <Text color={boot.status === 'starting' ? 'subtle' : 'warning'}>{boot.status === 'starting' ? 'Uruchamiam bazę wiedzy…' : 'Tryb awaryjny'}</Text>, ...boot.messages.map(m => muted(k, m)))}

      {focus && focusConcept
        ? card(
            k,
            AREA_COLORS[focusConcept.area] ?? 'claude',
            <Text bold>Najważniejsze teraz: {focusConcept.name}</Text>,
            <Text>{focus.reason}</Text>,
            focus.missingPrereqs.length > 0 && <Text color="warning">Brakujące podstawy: {focus.missingPrereqs.map(id => conceptById(id)?.name ?? id).join(', ')}</Text>,
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
              <Button key="now-lesson" variant="primary" onPress={() => mentor.requestLesson(io, focus.conceptId, false)}>
                Wyjaśnij
              </Button>
              <Button key="now-quiz" onPress={() => mentor.startQuiz(io, 'concept', focus.conceptId)}>
                Sprawdź, czy rozumiem
              </Button>
              <Button key="now-sim" onPress={go('sim')}>
                Symulator
              </Button>
            </Box>,
          )
        : card(k, 'subtle', <Text>Czekam na zmiany w kodzie.</Text>, muted(k, 'Gdy Claude utworzy albo zmieni plik, uruchomi testy lub doda zależność, zobaczysz tu, co się stało i co warto zrozumieć.'))}

      {job.state !== 'idle' || job.message
        ? <Text color={job.state === 'error' ? 'error' : job.state === 'idle' ? 'success' : 'suggestion'}>{job.state === 'working' ? '⟳ ' : job.state === 'queued' ? '… ' : job.state === 'error' ? '✗ ' : '✓ '}{job.message}</Text>
        : null}

      {due.length > 0 && (
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Text color="warning">Powtórki do zrobienia: {due.length}</Text>
          <Button key="now-review" onPress={() => mentor.startQuiz(io, 'review')}>
            Powtórz teraz
          </Button>
        </Box>
      )}

      {mechanisms.length > 0 &&
        section(
          k,
          'Mechanizmy w tej sesji',
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {mechanisms.map(([id, n]) => {
              const c = conceptById(id)
              return c ? <Text color={AREA_COLORS[c.area] ?? 'subtle'}>{`◆ ${c.name.replace(/\s*\(.*\)$/, '')} ×${n}`}</Text> : null
            })}
          </Box>,
        )}

      {section(
        k,
        `Ostatnie operacje Claude (${feed.length})`,
        feed.length === 0 ? muted(k, 'Brak operacji w tej sesji.') : null,
        ...feed.slice(0, 12).map(o => (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" columnGap={1} flexWrap="wrap">
              <Text color={o.failed || o.kind === 'error' ? 'error' : o.kind === 'fix' ? 'success' : 'subtle'}>{KIND_ICON[o.kind] ?? '•'}</Text>
              <Text bold>{o.file ? `${shortPath(o.file)}${o.line ? `:${o.line}` : ''}` : o.tool}</Text>
              {o.added + o.removed > 0 && <Text color="diffAdded">{`+${o.added}`}</Text>}
              {o.removed > 0 && <Text color="diffRemoved">{`−${o.removed}`}</Text>}
              <Text dimColor>{ago(o.ts, now)}</Text>
            </Box>
            <Text dimColor wrap="wrap">
              {o.summary}
            </Text>
            {o.preexisting && <Text color="warning">plik miał zmiany sprzed sesji: analizuję tylko zmianę Claude</Text>}
            {o.concepts.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                {o.concepts.slice(0, 5).map(id => {
                  const c = conceptById(id)
                  return c ? conceptChip(k, c.name, c.area) : null
                })}
              </Box>
            )}
          </Box>
        )),
      )}

      {recs.length > 0 &&
        section(
          k,
          'Na spokojnie: co warto poznać',
          ...recs.map(r => (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{r.name}</Text>
              <Text dimColor>{r.reason}</Text>
            </Box>
          )),
        )}
    </Box>
  )
}
