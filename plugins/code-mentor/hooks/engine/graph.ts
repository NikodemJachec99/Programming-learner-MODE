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

/** SVG grafu dla wybranego podzbioru pojęć (z ich wymaganiami). Najwyżej `maxNodes` węzłów, czytelny w jasnym i ciemnym motywie. */
export function graphSvg(concepts: readonly ConceptDef[], knowledge: readonly MentorKnowledgeRow[], focusIds: readonly string[], highlight: readonly string[], maxWidth = 640, maxNodes = 14): { svg: string; count: number } {
  const byId = new Map(concepts.map(c => [c.id, c]))
  const include = new Set<string>()
  // najpierw to, co polecane i używane w projekcie, potem ich bezpośrednie podstawy
  const ordered = [...new Set([...highlight, ...focusIds])].filter(id => byId.has(id))
  for (const id of ordered) {
    if (include.size >= Math.ceil(maxNodes * 0.6)) break
    include.add(id)
  }
  for (const id of [...include]) {
    for (const p of byId.get(id)!.prereqs) {
      if (include.size >= maxNodes) break
      include.add(p)
    }
  }
  const nodes = concepts.filter(c => include.has(c.id))
  // głębokość liczona tylko w tym podgrafie, żeby nie było pustych kolumn
  const local = new Map<string, number>()
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (local.has(id)) return local.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const ps = byId.get(id)!.prereqs.filter(p => include.has(p))
    const d = ps.length ? 1 + Math.max(...ps.map(p => depthOf(p, seen))) : 0
    local.set(id, d)
    return d
  }
  nodes.forEach(c => depthOf(c.id))
  const layers = new Map<number, ConceptDef[]>()
  for (const c of nodes) layers.set(local.get(c.id)!, [...(layers.get(local.get(c.id)!) ?? []), c])
  // układ z góry na dół: podstawy na górze, rząd zawija się do szerokości panelu
  const boxH = 28
  const gapX = 14
  const gapY = 30
  const textW = (t: string) => Math.ceil(t.length * 6.9) + 34
  const labelOf = (c: ConceptDef) => c.name.replace(/\s*\(.*\)$/, '')
  const pos = new Map<string, { x: number; y: number; w: number }>()
  let y = 8
  let width = 0
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const list = layers.get(d)!
    list.sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id))
    let x = 8
    for (const c of list) {
      const w = Math.min(maxWidth - 16, textW(labelOf(c)))
      if (x > 8 && x + w > maxWidth - 8) {
        x = 8
        y += boxH + 12
      }
      pos.set(c.id, { x, y, w })
      x += w + gapX
      width = Math.max(width, x)
    }
    y += boxH + gapY
  }
  const height = y - gapY + 16
  width = Math.max(width + 8, 200)
  const k = new Map(knowledge.map(r => [r.id, r]))
  const parts: string[] = [
    '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9aa3b2"/></marker></defs>',
  ]
  for (const c of nodes) {
    const to = pos.get(c.id)!
    for (const p of c.prereqs) {
      const from = pos.get(p)
      if (!from) continue
      const x1 = from.x + from.w / 2
      const y1 = from.y + boxH
      const x2 = to.x + to.w / 2
      const y2 = to.y - 2
      const my = (y1 + y2) / 2
      parts.push(`<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="#9aa3b2" stroke-opacity="0.8" stroke-width="1.4" marker-end="url(#arr)"/>`)
    }
  }
  for (const c of nodes) {
    const p = pos.get(c.id)!
    const row = k.get(c.id)
    const level = row?.level ?? 0
    const dot = LEVEL_COLORS[level] ?? LEVEL_COLORS[0]!
    const rec = highlight.includes(c.id)
    const label = labelOf(c)
    const chars = Math.max(6, Math.floor((p.w - 34) / 6.9))
    const short = label.length > chars ? label.slice(0, chars - 1) + '…' : label
    parts.push(
      `<g><title>${esc(`${c.name}: ${levelName(level)}${row ? `, opanowanie ${Math.round(row.mastery * 100)}%` : ''}${rec ? '. Polecane teraz.' : ''}`)}</title>` +
        `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${boxH}" rx="7" fill="#1f2430" stroke="${rec ? '#d97757' : '#4a5160'}" stroke-width="${rec ? 2.5 : 1}"/>` +
        `<circle cx="${p.x + 13}" cy="${p.y + boxH / 2}" r="5" fill="${dot}"/>` +
        `<text x="${p.x + 24}" y="${p.y + boxH / 2 + 4}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="${rec ? 600 : 400}" fill="#eef1f5">${esc(short)}</text></g>`,
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
  return { svg, count: nodes.length }
}
