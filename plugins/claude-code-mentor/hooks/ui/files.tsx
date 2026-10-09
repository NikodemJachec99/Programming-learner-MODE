// Pliki jak w claude-code-filetree (MIT, (c) 2026 Kurt Buhler): karta „Teraz” (co Claude robi,
// gałąź, legenda), „Claude dotknął” z plakietkami stanu i „Wszystkie pliki” jako drzewo z ikonami,
// statusem gita, godziną zmiany i podświetleniem plików z tej tury; na dole ostatni commit.
// Drzewo, gałąź, status gita, kolory odczytu, edycji i commitu z filetree; karta „Teraz”
// i plakietki odtworzone ze zrzutów ekranu. Bez skanowania dysku: tylko rozwinięte katalogi.

import type { Elements, RenderElement } from 'claude-code'
import type { Host } from '../host'
import { TOUCH_LABEL, fileBadge, pkey, posix, rel, rightNow, stampOf, touchedFiles, treeRows } from '../engine/files'
import type { FilesState, Touch, TreeRow } from '../engine/files'
import { latestChangeFor } from './activity'
import { mentor } from '../mentor'
import type { El, Kit } from './kit'
import { S } from './state'
import { TONES, shimmer, shimmerSvg } from './visuals'

export const FILES_PANE = 'mentor-files'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const PURPLE = '#a371f7'
const ORANGE = '#f0883e'
const YELLOW = '#d4a72c'
const GREEN = '#3fb950'
const RED = '#f85149'
const GREY = '#8a8a86'
const BLUE = '#4a9eed'

const TOUCH_COLOR: Record<Touch, string> = { reading: PURPLE, editing: ORANGE, opened: PURPLE, edited: ORANGE, committed: GREEN, failed: RED, denied: GREY }
const ROW_TINT: Partial<Record<Touch, string>> = { committed: 'rgba(63,185,80,0.14)', edited: 'rgba(240,136,62,0.12)', editing: 'rgba(240,136,62,0.12)', reading: 'rgba(163,113,247,0.12)' }
const GIT_COLOR = { new: GREEN, mod: YELLOW, del: RED } as const
const GIT_LETTER = { new: 'U', mod: 'M', del: 'D' } as const

const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const isDesk = (surface: string) => surface === 'desktop' || surface === 'vscode'
const nameOf = (p: string) => posix(p).split('/').pop() ?? p

// ---------- rysunki (desktop) ----------

/** Gwiazdka Claude w kółku; obraca się, gdy Claude pracuje. */
export function nowIconSvg(working: boolean): string {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    return `<line x1="${22 + Math.cos(a) * 3}" y1="${22 + Math.sin(a) * 3}" x2="${22 + Math.cos(a) * 9}" y2="${22 + Math.sin(a) * 9}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><style>.bg{fill:#efeeea}.st{stroke:${working ? '#d97757' : '#6b6b68'}}@media (prefers-color-scheme: dark){.bg{fill:#2f2f2e}.st{stroke:${working ? '#e8906f' : '#cfcfcb'}}}${working ? '.sp{transform-origin:22px 22px;animation:r 2.4s linear infinite}@keyframes r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.sp{animation:none}}' : ''}</style><circle class="bg" cx="22" cy="22" r="22"/><g class="st sp" stroke-width="2.6" stroke-linecap="round">${spokes}</g></svg>`
}

const branchIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><g fill="none" stroke="${BLUE}" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="3.5" r="1.8"/><circle cx="5" cy="14.5" r="1.8"/><circle cx="13" cy="5.5" r="1.8"/><path d="M5 5.3v7.4M13 7.3c0 3-3 3.2-6.5 5"/></g></svg>`

/** Plakietka typu pliku: krótki napis w kolorze języka na ciemnym tle (JS, TS, { }, GIT). */
export function badgeSvg(name: string): { svg: string; width: number } {
  const b = fileBadge(name)
  const width = Math.max(26, 10 + b.label.length * 7.4)
  return {
    width,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20"><style>.b{fill:#f0efec}@media (prefers-color-scheme: dark){.b{fill:#2e2e2d}}</style><rect class="b" x="0" y="1" width="${width}" height="18" rx="4"/><text x="${width / 2}" y="14" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="700" fill="${b.color}">${xml(b.label)}</text></svg>`,
  }
}

