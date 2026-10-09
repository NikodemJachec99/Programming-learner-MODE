// Grafika paneli: shimmer aktywnych plików, migoczący pasek postępu, zadania w tle,
// pogoda kontekstu i oś kroków. Desktop: SVG z animacją CSS (bez przerysowań panelu),
// z prefers-reduced-motion i prefers-color-scheme. Terminal: tekstowe odpowiedniki.
//
// Zapożyczenia (licencje w THIRD_PARTY_NOTICES.md):
// - palety tonów i funkcja shimmer: claude-code-filetree, MIT, (c) 2026 Kurt Buhler
// - pasek z pikseli, styl wierszy, formaty: claude-kit/savvy-progress, MIT, (c) 2026 johnnyvizz
// - pasma pogody kontekstu: claude-code-playground/token-weather, Apache-2.0, Anthropic
// Panel agentów i pasek zadania: savvy.ts, krab: crab.ts (oba z savvy-progress).

import { statusMarkSvg } from './savvy'

// ---------- tony i shimmer (claude-code-filetree) ----------

/** Cztery jasne i cztery ciemne odcienie tonu: od nasyconego do prawie białego. */
export const TONES = {
  orange: { bright: ['#f97316', '#fb923c', '#fdba74', '#ffedd5'], dim: ['#8a4316', '#a3562a', '#bd7444', '#d29267'], solid: '#f97316' },
  green: { bright: ['#22c55e', '#4ade80', '#86efac', '#dcfce7'], dim: ['#14532d', '#166534', '#2f7a47', '#4f9a66'], solid: '#4ade80' },
  purple: { bright: ['#a855f7', '#c084fc', '#d8b4fe', '#f3e8ff'], dim: ['#581c87', '#6b21a8', '#8b47c4', '#a874d6'], solid: '#c084fc' },
  red: { bright: ['#ef4444', '#f87171', '#fca5a5', '#fee2e2'], dim: ['#7f1d1d', '#991b1b', '#b54040', '#c96a6a'], solid: '#f87171' },
} as const
export type ToneName = keyof typeof TONES

/** Kolor znaku `i` w paśmie światła przesuwanym klatką `phase` (jak w filetree). */
export function shimmer(i: number, phase: number, len: number, palette: readonly string[]): string {
  const band = ((phase * 1.6) % (len + 8)) - 4
  const d = Math.abs(i - band)
  return palette[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? palette[0] ?? '#f97316'
}

const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const FONT = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

/** Szerokość tekstu w px, z grubsza (do rozmiaru SVG). */
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZĄĆĘŁŃÓŚŹŻmw@%]/.test(ch) ? 0.72 : 0.56)
export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
const fit = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

/**
 * Nazwa z przesuwającym się pasmem światła (desktop). Tekst w kolorze tonu, nad nim jaśniejsze
 * pasmo przycięte do kształtu liter, przesuwane przez CSS. Bez ruchu przy ograniczeniu animacji.
 */
export function shimmerSvg(text: string, tone: ToneName, size = 13): { svg: string; width: number; height: number } {
  const t = TONES[tone]
  const w = Math.ceil(textWidth(text, size) + 4)
  const h = Math.round(size * 1.45)
  const y = Math.round(size * 1.08)
  const id = `s${Math.abs([...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>.sh{animation:sw 1.5s linear infinite}@keyframes sw{from{transform:translateX(-36px)}to{transform:translateX(${w + 8}px)}}@media (prefers-reduced-motion: reduce){.sh{animation:none;opacity:0}}</style><defs><linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="${t.bright[3]}" stop-opacity="0"/><stop offset=".5" stop-color="${t.bright[3]}" stop-opacity="1"/><stop offset="1" stop-color="${t.bright[3]}" stop-opacity="0"/></linearGradient><clipPath id="${id}c"><text x="1" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="600">${xml(text)}</text></clipPath></defs><text x="1" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="600" fill="${t.bright[0]}">${xml(text)}</text><g clip-path="url(#${id}c)"><rect class="sh" x="0" y="0" width="34" height="${h}" fill="url(#${id}g)"/></g></svg>`
  return { svg, width: w, height: h }
}

