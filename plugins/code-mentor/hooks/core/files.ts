// Pliki projektu i git dla panelu „Pliki” i karty „Teraz” (wzorzec claude-code-filetree, MIT):
// katalogi czytane na żądanie, droga do plików, których Claude dotknął, jeden `git status` na
// odświeżenie, commit Claude. Bez skanowania całego dysku i bez gita przy każdym rysowaniu.

import type { Host } from '../host'
import { ancestors, inside, join as joinFs, parentOf, parseStatus, pkey, posix } from '../engine/files'
import type { FsItem, GitView } from '../engine/files'
import { S } from '../ui/state'

/** Katalogi pomijane przy szukaniu (jak PRUNE w filetree). */
const PRUNE = new Set(['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next', 'build', '.dart_tool'])

export class FilesController {
  /** `root` daje katalog projektu (ustala go start sesji Mentora). */
  constructor(private readonly root: () => string) {}

  private busy = false
  private again = false
  private timer = false
  /** Korzeń repozytorium dla katalogu (null: poza gitem); raz na katalog. */
  private repoTops = new Map<string, string | null>()

  async repoTop(io: Host, dir: string): Promise<string | null> {
    const k = pkey(dir)
    if (this.repoTops.has(k)) return this.repoTops.get(k)!
    const r = await io.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 8000 }).catch(() => null)
    const top = r && r.exitCode === 0 && r.stdout.trim() ? posix(r.stdout.trim()) : null
    this.repoTops.set(k, top)
    return top
  }

  /** Odświeża pliki: korzeń, rozwinięte katalogi i drogę do dotkniętych plików, jeden `git status`. */
  async refresh(io: Host): Promise<void> {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      do {
        this.again = false
        await this.load(io)
      } while (this.again)
    } catch {
      /* pliki to podgląd: błąd odczytu nie może przeszkodzić w pracy */
    } finally {
      this.busy = false
    }
  }

  private async load(io: Host): Promise<void> {
    const root = posix(this.root() || (await io.sessionRoot().catch(() => '')))
    if (!root || root === '/') return
    const f0 = await io.get(S.files)
    const same = pkey(f0.root) === pkey(root)
    const act = await io.get(S.activity)
    // droga do każdego dotkniętego pliku jest rozwinięta (filetree: reveal)
    const reveal = act.files.flatMap(a => ancestors(root, a.path))
    const seen = new Set<string>()
    const expanded = [...(same ? f0.expanded : []), ...reveal].map(posix).filter(d => !seen.has(pkey(d)) && (seen.add(pkey(d)), true))
    const listing: Record<string, FsItem[]> = {}
    const list = async (d: string) => {
      try {
        listing[pkey(d)] = (await io.fsList(d)).map(e => ({ name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size }))
      } catch {
        /* katalog zniknął albo brak dostępu */
      }
    }
    for (const d of [root, ...expanded].slice(0, 80)) await list(d)
    // szukanie obejmuje też nierozwinięte katalogi: przejście wszerz z limitem, bez ciężkich katalogów
    if (f0.query.trim()) {
      const queue = Object.keys(listing).map(k => [...expanded, root].find(d => pkey(d) === k) ?? k)
      for (let i = 0; i < queue.length && Object.keys(listing).length < 300; i++) {
        for (const it of listing[pkey(queue[i]!)] ?? []) {
          if (it.kind !== 'dir' || PRUNE.has(it.name)) continue
          const p = joinFs(queue[i]!, it.name)
          if (!listing[pkey(p)]) {
            await list(p)
            queue.push(p)
          }
        }
      }
    }
    // repozytorium projektu, a gdy katalog projektu nim nie jest (np. folder z wieloma worktree),
    // repozytorium pliku, którego Claude dotknął ostatnio
    let top = await this.repoTop(io, root)
    if (!top) {
      const latest = [...act.files].sort((x, y) => y.at - x.at)[0]
      if (latest) top = await this.repoTop(io, parentOf(latest.path))
    }
    const isRepo = !!top
    let git: GitView | null = null
    if (top) {
      const st = await io.run(['git', 'status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'], { cwd: top, timeoutMs: 15000 }).catch(() => null)
      if (st && st.exitCode === 0) git = parseStatus(st.stdout, top)
    }
    const now = await io.now()
    await io.set(S.files, f => ({ ...f, root, listing, expanded, isRepo, top: top ?? '', git: git ?? (isRepo && same && pkey(f.top) === pkey(top ?? '') ? f.git : null), loadedAt: now }))
  }

  /** Po edycji albo komendzie: jedno odświeżenie za chwilę dla kilku szybkich zmian. */
  soon(io: Host): void {
    if (this.timer) return
    this.timer = true
    void io
      .sleep(600)
      .then(() => {
        this.timer = false
        return this.refresh(io)
      })
      .catch(() => {
        this.timer = false
      })
  }

  /** Rozwija albo zwija katalog w drzewie. */
  async toggleDir(io: Host, path: string): Promise<void> {
    await io.set(S.files, f => ({ ...f, expanded: f.expanded.some(x => pkey(x) === pkey(path)) ? f.expanded.filter(x => !inside(path, x)) : [...f.expanded, posix(path)] }))
    // odświeżenie w tle: kliknięcie nie czeka na dysk i gita (limit czasu przycisku)
    void this.refresh(io)
  }

  /** Szukanie w drzewie: filtr nazw, z doczytaniem nierozwiniętych katalogów. */
  async search(io: Host, query: string): Promise<void> {
    await io.set(S.files, f => ({ ...f, query }))
    void this.refresh(io)
  }

  /** Udany `git commit` Claude: skrót commita i pliki tej tury, które nim weszły (po commicie czyste). */
  async noteCommit(io: Host): Promise<void> {
    await this.refresh(io)
    const f0 = await io.get(S.files)
    const root = f0.top || f0.root || posix(this.root())
    if (!root) return
    const r = await io.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd: root, timeoutMs: 8000 }).catch(() => null)
    if (!r || r.exitCode !== 0) return
    await this.refresh(io)
    const f = await io.get(S.files)
    const act = await io.get(S.activity)
    const files = act.files.filter(a => a.edits > 0 && !f.git?.files[pkey(a.path)]).map(a => a.path)
    const at = await io.now()
    await io.set(S.files, x => ({ ...x, commit: { sha: r.stdout.trim(), files, at } }))
  }
}
