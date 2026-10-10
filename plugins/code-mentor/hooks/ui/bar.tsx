// Pasek kontekstu nad promptem (dawny osobny mod context-bar): kategorie okna
// kontekstu z dymkami na desktopie, procent zajętości, licznik cache promptu
// i przycisk Mentor. Czyste rysowanie: dane podaje register.tsx.

import type { RenderElement } from 'claude-code'
import type { Elements } from 'claude-code'
import type { El } from './kit'
import { weather } from './visuals'
import { tr } from '../i18n'

/** Jedna kategoria z /context. */
export type BarRow = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

/** Ostatnio odczytany rozkład okna kontekstu. */
export type BarSnapshot = { rows: BarRow[]; totalTokens: number; maxTokens: number; percentage: number }
type Snapshot = BarSnapshot

export type BarOptions = {
  snap: BarSnapshot
  columns: number
  isWorking: boolean
  ttlMinutes: number
  lastRequestAt: number
  now: number
  /** Element Svg na desktopie i w VS Code; w terminalu brak (pasek tekstowy). */
  Svg?: Elements['desktop']['Svg']
  onMentor: () => unknown
  /** Przyciski bocznych paneli obok „Mentor” (Agenci, Pliki, Zadania): otwierają albo chowają panel. */
  panes?: readonly { key: string; label: string; onPress: () => unknown }[]
  /** Zajętość kontekstu po ostatnich turach (najstarsza pierwsza), najwyżej 12. */
  history?: readonly number[]
}

/** Ile tur pamięta historia paska. */
export const HISTORY_TURNS = 12

const SPARK = '▁▂▃▄▅▆▇█'

/** Miniwykres zajętości: słupek na turę, wysokość względem największej w oknie (jak token-weather). */
export function sparkline(history: readonly number[]): string {
  const xs = history.filter(x => x > 0).slice(-HISTORY_TURNS)
  if (xs.length < 2) return ''
  const top = Math.max(...xs)
  return xs.map(x => SPARK[Math.min(SPARK.length - 1, Math.floor((x / top) * (SPARK.length - 1)))]).join('')
}

/** Zmiana względem poprzedniej tury: ▲ +12.3k, ▼ −4k albo ▬ 0. */
export function turnDelta(history: readonly number[]): { text: string; up: boolean } | null {
  const xs = history.filter(x => x > 0)
  if (xs.length < 2) return null
  const d = xs[xs.length - 1]! - xs[xs.length - 2]!
  if (Math.abs(d) < 50) return { text: tr('▬ bez zmian', '▬ no change'), up: false }
  return { text: `${d > 0 ? '▲ +' : '▼ −'}${formatTokens(Math.abs(d))}`, up: d > 0 }
}

/**
 * Warning zones, lowest first: past a zone's mark the used cells beyond it take its color,
 * and so does the percentage once the fill passes it.
 */
const ZONES: readonly { from: number; color: string }[] = [
  { from: 60, color: 'yellow' },
  { from: 80, color: 'red' },
]

