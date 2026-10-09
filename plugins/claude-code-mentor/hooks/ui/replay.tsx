// Szczegóły zmiany w stylu Replay Theater (claude-code-playground, Apache-2.0): podsumowanie tury,
// „edycje po kolei” z kółkami na linii (zrobione ✓, bieżąca różowa z numerem, kolejne obrysowane),
// „Edycja k z N”, diff w ramce ze zmienionymi słowami, legenda i przyciski poprzednia / następna.
// Krok po kroku, skróty p i n oraz diff z kontekstem jak w replay-theater; wygląd odtworzony ze
// zrzutów ekranu, bo w repozytorium jest tylko wersja tekstowa.

import type { Elements, RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { ChangeMeta } from '../engine/change'
import { groupByTurn } from '../engine/change'
import { diffRows } from '../engine/worddiff'
import type { DiffRow } from '../engine/worddiff'
import { mentor } from '../mentor'
import type { Kit } from './kit'
import { S } from './state'

const PINK = '#e0479e'
const ADD = '#3fb950'
const DEL = '#f85149'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const isDesk = (k: Kit) => k.surface === 'desktop' || k.surface === 'vscode'
const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p
// katalog pliku; przy ścieżce bezwzględnej (plik spoza projektu) tylko dwa ostatnie poziomy
const dirOf = (p: string) => {
  const parts = p.replace(/\\/g, '/').split('/')
  parts.pop()
  return /^([A-Za-z]:|\/)/.test(p) ? parts.filter(Boolean).slice(-2).join('/') : parts.join('/')
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many

/** Edycje tej samej tury co wybrana, od najstarszej. */
export function turnSteps(changes: readonly ChangeMeta[], id: string): ChangeMeta[] {
  const g = groupByTurn(changes).find(x => x.items.some(c => c.id === id))
  // lista jest od najnowszej; przy tym samym czasie kolejność z listy, odwrócona
  return g ? [...g.items].reverse().sort((a, b) => a.ts - b.ts) : []
}

/** Kółko kroku z linią do sąsiadów (oś „edycje po kolei”). */
export function stepDotSvg(state: 'done' | 'active' | 'next' | 'failed', n: number, first: boolean, last: boolean, H: number): string {
  const cx = 14
  const cy = H / 2
  const line = `${first ? '' : `<line class="ln" x1="${cx}" y1="0" x2="${cx}" y2="${cy - 11}"/>`}${last ? '' : `<line class="ln" x1="${cx}" y1="${cy + 11}" x2="${cx}" y2="${H}"/>`}`
  const dot =
    state === 'active'
      ? `<circle cx="${cx}" cy="${cy}" r="11" fill="${PINK}"/><text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#fff">${n}</text>`
      : state === 'done'
        ? `<circle class="dn" cx="${cx}" cy="${cy}" r="11"/><path class="ck" d="M${cx - 4.5} ${cy}l3 3 6-6.5" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : state === 'failed'
          ? `<circle cx="${cx}" cy="${cy}" r="10.5" fill="none" stroke="${DEL}" stroke-width="1.5"/><path d="M${cx - 4} ${cy - 4}l8 8M${cx + 4} ${cy - 4}l-8 8" stroke="${DEL}" stroke-width="1.8" stroke-linecap="round"/>`
          : `<circle class="nx" cx="${cx}" cy="${cy}" r="10.5" fill="none" stroke-width="1.5"/><text class="nt" x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="500">${n}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="${H}" viewBox="0 0 28 ${H}"><style>.ln{stroke:#c9c9c6;stroke-width:1.5}.dn{fill:#e4e4e1}.ck{stroke:#6b6b68}.nx{stroke:#bdbdb9}.nt{fill:#6b6b68}@media (prefers-color-scheme: dark){.ln{stroke:#4a4a48}.dn{fill:#3a3a39}.ck{stroke:#cfcfcb}.nx{stroke:#5a5a58}.nt{fill:#a8a8a4}}</style>${line}${dot}</svg>`
}

/** Nagłówek szczegółów: tura, edycje po kolei, „Edycja k z N”, plik. */
export function renderReplayHead(io: Host, k: Kit, changes: readonly ChangeMeta[], m: ChangeMeta): RenderElement {
  const { Box, Text, Button } = k.E
  const steps = turnSteps(changes, m.id)
  const list = steps.length ? steps : [m]
  const at = Math.max(0, list.findIndex(c => c.id === m.id))
  const ok = list.filter(c => c.status === 'ok')
  const files = new Set(list.map(c => c.file)).size
  const added = ok.reduce((s, c) => s + c.added, 0)
  const removed = ok.reduce((s, c) => s + c.removed, 0)
  const desk = isDesk(k)
  const H = 34
  const rows = list.map((c, i) => {
    const active = c.id === m.id
    const state = c.status !== 'ok' ? 'failed' : active ? 'active' : i < at ? 'done' : 'next'
    const where = dirOf(c.file)
    const open = () => mentor.openChange(io, c.id)
    if (desk) {
      const { Svg } = k.E as Elements['desktop']
      return (
        <Box key={`rp-${c.id}`} flexDirection="row" alignItems="center" columnGap={1} paddingRight={1} backgroundColor={active ? 'rgba(224,71,158,0.16)' : undefined} hover={active ? undefined : { backgroundColor: 'rgba(128,128,128,0.10)' }}>
          <Svg source={stepDotSvg(state, i + 1, i === 0, i === list.length - 1, H)} alt={`${i + 1}. ${base(c.file)}`} width={28} height={H} />
          <Button key={`rp-open-${c.id}`} plain onPress={open}>
            {base(c.file)}
          </Button>
          {where ? <Text dimColor>{`w ${where}`}</Text> : null}
          <Box flexGrow={1} />
          {c.status === 'ok' ? (
            <Text>
              <Text color={ADD}>{`+${c.added}`}</Text>
              <Text color={DEL}>{` −${c.removed}`}</Text>
            </Text>
          ) : (
            <Text color={DEL}>{c.status === 'failed' ? 'nie weszła' : 'wrażliwy'}</Text>
          )}
        </Box>
      )
    }
    const mark = state === 'done' ? '✓' : state === 'failed' ? '✗' : String(i + 1)
    return (
      <Box key={`rp-${c.id}`} flexDirection="column">
        {i > 0 && <Text dimColor>{' │'}</Text>}
        <Box flexDirection="row" columnGap={1}>
          <Text color={active ? PINK : state === 'failed' ? 'error' : undefined} dimColor={!active && state !== 'failed'} bold={active}>
            {active ? `(${mark})` : state === 'done' ? ` ${mark} ` : `(${mark})`}
          </Text>
          <Button key={`rp-open-${c.id}`} plain dimColor={!active} onPress={open}>
            {base(c.file)}
          </Button>
          {where ? <Text dimColor>{`w ${where}`}</Text> : null}
          <Box flexGrow={1} />
          {c.status === 'ok' && (
            <Text>
              <Text color="success">{`+${c.added}`}</Text>
              <Text color="error">{` −${c.removed}`}</Text>
            </Text>
          )}
        </Box>
      </Box>
    )
  })
  const divider = desk ? (
    (() => {
      const { Svg } = k.E as Elements['desktop']
      const W = Math.max(200, Math.min(900, k.cols * 8 - 8))
      return <Svg key="rp-div" source={`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="17" viewBox="0 0 ${W} 17"><style>.d{stroke:#e2e2df}@media (prefers-color-scheme: dark){.d{stroke:#3a3a39}}</style><line class="d" x1="0" y1="8.5" x2="${W}" y2="8.5"/></svg>`} alt="" width={W} height={17} />
    })()
  ) : (
    <Text dimColor>{'─'.repeat(Math.max(10, Math.min(60, k.cols - 2)))}</Text>
  )
  const where = dirOf(m.file)
  const tool = m.tool || (m.kind === 'create' ? 'Write' : 'Edit')
  return (
    <Box flexDirection="column">
      <Text bold>{`${list.length} ${plural(list.length, 'edycja', 'edycje', 'edycji')} w ${files} ${files === 1 ? 'pliku' : 'plikach'}`}</Text>
      <Text>
        <Text color={ADD}>{`${added} ${plural(added, 'linia dodana', 'linie dodane', 'linii dodanych')}`}</Text>
        <Text>, </Text>
        <Text color={DEL}>{`${removed} ${plural(removed, 'usunięta', 'usunięte', 'usuniętych')}`}</Text>
      </Text>
      <Box marginTop={1}>
        <Text dimColor bold>
          EDYCJE PO KOLEI
        </Text>
      </Box>
      {rows}
      {divider}
      <Text color={PINK} bold>{`EDYCJA ${at + 1} Z ${list.length}`}</Text>
      <Text bold wrap="truncate-start">
        {base(m.file)}
      </Text>
      <Text dimColor wrap="truncate-start">{`${where ? m.file.replace(/\\/g, '/') : `${m.file}, katalog projektu`}${m.line ? `:${m.line}` : ''} · ${tool}`}</Text>
    </Box>
  )
}

/** Diff w ramce: wiersze − i + na tle, zmienione słowa mocniej. Desktop: SVG z czcionką o stałej szerokości. */
export function diffBoxSvg(rows: readonly DiffRow[], W: number): { svg: string; height: number } {
  const CW = 7.8
  const LH = 22
  const GAP = 12
  const PAD = 8
  const textX = 30
  const maxChars = Math.max(20, Math.floor((W - textX - 12) / CW))
  type Vis = { kind: '-' | '+' | ' '; text: string; spans: [number, number][]; cont: boolean } | { kind: 'gap' }
  const vis: Vis[] = []
  for (const r of rows) {
    if (r.kind === 'gap') {
      vis.push(r)
      continue
    }
    const t = r.text.replace(/\t/g, '  ')
    for (let off = 0; off === 0 || off < t.length; off += maxChars) {
      const part = t.slice(off, off + maxChars)
      const spans = r.spans.map(([a, b]) => [Math.max(a, off) - off, Math.min(b, off + maxChars) - off] as [number, number]).filter(([a, b]) => b > a)
      vis.push({ kind: r.kind, text: part, spans, cont: off > 0 })
    }
  }
  let y = PAD
  const body: string[] = []
  for (const v of vis) {
    if (v.kind === 'gap') {
      y += GAP
      continue
    }
    const cls = v.kind === '-' ? 'rm' : v.kind === '+' ? 'ad' : ''
    if (cls) body.push(`<rect class="${cls}" x="1" y="${y}" width="${W - 2}" height="${LH}"/>`)
    for (const [a, b] of v.spans) body.push(`<rect class="${cls}w" x="${textX + a * CW - 2}" y="${y + 2}" width="${(b - a) * CW + 4}" height="${LH - 4}" rx="3"/>`)
    if (!v.cont && v.kind !== ' ') body.push(`<text class="${v.kind === '-' ? 'sr' : 'sa'}" x="12" y="${y + 15.5}" font-family="${MONO}" font-size="14" font-weight="600">${v.kind === '-' ? '−' : '+'}</text>`)
    body.push(`<text class="tx" x="${textX}" y="${y + 15.5}" font-family="${MONO}" font-size="13" xml:space="preserve">${xml(v.text)}</text>`)
    y += LH
  }
  const height = Math.max(LH + PAD * 2, y + PAD)
  const css =
    '<style>.fr{fill:none;stroke:#d9d9d6}.rm{fill:#fdecec}.ad{fill:#e7f6ea}.rmw{fill:#f6b9b9}.adw{fill:#aee3b9}.tx{fill:#1f1f1f}.sr{fill:#cf222e}.sa{fill:#1a7f37}' +
    '@media (prefers-color-scheme: dark){.fr{stroke:#3d3d3b}.rm{fill:#3b1f20}.ad{fill:#17331f}.rmw{fill:#7d2c30}.adw{fill:#2a6a3a}.tx{fill:#ececec}.sr{fill:#ff7b72}.sa{fill:#56d364}}</style>'
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${css}<defs><clipPath id="dbc${W}x${height}"><rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="8"/></clipPath></defs><g clip-path="url(#dbc${W}x${height})">${body.join('')}</g><rect class="fr" x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="8"/></svg>`,
    height,
  }
}

/** Legenda pod diffem: usunięte, dodane, zmienione słowo, bez zmian. */
export function legendSvg(W: number): string {
  const items: [string, string][] = [
    ['rm', 'Usunięte'],
    ['ad', 'Dodane'],
    ['cw', 'Zmienione słowo'],
    ['un', 'Bez zmian'],
  ]
  let x = 0
  const parts = items.map(([c, t]) => {
    const box =
      c === 'cw'
        ? `<rect x="${x}" y="3" width="8" height="16" fill="${DEL}" opacity=".55"/><rect x="${x + 8}" y="3" width="8" height="16" fill="${ADD}" opacity=".55"/>`
        : `<rect class="${c}" x="${x + 0.75}" y="3.75" width="14.5" height="14.5" rx="3" stroke-width="1.5"/>`
    const out = `${box}<text class="lt" x="${x + 24}" y="16" font-family="${FONT}" font-size="13">${t}</text>`
    x += 24 + t.length * 7.4 + 22
    return out
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="22" viewBox="0 0 ${W} 22"><style>.rm{fill:#fdecec;stroke:#e5a0a0}.ad{fill:#e7f6ea;stroke:#8fd19e}.un{fill:none;stroke:#c9c9c6}.lt{fill:#6b6b68}@media (prefers-color-scheme: dark){.rm{fill:#3b1f20;stroke:#8a3a3d}.ad{fill:#17331f;stroke:#2f7a43}.un{stroke:#4a4a48}.lt{fill:#a8a8a4}}</style>${parts.join('')}</svg>`
}

/** Diff zmiany z legendą i przyciskami poprzednia / następna edycja (p, n). */
export function renderReplayDiff(io: Host, k: Kit, changes: readonly ChangeMeta[], m: ChangeMeta, unified: string, full: boolean): RenderElement {
  const { Box, Text, Button } = k.E
  const steps = turnSteps(changes, m.id)
  const at = steps.findIndex(c => c.id === m.id)
  const prev = at > 0 ? steps[at - 1] : undefined
  const next = at >= 0 && at < steps.length - 1 ? steps[at + 1] : undefined
  const { rows, hidden } = diffRows(unified, full ? 3 : 0, full ? 400 : 14)
  const toggle =
    hidden > 0 || full ? (
      <Button key="lab-fulldiff" plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, fullDiff: !l.fullDiff }))}>
        {full ? '▴ tylko zmiany' : `▾ cały diff${hidden ? ` (jeszcze ${hidden} zmienionych linii)` : ' z kontekstem'}`}
      </Button>
    ) : (
      <Button key="lab-fulldiff" plain dimColor onPress={() => io.set(S.lab, l => ({ ...l, fullDiff: true }))}>
        ▾ z kontekstem
      </Button>
    )
  const nav = (
    <Box flexDirection="row" columnGap={2} marginTop={1}>
      <Button key="tl-prev" hotkey="p" dimColor={!prev} onPress={() => (prev ? mentor.openChange(io, prev.id) : undefined)}>
        Poprzednia edycja
      </Button>
      <Button key="tl-next" hotkey="n" variant="primary" dimColor={!next} onPress={() => (next ? mentor.openChange(io, next.id) : undefined)}>
        Następna edycja
      </Button>
    </Box>
  )
  if (isDesk(k)) {
    const { Svg } = k.E as Elements['desktop']
    const W = Math.max(240, Math.min(900, k.cols * 8 - 8))
    const box = diffBoxSvg(rows, W)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Svg key="rp-diff" source={box.svg} alt={rows.map(r => (r.kind === 'gap' ? '⋯' : `${r.kind} ${r.text}`)).join('\n')} width={W} height={box.height} />
        <Box marginTop={1}>
          <Svg key="rp-legend" source={legendSvg(W)} alt="Usunięte, dodane, zmienione słowo, bez zmian" width={W} height={22} />
        </Box>
        {toggle}
        {nav}
      </Box>
    )
  }
  // terminal: tła z motywu Claude Code (diffRemoved, diffRemovedWord, …), jak natywny diff
  const line = (r: DiffRow, i: number) => {
    if (r.kind === 'gap') return <Text key={`rd-${i}`}> </Text>
    const bg = r.kind === '-' ? 'diffRemoved' : r.kind === '+' ? 'diffAdded' : undefined
    const word = r.kind === '-' ? 'diffRemovedWord' : 'diffAddedWord'
    const parts: RenderElement[] = []
    let pos = 0
    r.spans.forEach(([a, b], j) => {
      if (a > pos) parts.push(<Text key={`rd-${i}-t${j}`}>{r.text.slice(pos, a)}</Text>)
      parts.push(
        <Text key={`rd-${i}-w${j}`} backgroundColor={word}>
          {r.text.slice(a, b)}
        </Text>,
      )
      pos = b
    })
    if (pos < r.text.length) parts.push(<Text key={`rd-${i}-end`}>{r.text.slice(pos)}</Text>)
    return (
      <Text key={`rd-${i}`} backgroundColor={bg} wrap="wrap">
        <Text color={r.kind === '-' ? 'error' : r.kind === '+' ? 'success' : undefined} bold>{`${r.kind === ' ' ? ' ' : r.kind === '-' ? '−' : '+'} `}</Text>
        {parts}
      </Text>
    )
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {rows.map(line)}
      </Box>
      <Text>
        <Text backgroundColor="diffRemoved"> </Text>
        <Text dimColor> usunięte  </Text>
        <Text backgroundColor="diffAdded"> </Text>
        <Text dimColor> dodane  </Text>
        <Text backgroundColor="diffRemovedWord"> </Text>
        <Text backgroundColor="diffAddedWord"> </Text>
        <Text dimColor> zmienione słowo</Text>
      </Text>
      {toggle}
      {nav}
    </Box>
  )
}
