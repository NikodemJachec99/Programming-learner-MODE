// Pliki projektu i to, czego Claude dotknął (wzorzec claude-code-filetree, MIT, (c) 2026 Kurt Buhler):
// drzewo z katalogów rozwijanych na żądanie, status gita z jednego `git status`, gałąź, odczyty
// na fioletowo, edycje na pomarańczowo, commit na zielono. Czyste funkcje; I/O robi mentor.ts.

import type { Activity, FileAct } from './activity'

export type FsItem = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; size: number }
export type GitChange = 'new' | 'mod' | 'del'
export type GitView = { branch: string; upstream: string; ahead: number; behind: number; files: Record<string, GitChange> }

export type FilesState = {
  root: string
  listing: Record<string, FsItem[]>
  expanded: string[]
  query: string
  showHidden: boolean
  isRepo: boolean | null
  top: string
  git: GitView | null
  /** Ostatni commit Claude w tej sesji i pliki, które nim weszły. */
  commit: { sha: string; files: string[]; at: number } | null
  loadedAt: number
}

export const EMPTY_FILES: FilesState = { root: '', listing: {}, expanded: [], query: '', showHidden: true, isRepo: null, top: '', git: null, commit: null, loadedAt: 0 }

/** Ścieżka z ukośnikami, bez końcowego „/”. */
export const posix = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
/** Klucz porównania: Windows nie rozróżnia wielkości liter. */
export const pkey = (p: string): string => (/^[A-Za-z]:/.test(p) ? posix(p).toLowerCase() : posix(p))
export const join = (dir: string, name: string): string => (dir.endsWith('/') ? dir + name : `${dir}/${name}`)
export const parentOf = (p: string): string => {
  const i = posix(p).lastIndexOf('/')
  return i <= 0 ? '/' : posix(p).slice(0, i)
}
export const inside = (root: string, p: string): boolean => pkey(p) === pkey(root) || pkey(p).startsWith(pkey(root) + '/')
export const rel = (root: string, p: string): string => (inside(root, p) ? posix(p).slice(posix(root).length + 1) : posix(p))

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Katalogi pierwsze, potem nazwy po ludzku (jak filetree: toNodes). */
export function sortItems(list: readonly FsItem[]): FsItem[] {
  return [...list].sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name))
}

/** Katalogi między korzeniem a plikiem (bez korzenia), od góry. */
export function ancestors(root: string, p: string): string[] {
  const out: string[] = []
  if (!inside(root, p)) return out
  for (let d = parentOf(p); pkey(d) !== pkey(root) && inside(root, d); d = parentOf(d)) out.unshift(d)
  return out
}

/** `git status --porcelain=v1 -b -z`: gałąź i zmiana każdego pliku (ścieżki od korzenia repozytorium). */
export function parseStatus(stdout: string, top: string): GitView {
  const view: GitView = { branch: '', upstream: '', ahead: 0, behind: 0, files: {} }
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (rec.startsWith('## ')) {
      const body = rec.slice(3)
      view.branch = body.startsWith('HEAD (no branch)') ? 'detached' : (/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/.exec(body)?.[1] ?? body)
      view.upstream = /\.\.\.(\S+)/.exec(body)?.[1] ?? ''
      view.ahead = Number(/ahead (\d+)/.exec(body)?.[1] ?? 0)
      view.behind = Number(/behind (\d+)/.exec(body)?.[1] ?? 0)
      continue
    }
    if (rec.length < 4) continue
    const xy = rec.slice(0, 2)
    if (xy[0] === 'R' || xy[0] === 'C') i++
    if (xy === '!!') continue
    const path = pkey(join(top, rec.slice(3).replace(/\/$/, '')))
    view.files[path] = xy === '??' || (xy.includes('A') && !xy.includes('D')) ? 'new' : xy.includes('D') && !/U/.test(xy) ? 'del' : 'mod'
  }
  return view
}

