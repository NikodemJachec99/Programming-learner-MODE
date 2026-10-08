import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import { conceptById, mentor } from '../mentor'
import { levelName } from '../engine/lessons'
import { AREA_COLORS, AREA_NAMES, LEVEL_SHORT, LEVEL_THEME, ago, bar, card, levelBadge, md, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'

export async function renderKnowledge(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const knowledge = await io.get(S.knowledge)
  const mis = await io.get(S.misconceptions)
  const view = await io.get(S.view)
  const lessons = await io.get(S.lessons)
  const now = await io.now()
  const counts = [0, 1, 2, 3, 4].map(l => knowledge.filter(r => r.level === l).length)
  const seen = knowledge.filter(r => r.level > 0 || r.exposures > 0)
  const list = (view.knowledgeFilter < 0 ? seen : knowledge.filter(r => r.level === view.knowledgeFilter))
    .slice()
    .sort((a, b) => b.level - a.level || b.mastery - a.mastery || b.exposures - a.exposures)
  const active = mis.filter(m => !m.resolved).sort((a, b) => b.count - a.count)
  const detail = view.conceptDetail ? knowledge.find(r => r.id === view.conceptDetail) : undefined
  const dc = detail ? conceptById(detail.id) : undefined
  const graded = knowledge.reduce((s, r) => s + r.correct + r.incorrect, 0)
  const correct = knowledge.reduce((s, r) => s + r.correct, 0)

  return (
    <Box flexDirection="column">
      {section(
        k,
        'Podsumowanie',
        <Text>{`Lekcje: ${lessons.length} ostatnich · ocenione odpowiedzi: ${graded}${graded ? ` (${Math.round((correct / graded) * 100)}% poprawnych)` : ''} · powtórki do zrobienia: ${knowledge.filter(r => r.due).length}`}</Text>,
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {counts.map((n, l) => (
            <Text color={LEVEL_THEME[l]}>{`${LEVEL_SHORT[l]}: ${n}`}</Text>
          ))}
        </Box>,
        muted(k, 'Poziom rośnie tylko po ocenionych odpowiedziach. To, że Claude użył czegoś w projekcie, liczy się jako „spotkane”, nie jako wiedza.'),
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        <Button key="kf-all" variant={view.knowledgeFilter < 0 ? 'primary' : undefined} onPress={() => io.set(S.view, v => ({ ...v, knowledgeFilter: -1 }))}>
          {`Spotkane (${seen.length})`}
        </Button>
        {[0, 1, 2, 3, 4].map(l => (
          <Button key={`kf-${l}`} variant={view.knowledgeFilter === l ? 'primary' : undefined} onPress={() => io.set(S.view, v => ({ ...v, knowledgeFilter: l }))}>
            {`${levelName(l)} (${counts[l]})`}
          </Button>
        ))}
      </Box>

      {detail && dc &&
        card(
          k,
          AREA_COLORS[dc.area] ?? 'claude',
          <Text bold>{dc.name}</Text>,
          <Text dimColor>{`${AREA_NAMES[dc.area] ?? dc.area} · ${dc.langs.join(', ')}`}</Text>,
          <Text>{`Poziom: ${levelName(detail.level)} · opanowanie ${bar(detail.mastery)} ${Math.round(detail.mastery * 100)}% · pewność oceny ${Math.round(detail.confidence * 100)}%`}</Text>,
          <Text dimColor>{`Odpowiedzi: ${detail.correct} dobrych, ${detail.incorrect} złych · Claude użył w projektach: ${detail.exposures}× · ostatnia weryfikacja: ${detail.lastVerifiedAt ? ago(detail.lastVerifiedAt, now) : 'nigdy'}${detail.nextReviewAt ? ` · powtórka: ${detail.nextReviewAt <= now ? 'teraz' : `za ${Math.ceil((detail.nextReviewAt - now) / 86400000)} d`}` : ''}`}</Text>,
          dc.prereqs.length > 0 && <Text dimColor>{`Wymaga: ${dc.prereqs.map(p => `${conceptById(p)?.name ?? p} (${levelName(knowledge.find(r => r.id === p)?.level ?? 0)})`).join(', ')}`}</Text>,
          md(k, dc.intuition),
          ...mis.filter(m => m.conceptId === dc.id).map(m => <Text color={m.resolved ? 'success' : 'warning'}>{`${m.resolved ? '✓ przezwyciężone' : '! aktywne'}: ${m.description} (×${m.count})`}</Text>),
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="kd-quiz" variant="primary" onPress={() => mentor.startQuiz(io, 'concept', dc.id)}>
              Ćwiczenie
            </Button>
            <Button key="kd-lesson" onPress={() => mentor.requestLesson(io, dc.id, false)}>
              Lekcja
            </Button>
            <Button key="kd-known" onPress={() => mentor.selfReport(io, dc.id, true)}>
              Znam to
            </Button>
            <Button key="kd-unknown" onPress={() => mentor.selfReport(io, dc.id, false)}>
              Nie znam
            </Button>
            <Button key="kd-close" role="dismiss" onPress={() => io.set(S.view, v => ({ ...v, conceptDetail: null }))}>
              Zamknij
            </Button>
          </Box>,
          muted(k, '„Znam to” to tylko samoocena: ustawia punkt startowy, dopóki nie odpowiesz na pytanie.'),
        )}

      {section(
        k,
        view.knowledgeFilter < 0 ? 'Pojęcia, z którymi miałeś styczność' : levelName(view.knowledgeFilter),
        list.length === 0 ? muted(k, 'Pusto. Pojęcia pojawią się, gdy Claude zacznie ich używać albo gdy zrobisz ćwiczenia.') : null,
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
          'Aktywne błędne przekonania',
          ...active.slice(0, 8).map(m => (
            <Text color="warning" wrap="wrap">{`• ${conceptById(m.conceptId)?.name ?? m.conceptId}: ${m.description} (×${m.count})`}</Text>
          )),
          <Button key="k-mis" onPress={() => mentor.startQuiz(io, 'misconception')}>
            Przećwicz najczęstszy
          </Button>,
        )}
    </Box>
  )
}
