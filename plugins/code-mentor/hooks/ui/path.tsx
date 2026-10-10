import type { Elements, RenderElement } from 'claude-code'
import type { Host } from '../host'
import { CONCEPTS } from '../content/concepts'
import { mentor } from '../mentor'
import { graphSvg, recommend } from '../engine/graph'
import { BASIC_CONCEPTS } from '../engine/change'
import { levelName } from '../engine/lessons'
import { AREA_COLORS, AREA_NAMES, LEVEL_SHORT, bar, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { tr } from '../i18n'

export async function renderPath(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button } = k.E
  const knowledge = await io.get(S.knowledge)
  const feed = await io.get(S.feed)
  const view = await io.get(S.view)
  const projectCounts: Record<string, number> = {}
  for (const o of feed) for (const c of o.concepts) projectCounts[c] = (projectCounts[c] ?? 0) + 1
  for (const r of knowledge) if (r.inProject) projectCounts[r.id] = Math.max(projectCounts[r.id] ?? 0, r.inProject)
  const placement = await io.get(S.placement)
  // przed testem poziomu nie wiemy, co umiesz: nie polecamy podstaw na ślepo
  const untested = placement.status === 'none'
  const recs = recommend(CONCEPTS, knowledge, projectCounts, untested ? 12 : 6)
    .filter(r => !untested || !BASIC_CONCEPTS.has(r.id) || r.kind === 'review')
    .slice(0, 6)
  const lv = new Map(knowledge.map(r => [r.id, r]))
  const areas = [...new Set(CONCEPTS.map(c => c.area))]

  let graph: RenderElement | null = null
  if (view.pathMode === 'graph') {
    const focusIds = [...new Set([...recs.map(r => r.id), ...knowledge.filter(r => r.level > 0 || r.exposures > 0).map(r => r.id), ...Object.keys(projectCounts)])]
    const ids = focusIds.length ? focusIds : ['functions', 'async-await', 'sql-join', 'unit-tests']
    const g = graphSvg(CONCEPTS, knowledge, ids, recs.map(r => r.id), Math.max(320, k.cols * 8))
    if (k.surface === 'desktop' || k.surface === 'vscode' || k.surface === 'mobile') {
      const { Svg } = k.E as Elements['desktop']
      graph = <Svg source={g.svg} alt={tr(`Graf ${g.count} pojęć: kolor to poziom znajomości, grubsza ramka to rekomendacja.`, `Graph of ${g.count} concepts: color is your level, a thicker frame is a recommendation.`)} isInteractive />
    } else {
      graph = muted(k, tr('Ten interfejs nie rysuje grafiki SVG: przełącz na listę.', 'This surface does not draw SVG graphics: switch to the list.'))
    }
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Button key="pm-list" variant={view.pathMode === 'list' ? 'primary' : undefined} onPress={() => io.set(S.view, v => ({ ...v, pathMode: 'list' as const }))}>
          {tr('Lista', 'List')}
        </Button>
        <Button key="pm-graph" variant={view.pathMode === 'graph' ? 'primary' : undefined} onPress={() => io.set(S.view, v => ({ ...v, pathMode: 'graph' as const }))}>
          {tr('Graf zależności', 'Dependency graph')}
        </Button>
      </Box>

      {untested && (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap" marginTop={1}>
          <Text wrap="wrap">{tr('Nie wiem jeszcze, co umiesz. Test poziomu ma 6 pytań.', 'I don’t know yet what you know. The level test has 6 questions.')}</Text>
          <Button key="path-placement" variant="primary" onPress={() => mentor.quiz.startPlacement(io)}>
            {tr('Zrób test', 'Take the test')}
          </Button>
        </Box>
      )}
      {section(
        k,
        tr('Następne kroki', 'Next steps'),
        recs.length === 0 ? muted(k, tr('Brak rekomendacji: zrób kilka ćwiczeń albo poczekaj na zmiany w kodzie.', 'No recommendations: do a few exercises or wait for code changes.')) : null,
        ...recs.map(r => (
          <Box key={`rec-${r.id}`} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" columnGap={1}>
              <Text color={r.kind === 'review' ? 'warning' : r.kind === 'foundation' ? 'permission' : 'suggestion'}>{r.kind === 'review' ? '⟳' : r.kind === 'foundation' ? '▲' : '→'}</Text>
              <Button key={`rec-b-${r.id}`} plain onPress={() => (r.kind === 'review' ? mentor.quiz.startQuiz(io, 'concept', r.id) : mentor.requestLesson(io, r.id, false))}>
                {r.name}
              </Button>
            </Box>
            <Text dimColor wrap="wrap">{r.reason}</Text>
          </Box>
        )),
      )}

      {graph &&
        section(
          k,
          tr('Mapa pojęć z Twojego projektu', 'Concept map of your project'),
          graph,
          <Text wrap="wrap">
            {[0, 1, 2, 3, 4].map(i0 => LEVEL_SHORT[i0]!).map((name, i) => (
              <Text key={`lg-${i}`}>
                <Text color={['inactive', 'suggestion', 'permission', 'warning', 'success'][i]}>●</Text>
                <Text dimColor>{` ${name}   `}</Text>
              </Text>
            ))}
          </Text>,
          <Text dimColor wrap="wrap">{tr('Pomarańczowa ramka: polecane teraz. Strzałka: najpierw to, potem tamto. Najedź na pojęcie, żeby zobaczyć poziom.', 'Orange frame: recommended now. Arrow: this first, then that. Hover a concept to see your level.')}</Text>,
        )}

      {section(
        k,
        tr('Mapa kompetencji', 'Skills map'),
        ...areas.map(a => {
          const cs = CONCEPTS.filter(c => c.area === a)
          const avg = cs.reduce((s, c) => s + (lv.get(c.id)?.mastery ?? 0), 0) / cs.length
          const atLeast2 = cs.filter(c => (lv.get(c.id)?.level ?? 0) >= 2).length
          const used = cs.reduce((s, c) => s + (projectCounts[c.id] ?? 0), 0)
          return (
            <Box key={`area-${a}`} flexDirection="row" columnGap={1}>
              <Text color={AREA_COLORS[a] ?? 'subtle'}>{(AREA_NAMES[a] ?? a).padEnd(24).slice(0, 24)}</Text>
              <Text>{bar(avg, 8)}</Text>
              <Text dimColor>{`${atLeast2}/${cs.length}${used ? ` · ${tr('w projekcie', 'in project')} ${used}×` : ''}`}</Text>
            </Box>
          )
        }),
        muted(k, tr(`Liczba po pasku: pojęcia na poziomie co najmniej „${levelName(2)}”.`, `Number after the bar: concepts at level “${levelName(2)}” or higher.`)),
      )}
    </Box>
  )
}