/** Ile plików pod katalogiem ma zmiany (do koloru folderu). */
export function dirChanged(git: GitView | null, dir: string): boolean {
  if (!git) return false
  const k = pkey(dir) + '/'
  return Object.keys(git.files).some(f => f.startsWith(k))
}

export type TreeRow = { path: string; name: string; depth: number; dir: boolean; open: boolean; item: FsItem }

/** Widoczne wiersze drzewa: rozwinięte katalogi, filtr nazwy (z rodzicami), ukryte pliki na życzenie. */
export function treeRows(f: FilesState): TreeRow[] {
  const q = f.query.trim().toLowerCase()
  const open = new Set(f.expanded.map(pkey))
  const rows: TreeRow[] = []
  const matches = (dir: string, depth: number): boolean => {
    for (const it of f.listing[pkey(dir)] ?? []) {
      const p = join(dir, it.name)
      if (rel(f.root, p).toLowerCase().includes(q)) return true
      if (it.kind === 'dir' && depth < 12 && matches(p, depth + 1)) return true
    }
    return false
  }
  const walk = (dir: string, depth: number) => {
    for (const it of sortItems(f.listing[pkey(dir)] ?? [])) {
      if (!f.showHidden && it.name.startsWith('.')) continue
      const p = join(dir, it.name)
      const isDir = it.kind === 'dir'
      if (q && !rel(f.root, p).toLowerCase().includes(q) && !(isDir && matches(p, depth + 1))) continue
      const isOpen = isDir && (q ? !!f.listing[pkey(p)] : open.has(pkey(p)))
      rows.push({ path: p, name: it.name, depth, dir: isDir, open: isOpen, item: it })
      if (isOpen) walk(p, depth + 1)
    }
  }
  if (f.root) walk(f.root, 0)
  return rows
}

export type Touch = 'reading' | 'editing' | 'opened' | 'edited' | 'committed' | 'failed' | 'denied' | 'work'

export const TOUCH_LABEL: Record<Touch, string> = {
  reading: 'Czyta…',
  editing: 'Edytuje…',
  opened: 'Otwarty',
  edited: 'Edytowany',
  committed: 'Zacommitowany',
  failed: 'Błąd',
  denied: 'Odrzucony',
  work: 'Roboczy',
}

/** Stan pliku, którego Claude dotknął w tej turze. Commit wygrywa z edycją, błąd z sukcesem. */
export function touchOf(a: FileAct, commit: FilesState['commit']): Touch {
  if (a.active) return a.kind === 'edit' ? 'editing' : 'reading'
  if (a.denied) return 'denied'
  if (a.ok === false) return 'failed'
  if (a.edits > 0) return commit && commit.files.some(x => pkey(x) === pkey(a.path)) ? 'committed' : 'edited'
  return 'opened'
}

/** Pliki dotknięte w tej turze: najświeższe na górze. */
export function touchedFiles(act: Activity, commit: FilesState['commit']): { path: string; touch: Touch; act: FileAct }[] {
  return [...act.files].sort((x, y) => y.at - x.at || y.since - x.since).map(a => ({ path: a.path, touch: touchOf(a, commit), act: a }))
}