// ---------- pasek z pikseli (savvy-progress) ----------

/** Szum deterministyczny: piksele nie skaczą między przerysowaniami. */
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Pasek postępu z migoczących pikseli i pigułką z etykietą przy czole wypełnienia.
 * `live`: piksele migoczą (trwa); po zakończeniu spokojna poświata.
 */
export function pixelBarSvg(ratio: number, width: number, color: string, labelText: string, live: boolean): string {
  const H = 16
  const CELL = 3
  const r = Math.max(0, Math.min(1, ratio))
  const fillW = Math.round(width * r)
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(H / CELL)
  const dots: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let y = 0; y < rows; y++) if (noise(c, y) < density) dots.push(`<rect class="t${Math.floor(noise(y, c) * 4)}" x="${c * CELL + 1}" y="${y * CELL + 1}" width="2" height="2"/>`)
  }
  const pillW = Math.round(16 + textWidth(labelText, 11))
  const pillX = Math.max(0, Math.min(width - pillW, fillW - pillW))
  const cid = `pb${width}x${fillW}${live ? 'l' : 'd'}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"><style>.k{fill:#e4e4e2}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}}.t0,.t1,.t2,.t3{animation:tw ${live ? 2.2 : 3.2}s ease-in-out infinite}.t1{animation-duration:${live ? 2.8 : 3.8}s;animation-delay:-.7s}.t2{animation-duration:${live ? 1.9 : 4.4}s;animation-delay:-1.3s}.t3{animation-duration:${live ? 3.3 : 3.5}s;animation-delay:-.4s}@keyframes tw{0%,100%{opacity:1}50%{opacity:${live ? 0.3 : 0.8}}}@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}</style><defs><clipPath id="${cid}"><rect width="${width}" height="${H}" rx="${H / 2}"/></clipPath></defs><rect class="k" width="${width}" height="${H}" rx="${H / 2}"/><g clip-path="url(#${cid})" fill="${color}">${dots.join('')}</g><rect x="${pillX}" width="${pillW}" height="${H}" rx="${H / 2}" fill="${color}"/><text x="${pillX + pillW / 2}" y="${H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(labelText)}</text></svg>`
}

/** Tekstowy odpowiednik paska. */
export const pixelBarText = (ratio: number, width: number): string => {
  const n = Math.round(Math.max(0, Math.min(1, ratio)) * width)
  return '█'.repeat(n) + '░'.repeat(Math.max(0, width - n))
}

// ---------- pogoda kontekstu (token-weather) ----------

export type Weather = { icon: string; word: string; color: string }

/** Pasmo zajętości okna kontekstu jako pogoda. Bez obietnic o kompakcji. */
export function weather(percent: number): Weather {
  if (percent < 25) return { icon: '☀', word: 'pogodnie', color: 'warning' }
  if (percent < 50) return { icon: '☁', word: 'pochmurno', color: 'ide' }
  if (percent < 75) return { icon: '☂', word: 'przelotnie', color: 'suggestion' }
  if (percent < 90) return { icon: '☇', word: 'burzowo', color: 'permission' }
  return { icon: '↯', word: 'pełno', color: 'error' }
}

// ---------- formaty i styl wierszy (savvy-progress) ----------

const PANE_CSS =
  '<style>.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}' +
  '@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}' +
  '.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}@media (prefers-reduced-motion: reduce){.live{animation:none}}</style>'

export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)
export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// ---------- zadania w tle (styl wierszy savvy-progress, terminal jak w filetree) ----------

export type TaskView = {
  title: string
  command: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  elapsedMs: number
  tail: string[]
  summary?: string
}