function folderSvg(open: boolean, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="20" viewBox="0 0 26 20"><path d="M5 5.5h5l2 2h8.5a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" fill="${open ? color : 'none'}" fill-opacity="${open ? 0.18 : 0}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

/** Plakietka stanu po prawej: „Otwarty”, „Edytowany”, „Zacommitowany”. */
export function pillSvg(text: string, color: string, live = false): { svg: string; width: number } {
  const width = Math.round(18 + text.length * 7.1)
  return {
    width,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22" viewBox="0 0 ${width} 22">${live ? '<style>.p{animation:p 1.4s ease-in-out infinite}@keyframes p{50%{opacity:.45}}@media (prefers-reduced-motion: reduce){.p{animation:none}}</style>' : ''}<rect class="p" x="0" y="1" width="${width}" height="20" rx="10" fill="${color}" fill-opacity=".18"/><text x="${width / 2}" y="15" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${color}">${xml(text)}</text></svg>`,
  }
}

/** Nazwa z przesuwającym się pasmem światła (filetree): fiolet przy czytaniu, pomarańcz przy edycji. */
function shimmerName(c: Ctx, name: string, touch: Touch, key: string): RenderElement {
  const tone = touch === 'editing' ? 'orange' : 'purple'
  if (isDesk(c.surface)) {
    const { Svg } = c.E as Elements['desktop']
    const s = shimmerSvg(name, tone)
    return <Svg key={key} source={s.svg} alt={name} width={s.width} height={s.height} />
  }
  const chars = [...name]
  return (
    <c.E.Text key={key} bold>
      {chars.map((ch, j) => (
        <c.E.Text key={`${key}-${j}`} color={shimmer(j, mentor.frame, chars.length, TONES[tone].bright)}>
          {ch}
        </c.E.Text>
      ))}
    </c.E.Text>
  )
}

const live = (t: Touch | undefined) => t === 'reading' || t === 'editing'

// ---------- części ----------

type Ctx = { io: Host; E: El; surface: string; cols: number; f: FilesState; now: number }

function pill(c: Ctx, touch: Touch, key: string): RenderElement {
  const { Text } = c.E
  const text = TOUCH_LABEL[touch]
  const color = TOUCH_COLOR[touch]
  if (isDesk(c.surface)) {
    const { Svg } = c.E as Elements['desktop']
    const p = pillSvg(text, color, touch === 'reading' || touch === 'editing')
    return <Svg key={key} source={p.svg} alt={text} width={p.width} height={22} />
  }
  return (
    <Text key={key} color={color} bold>
      {text}
    </Text>
  )
}

function badge(c: Ctx, name: string, key: string): RenderElement {
  return fileIcon(c.E, c.surface, name, key)
}

/** Ikona typu pliku: plakietka SVG na desktopie, kolorowy skrót w terminalu. */
export function fileIcon(E: El, surface: string, name: string, key: string): RenderElement {
  const c = { E, surface }
  if (isDesk(c.surface)) {
    const { Svg } = c.E as Elements['desktop']
    const b = badgeSvg(name)
    return <Svg key={key} source={b.svg} alt={fileBadge(name).label} width={b.width} height={20} />
  }
  const b = fileBadge(name)
  return (
    <c.E.Text key={key} color={b.color} bold>
      {b.label.padEnd(3)}
    </c.E.Text>
  )
}

/** Karta „Teraz”: co Claude robi, gałąź z jej stanem i legenda kolorów. */
async function nowCard(c: Ctx): Promise<RenderElement> {
  const { Box, Text } = c.E
  const act = await c.io.get(S.activity)
  const working = mentor.work.turn === mentor.turn && mentor.work.startedAt > 0 && mentor.work.endedAt === null
  const r = rightNow(act, working, mentor.work.tool)
  const g = c.f.git
  const changed = g ? Object.keys(g.files).length : 0
  const status = !c.f.isRepo ? 'bez repozytorium git' : c.f.commit && !changed ? `zacommitowane ${c.f.commit.sha}` : changed ? `${changed} ${changed === 1 ? 'zmieniony plik' : changed % 10 >= 2 && changed % 10 <= 4 && (changed % 100 < 12 || changed % 100 > 14) ? 'zmienione pliki' : 'zmienionych plików'}` : 'czysto, nic nie zmienione'
  const desk = isDesk(c.surface)
  const Svg = desk ? (c.E as Elements['desktop']).Svg : null
  const dot = (color: string, text: string, key: string) => (
    <Text key={key}>
      <Text color={color}>● </Text>
      <Text>{text}</Text>
    </Text>
  )
  return (
    <Box key="fl-now" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} paddingY={desk ? 1 : 0}>
      <Box flexDirection="row" columnGap={2} alignItems="center">
        {Svg ? <Svg key="fl-now-icon" source={nowIconSvg(working)} alt={working ? 'pracuje' : 'czeka'} width={44} height={44} /> : <Text color={working ? 'claude' : undefined}>{working ? '✻' : '✳'}</Text>}
        <Box flexDirection="column" flexShrink={1}>
          <Text dimColor bold>
            TERAZ
          </Text>
          <Text bold wrap="truncate-end">
            {r.title}
          </Text>
          <Text dimColor wrap="truncate-end">
            {r.sub}
          </Text>
        </Box>
      </Box>
      <Text dimColor>{desk ? ' ' : '─'.repeat(Math.max(10, Math.min(50, c.cols - 6)))}</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {Svg ? <Svg key="fl-branch" source={branchIconSvg} alt="gałąź" width={18} height={18} /> : <Text color={BLUE}>⑂</Text>}
        {c.f.top && pkey(c.f.top) !== pkey(c.f.root) && <Text dimColor>{`${c.f.top.split('/').pop()} ·`}</Text>}
        <Text bold>{g?.branch || (c.f.isRepo ? '…' : '—')}</Text>
        {g && g.ahead > 0 && <Text color={GREEN}>{`↑${g.ahead}`}</Text>}
        {g && g.behind > 0 && <Text color={BLUE}>{`↓${g.behind}`}</Text>}
        <Box flexGrow={1} />
        <Text color={c.f.commit && !changed ? GREEN : undefined} dimColor={!(c.f.commit && !changed)}>
          {status}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" marginTop={desk ? 1 : 0}>
        {dot(PURPLE, 'Claude czytał', 'lg-r')}
        {dot(ORANGE, 'Claude edytował', 'lg-e')}
        {dot(YELLOW, 'Niezacommitowane', 'lg-u')}
      </Box>
    </Box>
  )
}

/** „Claude dotknął”: pliki tej tury z plakietką stanu; klik otwiera zmianę. */
async function touchedList(c: Ctx, max: number): Promise<RenderElement | null> {
  const { Box, Text, Button } = c.E
  const act = await c.io.get(S.activity)
  const list = touchedFiles(act, c.f.commit)
  if (!list.length) return null
  const changes = await c.io.get(S.changes)
  const root = c.f.root || posix(mentor.projectRoot)
  const shown = list.slice(0, max)
  return (
    <Box key="fl-touched" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor bold>
          CLAUDE DOTKNĄŁ
        </Text>
        <Text dimColor bold>{`${list.length} ${list.length === 1 ? 'PLIK' : list.length % 10 >= 2 && list.length % 10 <= 4 && (list.length % 100 < 12 || list.length % 100 > 14) ? 'PLIKI' : 'PLIKÓW'}`}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {shown.map((t, i) => {
          const name = nameOf(t.path)
          const parts = (root ? rel(root, t.path) : posix(t.path)).split('/').slice(0, -1)
          const dir = /^([A-Za-z]:|\/)/.test(parts.join('/')) ? `…/${parts.filter(Boolean).slice(-2).join('/')}` : parts.join('/')
          const change = latestChangeFor(changes, t.path)
          return (
            <Box key={`fl-t-${i}`} flexDirection="row" columnGap={1} alignItems="center">
              {badge(c, name, `fl-t-b-${i}`)}
              {live(t.touch) ? (
                shimmerName(c, name, t.touch, `fl-t-s-${i}`)
              ) : change ? (
                <Button key={`fl-t-o-${i}`} plain onPress={() => mentor.openChange(c.io, change.id)}>
                  {name}
                </Button>
              ) : (
                <Text bold wrap="truncate-end">
                  {name}
                </Text>
              )}
              {dir ? (
                <Text dimColor wrap="truncate-start">
                  {dir}
                </Text>
              ) : null}
              <Box flexGrow={1} />
              {pill(c, t.touch, `fl-t-p-${i}`)}
            </Box>
          )
        })}
        {list.length > max && <Text dimColor>{`+ ${list.length - max} więcej`}</Text>}
      </Box>
    </Box>
  )
}

/** Jeden wiersz drzewa: strzałka, ikona, nazwa w kolorze stanu, po prawej plakietka albo git i godzina. */
function treeRow(c: Ctx, r: TreeRow, touch: Touch | undefined, changeId: string | undefined, i: number): RenderElement {
  const { Box, Text, Button } = c.E
  const gitState = c.f.git?.files[pkey(r.path)]
  const dirDirty = r.dir && !!c.f.git && Object.keys(c.f.git.files).some(k => k.startsWith(pkey(r.path) + '/'))
  const color = touch ? TOUCH_COLOR[touch] : gitState ? GIT_COLOR[gitState] : r.dir && dirDirty ? GREEN : r.name.startsWith('.') ? GREY : undefined
  const desk = isDesk(c.surface)
  const Svg = desk ? (c.E as Elements['desktop']).Svg : null
  const chevron = r.dir ? (
    <Button key={`fl-c-${i}`} plain dimColor label={r.open ? '▾' : '▸'} onPress={() => mentor.toggleDir(c.io, r.path)} />
  ) : (
    <Text key={`fl-c-${i}`}>{'  '}</Text>
  )
  const icon = r.dir ? (
    Svg ? (
      <Svg key={`fl-i-${i}`} source={folderSvg(r.open, color ?? BLUE)} alt="folder" width={26} height={20} />
    ) : (
      <Text key={`fl-i-${i}`} color={color ?? BLUE}>
        {r.open ? '▣' : '■'}
      </Text>
    )
  ) : (
    badge(c, r.name, `fl-i-${i}`)
  )
  const nameEl = live(touch) ? (
    shimmerName(c, r.name, touch!, `fl-n-${i}`)
  ) : r.dir ? (
    color ? (
      <Text key={`fl-n-${i}`} color={color} bold={!!touch}>
        {r.name}
      </Text>
    ) : (
      <Button key={`fl-n-${i}`} plain onPress={() => mentor.toggleDir(c.io, r.path)}>
        {r.name}
      </Button>
    )
  ) : changeId && !color ? (
    <Button key={`fl-n-${i}`} plain onPress={() => mentor.openChange(c.io, changeId)}>
      {r.name}
    </Button>
  ) : (
    <Text key={`fl-n-${i}`} color={color} bold={!!touch} wrap="truncate-end">
      {r.name}
    </Text>
  )
  const right = touch ? (
    pill(c, touch, `fl-p-${i}`)
  ) : (
    <Text key={`fl-r-${i}`}>
      {gitState && <Text color={GIT_COLOR[gitState]} bold>{`${GIT_LETTER[gitState]} `}</Text>}
      <Text dimColor>{r.dir ? '' : stampOf(r.item.mtimeMs, c.now)}</Text>
    </Text>
  )
  return (
    <Box key={`fl-row-${i}`} flexDirection="row" columnGap={1} alignItems="center" paddingLeft={r.depth * 2} paddingRight={1} backgroundColor={desk && touch ? ROW_TINT[touch] : undefined}>
      {chevron}
      {icon}
      {nameEl}
      {touch && changeId && color && (
        <Button key={`fl-go-${i}`} plain dimColor onPress={() => mentor.openChange(c.io, changeId)}>
          →
        </Button>
      )}
      <Box flexGrow={1} />
      {right}
    </Box>
  )
}

const MAX_TREE = 300

/** Boczny panel „Pliki”: karta Teraz, szukanie, Claude dotknął, wszystkie pliki, ostatni commit. */
export async function renderFilesPane(io: Host, E: El, surface: string, cols: number): Promise<RenderElement> {
  const { Box, Text, Button, Input } = E as Elements['desktop']
  const f = await io.get(S.files)
  if (!f.loadedAt) void mentor.refreshFiles(io)
  const now = await io.now()
  const c: Ctx = { io, E, surface, cols, f, now }
  const act = await io.get(S.activity)
  const touchBy = new Map(touchedFiles(act, f.commit).map(t => [pkey(t.path), t.touch]))
  const changes = await io.get(S.changes)
  const rows = treeRows(f)
  const shown = rows.slice(0, MAX_TREE)
  const project = (f.root || posix(mentor.projectRoot)).split('/').pop() ?? ''
  return (
    <Box flexDirection="column">
      {await nowCard(c)}
      <Box marginTop={1}>
        <Input key="fl-q" placeholder="Znajdź plik" value={f.query} onInput={v => void mentor.searchFiles(io, v)} onSubmit={v => void mentor.searchFiles(io, v)} />
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap" marginTop={1}>
        <Button key="fl-refresh" onPress={() => void mentor.refreshFiles(io)}>
          Odśwież
        </Button>
        <Button key="fl-collapse" onPress={() => void io.set(S.files, x => ({ ...x, expanded: [] }))}>
          Zwiń wszystko
        </Button>
        <Button key="fl-hidden" onPress={() => void io.set(S.files, x => ({ ...x, showHidden: !x.showHidden }))}>
          {f.showHidden ? 'Ukryj ukryte pliki' : 'Pokaż ukryte pliki'}
        </Button>
      </Box>
      {await touchedList(c, 12)}
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text dimColor bold>
          WSZYSTKIE PLIKI
        </Text>
        <Text dimColor bold>
          {project.toUpperCase()}
        </Text>
      </Box>
      {!f.loadedAt ? <Text dimColor>Wczytuję pliki…</Text> : !rows.length ? <Text dimColor>{f.query ? 'Nic nie pasuje.' : 'Pusty katalog.'}</Text> : null}
      {shown.map((r, i) => treeRow(c, r, touchBy.get(pkey(r.path)), latestChangeFor(changes, r.path)?.id, i))}
      {rows.length > MAX_TREE && <Text dimColor>{`+ ${rows.length - MAX_TREE} więcej, zawęź szukaniem`}</Text>}
      {f.commit && (
        <Box flexDirection="row" marginTop={1}>
          <Box flexGrow={1} />
          <Text>
            <Text color={GREEN}>● zacommitowane </Text>
            <Text dimColor>{f.commit.sha}</Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** W Zmianach: karta Teraz i to, czego Claude dotknął, z przyciskiem do panelu Pliki. */
export async function renderFilesSummary(io: Host, k: Kit): Promise<RenderElement | null> {
  const { Box, Button } = k.E
  const act = await io.get(S.activity)
  const f = await io.get(S.files)
  if (!act.files.length && !mentor.work.startedAt) return null
  if (!f.loadedAt) void mentor.refreshFiles(io)
  const c: Ctx = { io, E: k.E, surface: k.surface, cols: k.cols, f, now: await io.now() }
  return (
    <Box key="fl-sum" flexDirection="column" marginTop={1}>
      {await nowCard(c)}
      {await touchedList(c, 6)}
      <Box marginTop={1}>
        <Button key="fl-open" plain dimColor onPress={() => void io.openFiles()}>
          Wszystkie pliki →
        </Button>
      </Box>
    </Box>
  )
}