/** Karta „Teraz”: co Claude robi w tej chwili i ile plików otworzył i zmienił. */
export function rightNow(act: Activity, working: boolean, tool: string): { title: string; sub: string } {
  const live = act.files.find(f => f.active)
  const name = (p: string) => posix(p).split('/').pop() ?? p
  const opened = act.files.length
  const edited = act.files.filter(f => f.edits > 0).length
  const parts: string[] = []
  if (opened) parts.push(`${opened === 1 ? 'otworzył 1 plik' : `otworzył ${opened} ${opened % 10 >= 2 && opened % 10 <= 4 && (opened % 100 < 12 || opened % 100 > 14) ? 'pliki' : 'plików'}`}`)
  if (edited) parts.push(`zmienił ${edited}`)
  const sub = parts.join(', ') || (working ? 'jeszcze nic nie otworzył' : 'nic nie otworzył')
  if (!working) return { title: opened ? 'Claude skończył' : 'Claude czeka na polecenie', sub }
  if (live) return { title: `Claude ${live.kind === 'edit' ? 'edytuje' : 'czyta'} ${name(live.path)}`, sub }
  if (/^(Bash|PowerShell)$/.test(tool)) return { title: 'Claude uruchamia komendę', sub }
  if (/^(Grep|Glob)$/.test(tool)) return { title: 'Claude szuka w plikach', sub }
  if (/^Web/.test(tool)) return { title: 'Claude szuka w sieci', sub }
  if (tool === 'Agent' || tool === 'Task') return { title: 'Claude deleguje do agenta', sub }
  return { title: 'Claude myśli', sub }
}

/** Plakietka typu pliku (jak ikony filetree, ale tekstem: JS, TS, {}, GIT). */
export function fileBadge(name: string): { label: string; color: string } {
  const lower = name.toLowerCase()
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return { label: 'GIT', color: '#f05033' }
  if (lower === 'dockerfile') return { label: 'DK', color: '#2496ed' }
  if (lower === 'license' || lower === 'licence') return { label: '©', color: '#d4a72c' }
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  const map: Record<string, [string, string]> = {
    js: ['JS', '#e8c547'], mjs: ['JS', '#e8c547'], cjs: ['JS', '#e8c547'], jsx: ['JSX', '#5ccfe6'],
    ts: ['TS', '#4a90d9'], mts: ['TS', '#4a90d9'], cts: ['TS', '#4a90d9'], tsx: ['TSX', '#4a90d9'], json: ['{ }', '#cbcb41'], jsonc: ['{ }', '#cbcb41'],
    md: ['MD', '#8fa1b3'], py: ['PY', '#4f9bd5'], dart: ['DT', '#40c4ff'], go: ['GO', '#00add8'], rs: ['RS', '#dea584'],
    java: ['JV', '#e76f00'], kt: ['KT', '#a97bff'], cs: ['C#', '#9b4f96'], php: ['PHP', '#8892bf'], rb: ['RB', '#cc342d'],
    html: ['<>', '#e44d26'], htm: ['<>', '#e44d26'], css: ['#', '#4a90d9'], scss: ['#', '#cd6799'], vue: ['VUE', '#41b883'],
    svelte: ['SV', '#ff3e00'], sql: ['SQL', '#e38c00'], sh: ['$', '#89e051'], ps1: ['PS', '#5391fe'], bat: ['$', '#89e051'],
    yml: ['YML', '#cb171e'], yaml: ['YML', '#cb171e'], toml: ['TML', '#9c4221'], xml: ['XML', '#e37933'], txt: ['TXT', '#8a8a86'],
    lock: ['LCK', '#8a8a86'], env: ['ENV', '#ecd53f'], png: ['IMG', '#a074c4'], jpg: ['IMG', '#a074c4'], jpeg: ['IMG', '#a074c4'],
    svg: ['SVG', '#ffb13b'], gif: ['IMG', '#a074c4'], webp: ['IMG', '#a074c4'], pdf: ['PDF', '#e5252a'], c: ['C', '#5c6bc0'],
    cpp: ['C++', '#5c6bc0'], h: ['H', '#5c6bc0'], swift: ['SW', '#f05138'], lua: ['LUA', '#6c78d4'], csv: ['CSV', '#89e051'],
  }
  const hit = map[ext]
  return hit ? { label: hit[0], color: hit[1] } : { label: '·', color: '#8a8a86' }
}

/** Godzina zmiany pliku (dziś) albo dzień i miesiąc. */
export function stampOf(ms: number, now: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const n = new Date(now)
  const p = (v: number) => String(v).padStart(2, '0')
  return d.toDateString() === n.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getDate())}.${p(d.getMonth() + 1)}`
}
