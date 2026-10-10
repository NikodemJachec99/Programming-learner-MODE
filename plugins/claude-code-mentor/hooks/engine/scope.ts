// Co jest materiałem do nauki. Mentor uczy na zmianach w kodzie projektu, nie na plikach roboczych
// Claude (scratchpad, pliki tymczasowe, pamięć i plany w ~/.claude), wygenerowanych (dist, build,
// lockfile) ani notatkach (Markdown, logi). Czyste funkcje: ścieżka → rodzaj.

export type Scope = 'code' | 'config' | 'notes' | 'work'

/** Czy zmiana w pliku tego rodzaju może dać lekcję, ćwiczenie albo quiz. */
export const teachable = (s: Scope): boolean => s === 'code' || s === 'config'

export const SCOPE_LABEL: Record<Scope, string> = {
  code: 'kod',
  config: 'konfiguracja',
  notes: 'notatki i dane',
  work: 'robocze Claude',
}

const posix = (p: string) => p.replace(/\\/g, '/')

// katalogi robocze Claude i systemu oraz wynik builda: nigdy nie są kodem projektu do nauki
const WORK_DIRS =
  /(^|\/)(\.claude|scratchpad|AppData\/Local\/Temp|Temp|tmp|temp|var\/folders|node_modules|\.git|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|dist|build|out|coverage|\.next|\.nuxt|\.dart_tool|\.gradle|target|\.turbo|\.cache)(\/|$)/i

// pliki wygenerowane albo bez logiki: lockfile, mapy, zminifikowane
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|pubspec\.lock|go\.sum)$|\.(min\.(js|css)|map|lock)$/i

// notatki, dokumentacja, dane i media: nie uczą programowania
const NOTES = /\.(md|mdx|markdown|txt|rst|adoc|log|csv|tsv|png|jpe?g|gif|webp|svg|ico|pdf|zip|gz)$/i

// konfiguracja: lekcje o zależnościach i ustawieniach, nie o logice
const CONFIG = /(^|\/)(package\.json|tsconfig[\w.-]*\.json|jsconfig\.json|composer\.json|pyproject\.toml|requirements[\w.-]*\.txt|pubspec\.yaml|Dockerfile|docker-compose[\w.-]*\.ya?ml|\.env\.example|vite\.config\.\w+|webpack\.config\.\w+|eslint\.config\.\w+|\.eslintrc[\w.]*|\.prettierrc[\w.]*)$|\.(ya?ml|toml|ini|cfg|conf)$/i

/** Katalog, w którym „poza projektem” nic nie znaczy: korzeń dysku albo katalog domowy. */
export function broadRoot(root: string): boolean {
  const r = posix(root).replace(/\/+$/, '')
  return !r || /^[A-Za-z]:$/.test(r) || r === '' || /^([A-Za-z]:)?\/(Users|home)\/[^/]+$/i.test(r) || r === '/'
}

/** Czy ścieżka leży w katalogu projektu (bez rozróżniania wielkości liter na Windows). */
export function insideRoot(root: string, path: string): boolean {
  const r = posix(root).replace(/\/+$/, '').toLowerCase()
  const p = posix(path).toLowerCase()
  return p === r || p.startsWith(r + '/')
}

const absolute = (p: string) => /^([A-Za-z]:)?\//.test(posix(p))

/**
 * Rodzaj pliku dla nauki. `root` to katalog projektu; plik spoza niego (bezwzględna ścieżka
 * poza katalogiem) to plik roboczy, chyba że katalog projektu jest zbyt szeroki (dysk, katalog domowy).
 */
export function scopeOf(path: string, root = ''): Scope {
  const p = posix(path)
  if (!p) return 'work'
  if (WORK_DIRS.test(p)) return 'work'
  if (root && !broadRoot(root) && absolute(p) && !insideRoot(root, p)) return 'work'
  if (GENERATED.test(p)) return 'work'
  if (NOTES.test(p)) return 'notes'
  if (CONFIG.test(p)) return 'config'
  return 'code'
}

/** Komenda, która dotyczy tylko plików roboczych (skrypt w scratchpad, plik tymczasowy). */
export function workCommand(cmd: string): boolean {
  return /(scratchpad|AppData[\\/]Local[\\/]Temp|[\\/]tmp[\\/]|\.claude[\\/])/i.test(cmd)
}

/** Treść bez różnic końców linii i końcowych spacji (do sprawdzenia, czy plik wrócił do stanu sprzed tury). */
export const sameText = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n').replace(/\s+$/, '') === b.replace(/\r\n/g, '\n').replace(/\s+$/, '')
