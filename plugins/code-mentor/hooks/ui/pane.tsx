import type { RenderElement, RenderSurface } from 'claude-code'
import type { Host } from '../host'
import type { MentorTab } from '../../types'
import { conceptById, mentor } from '../mentor'
import type { El, Kit } from './kit'
import { renderChanges } from './changes'
import { renderKnowledge } from './knowledge'
import { renderLesson } from './lesson'
import { renderPath } from './path'
import { renderPractice } from './practice'
import { renderSettings } from './settings'
import { renderSim } from './sim'
import { S } from './state'
import { MENTOR_VERSION, isNewer } from '../version'
import { tr } from '../i18n'

export const PANE_ID = 'mentor'
export const PANE_TITLE = `Claude Code Mentor ${MENTOR_VERSION}`

/** Trzy główne zakładki w pasku; reszta w menu "Więcej". Wszystko zaczyna się od Zmian. */
const TABS = (): { id: MentorTab; label: string }[] => [
  { id: 'changes', label: tr('Zmiany', 'Changes') },
  { id: 'practice', label: tr('Ćwiczenia', 'Practice') },
  { id: 'sim', label: tr('Symulator', 'Simulator') },
]
const MORE = (): { id: MentorTab; label: string }[] => [
  { id: 'lesson', label: tr('Lekcje', 'Lessons') },
  { id: 'knowledge', label: tr('Moja wiedza', 'My knowledge') },
  { id: 'path', label: tr('Ścieżka nauki', 'Learning path') },
  { id: 'settings', label: tr('Ustawienia', 'Settings') },
]

export async function renderPane(io: Host, E: El, surface: RenderSurface, cols: number): Promise<RenderElement> {
  const { Box, Text, Button, Select } = E
  const k: Kit = { E, cols, surface }
  const tab = await io.get(S.tab)
  const unseen = await io.get(S.unseen)
  const quiz = await io.get(S.quiz)
  const settings = await io.get(S.settings)
  const boot = await io.get(S.boot)
  const stale = !!boot.installedVersion && isNewer(boot.installedVersion, MENTOR_VERSION)
  // harmonogram animacji: na desktopie ruch robi CSS, w terminalu klatki tekstu
  mentor.anim.lastSurface = surface
  const flash = await io.get(S.flash)
  const flashOn = !!flash && flash.until > (await io.now())
  let body: RenderElement
  try {
    switch (tab) {
      case 'changes':
      case 'now':
        body = await renderChanges(io, k)
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
    body = <Text color="error">{`${tr('Błąd widoku', 'View error')}: ${e instanceof Error ? e.message : String(e)}`}</Text>
  }
  return (
    <Box flexDirection="column">
      {stale && <Text color="warning" wrap="wrap">{tr(`Zainstalowana jest nowsza wersja ${boot.installedVersion}, a ta sesja działa na ${MENTOR_VERSION}. Wpisz /reload-plugins albo otwórz nową sesję.`, `Version ${boot.installedVersion} is installed, but this session runs ${MENTOR_VERSION}. Type /reload-plugins or open a new session.`)}</Text>}
      {flashOn && (
        <Text color={flash!.tone === 'ok' ? 'success' : 'error'} wrap="wrap">
          {`${flash!.tone === 'ok' ? '✓' : '✗'} ${flash!.text}`}
        </Text>
      )}
      {settings.paused && <Text color="warning">{tr('Pauza: automatyczne lekcje wstrzymane (/mentor resume)', 'Paused: automatic lessons are off (/mentor resume)')}</Text>}
      <Box flexDirection="row" flexWrap="nowrap" columnGap={1} alignItems="center" marginBottom={1}>
        {TABS().map(t => {
          const badge = t.id === 'practice' && quiz?.status === 'asking' ? ' •' : ''
          const active = tab === t.id
          return (
            <Button
              key={`tab-${t.id}`}
              variant={active ? 'primary' : undefined}
              plain={active ? undefined : true}
              dimColor={!active}
              onPress={() => io.set(S.tab, () => t.id)}
            >
              {t.label + badge}
            </Button>
          )
        })}
        <Select
          key="tab-more"
          value={MORE().some(m => m.id === tab) ? tab : 'more'}
          options={[{ value: 'more', label: unseen > 0 ? tr(`Więcej · nowe: ${unseen}`, `More · new: ${unseen}`) : tr('Więcej', 'More') }, ...MORE().map(m => ({ value: m.id, label: m.id === 'lesson' && unseen > 0 ? `${m.label} (${unseen})` : m.label }))]}
          onSelect={async v => {
            if (v === 'more') return
            await io.set(S.tab, () => v as MentorTab)
            if (v === 'lesson') await io.set(S.unseen, () => 0)
          }}
        />
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
      <Text color="claude">{c ? c.name.replace(/\s*\(.*\)$/, '') : tr('nowa lekcja', 'new lesson')}</Text>
      {unseen > 0 && <Text dimColor>{`· ${tr('nowe', 'new')}: ${unseen}`}</Text>}
      <Button
        key="band-open"
        plain
        dimColor
        onPress={async () => {
          await io.set(S.tab, () => (unseen ? 'lesson' : 'changes') as MentorTab)
          await io.set(S.unseen, () => 0)
          await io.openPane()
        }}
      >
        {tr('[otwórz]', '[open]')}
      </Button>
    </Box>
  )
}
