import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import { conceptById, mentor } from '../mentor'
import { levelName } from '../engine/lessons'
import type { Elements } from 'claude-code'
import { LEVEL_COLORS } from '../engine/graph'
import { AREA_COLORS, AREA_NAMES, LEVEL_SHORT, LEVEL_THEME, ago, bar, card, label, levelBadge, md, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { renderRecap } from './recap'
import { tr } from '../i18n'

export async function renderKnowledge(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const knowledge = await io.get(S.knowledge)
  const mis = await io.get(S.misconceptions)
  const view = await io.get(S.view)
  const lessons = await io.get(S.lessons)
  const now = await io.now()
  const seen = knowledge.filter(r => r.level > 0 || r.exposures > 0)
  // poziom 0 liczony tylko wśród spotkanych: reszta katalogu to nie jest „Twoja wiedza”
  const counts = [0, 1, 2, 3, 4].map(l => seen.filter(r => r.level === l).length)
  const levels = [0, 1, 2, 3, 4].filter(l => counts[l]! > 0)
  const list = (view.knowledgeFilter < 0 || !counts[view.knowledgeFilter] ? seen : seen.filter(r => r.level === view.knowledgeFilter))
    .slice()
    .sort((a, b) => b.level - a.level || b.mastery - a.mastery || b.exposures - a.exposures)
  const active = mis.filter(m => !m.resolved).sort((a, b) => b.count - a.count)
  const detail = view.conceptDetail ? knowledge.find(r => r.id === view.conceptDetail) : undefined
  const dc = detail ? conceptById(detail.id) : undefined
  const graded = knowledge.reduce((s, r) => s + r.correct + r.incorrect, 0)
  const correct = knowledge.reduce((s, r) => s + r.correct, 0)
  // podsumowanie ostatnich dni zawsze na górze „Mojej wiedzy” (także po /mentor recap)
  const recap = await renderRecap(io, k, false)

  return (
    <Box flexDirection="column">
      {recap}
      {label(k, tr('Twój postęp', 'Your progress'), `${counts[2]! + counts[3]! + counts[4]!} / ${knowledge.length} ${tr('rozumiesz', 'understood')}`)}
      {k.surface !== 'terminal'
        ? (() => {
            // Rozkład 79 pojęć na 5 poziomów jako jeden pasek; dymek z liczbą po najechaniu.
            const { Svg } = k.E as Elements['desktop']
            const w = Math.max(200, Math.min(560, k.cols * 7))
            const total = Math.max(1, knowledge.length)
            let x = 0
            const rects = [4, 3, 2, 1, 0]
              .map(l => {
                const width = (counts[l]! / total) * w
                const r = width > 0 ? `<g><title>${LEVEL_SHORT[l]}: ${counts[l]}</title><rect x="${x.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="10" rx="2" fill="${LEVEL_COLORS[l]}" fill-opacity="${l === 0 ? 0.35 : 0.9}"/></g>` : ''
                x += width
                return r
              })
              .join('')
            return <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10" viewBox="0 0 ${w} 10">${rects}</svg>`} alt={counts.map((n, l) => `${LEVEL_SHORT[l]} ${n}`).join(', ')} width={w} height={10} isInteractive />
          })()
        : <Text>{bar((counts[2]! + counts[3]! + counts[4]!) / Math.max(1, knowledge.length), 24)}</Text>}
      <Text wrap="wrap">
        {[4, 3, 2, 1, 0].map(l => (
          <Text>
            <Text color={LEVEL_THEME[l]}>■ </Text>
            <Text dimColor>{`${LEVEL_SHORT[l]} ${counts[l]}   `}</Text>
          </Text>
        ))}
      </Text>
      <Text dimColor wrap="wrap">
        {tr(`${graded} ocenionych odpowiedzi${graded ? `, ${Math.round((correct / graded) * 100)}% poprawnych` : ''} · ${knowledge.filter(r => r.due).length} powtórek do zrobienia · ${lessons.length} ostatnich lekcji`, `${graded} graded answers${graded ? `, ${Math.round((correct / graded) * 100)}% right` : ''} · ${knowledge.filter(r => r.due).length} reviews due · ${lessons.length} recent lessons`)}
      </Text>
      {levels.length > 1 && <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Button key="kf-all" variant={view.knowledgeFilter < 0 ? 'primary' : undefined} plain={view.knowledgeFilter < 0 ? undefined : true} dimColor={view.knowledgeFilter >= 0} onPress={() => io.set(S.view, v => ({ ...v, knowledgeFilter: -1 }))}>
          {`${tr('Spotkane', 'Seen')} (${seen.length})`}
        </Button>
        {levels.map(l => (
          <Button key={`kf-${l}`} variant={view.knowledgeFilter === l ? 'primary' : undefined} plain={view.knowledgeFilter === l ? undefined : true} dimColor={view.knowledgeFilter !== l} onPress={() => io.set(S.view, v => ({ ...v, knowledgeFilter: l }))}>
            {`${levelName(l)} (${counts[l]})`}
          </Button>
        ))}
      </Box>}

      {detail && dc &&
        card(
          k,
          AREA_COLORS[dc.area] ?? 'claude',
          <Text bold>{dc.name}</Text>,
          <Text dimColor>{`${AREA_NAMES[dc.area] ?? dc.area} · ${dc.langs.join(', ')}`}</Text>,
          <Text>{`${tr('Poziom', 'Level')}: ${levelName(detail.level)} · ${tr('opanowanie', 'mastery')} ${bar(detail.mastery)} ${Math.round(detail.mastery * 100)}% · ${tr('pewność oceny', 'confidence')} ${Math.round(detail.confidence * 100)}%`}</Text>,
          <Text dimColor>{tr(`Odpowiedzi: ${detail.correct} dobrych, ${detail.incorrect} złych · Claude użył w projektach: ${detail.exposures}× · ostatnia weryfikacja: ${detail.lastVerifiedAt ? ago(detail.lastVerifiedAt, now) : 'nigdy'}${detail.nextReviewAt ? ` · powtórka: ${detail.nextReviewAt <= now ? 'teraz' : `za ${Math.ceil((detail.nextReviewAt - now) / 86400000)} d`}` : ''}`, `Answers: ${detail.correct} right, ${detail.incorrect} wrong · Claude used it in projects: ${detail.exposures}× · last verified: ${detail.lastVerifiedAt ? ago(detail.lastVerifiedAt, now) : 'never'}${detail.nextReviewAt ? ` · review: ${detail.nextReviewAt <= now ? 'now' : `in ${Math.ceil((detail.nextReviewAt - now) / 86400000)} d`}` : ''}`)}</Text>,
          dc.prereqs.length > 0 && <Text dimColor>{`${tr('Wymaga', 'Requires')}: ${dc.prereqs.map(p => `${conceptById(p)?.name ?? p} (${levelName(knowledge.find(r => r.id === p)?.level ?? 0)})`).join(', ')}`}</Text>,
          md(k, dc.intuition),
          ...mis.filter(m => m.conceptId === dc.id).map(m => <Text color={m.resolved ? 'success' : 'warning'}>{`${m.resolved ? tr('✓ przezwyciężone', '✓ overcome') : tr('! aktywne', '! active')}: ${m.description} (×${m.count})`}</Text>),
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="kd-quiz" variant="primary" onPress={() => mentor.quiz.startQuiz(io, 'concept', dc.id)}>
              {tr('Ćwiczenie', 'Exercise')}
            </Button>
            <Button key="kd-lesson" onPress={() => mentor.requestLesson(io, dc.id, false)}>
              {tr('Lekcja', 'Lesson')}
            </Button>
            <Button key="kd-known" onPress={() => mentor.quiz.selfReport(io, dc.id, true)}>
              {tr('Znam to', 'I know this')}
            </Button>
            <Button key="kd-unknown" onPress={() => mentor.quiz.selfReport(io, dc.id, false)}>
              {tr('Nie znam', 'I don’t know')}
            </Button>
            <Button key="kd-close" role="dismiss" onPress={() => io.set(S.view, v => ({ ...v, conceptDetail: null }))}>
              {tr('Zamknij', 'Close')}
            </Button>
          </Box>,
          muted(k, tr('„Znam to” to tylko samoocena: ustawia punkt startowy, dopóki nie odpowiesz na pytanie.', '“I know this” is only self-assessment: it sets a starting point until you answer a question.')),
        )}

      {section(
        k,
        view.knowledgeFilter < 0 || !counts[view.knowledgeFilter] ? tr('Pojęcia, z którymi miałeś styczność', 'Concepts you have come across') : levelName(view.knowledgeFilter),
        list.length === 0 ? muted(k, tr('Pusto. Pojęcia pojawią się, gdy Claude zacznie ich używać albo gdy zrobisz ćwiczenia.', 'Empty. Concepts show up once Claude starts using them or you do exercises.')) : null,
        ...list.slice(0, 40).map(r => (
          <Box key={`k-${r.id}`} flexDirection="row" columnGap={1}>
            {levelBadge(k, r.level)}
            <Button key={`kb-${r.id}`} plain onPress={() => io.set(S.view, v => ({ ...v, conceptDetail: r.id }))}>
              {r.name.replace(/\s*\(.*\)$/, '')}
            </Button>
            <Text dimColor>{`${bar(r.mastery, 6)}${r.due ? ' ⟳' : ''}${r.exposures ? ` ·${r.exposures}×` : ''}`}</Text>
          </Box>
        )),
      )}

      {active.length > 0 &&
        section(
          k,
          tr('Aktywne błędne przekonania', 'Active misconceptions'),
          ...active.slice(0, 8).map(m => (
            <Text color="warning" wrap="wrap">{`• ${conceptById(m.conceptId)?.name ?? m.conceptId}: ${m.description} (×${m.count})`}</Text>
          )),
          <Button key="k-mis" onPress={() => mentor.quiz.startQuiz(io, 'misconception')}>
            {tr('Przećwicz najczęstszy', 'Practice the most common one')}
          </Button>,
        )}
    </Box>
  )
}
