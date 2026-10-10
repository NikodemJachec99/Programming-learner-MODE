// Wspólne dla widoków zmian: najnowsza zmiana danego pliku (plik w drzewie prowadzi do niej).

import type { ChangeMeta } from '../engine/change'

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** Najnowsza zmiana tego pliku (lista jest od najnowszej). */
export function latestChangeFor(changes: readonly ChangeMeta[], path: string): ChangeMeta | undefined {
  const p = norm(path)
  return changes.find(c => c.file && (norm(c.file) === p || p.endsWith('/' + norm(c.file)) || norm(c.file).endsWith('/' + p)))
}
