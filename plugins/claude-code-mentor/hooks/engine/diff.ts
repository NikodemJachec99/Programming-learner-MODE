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
    unified += `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}\n`
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
