// Podsumowanie nauki z ostatnich dni: co poszło w górę, odpowiedzi, lekcje, zadania, co wraca do
// powtórki i otwarte błędy w rozumowaniu. W Zmianach pokazuje się samo co kilka dni, w „Mojej wiedzy”
// zawsze. Same liczby z bazy, bez wywołań modelu.

import type { RenderElement } from 'claude-code'
import type { MentorRecap } from '../../types'
import type { Host } from '../host'
import { levelName } from '../engine/lessons'
import { RECAP_DAYS, RECAP_EVERY_DAYS, conceptById, mentor } from '../mentor'
import type { Kit } from './kit'
import { S } from './state'
import { plural, tr } from '../i18n'

const name = (id: string) => conceptById(id)?.name.replace(/\s*\(.*\)$/, '') ?? id

/** Czy w podsumowaniu jest coś do pokazania. */
export function recapHasContent(r: MentorRecap | null): r is MentorRecap {
  if (!r) return false
  return r.up.length > 0 || r.answers.correct + r.answers.partial + r.answers.incorrect > 0 || r.lessons.total > 0 || r.due.length > 0 || r.openMisconceptions > 0
}

/** Czy karta ma się pokazać sama: jest treść i minęło co najmniej kilka dni od zamknięcia. */
export function recapDue(r: { data: MentorRecap | null; seenAt: number }, now: number): boolean {
  return recapHasContent(r.data) && now - r.seenAt >= RECAP_EVERY_DAYS * 86_400_000
}

/** Karta podsumowania. `closable`: z przyciskiem „Zamknij” (w Zmianach). */
export async function renderRecap(io: Host, k: Kit, closable: boolean): Promise<RenderElement | null> {
  const { Box, Text, Button } = k.E
  const { data: r } = await io.get(S.recap)
  if (!recapHasContent(r)) return null
  const a = r.answers
  const answered = a.correct + a.partial + a.incorrect
  return (
    <Box key="recap" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="claude">
          {tr('PODSUMOWANIE', 'RECAP')}
        </Text>
        <Text dimColor>{tr(`ostatnie ${RECAP_DAYS} dni`, `last ${RECAP_DAYS} days`)}</Text>
      </Box>
      {r.up.length > 0 && (
        <Text wrap="wrap">
          <Text bold>{tr('Poszło w górę: ', 'Went up: ')}</Text>
          <Text>{r.up.map(u => `${name(u.id)} (${levelName(u.from)} → ${levelName(u.to)})`).join(', ')}</Text>
        </Text>
      )}
      {answered > 0 && (
        <Text>
          <Text bold>{tr('Odpowiedzi: ', 'Answers: ')}</Text>
          <Text color="success">{`${a.correct} ${tr('dobrze', 'right')}`}</Text>
          {a.partial > 0 && <Text color="warning">{`, ${a.partial} ${tr('częściowo', 'partly')}`}</Text>}
          <Text color={a.incorrect ? 'error' : undefined} dimColor={!a.incorrect}>{`, ${a.incorrect} ${tr('źle', 'wrong')}`}</Text>
        </Text>
      )}
      {(r.lessons.total > 0 || r.tasks.tasks > 0) && (
        <Text dimColor wrap="wrap">
          {[r.tasks.tasks ? `${r.tasks.tasks} ${plural(r.tasks.tasks, ['zadanie', 'zadania', 'zadań'], ['task', 'tasks'])} ${tr('z kodem', 'with code')}` : '', r.lessons.total ? tr(`lekcje: ${r.lessons.read} przeczytane z ${r.lessons.total}`, `lessons: ${r.lessons.read} of ${r.lessons.total} read`) : ''].filter(Boolean).join(' · ')}
        </Text>
      )}
      {r.due.length > 0 && (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center">
          <Text bold>{tr('Do powtórki:', 'Due for review:')}</Text>
          <Text wrap="wrap">{r.due.map(name).join(', ')}</Text>
          <Button key="recap-review" plain onPress={() => mentor.quiz.startQuiz(io, 'review')}>
            {tr('Powtórz teraz →', 'Review now →')}
          </Button>
        </Box>
      )}
      {r.openMisconceptions > 0 && (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text color="warning">{`${tr('Błędy w rozumowaniu do poprawy', 'Misconceptions to fix')}: ${r.openMisconceptions}`}</Text>
          <Button key="recap-mis" plain dimColor onPress={() => mentor.quiz.startQuiz(io, 'misconception')}>
            {tr('Ćwicz →', 'Practice →')}
          </Button>
        </Box>
      )}
      {closable && (
        <Button key="recap-close" plain dimColor onPress={() => mentor.dismissRecap(io)}>
          {tr('Zamknij', 'Close')}
        </Button>
      )}
    </Box>
  )
}