/** The zone a fill or a cell position falls in, as a percentage of the window; null below the first. */
const zoneAt = (percent: number) => [...ZONES].reverse().find(zone => percent > zone.from) ?? null

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${Math.round(n)}`)

/** Pozostały czas cache: mm:ss poniżej godziny. */
const formatLeft = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Splits `width` cells across the rows by their tokens (largest remainder), so the
 * segments always add up to the full bar. A used category with any tokens keeps at
 * least one cell, taken from the widest segment, so small ones stay visible.
 */
const cellsFor = (rows: BarRow[], width: number): number[] => {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  if (total <= 0 || width <= 0) return rows.map(() => 0)
  const exact = rows.map(row => (row.tokens / total) * width)
  const cells = exact.map(Math.floor)
  let left = width - cells.reduce((a, b) => a + b, 0)
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of byRemainder) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  rows.forEach((row, i) => {
    if (row.kind !== 'used' || row.tokens <= 0 || (cells[i] ?? 0) > 0) return
    const widest = cells.indexOf(Math.max(...cells))
    if ((cells[widest] ?? 0) > 1) {
      cells[widest] = (cells[widest] ?? 0) - 1
      cells[i] = 1
    }
  })
  return cells
}

/**
 * Kolory kategorii w motywie Desktop (odczytane z jego paska): /context podaje klucze
 * motywu, a SVG potrzebuje zwykłych kolorów. Najpierw po nazwie, potem po kluczu.
 */
const HEX_BY_NAME: Record<string, string> = {
  'System prompt': '#4d4d4d',
  'System tools': '#c3c2b7',
  'MCP tools': '#0891b2',
  'MCP server instructions': '#16a34a',
  'Custom agents': '#6da7ec',
  'Memory files': '#c6613f',
  Skills: '#db9300',
  Messages: '#827dbd',
}
const HEX_BY_KEY: Record<string, string> = {
  inactive: '#4d4d4d',
  subtle: '#6b6b6b',
  promptBorder: '#c3c2b7',
  claude: '#c6613f',
  warning: '#db9300',
  permission: '#827dbd',
  success: '#16a34a',
  suggestion: '#6da7ec',
  ide: '#0891b2',
  yellow: '#f5d90a',
  red: '#e5484d',
}
const FALLBACK = ['#8b5cf6', '#14b8a6', '#f472b6', '#a3a3a3', '#84cc16']
const hexFor = (row: BarRow, i: number): string => HEX_BY_NAME[row.name] ?? HEX_BY_KEY[row.color] ?? FALLBACK[i % FALLBACK.length] ?? '#888888'

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Pasek jako SVG: każda kategoria to prostokąt z natywnym dymkiem (<title>) po najechaniu.
 * Część zajęta za progiem strefy (60%, 80%) dostaje kolor strefy, jak w wersji tekstowej.
 */
const barSvg = (snap: Snapshot, widthPx: number): string => {
  const total = snap.rows.reduce((s, r) => s + r.tokens, 0) || 1
  const h = 14
  let x = 0
  const parts: string[] = [
    '<defs><pattern id="dots" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="1.4" height="1.4" fill="#6b6b6b"/></pattern></defs>',
    '<style>g.cat:hover rect{filter:brightness(1.35)}</style>',
  ]
  snap.rows.forEach((row, i) => {
    const w = (row.tokens / total) * widthPx
    if (w <= 0) return
    const tip = `${row.name}: ${formatTokens(row.tokens)} (${((row.tokens / total) * 100).toFixed(1)}%)`
    const pieces: string[] = []
    if (row.kind === 'used') {
      // podział na kolor kategorii i kolory stref (procent okna)
      const startPct = (x / widthPx) * 100
      const endPct = ((x + w) / widthPx) * 100
      const cuts = [startPct, ...ZONES.map(z => z.from).filter(f => f > startPct && f < endPct), endPct]
      for (let k = 0; k < cuts.length - 1; k += 1) {
        const a = cuts[k] ?? 0
        const b = cuts[k + 1] ?? 0
        const zone = zoneAt((a + b) / 2)
        const fill = zone ? (HEX_BY_KEY[zone.color] ?? '#f5d90a') : hexFor(row, i)
        pieces.push(`<rect x="${((a / 100) * widthPx).toFixed(2)}" y="0" width="${(((b - a) / 100) * widthPx).toFixed(2)}" height="${h}" fill="${fill}"/>`)
      }
    } else {
      const fill = row.kind === 'buffer' ? 'url(#dots)' : '#2b2b2b'
      pieces.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${h}" fill="${fill}"/>`)
    }
    parts.push(`<g class="cat"><title>${escapeXml(tip)}</title>${pieces.join('')}</g>`)
    x += w
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${h}" viewBox="0 0 ${widthPx} ${h}" shape-rendering="crispEdges">${parts.join('')}</svg>`
}