/** Wysokość wiersza zadania w zależności od liczby linii wyjścia. */
export const taskRowHeight = (t: TaskView) => 50 + Math.max(1, t.tail.length) * 14 + 8

/**
 * Wiersz zadania w tle: ikona terminala z mrugającym kursorem, opis i komenda, czas, stan,
 * pasek „trwa” z przesuwającym się pasmem i ostatnie linie wyjścia (najnowsza pulsuje).
 */
export function taskRowSvg(width: number, t: TaskView): string {
  const H = taskRowHeight(t)
  const live = t.status === 'running'
  const color = t.status === 'failed' ? '#d0453f' : t.status === 'killed' ? '#9a9a96' : live ? '#d97757' : '#3b9c5f'
  const textW = width - 44 - 22
  const head = t.title || t.command
  const sub = t.title ? `$ ${t.command}` : ''
  const cid = `tb${Math.round(width)}x${H}`
  const icon = `<rect x="2" y="6" width="28" height="22" rx="5" fill="#2a2522"/><path d="M8 13l4 3.5-4 3.5" fill="none" stroke="#eee" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect class="${live ? 'cur' : ''}" x="15" y="19" width="8" height="2" rx="1" fill="${color}"/>`
  const bar = live
    ? `<rect class="k" x="44" y="40" width="${textW}" height="3" rx="1.5"/><g clip-path="url(#${cid})"><rect class="sweep" x="44" y="40" width="${Math.round(textW * 0.28)}" height="3" rx="1.5" fill="${color}"/></g>`
    : `<rect x="44" y="40" width="${textW}" height="3" rx="1.5" fill="${color}" opacity="${t.status === 'completed' ? 0.85 : 0.5}"/>`
  const lines = (t.tail.length ? t.tail : [live ? 'czekam na wyjście…' : (t.summary ?? 'bez wyjścia')])
    .map((l, i, all) => `<text class="${i === all.length - 1 && live ? 'nl' : 's'}" x="44" y="${58 + i * 14}" font-family="${MONO}" font-size="11">${xml(fit(l, 11, textW))}</text>`)
    .join('')
  const state = live ? `trwa ${fmtTime(t.elapsedMs)}` : `${t.status === 'completed' ? 'gotowe' : t.status === 'killed' ? 'zatrzymane' : 'błąd'} · ${fmtTime(t.elapsedMs)}`
  const css =
    '<style>.cur{animation:cb 1s steps(1) infinite}@keyframes cb{50%{opacity:0}}' +
    `.sweep{animation:sw 1.4s ease-in-out infinite}@keyframes sw{0%{transform:translateX(-30%)}100%{transform:translateX(${Math.round(textW * 0.9)}px)}}` +
    '.nl{fill:#1f1f1f;animation:nl 1.6s ease-in-out infinite}@media (prefers-color-scheme: dark){.nl{fill:#ececec}}@keyframes nl{50%{opacity:.55}}' +
    '@media (prefers-reduced-motion: reduce){.cur,.sweep,.nl{animation:none}}</style>'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">${PANE_CSS}${css}` +
    `<defs><clipPath id="${cid}"><rect x="44" y="40" width="${textW}" height="3" rx="1.5"/></clipPath></defs>${icon}` +
    `<text class="t" x="44" y="16" font-family="${FONT}" font-size="13" font-weight="600">${xml(fit(head, 13, textW - textWidth(state, 11) - 12))}</text>` +
    `<text class="s" x="${44 + textW}" y="16" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(state)}</text>` +
    (sub ? `<text class="s" x="44" y="31" font-family="${MONO}" font-size="11">${xml(fit(sub, 11, textW))}</text>` : '') +
    `${bar}${lines}${statusMarkSvg(width - 8, 12, live ? 'running' : t.status === 'completed' ? 'done' : 'failed', color)}` +
    `<line class="ln" x1="0" y1="${H - 0.5}" x2="${width}" y2="${H - 0.5}"/></svg>`
  )
}
