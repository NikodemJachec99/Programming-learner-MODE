import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BarRow, Snapshot } from '../types'

const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
/** Kiedy skończyła się ostatnia odpowiedź modelu (ostatnie odświeżenie cache promptu); 0 = jeszcze nie było. */
const lastRequestAt = atom({ plugin: 'context-bar', key: 'lastRequestAt' } as const, 0)
/** Czas życia cache promptu w minutach (5 albo 60); trwała kopia w $.store. */
const ttlMinutes = atom({ plugin: 'context-bar', key: 'ttlMinutes' } as const, 60)

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

let isBusy = false
let isDirty = false

// The breakdown /context draws, estimated locally ('summary'), so it costs no API call.
// A call that lands while one is running marks it dirty; the running one reads again.
async function refresh($: EngineInterface): Promise<void> {
  if (isBusy) {
    isDirty = true
    return
  }
  isBusy = true
  try {
    do {
      isDirty = false
      const usage = await $.session.usage({ breakdown: 'summary' })
      const breakdown = usage.context.breakdown
      if (!breakdown) continue
      const rows: BarRow[] = breakdown.categories
        .filter((category: { kind: string; tokens: number }) => category.kind !== 'deferred' && category.tokens > 0)
        .map((category: { name: string; tokens: number; color: string; kind: string }) => ({
          name: category.name,
          tokens: category.tokens,
          color: category.color,
          kind: category.kind as BarRow['kind'],
        }))
      const fresh: Snapshot = {
        rows,
        totalTokens: breakdown.totalTokens,
        maxTokens: breakdown.maxTokens,
        percentage: breakdown.percentage,
      }
      await update($, snapshot, () => fresh)
    } while (isDirty)
  } finally {
    isBusy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Pasek kontekstu nad promptem: przełącz, albo /context-bar ttl 5|60 (czas cache w minutach)',
      argumentHint: '[ttl 5|60]',
      immediate: true,
    })
    const result = await next(e)
    // Pasek pod promptem z poprzedniej wersji: zdejmij, jeśli został.
    $.ui.status(undefined)
    const savedTtl = Number(await $.store.get('ttlMinutes'))
    if (savedTtl > 0) await update($, ttlMinutes, () => savedTtl)
    if (await read($, isOn)) void refresh($)
    // Odliczanie cache: przerysowanie paska co 5 s (tylko ten plugin, bez wywołań API).
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return result
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'ttl') {
      const minutes = Number(args[1])
      if (minutes !== 5 && minutes !== 60) return { text: 'Użycie: /context-bar ttl 5  albo  /context-bar ttl 60' }
      await update($, ttlMinutes, () => minutes)
      await $.store.set('ttlMinutes', minutes)
      return { text: `Czas cache ustawiony na ${minutes} min.` }
    }
    const now = await update($, isOn, value => !value)
    if (now) void refresh($)
    return { text: now ? 'Context bar on.' : 'Context bar off.' }
  })

  // The fill moved (a response, a compaction): read the categories again.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context') && (await read($, isOn))) void refresh($)
    return result
  })

  // Koniec odpowiedzi modelu w głównej pętli: ostatnie zapytanie odświeżyło cache promptu.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, lastRequestAt, () => at)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const snap = await read($, snapshot)
    if (!snap || snap.rows.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    // Miejsce na pasek w komórkach: bodyColumns to pole, w którym rysuje pasek nad promptem.
    const columns = e.props.bodyColumns || e.viewport?.columns || 80

    // Cache promptu: w trakcie tury jest odświeżany; potem odliczamy TTL od końca ostatniej odpowiedzi.
    const ttlMs = (await read($, ttlMinutes)) * 60_000
    const last = await read($, lastRequestAt)
    const leftMs = last > 0 ? last + ttlMs - (await $.clock.now()) : null
    const cacheText = e.props.isWorking
      ? ' · cache: odświeżany'
      : leftMs === null
        ? ' · cache: —'
        : leftMs > 0
          ? ` · cache ${formatLeft(leftMs)}`
          : ' · cache wygasł'
    const cacheColor = e.props.isWorking || leftMs === null ? undefined : leftMs <= 0 ? 'red' : leftMs < 5 * 60_000 ? 'yellow' : 'green'

    const tail = ` ${snap.percentage}% ${formatTokens(snap.totalTokens)}/${formatTokens(snap.maxTokens)}`
    // Przycisk otwiera panel Claude Code Mentor przez jego polecenie /mentor
    // (panel należy do tamtego pluginu, więc nie otwieramy go stąd wprost).
    const mentorLabel = 'Mentor'
    // Zapas na odstępy i przycisk; pasek nigdy nie może się zawinąć do drugiej linii.
    const width = Math.max(10, Math.floor((columns - tail.length - cacheText.length - mentorLabel.length - 10) * 0.9))
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
    const svgSurface = e.surface === 'desktop' || e.surface === 'vscode'
    const bar = svgSurface ? (
      (() => {
        const { Svg } = $.ui.resolve({ ...e, surface: 'desktop' as const })
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
          <Text>
            {group.parts.map(part => (
              <Text color={part.color} dimColor={part.isDim}>
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
          {fillZone ? (
            <Text color={fillZone.color} bold>
              {tail.trimStart()}
            </Text>
          ) : (
            <Text dimColor>{tail.trimStart()}</Text>
          )}
          {cacheColor ? <Text color={cacheColor}>{cacheText}</Text> : <Text dimColor>{cacheText}</Text>}
        </Text>
        </Box>
        <Button
          key="open-mentor"
          label={mentorLabel}
          dimColor
          onPress={() =>
            $.command.run({ command: 'mentor' }).catch(err => {
              $.ui.toast(`Mentor niedostępny: ${err instanceof Error ? err.message : String(err)}`)
            })
          }
        />
      </Box>
    )
  })
}