export function renderBar(E: El, o: BarOptions): RenderElement {
    const snap = o.snap
    const columns = o.columns
    const { Box, Text, Button } = E
    // Miejsce na pasek w komórkach: bodyColumns to pole, w którym rysuje pasek nad promptem.

    // Cache promptu: w trakcie tury jest odświeżany; potem odliczamy TTL od końca ostatniej odpowiedzi.
    const ttlMs = o.ttlMinutes * 60_000
    const last = o.lastRequestAt
    const leftMs = last > 0 ? last + ttlMs - o.now : null
    const cacheText = o.isWorking
      ? tr(' · cache: odświeżany', ' · cache: refreshing')
      : leftMs === null
        ? ' · cache: —'
        : leftMs > 0
          ? ` · cache ${formatLeft(leftMs)}`
          : tr(' · cache wygasł', ' · cache expired')
    const cacheColor = o.isWorking || leftMs === null ? undefined : leftMs <= 0 ? 'red' : leftMs < 5 * 60_000 ? 'yellow' : 'green'

    // pogoda kontekstu (token-weather): ikona zawsze, słowo gdy jest miejsce
    const sky = weather(snap.percentage)
    const skyText = columns >= 90 ? `${sky.icon} ${sky.word} ` : `${sky.icon} `
    const tail = ` ${snap.percentage}% ${formatTokens(snap.totalTokens)}/${formatTokens(snap.maxTokens)}`
    const mentorLabel = 'Mentor'
    // Wąsko: najpierw znika wykres, potem zmiana tury, na końcu cache. Procent i tokeny zostają zawsze.
    const spark = columns >= 110 ? sparkline(o.history ?? []) : ''
    const delta = columns >= 80 ? turnDelta(o.history ?? []) : null
    const cacheShown = columns >= 60 ? cacheText : ''
    const extra = (spark ? spark.length + 1 : 0) + (delta ? delta.text.length + 3 : 0)
    // Zapas na odstępy i przycisk; pasek nigdy nie może się zawinąć do drugiej linii.
    // panele obok „Mentor”: w wąskim oknie same pierwsze litery, żeby pasek się nie zawinął
    const panes = (o.panes ?? []).map(p => ({ ...p, label: columns >= 100 ? p.label : p.label.replace(/^(\S)\S*/, '$1') }))
    const panesWidth = panes.reduce((s, p) => s + p.label.length + 3, 0)
    const width = Math.max(10, Math.floor((columns - tail.length - skyText.length - cacheShown.length - extra - mentorLabel.length - panesWidth - 10) * 0.9))
    const cells = cellsFor(snap.rows, width)
    const fillZone = zoneAt(snap.percentage)

    // Cell by cell, merged into runs of one color: a used cell past a zone's mark of the
    // window takes the zone's color, so the bar shows how far into each zone it reaches.
    const groups: { row: number; parts: { text: string; color: string; isDim: boolean }[] }[] = []
    let at = 0
    snap.rows.forEach((row, i) => {
      const glyph = row.kind === 'used' ? '█' : row.kind === 'buffer' ? '▒' : '░'
      const parts: { text: string; color: string; isDim: boolean }[] = []
      for (let c = 0; c < (cells[i] ?? 0); c += 1, at += 1) {
        const zone = row.kind === 'used' ? zoneAt(((at + 0.5) / width) * 100) : null
        const color = zone?.color ?? row.color
        const isDim = !zone && row.kind !== 'used'
        const lastPart = parts[parts.length - 1]
        if (lastPart && lastPart.color === color && lastPart.isDim === isDim) lastPart.text += glyph
        else parts.push({ text: glyph, color, isDim })
      }
      if (parts.length) groups.push({ row: i, parts })
    })

    // Desktop i VS Code: SVG z dymkami po najechaniu. Terminal: pasek tekstowy.
    const svgSurface = !!o.Svg
    const bar = svgSurface ? (
      (() => {
        const Svg = o.Svg!
        const widthPx = Math.max(80, Math.round(width * 8))
        return (
          <Box flexShrink={1} overflow="hidden">
            <Svg
              source={barSvg(snap, widthPx)}
              alt={snap.rows.map(r => `${r.name} ${formatTokens(r.tokens)}`).join(', ')}
              width={widthPx}
              height={14}
              isInteractive
            />
          </Box>
        )
      })()
    ) : (
      <Box flexDirection="row" flexWrap="nowrap" flexShrink={1} overflow="hidden">
        {groups.map(group => (
          <Text key={`bar-g-${group.row}`}>
            {group.parts.map((part, pi) => (
              <Text key={`bar-p-${group.row}-${pi}`} color={part.color} dimColor={part.isDim}>
                {part.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="row" flexWrap="nowrap" columnGap={1} alignItems="center">
        {bar}
        <Box flexShrink={0}>
        <Text wrap="truncate">
          <Text color={sky.color}>{skyText}</Text>
          {fillZone ? (
            <Text color={fillZone.color} bold>
              {tail.trimStart()}
            </Text>
          ) : (
            <Text dimColor>{tail.trimStart()}</Text>
          )}
          {delta && <Text color={delta.up ? undefined : 'success'} dimColor={delta.up}>{` · ${delta.text}`}</Text>}
          {spark && <Text color="permission">{` ${spark}`}</Text>}
          {cacheShown ? cacheColor ? <Text color={cacheColor}>{cacheShown}</Text> : <Text dimColor>{cacheShown}</Text> : null}
        </Text>
        </Box>
        <Button
          key="open-mentor"
          label={mentorLabel}
          dimColor
          onPress={o.onMentor}
        />
        {panes.map(p => (
          <Button key={p.key} label={p.label} dimColor onPress={p.onPress} />
        ))}
      </Box>
    )
}
