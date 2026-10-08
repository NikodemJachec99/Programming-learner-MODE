// Wspólne klocki UI panelu: karty, sekcje, plakietki, paleta kategorii.
// Kolory to klucze motywu Claude Code, więc panel działa w jasnym i ciemnym.

import type { Elements, RenderElement, RenderSurface } from 'claude-code'

/** Powierzchnie z polami formularza. Mobile (bez Input/Select) nie jest obsługiwane przez panel. */
export type El = Elements['desktop'] | Elements['terminal'] | Elements['vscode']
export type Kit = { E: El; cols: number; surface: RenderSurface }

export const AREA_NAMES: Record<string, string> = {
  fundamentals: 'Podstawy',
  'data-structures': 'Struktury danych',
  functions: 'Funkcje',
  errors: 'Błędy i wyjątki',
  oop: 'Programowanie obiektowe',
  modules: 'Moduły i zależności',
  async: 'Asynchroniczność',
  network: 'HTTP i API',
  sql: 'SQL i bazy danych',
  algorithms: 'Algorytmy',
  testing: 'Testy i debugowanie',
  git: 'Git',
  frontend: 'Frontend',
  backend: 'Backend',
  architecture: 'Architektura',
  security: 'Bezpieczeństwo',
  devops: 'Docker i wdrażanie',
  ai: 'AI, LLM i agenci',
}

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
}

export const LEVEL_THEME = ['inactive', 'suggestion', 'permission', 'warning', 'success']
export const LEVEL_SHORT = ['nie znam', 'uczę się', 'częściowo', 'stosuję', 'opanowane']

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
  if (s < 60) return `${s} s temu`
  if (s < 3600) return `${Math.round(s / 60)} min temu`
  if (s < 86400) return `${Math.round(s / 3600)} h temu`
  return `${Math.round(s / 86400)} d temu`
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
