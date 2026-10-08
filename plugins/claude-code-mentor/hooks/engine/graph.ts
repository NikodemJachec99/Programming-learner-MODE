// Graf pojęć i ścieżka nauki: układ warstwowy (wg zależności), kolory wg
// poziomu znajomości, rekomendacje następnych kroków z uzasadnieniem.

import type { ConceptDef } from '../content/types'
import type { MentorKnowledgeRow } from '../../types'
import { levelName } from './lessons'

export const LEVEL_COLORS = ['#7c8594', '#4f8ef7', '#a77bf3', '#e0a33a', '#3fb27f']

export function depthMap(concepts: readonly ConceptDef[]): Map<string, number> {
  const byId = new Map(concepts.map(c => [c.id, c]))
  const memo = new Map<string, number>()
  const depth = (id: string, stack: Set<string>): number => {
    const known = memo.get(id)
    if (known !== undefined) return known
    if (stack.has(id)) return 0
    stack.add(id)
    const c = byId.get(id)
    const d = c && c.prereqs.length ? 1 + Math.max(...c.prereqs.map(p => depth(p, stack))) : 0
    stack.delete(id)
    memo.set(id, d)
    return d
  }
  for (const c of concepts) depth(c.id, new Set())
  return memo
}

/** Pojęcia z brakami: wymagania wstępne poniżej "Rozumiem częściowo". */
export function missingPrereqs(c: ConceptDef, levels: Record<string, number>, concepts: readonly ConceptDef[], depth = 2): ConceptDef[] {
  const byId = new Map(concepts.map(x => [x.id, x]))
  const out: ConceptDef[] = []
  const visit = (id: string, d: number) => {
    const x = byId.get(id)
    if (!x || d > depth) return
    for (const p of x.prereqs) {
      const pc = byId.get(p)
      if (!pc) continue
      if ((levels[p] ?? 0) < 2 && !out.includes(pc)) out.push(pc)
      visit(p, d + 1)
    }
  }
  visit(c.id, 1)
  return out.slice(0, 4)
}

export type Recommendation = { id: string; name: string; reason: string; kind: 'review' | 'foundation' | 'next' }

export function recommend(concepts: readonly ConceptDef[], knowledge: readonly MentorKnowledgeRow[], projectConcepts: Record<string, number>, limit = 6): Recommendation[] {
  const k = new Map(knowledge.map(r => [r.id, r]))
  const lvl = (id: string) => k.get(id)?.level ?? 0
  const byId = new Map(concepts.map(c => [c.id, c]))
  const out: Recommendation[] = []
  const add = (r: Recommendation) => {
    if (!out.some(x => x.id === r.id)) out.push(r)
  }
  for (const r of knowledge.filter(r => r.due).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0)).slice(0, 2)) {
    add({ id: r.id, name: r.name, reason: `Powtórka: termin minął, poziom ${levelName(r.level)}. Powtórka teraz utrwala wiedzę na dłużej (spaced repetition).`, kind: 'review' })
  }
  const scored = concepts
    .filter(c => lvl(c.id) < 3)
    .map(c => {
      const used = projectConcepts[c.id] ?? 0
      const exp = k.get(c.id)?.exposures ?? 0
      const unmet = c.prereqs.filter(p => lvl(p) < 2)
      const score = (used * 3 + Math.min(exp, 10)) * c.weight + (c.weight === 3 ? 4 : 0) - unmet.length * 2
      return { c, used, exp, unmet, score }
    })
    .sort((a, b) => b.score - a.score)
  for (const s of scored) {
    if (out.length >= limit) break
    if (s.unmet.length) {
      const base = byId.get(s.unmet[0]!)
      if (base && lvl(base.id) < 2) {
        add({ id: base.id, name: base.name, reason: `Podstawa dla „${s.c.name}”${s.used ? `, którego Claude używa w tym projekcie (${s.used}×)` : ''}. Bez niej tamto będzie niejasne.`, kind: 'foundation' })
        continue
      }
    }
    add({
      id: s.c.id,
      name: s.c.name,
      reason: s.used ? `Występuje w bieżącym projekcie ${s.used}×, a Twój poziom to ${levelName(lvl(s.c.id))}.` : s.exp ? `Claude używał tego w Twoich projektach ${s.exp}×. Poziom: ${levelName(lvl(s.c.id))}.` : `Fundament (waga ${s.c.weight}/3), wszystkie wymagania wstępne spełnione.`,
      kind: 'next',
    })
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** SVG grafu dla wybranego podzbioru pojęć (z ich wymaganiami). */
export function graphSvg(concepts: readonly ConceptDef[], knowledge: readonly MentorKnowledgeRow[], focusIds: readonly string[], highlight: readonly string[], maxWidth = 640): { svg: string; count: number } {
  const byId = new Map(concepts.map(c => [c.id, c]))
  const include = new Set<string>()
  const addWithPrereqs = (id: string, d = 0) => {
    const c = byId.get(id)
    if (!c || include.has(id) || d > 6) return
    include.add(id)
    c.prereqs.forEach(p => addWithPrereqs(p, d + 1))
  }
  focusIds.forEach(id => addWithPrereqs(id))
  const nodes = concepts.filter(c => include.has(c.id))
  const depth = depthMap(concepts)
  const layers = new Map<number, ConceptDef[]>()
  for (const c of nodes) {
    const d = depth.get(c.id) ?? 0
    layers.set(d, [...(layers.get(d) ?? []), c])
  }
  const maxDepth = Math.max(0, ...layers.keys())
  const colW = Math.max(110, Math.floor(maxWidth / (maxDepth + 1)))
  const rowH = 30
  const boxW = colW - 18
  const pos = new Map<string, { x: number; y: number }>()
  let maxRows = 0
  for (const [d, list] of layers) {
    list.sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id))
    list.forEach((c, i) => pos.set(c.id, { x: 8 + d * colW, y: 10 + i * rowH }))
    maxRows = Math.max(maxRows, list.length)
  }
  const width = 16 + (maxDepth + 1) * colW
  const height = 20 + maxRows * rowH
  const k = new Map(knowledge.map(r => [r.id, r]))
  const parts: string[] = []
  for (const c of nodes) {
    const to = pos.get(c.id)!
    for (const p of c.prereqs) {
      const from = pos.get(p)
      if (!from) continue
      const x1 = from.x + boxW
      const y1 = from.y + 11
      const x2 = to.x
      const y2 = to.y + 11
      const mx = (x1 + x2) / 2
      parts.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#8a93a3" stroke-opacity="0.45" stroke-width="1"/>`)
    }
  }
  for (const c of nodes) {
    const p = pos.get(c.id)!
    const row = k.get(c.id)
    const level = row?.level ?? 0
    const color = LEVEL_COLORS[level] ?? LEVEL_COLORS[0]!
    const hl = highlight.includes(c.id)
    const label = c.name.replace(/\s*\(.*\)$/, '')
    const short = label.length > Math.floor(boxW / 6.4) ? label.slice(0, Math.floor(boxW / 6.4) - 1) + '…' : label
    parts.push(
      `<g><title>${esc(`${c.name}: ${levelName(level)}${row ? `, opanowanie ${Math.round(row.mastery * 100)}%` : ''}`)}</title>` +
        `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="22" rx="6" fill="${color}" fill-opacity="${hl ? 0.38 : 0.16}" stroke="${color}" stroke-width="${hl ? 2 : 1}"/>` +
        `<text x="${p.x + 8}" y="${p.y + 15}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" fill="${color}">${esc(short)}</text></g>`,
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
  return { svg, count: nodes.length }
}
