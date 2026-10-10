// Zamiana wyniku narzędzia Edit/Write (structuredPatch) na fakty:
// które linie dodano, gdzie, jaki fragment pokazać. To jest zaobserwowana
// zmiana z konkretnego wywołania narzędzia, a nie `git diff` całego repo.

export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

export type ChangeFacts = {
  added: number
  removed: number
  /** Dodane linie z numerami w nowej wersji pliku. */
  addedLines: { line: number; text: string }[]
  removedLines: string[]
  /** Pierwsza zmieniona linia (w nowej wersji). */
  firstLine: number | null
  /** Fragment po zmianie z odrobiną kontekstu: tekst i numer pierwszej linii. */
  snippet: { text: string; start: number }
  /** Hunki w formacie unified diff (do elementu Code format="diff"). */
  unified: string
}

export function factsFromPatch(hunks: readonly Hunk[], maxLines = 80): ChangeFacts {
  const addedLines: { line: number; text: string }[] = []
  const removedLines: string[] = []
  const snippetLines: string[] = []
  let snippetStart = 0
  let unified = ''
  for (const h of hunks) {
    // nagłówek liczony z samych linii: niespójny nagłówek z narzędzia nie może wywrócić rysowania diffu
    const body = h.lines.filter(l => l[0] === ' ' || l[0] === '-' || l[0] === '+')
    const oldCount = body.filter(l => l[0] !== '+').length
    const newCount = body.filter(l => l[0] !== '-').length
    unified += `@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@\n${body.join('\n')}\n`
    let n = h.newStart
    if (!snippetStart) snippetStart = h.newStart
    for (const l of h.lines) {
      const tag = l[0]
      const text = l.slice(1)
      if (tag === '+') {
        addedLines.push({ line: n, text })
        if (snippetLines.length < maxLines) snippetLines.push(text)
        n++
      } else if (tag === '-') {
        removedLines.push(text)
      } else {
        if (snippetLines.length < maxLines && snippetLines.length > 0) snippetLines.push(text)
        else if (snippetLines.length === 0) snippetStart = n + 1
        n++
      }
    }
  }
  // przytnij końcowy kontekst bez zmian
  return {
    added: addedLines.length,
    removed: removedLines.length,
    addedLines,
    removedLines,
    firstLine: addedLines[0]?.line ?? hunks[0]?.newStart ?? null,
    snippet: { text: snippetLines.join('\n').replace(/\n+$/, ''), start: addedLines[0]?.line ?? snippetStart ?? 1 },
    unified: unified.trimEnd(),
  }
}

/** Dla nowego pliku (Write, create): cała treść to dodane linie. */
export function factsFromContent(content: string, maxLines = 80): ChangeFacts {
  const lines = content.split('\n')
  return {
    added: lines.length,
    removed: 0,
    addedLines: lines.map((text, i) => ({ line: i + 1, text })),
    removedLines: [],
    firstLine: 1,
    snippet: { text: lines.slice(0, maxLines).join('\n'), start: 1 },
    unified: '',
  }
}

/** Zwęża fragment do okna wokół wskazanej linii (np. linii z pojęciem). */
export function windowAround(addedLines: { line: number; text: string }[], center: number, radius = 12): { text: string; start: number } {
  const inWin = addedLines.filter(l => Math.abs(l.line - center) <= radius)
  if (!inWin.length) return { text: '', start: center }
  // uzupełnij dziury w numeracji pustymi liniami nie da się (brak tekstu), więc bierzemy ciągły blok
  const out: string[] = []
  let prev = inWin[0]!.line - 1
  const start = inWin[0]!.line
  for (const l of inWin) {
    if (l.line !== prev + 1) out.push('  // …')
    out.push(l.text)
    prev = l.line
  }
  return { text: out.join('\n'), start }
}

export function langOf(path: string | null): string {
  if (!path) return 'text'
  const m = /\.([a-z0-9]+)$/i.exec(path)
  const ext = (m?.[1] ?? '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', php: 'php', sql: 'sql', sh: 'sh', bash: 'sh', ps1: 'powershell', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', cs: 'csharp', rb: 'ruby', html: 'html', css: 'css', scss: 'css', json: 'json', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', dart: 'dart', vue: 'vue', svelte: 'svelte', toml: 'toml', dockerfile: 'dockerfile',
  }
  if (/(^|[\\/])Dockerfile$/i.test(path)) return 'dockerfile'
  return map[ext] ?? ext ?? 'text'
}

export function codeLanguage(lang: string): string {
  const map: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash' }
  return map[lang] ?? lang
}

/**
 * Skrócony diff do pierwszego widoku (jak replay-theater): wokół każdej zmiany `ctx` linii
 * kontekstu, reszta pominięta, najwyżej `cap` linii zmian. Wynik to dalej poprawny unified diff
 * (nagłówki hunków liczone od nowa), więc rysuje go ten sam element co pełny.
 */
export function compactDiff(unified: string, ctx = 1, cap = 14): { text: string; hidden: number; total: number } {
  type L = { tag: string; text: string; old: number; neu: number }
  const lines: L[][] = []
  let cur: L[] | null = null
  let o = 0
  let n = 0
  for (const raw of unified.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (h) {
      cur = []
      lines.push(cur)
      o = Number(h[1])
      n = Number(h[2])
      continue
    }
    if (!cur) continue
    const tag = raw[0]
    if (tag !== ' ' && tag !== '-' && tag !== '+') continue
    cur.push({ tag, text: raw.slice(1), old: o, neu: n })
    if (tag !== '+') o++
    if (tag !== '-') n++
  }
  const total = lines.reduce((s, h) => s + h.filter(l => l.tag !== ' ').length, 0)
  let shown = 0
  let hidden = 0
  const out: string[] = []
  for (const hunk of lines) {
    const keep = hunk.map(() => false)
    hunk.forEach((l, i) => {
      if (l.tag === ' ') return
      if (shown >= cap) {
        hidden++
        return
      }
      shown++
      for (let j = Math.max(0, i - ctx); j <= Math.min(hunk.length - 1, i + ctx); j++) {
        // kontekst tak, zmiany obok tylko w limicie
        if (hunk[j]!.tag === ' ' || j === i) keep[j] = true
      }
    })
    // grupy kolejnych zachowanych linii to nowe hunki
    let i = 0
    while (i < hunk.length) {
      if (!keep[i]) {
        i++
        continue
      }
      const start = i
      while (i < hunk.length && keep[i]) i++
      const part = hunk.slice(start, i)
      if (!part.some(l => l.tag !== ' ')) continue
      const oc = part.filter(l => l.tag !== '+').length
      const nc = part.filter(l => l.tag !== '-').length
      out.push(`@@ -${part[0]!.old},${oc} +${part[0]!.neu},${nc} @@`, ...part.map(l => l.tag + l.text))
    }
  }
  return { text: out.length ? out.join('\n') + '\n' : '', hidden, total }
}
