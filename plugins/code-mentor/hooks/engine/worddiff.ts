// Diff linia po linii ze zmienionymi słowami (wygląd replay-theater): pary linii − i + z tego
// samego bloku dostają zakresy znaków, które się różnią. Czyste funkcje, bez I/O.

export type DiffRow =
  | { kind: '-' | '+' | ' '; text: string; spans: [number, number][]; line: number }
  | { kind: 'gap' }

const TOKEN = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu

function tokens(s: string): { t: string; at: number }[] {
  const out: { t: string; at: number }[] = []
  for (const m of s.matchAll(TOKEN)) out.push({ t: m[0], at: m.index ?? 0 })
  return out
}

/** Zakresy znaków różniących się między linią przed i po (LCS na słowach). Puste, gdy linie za długie. */
export function wordSpans(a: string, b: string): { del: [number, number][]; add: [number, number][] } {
  const x = tokens(a)
  const y = tokens(b)
  if (!x.length || !y.length || x.length * y.length > 40_000) return { del: [], add: [] }
  const n = x.length
  const m = y.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = x[i]!.t === y[j]!.t ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const keepX = new Array<boolean>(n).fill(false)
  const keepY = new Array<boolean>(m).fill(false)
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[i]!.t === y[j]!.t) {
      keepX[i] = keepY[j] = true
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  // nic wspólnego poza spacjami: to nowa linia, nie zmiana słów
  const common = x.filter((t, i) => keepX[i] && /\S/.test(t.t)).length
  if (!common) return { del: [], add: [] }
  return { del: spans(x, keepX), add: spans(y, keepY) }
}

// zmienione tokeny w ciągu; spacja między dwoma zmienionymi należy do zakresu („what a lot of”)
function spans(t: { t: string; at: number }[], keep: boolean[]): [number, number][] {
  const word = (i: number) => /\S/.test(t[i]!.t)
  const changed = t.map((_, i) => word(i) && !keep[i])
  for (let i = 0; i < t.length; i++) {
    if (word(i)) continue
    let p = i - 1
    while (p >= 0 && !word(p)) p--
    let q = i + 1
    while (q < t.length && !word(q)) q++
    changed[i] = p >= 0 && q < t.length && changed[p]! && changed[q]!
  }
  const out: [number, number][] = []
  for (let i = 0; i < t.length; i++) {
    if (!changed[i]) continue
    let j = i
    while (j + 1 < t.length && changed[j + 1]) j++
    out.push([t[i]!.at, t[j]!.at + t[j]!.t.length])
    i = j
  }
  return out
}

/**
 * Wiersze do narysowania z unified diffu: same zmiany z `ctx` liniami kontekstu, przerwa między
 * odległymi miejscami, najwyżej `cap` linii zmian. Pary − / + w bloku dostają zmienione słowa.
 */
export function diffRows(unified: string, ctx = 0, cap = 40): { rows: DiffRow[]; hidden: number } {
  type L = { kind: '-' | '+' | ' '; text: string; line: number }
  const hunks: L[][] = []
  let cur: L[] | null = null
  let n = 0
  for (const raw of unified.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (h) {
      cur = []
      hunks.push(cur)
      n = Number(h[1])
      continue
    }
    if (!cur) continue
    const tag = raw[0]
    if (tag !== ' ' && tag !== '-' && tag !== '+') continue
    cur.push({ kind: tag, text: raw.slice(1), line: tag === '-' ? n : n })
    if (tag !== '-') n++
  }
  const rows: DiffRow[] = []
  let shown = 0
  let hidden = 0
  for (const hunk of hunks) {
    const keep = hunk.map(l => l.kind !== ' ')
    hunk.forEach((l, i) => {
      if (l.kind === ' ') return
      for (let j = Math.max(0, i - ctx); j <= Math.min(hunk.length - 1, i + ctx); j++) keep[j] = true
    })
    let prevKept = -2
    for (let i = 0; i < hunk.length; i++) {
      if (!keep[i]) continue
      const l = hunk[i]!
      if (l.kind !== ' ' && shown >= cap) {
        hidden++
        continue
      }
      if (rows.length && i !== prevKept + 1) rows.push({ kind: 'gap' })
      if (l.kind !== ' ') shown++
      rows.push({ kind: l.kind, text: l.text, spans: [], line: l.line })
      prevKept = i
    }
    if (hunks.length > 1 && hunk !== hunks[hunks.length - 1] && rows.length && rows[rows.length - 1]!.kind !== 'gap') rows.push({ kind: 'gap' })
  }
  if (rows.length && rows[rows.length - 1]!.kind === 'gap') rows.pop()
  // pary w każdym bloku: i-ta usunięta z i-tą dodaną
  for (let i = 0; i < rows.length; ) {
    if (rows[i]!.kind !== '-') {
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d]!.kind === '-') d++
    let a = d
    while (a < rows.length && rows[a]!.kind === '+') a++
    for (let k = 0; k < Math.min(d - i, a - d); k++) {
      const r = rows[i + k] as Exclude<DiffRow, { kind: 'gap' }>
      const s = rows[d + k] as Exclude<DiffRow, { kind: 'gap' }>
      const w = wordSpans(r.text, s.text)
      r.spans = w.del
      s.spans = w.add
    }
    i = a
  }
  return { rows, hidden }
}
