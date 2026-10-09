// Aktywność Claude na plikach w bieżącej turze (pomysł z claude-code-filetree):
// odczyt i edycja trwają, po końcu krótki błysk, potem plik wraca do neutralnego wyglądu.
// Same czyste funkcje: dane przychodzą z obserwowanych wywołań narzędzi, bez skanowania dysku i gita.

export type ActKind = 'read' | 'edit'

export type FileAct = {
  path: string
  kind: ActKind
  /** Narzędzie jeszcze działa (albo czeka na zgodę). */
  active: boolean
  /** Wynik ostatniej operacji: null w trakcie. */
  ok: boolean | null
  since: number
  /** Koniec ostatniej operacji. */
  at: number
  reads: number
  edits: number
  /** Operację odrzucono (uprawnienia, zablokowana): nie sukces i nie błąd kodu. */
  denied?: boolean
}

export type Activity = { turn: number; files: FileAct[] }

/** Jak długo plik świeci po zakończeniu operacji. */
export const FLASH_MS = 2700
/** Ile plików tury trzymamy (najświeższe). */
export const MAX_FILES = 40

export const EMPTY_ACTIVITY: Activity = { turn: 0, files: [] }

/** Ton do narysowania: trwa odczyt/edycja, świeży wynik, błąd albo spokój. */
export type ActTone = 'read' | 'edit' | 'ok' | 'error' | 'idle'

const norm = (p: string) => p.replace(/\\/g, '/')

/** Nowa tura: lista zaczyna się od nowa. */
export function newTurn(a: Activity): Activity {
  return { turn: a.turn + 1, files: [] }
}

export function touchStart(a: Activity, path: string, kind: ActKind, now: number): Activity {
  const p = norm(path)
  const prev = a.files.find(f => f.path === p)
  // edycja ma pierwszeństwo: odczyt w trakcie edycji nie przykrywa pomarańczu
  const k: ActKind = prev?.active && prev.kind === 'edit' ? 'edit' : kind
  const next: FileAct = prev
    ? { ...prev, kind: k, active: true, ok: null, since: now }
    : { path: p, kind, active: true, ok: null, since: now, at: now, reads: 0, edits: 0 }
  return { ...a, files: [...a.files.filter(f => f.path !== p), next].slice(-MAX_FILES) }
}

/** Koniec operacji. Nieudana zostaje czerwona do końca tury, nie udaje sukcesu. */
export function touchEnd(a: Activity, path: string, kind: ActKind, ok: boolean, now: number, denied = false): Activity {
  const p = norm(path)
  return {
    ...a,
    files: a.files.map(f =>
      f.path !== p
        ? f
        : {
            ...f,
            kind,
            active: false,
            ok: f.ok === false && kind === 'read' ? false : ok,
            denied: !ok && denied,
            at: now,
            reads: f.reads + (kind === 'read' && ok ? 1 : 0),
            edits: f.edits + (kind === 'edit' && ok ? 1 : 0),
          },
    ),
  }
}

export function toneOf(f: FileAct, now: number): ActTone {
  if (f.active) return f.kind
  if (f.ok === false) return 'error'
  if (now - f.at < FLASH_MS) return f.kind === 'edit' ? 'ok' : 'read'
  return 'idle'
}

/**
 * Kiedy rysunek znowu się zmieni sam z siebie: co klatkę, gdy coś trwa,
 * w chwili wygaśnięcia najbliższego błysku albo nigdy (null).
 */
export function nextChange(a: Activity, now: number, frameMs: number, frames = false): number | null {
  if (a.files.some(f => f.active)) return now + frameMs
  const ends = a.files.filter(f => f.ok !== false && now - f.at < FLASH_MS).map(f => f.at + FLASH_MS)
  if (!ends.length) return null
  // klatki shimmera tylko tam, gdzie liczy je panel (terminal); inaczej pobudka na wygaśnięcie
  return frames ? now + frameMs : Math.min(...ends)
}
