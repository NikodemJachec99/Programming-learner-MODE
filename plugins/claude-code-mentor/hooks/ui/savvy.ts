// Rysunki paska nad promptem i panelu agentów przeniesione z claude-kit/savvy-progress
// (hooks/register.tsx: rowSvg, headerSvg, agentSvg, statusMark, PANE_CSS, noise, fitText).
// MIT License, Copyright (c) 2026 johnnyvizz; pełny tekst w THIRD_PARTY_NOTICES.md.
// Zmiany: polskie teksty, dane z modelu agentów Mentora, etykiety ról zamiast tierów.
// Krab i kostiumy też z savvy-progress, w crab.ts.

import { CRAB_CSS, COSTUME_COLOR, crab } from './crab'
import type { Costume } from './crab'

const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
export const FLOW_ACCENT = ACCENT
export const FLOW_DONE = DONE
const H = 22
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Przybliżona szerokość tekstu systemowego w em; wystarczy do rozmiaru pól.
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZĄĆĘŁŃÓŚŹŻmw@%]/.test(ch) ? 0.72 : 0.56)
const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// Szum deterministyczny: piksele nie migają przy każdym przerysowaniu.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  isFinished: boolean
  label: string
  /** Praca bez znanej liczby kroków: zamiast wypełnienia po pasku przesuwa się pasmo pikseli. */
  indeterminate?: boolean
  /** Tekst po prawej zamiast procentu (np. czas pracy). */
  right?: string
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

/**
 * Pasek nad promptem: kropka, tytuł zadania, pasek z migoczących pikseli (gęstszy ku czołu),
 * słabsza warstwa dla przekazanych i jeszcze nie skończonych, znaczniki zadań, pigułka z etykietą,
 * procent i krab. Cały wiersz to jedno SVG (desktop zawija elementy obok siebie).
 */
export function flowRowSvg(f: Flow, W: number, isWorking: boolean, costume: Costume = 'other'): string {
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
  }
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
  }
  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }
  // praca bez znanego końca: rzadki ślad na całym pasku i gęstniejące ku czołu pasmo, które jedzie w prawo
  const sweeping = f.indeterminate === true && !f.isFinished
  const segW = Math.max(48, Math.round(BAR_W * 0.28))
  const trail: string[] = []
  const band: string[] = []
  if (sweeping) {
    for (let c = 0; c < Math.floor(BAR_W / CELL); c++) {
      for (let r = 0; r < rows; r++) if (noise(c + 11, r + 5) < 0.14) trail.push(`<rect class="t${Math.floor(noise(r + 2, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
    const segCols = Math.floor(segW / CELL)
    for (let c = 0; c < segCols; c++) {
      const density = 0.15 + 0.8 * Math.pow(c / Math.max(1, segCols - 1), 1.6)
      for (let r = 0; r < rows; r++) if (noise(c + 3, r + 9) < density) band.push(`<rect class="t${Math.floor(noise(r, c + 4) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  const pillW = Math.round(18 + f.label.length * 6.6)
  const pillX = sweeping ? 0 : Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = f.right ?? `${Math.round(ratio(f) * 100)}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}${sweeping ? `
.sw{animation:sw 2.6s cubic-bezier(.45,.05,.4,.95) infinite}
@keyframes sw{0%{transform:translateX(${-segW}px)}100%{transform:translateX(${BAR_W}px)}}
@media (prefers-reduced-motion: reduce){.sw{animation:none}}` : ''}
</style>
<defs><clipPath id="fc${W}"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#fc${W})">
<g fill="${color}">${dots.join('')}</g>${sweeping ? `
<g fill="${color}" opacity="0.35">${trail.join('')}</g>
<g class="sw" fill="${color}" transform="translate(${Math.round((BAR_W - segW) / 2)},0)">${band.join('')}</g>` : ''}
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(f.label)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, costume, isWorking, false, 0.8)}
</svg>`
}

/** Tekstowy pasek dla terminala. */
export const flowBarText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------- panel agentów ----------

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

export function statusMarkSvg(x: number, y: number, status: string, color: string): string {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const svg = (W: number, Hh: number, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

export const headerHeight = (title: string): number => (title ? 72 : 44)

/** Nagłówek panelu: tytuł zadania i trzy kafelki (koszt, tokeny, czas). */
export function headerSvg(W: number, title: string, tiles: [string, string][]): string {
  const gap = 6
  const tw = (W - gap * (tiles.length - 1)) / tiles.length
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${xml(k)}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${xml(v)}</text>`
  return svg(W, headerHeight(title), `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}${tiles.map(([k, v], i) => tile(i, k, v)).join('')}`)
}

export type AgentRow = {
  costume: Costume
  description: string
  role: string
  model: string
  effort?: string
  status: 'running' | 'done' | 'failed'
  /** Linia kroków: co robi teraz (savvy: „3/5 · Hero copy”). */
  steps: string
  /** „ctx 4% · 38k ≈$0.05 0:27”. */
  stats: string
  /** Wypełnienie paska: postęp albo kontekst; null = kontekst, rysowany na szaro. */
  progress: number | null
  ctx: number
}

/** Wiersz agenta: krab, zadanie, rola i model, kroki, statystyki, pasek, znacznik stanu. */
export function agentSvg(W: number, a: AgentRow): string {
  const color = COSTUME_COLOR[a.costume]
  const textW = W - 42 - 22
  const meta = [a.effort ? `${a.model} · ${a.effort}` : a.model]
  if (a.status === 'failed') meta.push('błąd')
  const barW = textW
  const stepsW = Math.max(0, barW - textWidth(a.stats, 11) - 12)
  const fillW = Math.round(barW * (a.progress ?? a.ctx / 100))
  return svg(
    W,
    66,
    `${crab(0, 14, a.costume, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(a.role)}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${a.steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(a.steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(a.stats)}</text>
<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect${a.progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${a.progress === null ? '' : ` fill="${color}"`}/>
${statusMarkSvg(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

/** Widok skrócony: rząd krabów z kropką dla pracujących i podsumowanie po prawej. */
export function compactSvg(W: number, icons: { costume: Costume; status: string }[], summary: string): string {
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => crab(i * 36, 0, ic.costume, ic.status === 'running', ic.status === 'planned') + (ic.status === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${COSTUME_COLOR[ic.costume]}"/>` : ''))
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(W, 32, `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${xml(summary)}</text>`)
}
