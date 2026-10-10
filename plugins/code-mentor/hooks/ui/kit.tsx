// Wspólne klocki UI panelu: karty, sekcje, plakietki, paleta kategorii.
// Kolory to klucze motywu Claude Code, więc panel działa w jasnym i ciemnym.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { tr } from '../i18n'

/** Powierzchnie z polami formularza. Mobile (bez Input/Select) nie jest obsługiwane przez panel. */
export type El = Elements['desktop'] | Elements['terminal'] | Elements['vscode']
export type Kit = { E: El; cols: number; surface: RenderSurface }

const AREA_TEXT: Record<string, [string, string]> = {
  fundamentals: ['Podstawy', 'Fundamentals'],
  'data-structures': ['Struktury danych', 'Data structures'],
  functions: ['Funkcje', 'Functions'],
  errors: ['Błędy i wyjątki', 'Errors and exceptions'],
  oop: ['Programowanie obiektowe', 'Object-oriented programming'],
  modules: ['Moduły i zależności', 'Modules and dependencies'],
  async: ['Asynchroniczność', 'Asynchrony'],
  network: ['HTTP i API', 'HTTP and APIs'],
  sql: ['SQL i bazy danych', 'SQL and databases'],
  algorithms: ['Algorytmy', 'Algorithms'],
  testing: ['Testy i debugowanie', 'Testing and debugging'],
  git: ['Git', 'Git'],
  frontend: ['Frontend', 'Frontend'],
  backend: ['Backend', 'Backend'],
  architecture: ['Architektura', 'Architecture'],
  security: ['Bezpieczeństwo', 'Security'],
  devops: ['Docker i wdrażanie', 'Docker and deployment'],
  ai: ['AI, LLM i agenci', 'AI, LLMs and agents'],
  mobile: ['Flutter i aplikacje mobilne', 'Flutter and mobile apps'],
}
/** Nazwy obszarów w bieżącym języku (czytane przy rysowaniu). */
export const AREA_NAMES: Record<string, string> = Object.defineProperties(
  {},
  Object.fromEntries(Object.entries(AREA_TEXT).map(([k, [pl, en]]) => [k, { get: () => tr(pl, en), enumerable: true }])),
)

export const AREA_COLORS: Record<string, string> = {
  fundamentals: 'suggestion',
  'data-structures': 'suggestion',
  functions: 'suggestion',
  errors: 'warning',
  oop: 'permission',
  modules: 'ide',
  async: 'permission',
  network: 'ide',
  sql: 'warning',
  algorithms: 'claude',
  testing: 'success',
  git: 'subtle',
  frontend: 'autoAccept',
  backend: 'autoAccept',
  architecture: 'claude',
  security: 'error',
  devops: 'ide',
  ai: 'planMode',
  mobile: 'autoAccept',
}

export const LEVEL_THEME = ['inactive', 'suggestion', 'permission', 'warning', 'success']
const LEVEL_TEXT: [string, string][] = [
  ['nie znam', 'unknown'],
  ['uczę się', 'learning'],
  ['częściowo', 'partly'],
  ['stosuję', 'applying'],
  ['opanowane', 'mastered'],
]
/** Krótkie nazwy poziomów w bieżącym języku. */
export const LEVEL_SHORT: Record<number, string> = Object.defineProperties(
  {},
  Object.fromEntries(LEVEL_TEXT.map(([pl, en], i) => [i, { get: () => tr(pl, en), enumerable: true }])),
)

export const KIND_ICON: Record<string, string> = {
  create: '＋',
  edit: '✎',
  config: '⚙',
  dependency: '⬇',
  bash: '›',
  test: '✓',
  build: '▣',
  error: '✗',
  fix: '✔',
  git: '⎇',
}

/** Ścieżka do pokazania: ostatnie dwa człony, cała tylko gdy krótka. */
export function shortPath(p: string, max = 42): string {
  if (p.length <= max) return p
  const parts = p.split(/[\\/]/).filter(Boolean)
  return `…/${parts.slice(-2).join('/')}`
}

