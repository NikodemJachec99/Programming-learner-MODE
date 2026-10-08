import type { RenderElement, RenderSurface } from 'claude-code'
import type { Host } from '../host'
import type { MentorTab } from '../../types'
import { conceptById } from '../mentor'
import type { El, Kit } from './kit'
import { renderKnowledge } from './knowledge'
import { renderLesson } from './lesson'
import { renderNow } from './now'
import { renderPath } from './path'
import { renderPractice } from './practice'
import { renderSettings } from './settings'
import { renderSim } from './sim'
import { S } from './state'

export const PANE_ID = 'mentor'
export const PANE_TITLE = 'Mentor'

const TABS: { id: MentorTab; label: string }[] = [
  { id: 'now', label: 'Teraz' },
  { id: 'lesson', label: 'Zrozum kod' },
  { id: 'sim', label: 'Symulator' },
  { id: 'practice', label: 'Ćwiczenia' },
  { id: 'knowledge', label: 'Moja wiedza' },
  { id: 'path', label: 'Ścieżka' },
  { id: 'settings', label: 'Ustawienia' },
]

export async function renderPane(io: Host, E: El, surface: RenderSurface, cols: number): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const k: Kit = { E, cols, surface }
  const tab = await io.get(S.tab)
  const unseen = await io.get(S.unseen)
  const quiz = await io.get(S.quiz)
  const settings = await io.get(S.settings)
  let body: RenderElement
  try {
    switch (tab) {
      case 'now':
        body = await renderNow(io, k)
        break
      case 'lesson':
        body = await renderLesson(io, k)
        break
      case 'sim':
        body = await renderSim(io, k)
        break
      case 'practice':
        body = await renderPractice(io, k)
        break
      case 'knowledge':
        body = await renderKnowledge(io, k)
        break
      case 'path':
        body = await renderPath(io, k)
        break
      default:
        body = await renderSettings(io, k)
    }
  } catch (e) {
    body = <Text color="error">{`Błąd widoku: ${e instanceof Error ? e.message : String(e)}`}</Text>
  }
  return (
    <Box flexDirection="column">
      {settings.paused && <Text color="warning">Pauza: automatyczne lekcje wstrzymane (/mentor resume)</Text>}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginBottom={1}>
        {TABS.map(t => {
          const badge = t.id === 'lesson' && unseen > 0 ? ` (${unseen})` : t.id === 'practice' && quiz?.status === 'asking' ? ' •' : ''
          return (
            <Button
              key={`tab-${t.id}`}
              variant={tab === t.id ? 'primary' : undefined}
              dimColor={tab !== t.id}
              onPress={async () => {
                await io.set(S.tab, () => t.id)
                if (t.id === 'lesson') await io.set(S.unseen, () => 0)
              }}
            >
              {t.label + badge}
            </Button>
          )
        })}
      </Box>
      {body}
    </Box>
  )
}

/** Dyskretny pasek nad promptem: bieżący temat nauki. */
export async function renderBand(io: Host, E: El): Promise<RenderElement | null> {
  const { Box, Text, Button } = E
  const settings = await io.get(S.settings)
  const focus = await io.get(S.focus)
  const unseen = await io.get(S.unseen)
  if (!settings.band || settings.paused || (!focus && !unseen)) return null
  const c = focus ? conceptById(focus.conceptId) : undefined
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>Mentor:</Text>
      <Text color="claude">{c ? c.name.replace(/\s*\(.*\)$/, '') : 'nowa lekcja'}</Text>
      {unseen > 0 && <Text dimColor>{`· nowe: ${unseen}`}</Text>}
      <Button
        key="band-open"
        plain
        dimColor
        onPress={async () => {
          await io.set(S.tab, () => (unseen ? 'lesson' : 'now') as MentorTab)
          await io.set(S.unseen, () => 0)
          await io.openPane()
        }}
      >
        [otwórz]
      </Button>
    </Box>
  )
}