export function bar(value: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round(value * width)))
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  const v = s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`
  return tr(`${v} temu`, `${v} ago`)
}

export function section(k: Kit, title: string, ...children: (RenderElement | false | null | undefined)[]): RenderElement {
  const { Box, Text } = k.E
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="claude">
        {title}
      </Text>
      {children.filter(Boolean)}
    </Box>
  )
}

export function card(k: Kit, color: string, ...children: (RenderElement | false | null | undefined)[]): RenderElement {
  const { Box } = k.E
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      {children.filter(Boolean)}
    </Box>
  )
}

export function muted(k: Kit, text: string): RenderElement {
  const { Text } = k.E
  return <Text dimColor>{text}</Text>
}

export function md(k: Kit, text: string, key?: string): RenderElement {
  const { Markdown } = k.E
  return key ? <Markdown key={key} text={text} /> : <Markdown text={text} />
}

export function code(k: Kit, source: string, language: string, startLine?: number, path?: string | null): RenderElement {
  const { Code } = k.E
  return <Code source={source || ' '} language={language} startLine={startLine} path={path ?? undefined} wrap="wrap" />
}

export function conceptChip(k: Kit, name: string, area: string): RenderElement {
  const { Text } = k.E
  return <Text color={AREA_COLORS[area] ?? 'subtle'}>{`◆ ${name.replace(/\s*\(.*\)$/, '')}`}</Text>
}

export function levelBadge(k: Kit, level: number): RenderElement {
  const { Text } = k.E
  return <Text color={LEVEL_THEME[level] ?? 'inactive'}>{`[${LEVEL_SHORT[level] ?? '?'}]`}</Text>
}

// ===================== system wyglądu v2 =====================
// Jeden akcent (claude) dla najważniejszej rzeczy na ekranie, trzy kolory stanu,
// reszta w szarościach. Etykiety sekcji wielkimi literami, przygaszone.

export const KIND_BADGE: Record<string, { label: string; color: string }> = {
  create: { get label() { return tr('NOWY', 'NEW') }, color: 'success' },
  edit: { get label() { return tr('EDYCJA', 'EDIT') }, color: 'suggestion' },
  config: { get label() { return tr('KONFIG', 'CONFIG') }, color: 'subtle' },
  dependency: { get label() { return tr('PAKIET', 'PACKAGE') }, color: 'warning' },
  test: { label: 'TEST', color: 'permission' },
  build: { label: 'BUILD', color: 'subtle' },
  error: { get label() { return tr('BŁĄD', 'ERROR') }, color: 'error' },
  fix: { get label() { return tr('NAPRAWA', 'FIX') }, color: 'success' },
  git: { label: 'GIT', color: 'subtle' },
  bash: { get label() { return tr('KOMENDA', 'COMMAND') }, color: 'subtle' },
}
const BADGE_WIDTH = 7

/** Etykieta sekcji: WIELKIE LITERY, przygaszona, opcjonalnie licznik po prawej. */
export function label(k: Kit, text: string, right?: string): RenderElement {
  const { Box, Text } = k.E
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text dimColor bold>
        {text.toUpperCase()}
      </Text>
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  )
}

/** Plakietka rodzaju zmiany o stałej szerokości (wyrównane kolumny). */
export function badge(k: Kit, kind: string, failed = false): RenderElement {
  const { Text } = k.E
  const b = failed ? { label: tr('BŁĄD', 'ERROR'), color: 'error' } : (KIND_BADGE[kind] ?? { label: kind.toUpperCase(), color: 'subtle' })
  return (
    <Text color={b.color} bold>
      {b.label.padEnd(BADGE_WIDTH)}
    </Text>
  )
}

/** Krótka nazwa pojęcia (bez angielskiego terminu w nawiasie). */
export const shortName = (name: string): string => name.replace(/\s*\(.*\)$/, '')

/** Lista pojęć jako jedna przygaszona linia: "Async/await · Promise · JSON". */
export function tags(k: Kit, names: string[], max = 3): RenderElement | null {
  const { Text } = k.E
  if (!names.length) return null
  const shown = names.slice(0, max)
  return <Text dimColor wrap="wrap">{shown.join(' · ') + (names.length > max ? ` · +${names.length - max}` : '')}</Text>
}

/** Karta: neutralna ramka albo akcent dla jednego, najważniejszego elementu. */
export function panel(k: Kit, accent: boolean, ...children: (RenderElement | false | null | undefined)[]): RenderElement {
  const { Box } = k.E
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent ? 'claude' : 'subtle'} borderDimColor={!accent} paddingX={1} marginTop={1}>
      {children.filter(Boolean)}
    </Box>
  )
}
