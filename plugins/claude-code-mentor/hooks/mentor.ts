// Kontroler Mentora: integracja z Claude Code (obserwacje), silnik nauki
// (priorytety, kolejka lekcji, quizy), persystencja (helper SQLite) i stan UI.
// Zasada: nic stąd nie trafia do głównej rozmowy. Hooki zawsze oddają
// wynik narzędzia i tury bez zmian, a błędy Mentora są łapane lokalnie.

import type { Host } from './host'
import type {
  MentorAlternative,
  MentorBenchVariant,
  MentorKnowledgeRow,
  MentorLesson,
  MentorLessonBody,
  MentorLessonMeta,
  MentorMisconception,
  MentorObservation,
  MentorQuizState,
  MentorSettings,
  MentorTab,
} from '../types'
import { CONCEPTS } from './content/concepts'
import type { ConceptDef } from './content/types'
import { Breaker, COST_PROFILES, estimateTokens, MANUAL_LIMIT, MIN_GAP_MS, today } from './engine/budget'
import { BASIC_CONCEPTS, applyHunks, changedRanges, describeChange, simDialect, windowFor } from './engine/change'
import type { ChangeFull, ChangeMeta } from './engine/change'
import { classifyCommand, detectConcepts, isConfigFile, newSymbols } from './engine/detect'
import { factsFromContent, factsFromPatch, langOf } from './engine/diff'
import type { ChangeFacts, Hunk } from './engine/diff'
import { depthMap, missingPrereqs } from './engine/graph'
import { hash, makeId } from './engine/hash'
import { builtinLesson, extractJson, lessonRequest, levelName, mergeModelLesson } from './engine/lessons'
import type { LessonInput } from './engine/lessons'
import { changeQuestion } from './engine/changequiz'
import { PLACEMENT } from './engine/placement'
import { decisionFor, decisionPrompt } from './engine/decision'
import { applyFeedback, detailFor, EMPTY_FEEDBACK, FEEDBACK_LABEL, lessonPrefs, parseFeedback } from './engine/feedback'
import type { FeedbackKind, FeedbackStore } from './engine/feedback'
import { caseStatement, nextVariantId } from './engine/bench'
import type { Example } from './engine/examples'
import { pairCall } from './sim/autocall'
import { simTotal } from './ui/simcache'
import { nextChange } from './engine/activity'
import { nextRead, withOutput } from './engine/tasks'
import { ancestors, inside, join as joinFs, parentOf, parseStatus, pkey, posix } from './engine/files'
import type { FsItem, GitView } from './engine/files'
import { boundaryQuestion, fromTemplate, gradeChoice, gradeRequest, parseGrade, parseQuiz, predictOutputQuestion, quizRequest } from './engine/quiz'
import type { Built, Grade } from './engine/quiz'
import { isSensitivePath, redact, redactLines, safeSnippet } from './engine/redact'
import { batch, DbError, flushPending, joinPath, one, pendingCount, runSql, write } from './store/db'
import type { DbCtx, Op } from './store/db'
import { DEFAULT_SETTINGS, S } from './ui/state'


type Detail = { snippet: string; start: number; lang: string; unified: string; facts: ChangeFacts | null }
type Job = { id: string; kind: 'auto' | 'manual'; conceptId: string; obsId: string; deep: boolean; task: string | null; note: string | null; at: number; obs?: MentorObservation; inline?: boolean }

const BY_ID = new Map<string, ConceptDef>(CONCEPTS.map(c => [c.id, c]))
const DEPTH = depthMap(CONCEPTS)
export const conceptById = (id: string): ConceptDef | undefined => BY_ID.get(id)


/**
 * Pojęcia warte uwagi w zmianie: bez podstaw i bez tego, co już opanowane (poziom 3+),
 * najbardziej zaawansowane najpierw. Gdy nic nie zostaje: pusta lista do pokazania w panelu,
 * a z `fallback` pierwsze pojęcie z listy (lekcja i ćwiczenie muszą mieć o czym być).
 */
/** Zmiana z historii z tekstami po redakcji (opis, polecenie, fakty). */
export const cleanMeta = <T extends { summary: string; turnLabel: string | null; facts: string[] }>(m: T): T => ({
  ...m,
  summary: redact(m.summary ?? '').text,
  turnLabel: m.turnLabel ? redact(m.turnLabel).text : m.turnLabel,
  facts: (m.facts ?? []).map(f => redact(f).text),
})

export function interestingConcepts(ids: readonly string[], levels: Record<string, number>, fallback = false): string[] {
  const known = [...new Set(ids)].filter(id => BY_ID.has(id))
  const picked = known.filter(id => !BASIC_CONCEPTS.has(id) && (levels[id] ?? 0) < 3).sort((a, b) => (DEPTH.get(b) ?? 0) - (DEPTH.get(a) ?? 0))
  return picked.length || !fallback ? picked : known.slice(0, 1)
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

type KnowledgeDb = {
  concept_id: string
  name?: string
  area?: string
  level: number
  mastery: number
  confidence: number
  effectiveConfidence?: number
  exposures: number
  correct: number
  incorrect: number
  isDue?: boolean
  next_review_at: number | null
  last_verified_at: number | null
}
type MisDb = { concept_id: string; key: string; description: string | null; count: number; resolved_at: number | null; last_seen: number }
type LessonDb = { id: string; title: string; ts: number; concept_ids?: string[]; file_path: string | null; line: number | null; source: 'model' | 'builtin'; status: string; body?: MentorLessonBody; model?: string | null }

/**
 * Wywołanie dla symulacji przed/po: gdy funkcja ma jeden parametr, a zmieniona linia
 * zawiera liczbę, wywołujemy ją z tą liczbą (to zwykle przypadek brzegowy zmiany).
 */
export function suggestCall(code: string, unified: string, dialect: 'js' | 'dart'): { call: string; hint: string } {
  const fn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(([^)]*)\)|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)[^=\n]*=>|^\s*(?:Future<[^>]*>|void|int|double|String|bool|num|[A-Z]\w*)\s+([a-z_]\w*)\s*\(([^)]*)\)\s*(?:async\s*)?[{=]/m.exec(code)
  const name = fn?.[1] ?? fn?.[3] ?? fn?.[5]
  if (!name) return { call: '', hint: '' }
  const params = (fn?.[2] ?? fn?.[4] ?? fn?.[6] ?? '').split(',').filter(x => x.trim()).length
  const changed = unified.split('\n').find(l => l.startsWith('+') && !l.startsWith('+++')) ?? ''
  const num = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/.exec(changed.slice(1))?.[0]
  const print = dialect === 'dart' ? 'print' : 'console.log'
  if (params === 1 && num !== undefined) return { call: `${print}(${name}(${num}))`, hint: `${name}(${num})` }
  if (params === 0) return { call: `${print}(${name}())`, hint: `${name}()` }
  return { call: '', hint: `${name}(…)` }
}

/** Pauza między krokami odtwarzania w Symulatorze. */
export const SPEED_MS = { slow: 8000, normal: 4000, fast: 1800 } as const
/** Klatka spinnerów w terminalu i odstęp kroków animacji laboratorium. */
export const FRAME_MS = 150
export const BENCH_FRAME_MS = 800
export const BENCH_FRAMES = 5
export const SPEED_LABEL = { slow: 'wolno', normal: 'średnio', fast: 'szybko' } as const

/** Katalogi pomijane przy szukaniu (jak PRUNE w filetree). */
const PRUNE = new Set(['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next', 'build', '.dart_tool'])

export class Mentor {
  ctx: DbCtx | null = null
  projectId = ''
  projectRoot = ''
  sessionId = ''
  surface: string | null = null
  turn = 0
  private taskContext: string | null = null
  private turnLabel: string | null = null
  /** Tura, w której zamknięto pasek zadania nad promptem (✕). */
  flowDismissedTurn = -1
  /** Praca bieżącego polecenia do paska zadania: start, koniec, wywołania narzędzi, linie +/−. */
  work = { turn: -1, startedAt: 0, endedAt: null as number | null, steps: 0, added: 0, removed: 0, tool: '' }

  /** Start pracy nad poleceniem (po onPrompt). */
  startWork(at: number): void {
    this.work = { turn: this.turn, startedAt: at, endedAt: null, steps: 0, added: 0, removed: 0, tool: '' }
  }

  /** Jedno wywołanie narzędzia w tej turze (Claude albo subagent). */
  workStep(tool: string): void {
    if (this.work.turn === this.turn && this.work.endedAt === null) this.work = { ...this.work, steps: this.work.steps + 1, tool }
  }

  /** Koniec odpowiedzi głównej rozmowy. */
  endWork(at: number): void {
    if (this.work.turn === this.turn && this.work.endedAt === null) this.work = { ...this.work, endedAt: at }
  }
  private lastChange: ChangeFull | null = null
  private changeCache = new Map<string, ChangeFull>()
  private turnObs: MentorObservation[] = []
  private details = new Map<string, Detail>()
  private projectConcepts: Record<string, number> = {}
  private taught = new Set<string>()
  private jobs: Job[] = []
  private working = false
  private lastAutoAt = 0
  private breaker = new Breaker()
  private failedCommands = new Map<string, { obsId: string; ts: number }>()
  private preexisting = new Set<string>()
  private touchedSince = new Set<string>()
  private quizCount = 0
  private settings: MentorSettings = DEFAULT_SETTINGS

  // ===================== start =====================

  async boot(io: Host, cwd: string, surface: string | null): Promise<void> {
    this.surface = surface
    const messages: string[] = []
    const now = await io.now()
    this.sessionId = await io.sessionId().catch(() => makeId('s', now))
    const root = (await io.sessionRoot().catch(() => cwd)) || cwd
    this.projectRoot = root
    this.projectId = 'p_' + hash(norm(root))
    const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root
    const dataDir = (await io.dataDir()) ?? ''
    void this.checkVersion(io)
    void this.loadPlacement(io)
    void this.loadFeedback(io)
    const posix = dataDir.startsWith('/')
    const engine = await io.version().catch(() => '?')
    // Kandydaci na node.exe: z instalatora (prawdziwa ścieżka przed linkami nvm),
    // potem typowe lokalizacje. Bierzemy pierwszego, który faktycznie się uruchamia:
    // proces sesji Desktop nie zawsze potrafi wystartować node przez symlink nvm.
    const candidates: string[] = []
    if (dataDir) {
      try {
        const rt = JSON.parse(await io.fsRead(joinPath(dataDir, 'runtime.json'))) as { node?: string; candidates?: string[] }
        candidates.push(...(rt.candidates ?? []), ...(rt.node ? [rt.node] : []))
      } catch {
        messages.push('Brak runtime.json (tworzy go instalator): szukam node w typowych miejscach.')
      }
    } else {
      messages.push('Brak LOCALAPPDATA i HOME: nie wiem, gdzie trzymać bazę.')
    }
    if (posix) candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', 'node')
    else candidates.push('C:\\Program Files\\nodejs\\node.exe', 'node')
    let node = 'node'
    const tried: string[] = []
    for (const c of [...new Set(candidates)]) {
      try {
        const r = await io.run([c, '--version'], { timeoutMs: 8000 })
        if (r.exitCode === 0 && /^v(2[2-9]|[3-9]\d)\./.test(r.stdout.trim())) {
          node = c
          break
        }
        tried.push(`${c}: ${r.stdout.trim() || `exit ${r.exitCode}`} (wymagany Node 22.5+)`)
      } catch (e) {
        tried.push(`${c}: ${errText(e).slice(0, 80)}`)
      }
    }
    if (tried.length) messages.push(`Pominięte node: ${tried.join('; ')}`)
    const root$ = io.pluginRoot
    const ctx: DbCtx = { node, helper: joinPath(root$, 'helper', 'mentor-db.mjs'), sqlHelper: joinPath(root$, 'helper', 'sql-sandbox.mjs'), dataDir }
    let isGit = false
    try {
      const repo = await io.isGitRepo()
      isGit = !!repo
      if (repo) await this.loadBaseline(io, root)
    } catch {
      /* brak gita: brak bazowej listy zmian */
    }
    await io.set(S.boot, b => ({ ...b, status: 'starting' as const, dataDir, node, sessionId: this.sessionId, engine, project: { id: this.projectId, name, root, isGit }, messages }))

    if (!dataDir) {
      await io.set(S.boot, b => ({ ...b, status: 'degraded' as const }))
      return
    }
    try {
      const flushed = await flushPending(io, ctx).catch(() => 0)
      if (flushed) messages.push(`Dosłano ${flushed} zapisów z bufora.`)
      const res = await batch(io, ctx, [
        { op: 'init' },
        {
          op: 'bootstrap',
          args: {
            project: { id: this.projectId, root, name },
            session: { id: this.sessionId, surface: surface ?? 'unknown' },
            concepts: CONCEPTS.map(c => ({ id: c.id, name: c.name, area: c.area, langs: c.langs, prereqs: c.prereqs, weight: c.weight })),
            now,
            day: today(now),
          },
        },
        { op: 'maybeDailyBackup', args: { now } },
        { op: 'getChanges', args: { projectId: this.projectId, limit: 120 } },
      ])
      const init = res[0]
      const boot = res[1]
      if (!init?.ok) throw new DbError(init?.error ?? 'init')
      if (!boot?.ok) throw new DbError(boot?.error ?? 'bootstrap')
      this.ctx = ctx
      const v = boot.value as {
        settings: Partial<MentorSettings>
        knowledge: KnowledgeDb[]
        misconceptions: MisDb[]
        recentLessons: LessonDb[]
        usageToday: { kind: string; calls: number; tokens_in: number; tokens_out: number }[]
      }
      this.settings = { ...DEFAULT_SETTINGS, ...v.settings }
      await io.set(S.settings, () => this.settings)
      await this.applyKnowledge(io, v.knowledge, v.misconceptions)
      await io.set(S.lessons, () => v.recentLessons.map(toMeta))
      const hist = res[3]
      if (hist?.ok && Array.isArray(hist.value)) {
        // historia mogła powstać przed poprawką redakcji: w pamięci zawsze czyste teksty
        const saved = (hist.value as ChangeMeta[]).map(cleanMeta)
        await io.set(S.changes, live => [...live, ...saved.filter(x => !live.some(y => y.id === x.id))].slice(0, 120))
      }
      await this.applyUsage(io, v.usageToday)
      const schema = (init.value as { schemaVersion: number }).schemaVersion
      await io.set(S.boot, b => ({ ...b, status: 'ready' as const, schemaVersion: schema, messages }))
      void this.scrubHistory(io).catch(() => undefined)
    } catch (e) {
      messages.push(`Baza niedostępna: ${errText(e)}. Mentor działa w trybie awaryjnym: zapisy trafiają do bufora i zostaną dosłane.`)
      const pending = await pendingCount(io)
      await io.set(S.boot, b => ({ ...b, status: 'degraded' as const, messages, pending }))
    }
  }

  /**
   * Jednorazowo (flaga w $.store): stare opisy zmian, polecenia i obserwacje przechodzą przez
   * redakcję. Kopia bazy przed zapisem; zmieniane są tylko rekordy, w których coś usunięto.
   */
  async scrubHistory(io: Host): Promise<{ changes: number; observations: number } | null> {
    if (!this.ctx || (await io.storeGet('scrub-v1').catch(() => null))) return null
    const scan = await one<{ changes: { id: string; summary: string | null; turnLabel: string | null; facts: string[] | null }[]; observations: { id: number; summary: string | null }[] }>(io, this.ctx, 'scrubScan', {})
    const clean = (t: string | null) => (t == null ? t : redact(t).text)
    const changes = scan.changes
      .map(c => ({ id: c.id, summary: clean(c.summary), turnLabel: clean(c.turnLabel), facts: c.facts?.map(f => redact(f).text) ?? null, was: c }))
      .filter(c => c.summary !== c.was.summary || c.turnLabel !== c.was.turnLabel || JSON.stringify(c.facts) !== JSON.stringify(c.was.facts))
      .map(({ was: _was, ...c }) => c)
    const observations = scan.observations.map(o => ({ id: o.id, summary: clean(o.summary) })).filter((o, i) => o.summary !== scan.observations[i]!.summary)
    if (changes.length || observations.length) {
      await one(io, this.ctx, 'backup', { keep: 10 })
      await one(io, this.ctx, 'scrubApply', { changes, observations })
    }
    const result = { changes: changes.length, observations: observations.length }
    await io.storeSet('scrub-v1', { ...result, at: await io.now() })
    return result
  }

  private async loadBaseline(io: Host, root: string): Promise<void> {
    const top = await io.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 8000 })
    if (top.exitCode !== 0) return
    const repoRoot = top.stdout.trim()
    const st = await io.run(['git', 'status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, timeoutMs: 15000 })
    if (st.exitCode !== 0) return
    for (const line of st.stdout.split(/\r?\n/)) {
      const p = line.slice(3).trim().replace(/^"|"$/g, '')
      if (!p) continue
      const target = p.includes(' -> ') ? p.split(' -> ').pop()! : p
      this.preexisting.add(norm(`${repoRoot}/${target}`))
    }
  }

  async applyUsage(io: Host, rows: { kind: string; calls: number; tokens_in: number; tokens_out: number }[]): Promise<void> {
    const auto = rows.find(r => r.kind === 'auto')
    const manual = rows.find(r => r.kind === 'manual')
    const p = COST_PROFILES[this.settings.cost]
    await io.set(S.usage, u => ({
      ...u,
      autoCalls: auto?.calls ?? 0,
      manualCalls: manual?.calls ?? 0,
      tokens: rows.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0),
      limitCalls: p.autoCallsPerDay,
      limitTokens: p.tokensPerDay,
      breakerUntil: this.breaker.until,
    }))
  }

  private async applyKnowledge(io: Host, rows: KnowledgeDb[], mis: MisDb[]): Promise<void> {
    const k: MentorKnowledgeRow[] = rows.map(r => {
      const c = BY_ID.get(r.concept_id)
      return {
        id: r.concept_id,
        name: c?.name ?? r.name ?? r.concept_id,
        area: c?.area ?? r.area ?? '',
        level: r.level,
        mastery: r.mastery,
        confidence: r.effectiveConfidence ?? r.confidence,
        exposures: r.exposures,
        correct: r.correct,
        incorrect: r.incorrect,
        due: !!r.isDue,
        nextReviewAt: r.next_review_at,
        lastVerifiedAt: r.last_verified_at,
        inProject: this.projectConcepts[r.concept_id] ?? 0,
      }
    })
    await io.set(S.knowledge, () => k)
    const m: MentorMisconception[] = mis.map(x => ({ conceptId: x.concept_id, key: x.key, description: x.description ?? x.key, count: x.count, resolved: x.resolved_at !== null, lastSeen: x.last_seen }))
    await io.set(S.misconceptions, () => m)
  }

  private async countUsage(io: Host, kind: 'auto' | 'manual', tokens: number): Promise<void> {
    await io.set(S.usage, u => ({ ...u, autoCalls: u.autoCalls + (kind === 'auto' ? 1 : 0), manualCalls: u.manualCalls + (kind === 'manual' ? 1 : 0), tokens: u.tokens + tokens, breakerUntil: this.breaker.until }))
  }

  async refreshKnowledge(io: Host): Promise<void> {
    if (!this.ctx) return
    try {
      const v = await one<{ knowledge: KnowledgeDb[]; misconceptions: MisDb[] }>(io, this.ctx, 'getKnowledge')
      await this.applyKnowledge(io, v.knowledge, v.misconceptions)
    } catch (e) {
      io.log(`claude-code-mentor: getKnowledge: ${errText(e)}`)
    }
  }

  // ===================== obserwacja pracy Claude =====================

  onPrompt(text: string): void {
    this.turn++
    const r = redact(text)
    this.taskContext = r.text.trim().slice(0, 1500) || null
    const first = r.text.trim().split(/\r?\n/)[0] ?? ''
    this.turnLabel = first ? (first.length > 90 ? first.slice(0, 89) + '…' : first) : null
  }

  // ---------- pliki projektu (wzorzec claude-code-filetree) ----------

  private filesBusy = false
  private filesAgain = false
  private filesTimer = false
  /** Korzeń repozytorium dla katalogu (null: poza gitem); raz na katalog. */
  private repoTops = new Map<string, string | null>()

  private async repoTop(io: Host, dir: string): Promise<string | null> {
    const k = pkey(dir)
    if (this.repoTops.has(k)) return this.repoTops.get(k)!
    const r = await io.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 8000 }).catch(() => null)
    const top = r && r.exitCode === 0 && r.stdout.trim() ? posix(r.stdout.trim()) : null
    this.repoTops.set(k, top)
    return top
  }

  /** Odświeża pliki: korzeń, rozwinięte katalogi i drogę do dotkniętych plików, jeden `git status`. */
  async refreshFiles(io: Host): Promise<void> {
    if (this.filesBusy) {
      this.filesAgain = true
      return
    }
    this.filesBusy = true
    try {
      do {
        this.filesAgain = false
        await this.loadFiles(io)
      } while (this.filesAgain)
    } catch {
      /* pliki to podgląd: błąd odczytu nie może przeszkodzić w pracy */
    } finally {
      this.filesBusy = false
    }
  }

  private async loadFiles(io: Host): Promise<void> {
    const root = posix(this.projectRoot || (await io.sessionRoot().catch(() => '')))
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
  filesSoon(io: Host): void {
    if (this.filesTimer) return
    this.filesTimer = true
    void io
      .sleep(600)
      .then(() => {
        this.filesTimer = false
        return this.refreshFiles(io)
      })
      .catch(() => {
        this.filesTimer = false
      })
  }

  /** Rozwija albo zwija katalog w drzewie. */
  async toggleDir(io: Host, path: string): Promise<void> {
    await io.set(S.files, f => ({ ...f, expanded: f.expanded.some(x => pkey(x) === pkey(path)) ? f.expanded.filter(x => !inside(path, x)) : [...f.expanded, posix(path)] }))
    // odświeżenie w tle: kliknięcie nie czeka na dysk i gita (limit czasu przycisku)
    void this.refreshFiles(io)
  }

  /** Szukanie w drzewie: filtr nazw, z doczytaniem nierozwiniętych katalogów. */
  async searchFiles(io: Host, query: string): Promise<void> {
    await io.set(S.files, f => ({ ...f, query }))
    void this.refreshFiles(io)
  }

  /** Udany `git commit` Claude: skrót commita i pliki tej tury, które nim weszły (po commicie czyste). */
  async noteCommit(io: Host): Promise<void> {
    await this.refreshFiles(io)
    const f0 = await io.get(S.files)
    const root = f0.top || f0.root || posix(this.projectRoot)
    if (!root) return
    const r = await io.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd: root, timeoutMs: 8000 }).catch(() => null)
    if (!r || r.exitCode !== 0) return
    await this.refreshFiles(io)
    const f = await io.get(S.files)
    const act = await io.get(S.activity)
    const files = act.files.filter(a => a.edits > 0 && !f.git?.files[pkey(a.path)]).map(a => a.path)
    const at = await io.now()
    await io.set(S.files, x => ({ ...x, commit: { sha: r.stdout.trim(), files, at } }))
  }

  /** Pierwsza linia bieżącego polecenia (po redakcji), tytuł paska i panelu agentów. */
  turnTitle(): string | null {
    return this.turnLabel
  }

  /** Po wykonaniu narzędzia. Nie zmienia wyniku; błędy połyka. */
  async onTool(io: Host, tool: string, input: Record<string, unknown>, ran: { isError?: true; deny?: string; result?: unknown; text?: string }): Promise<void> {
    if (this.settings.paused) return
    const now = await io.now()
    let obs: MentorObservation | null = null
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') obs = this.observeEdit(tool, input, ran, now)
    else if (tool === 'Bash') obs = this.observeBash(input, ran, now)
    const change = this.lastChange
    this.lastChange = null
    if (change) await this.addChange(io, change)
    if (!obs) return
    this.turnObs.push(obs)
    if (this.work.turn === this.turn && (obs.kind === 'edit' || obs.kind === 'create')) this.work = { ...this.work, added: this.work.added + obs.added, removed: this.work.removed + obs.removed }
    if (obs.file) this.touchedSince.add(norm(obs.file))
    await io.set(S.feed, f => [obs!, ...f].slice(0, 40))
  }

  private rel(path: string): string {
    // Bez końcowego ukośnika, inaczej katalog główny dysku (C:\) nigdy nie pasuje.
    const r = norm(this.projectRoot).replace(/\/+$/, '')
    const p = path.replace(/\\/g, '/')
    return norm(p).startsWith(r + '/') ? p.slice(r.length + 1) : p
  }

  private observeEdit(tool: string, input: Record<string, unknown>, ran: { isError?: true; deny?: string; result?: unknown; text?: string }, now: number): MentorObservation {
    const path = String(input.file_path ?? input.notebook_path ?? '')
    const id = makeId('o', now)
    const base: MentorObservation = {
      id, ts: now, turn: this.turn, kind: 'edit', tool, file: this.rel(path), line: null, summary: '', added: 0, removed: 0, lang: langOf(path),
      concepts: [], symbols: [], failed: false, blocked: false, preexisting: this.preexisting.has(norm(path)),
    }
    const result = (ran.result ?? {}) as { type?: string; structuredPatch?: Hunk[]; content?: string; staged?: boolean; originalFile?: string | null }
    if (ran.deny !== undefined || ran.isError || result.staged) {
      this.lastChange = this.changeShell(base, 'failed', now)
      return { ...base, failed: true, summary: ran.deny ? `Operacja odrzucona: ${ran.deny.slice(0, 160)}` : result.staged ? 'Zmiana wstrzymana do przeglądu, plik bez zmian' : `Edycja nie powiodła się: ${(ran.text ?? '').slice(0, 160)}` }
    }
    let facts: ChangeFacts | null = null
    if (tool === 'Write' && (result.type === 'create' || !result.structuredPatch?.length)) facts = factsFromContent(String(input.content ?? result.content ?? ''), this.settings.maxSnippetLines)
    else if (result.structuredPatch) facts = factsFromPatch(result.structuredPatch, this.settings.maxSnippetLines)
    else if (tool === 'NotebookEdit') facts = factsFromContent(String(input.new_source ?? ''), this.settings.maxSnippetLines)
    const kind: MentorObservation['kind'] = tool === 'Write' && result.type === 'create' ? 'create' : isConfigFile(path) ? 'config' : 'edit'
    if (isSensitivePath(path)) {
      this.lastChange = { ...this.changeShell({ ...base, kind }, 'blocked', now), summary: 'Plik wrażliwy: kod nie jest zapisywany ani analizowany' }
      return { ...base, kind, blocked: true, added: facts?.added ?? 0, removed: facts?.removed ?? 0, summary: 'Plik wrażliwy: treść nie jest analizowana ani zapisywana' }
    }
    if (!facts) return { ...base, kind, summary: 'Zmiana bez szczegółów diffu' }
    // wszystko, co dalej powstaje z linii (opis zmiany, nazwy, pojęcia), widzi już tekst bez sekretów
    facts = redactLines(facts)
    const hits = detectConcepts(base.lang, facts.addedLines, path)
    const symbols = newSymbols(facts.addedLines)
    let summary = ''
    let k2: MentorObservation['kind'] = kind
    if (/package\.json$|composer\.json$|requirements[\w.-]*\.txt$|pyproject\.toml$/i.test(path)) {
      const deps = facts.addedLines.map(l => /^\s*"([@\w/.-]+)"\s*:\s*"[~^>=<]*\d/.exec(l.text)?.[1] ?? /^([A-Za-z][\w.-]*)\s*[=<>~!]=/.exec(l.text.trim())?.[1]).filter((x): x is string => !!x)
      if (deps.length) {
        k2 = 'dependency'
        summary = `Nowe/zmienione zależności: ${deps.slice(0, 6).join(', ')}`
      }
    }
    if (!summary) {
      const what = kind === 'create' ? 'Nowy plik' : kind === 'config' ? 'Zmiana konfiguracji' : 'Edycja'
      summary = `${what}: +${facts.added} −${facts.removed}${symbols.length ? `, nowe: ${symbols.slice(0, 4).join(', ')}` : ''}`
    }
    const firstHit = hits.find(x => x.strong) ?? hits[0]
    const line = firstHit?.line ?? facts.firstLine
    const snip = safeSnippet(path, facts.snippet.text, this.settings.maxSnippetLines)
    const unified = redact(facts.unified).text
    this.details.set(id, { snippet: snip.text, start: facts.snippet.start, lang: base.lang, unified, facts })
    const obsOut: MentorObservation = { ...base, kind: k2, line, added: facts.added, removed: facts.removed, concepts: hits.map(x => x.id), symbols, summary }
    this.lastChange = this.captureChange(obsOut, tool, input, result, facts, unified, now)
    return obsOut
  }

  /** Czy w Claude Code jest już nowsza wersja niż ta, na której działa sesja. */
  async checkVersion(io: Host): Promise<void> {
    const v = await io.installedVersion().catch(() => null)
    await io.set(S.boot, b => ({ ...b, installedVersion: v }))
  }

  // ===================== Change Lab =====================

  private changeShell(o: MentorObservation, status: 'failed' | 'blocked', now: number): ChangeFull {
    return {
      id: makeId('c', now), ts: now, turnKey: `${this.sessionId}:${this.turn}`, turnLabel: this.turnLabel, tool: o.tool,
      kind: o.kind === 'create' ? 'create' : 'edit', status, file: o.file ?? '', lang: o.lang, line: null, added: o.added, removed: o.removed,
      summary: status === 'failed' ? 'Zmiana nie weszła do pliku (odrzucona albo błąd narzędzia)' : '', concepts: [], facts: [], hasBefore: false, hasAfter: false,
      unified: '', before: null, beforeStart: 1, after: null, afterStart: 1,
    }
  }

  /**
   * Rekord zmiany z wyniku narzędzia: "przed" to originalFile, "po" to ten plik z nałożonym
   * patchem (albo treść Write). Gdy patch się nie nakłada, "po" zostaje puste zamiast zgadywane.
   */
  private captureChange(o: MentorObservation, tool: string, input: Record<string, unknown>, result: { type?: string; structuredPatch?: Hunk[]; content?: string; originalFile?: string | null }, facts: ChangeFacts, unified: string, now: number): ChangeFull {
    const isCreate = o.kind === 'create'
    const original = typeof result.originalFile === 'string' ? result.originalFile : null
    const hunks = result.structuredPatch ?? []
    let afterFull: string | null = null
    if (tool === 'Write') afterFull = String(input.content ?? result.content ?? '')
    else if (original !== null && hunks.length) afterFull = applyHunks(original, hunks)
    const ranges = changedRanges(hunks)
    let before: { text: string; start: number } | null = null
    let after: { text: string; start: number } | null = null
    if (!isCreate && original !== null && ranges) before = windowFor(original, ranges.old[0], ranges.old[1])
    if (afterFull !== null) {
      if (isCreate) after = { text: afterFull.split(/\r?\n/).slice(0, 200).join('\n'), start: 1 }
      else if (ranges) after = windowFor(afterFull, ranges.new[0], ranges.new[1])
    }
    const keep = this.settings.saveChanges !== false
    const shortName = (id: string) => BY_ID.get(id)?.name.replace(/\s*\(.*\)$/, '') ?? null
    return {
      id: makeId('c', now), ts: now, turnKey: `${this.sessionId}:${this.turn}`, turnLabel: this.turnLabel, tool,
      kind: o.kind === 'create' ? 'create' : o.kind === 'config' ? 'config' : o.kind === 'dependency' ? 'dependency' : 'edit',
      status: 'ok', file: o.file ?? '', lang: o.lang, line: o.line, added: o.added, removed: o.removed, summary: o.summary,
      concepts: o.concepts, facts: describeChange(facts.removedLines, facts.addedLines, o.lang, shortName, isCreate).map(f => redact(f).text),
      hasBefore: keep && !!before, hasAfter: keep && !!after,
      unified: keep ? unified : '', before: keep && before ? redact(before.text).text : null, beforeStart: before?.start ?? 1,
      after: keep && after ? redact(after.text).text : null, afterStart: after?.start ?? 1,
    }
  }

  private async addChange(io: Host, c: ChangeFull): Promise<void> {
    this.changeCache.set(c.id, c)
    const meta: ChangeMeta = { ...c }
    delete (meta as Partial<ChangeFull>).before
    delete (meta as Partial<ChangeFull>).after
    delete (meta as Partial<ChangeFull>).unified
    await io.set(S.changes, list => [meta, ...list.filter(x => x.id !== c.id)].slice(0, 120))
    // zapis w tle: nie opóźnia wyniku narzędzia
    void write(io, this.ctx, [{ op: 'saveChange', args: { change: { ...c, sessionId: this.sessionId, projectId: this.projectId } } }]).catch(() => undefined)
  }

  getChange(id: string): ChangeFull | null {
    return this.changeCache.get(id) ?? null
  }

  async openChange(io: Host, id: string): Promise<void> {
    await io.set(S.lab, l => ({ ...l, selected: id, view: 'diff' as const, error: null, confirm: null, handed: null, guess: null, alt: l.alt.forId === id ? l.alt : { status: 'idle' as const, forId: null, items: [], message: '' } }))
    await io.set(S.tab, () => 'changes' as MentorTab)
    if (this.changeCache.has(id)) return
    if (!this.ctx) {
      await io.set(S.lab, l => ({ ...l, error: 'Baza jeszcze startuje. Spróbuj za chwilę.' }))
      return
    }
    await io.set(S.lab, l => ({ ...l, loading: true }))
    // odczyt z bazy w tle: kliknięcie od razu pokazuje szczegóły („Wczytuję kod…”), nie czeka na bazę
    const ctx = this.ctx
    void (async () => {
      try {
        const full = await one<ChangeFull | null>(io, ctx, 'getChange', { id })
        if (full) this.changeCache.set(id, { ...full, before: full.before ?? null, after: full.after ?? null, unified: full.unified ?? '' })
        else await io.set(S.lab, l => ({ ...l, error: 'Tej zmiany nie ma już w historii (limit 400 zmian albo 60 dni).' }))
      } catch (e) {
        await io.set(S.lab, l => ({ ...l, error: `Nie udało się wczytać zmiany: ${errText(e)}` }))
      } finally {
        await io.set(S.lab, l => ({ ...l, loading: false }))
      }
    })()
  }

  /**
   * Laboratorium w szczegółach zmiany: A = przed, B = po, przypadki dobrane z diffu.
   * Drugie kliknięcie zamyka. Nic nie trafia do plików.
   */
  async openBench(io: Host, id: string): Promise<void> {
    const c = this.changeCache.get(id)
    if (!c?.after) return
    if ((await io.get(S.lab)).bench?.forId === id) return void (await io.set(S.lab, l => ({ ...l, bench: null })))
    const dialect = simDialect(c.lang) ?? 'js'
    const variants: MentorBenchVariant[] = [
      ...(c.before ? [{ id: 'A', label: 'przed', code: c.before, origin: 'before' as const }] : []),
      { id: c.before ? 'B' : 'A', label: c.before ? 'po' : 'nowy kod', code: c.after, origin: 'after' as const },
    ]
    // przypadek z diffu (np. wartość z warunku) i wspólne wywołanie z przykładowymi danymi
    const fromDiff = suggestCall(c.after, c.unified, dialect)
    const shared = c.before ? pairCall(c.before, c.after, dialect) : null
    const cases = [...new Set([fromDiff.call ? fromDiff.hint : '', shared?.call ? shared.label ?? '' : ''].filter(Boolean))].slice(0, 3)
    await io.set(S.lab, l => ({ ...l, bench: { forId: id, variants, cases, sel: variants[variants.length - 1]!.id, line: 1, error: null, handed: null, reveal: cases.length ? 0 : undefined, frame: 0 } }))
    if (cases.length) await this.animateBench(io)
  }

  // ===================== animacje: jeden harmonogram =====================
  // Jedna pętla dla wszystkiego, co się rusza: odtwarzanie w Symulatorze, odsłanianie wyników
  // laboratorium, błyski plików, oczekiwanie na lekcję i krótkie potwierdzenia. Śpi dokładnie do
  // najbliższej zmiany; gdy nic się nie rusza, kończy się i nie zostawia żadnego timera.

  /** Licznik klatek (spinnery w terminalu). */
  frame = 0
  /** Powierzchnia, na której panel był ostatnio rysowany (na desktopie ruch robi CSS w SVG). */
  lastSurface: string | null = null
  private animIo: Host | null = null
  private animRunning = false
  private simNextAt = 0
  private benchNextAt = 0
  /** Ile razy pętla obudziła się, żeby przerysować (do pomiarów i testów). */
  animTicks = 0

  /** Budzi harmonogram, jeśli śpi. */
  wake(io: Host): void {
    this.animIo = io
    if (!this.animRunning) void this.animLoop().catch(() => undefined)
  }

  private async animLoop(): Promise<void> {
    this.animRunning = true
    try {
      // bezpiecznik: żadna animacja nie trwa dłużej niż kilka tysięcy kroków
      for (let guard = 0; guard < 20_000; guard++) {
        const io = this.animIo
        if (!io) break
        const now = await io.now()
        const due = await this.animDue(io, now)
        if (due === null) break
        if (!(await io.sleep(Math.max(40, due - now)))) break
        // krok liczy się co najmniej do zaplanowanej chwili (zegar bez sesji stoi w miejscu)
        await this.animStep(io, Math.max(due, await io.now()))
      }
    } finally {
      this.animRunning = false
    }
  }

  private async animDue(io: Host, now: number): Promise<number | null> {
    const due: number[] = []
    // w terminalu błysk pliku to shimmer z klatek; na desktopie robi go CSS
    const a = nextChange(await io.get(S.activity), now, FRAME_MS, this.lastSurface === 'terminal')
    if (a !== null) due.push(a)
    // pracujący subagenci i zadania w tle: licznik czasu raz na sekundę, wyjście zadań co kilka sekund
    const tasks = await io.get(S.tasks)
    const working = this.work.turn === this.turn && this.work.startedAt > 0 && this.work.endedAt === null
    if (working || (await io.get(S.agents)).some(x => x.status === 'running') || tasks.some(t => t.status === 'running')) due.push(now + 1000)
    const read = nextRead(tasks)
    if (read !== null) due.push(read)
    if ((await io.get(S.sim)).playing) due.push(this.simNextAt)
    if ((await io.get(S.lab)).bench?.reveal !== undefined) due.push(this.benchNextAt)
    const job = await io.get(S.job)
    // terminal nie ma CSS: spinner oczekiwania na lekcję to klatki tekstu
    if ((job.state === 'working' || job.state === 'queued') && this.lastSurface === 'terminal') due.push(now + 400)
    const flash = await io.get(S.flash)
    if (flash && flash.until > now) due.push(flash.until)
    return due.length ? Math.min(...due) : null
  }

  private async animStep(io: Host, now: number): Promise<void> {
    this.frame++
    this.animTicks++
    const sim = await io.get(S.sim)
    if (sim.playing && now >= this.simNextAt - 5) {
      const total = simTotal(sim)
      // odtwarzanie żyje tylko na widocznej zakładce Symulatora
      if ((await io.get(S.tab)) !== 'sim' || sim.cursor >= total - 1) await io.set(S.sim, s => ({ ...s, playing: false }))
      else {
        await io.set(S.sim, s => ({ ...s, cursor: Math.min(total - 1, s.cursor + 1), playing: s.cursor + 1 < total - 1 }))
        this.simNextAt = now + SPEED_MS[sim.speed ?? 'slow']
      }
    }
    // ostatnie linie wyjścia zadań w tle (tylko te, którym minął odstęp)
    for (const t of await io.get(S.tasks)) {
      if (t.status === 'running' && t.outputFile && now >= t.nextReadAt - 5) await this.readTask(io, t.id)
    }
    const b = (await io.get(S.lab)).bench
    if (b?.reveal !== undefined && now >= this.benchNextAt - 5) {
      const cells = b.cases.length * b.variants.length
      const f = (b.frame ?? 0) + 1
      const reveal = f >= BENCH_FRAMES ? b.reveal + 1 : b.reveal
      await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: reveal >= cells ? undefined : reveal, frame: f >= BENCH_FRAMES ? 0 : f } } : l))
      this.benchNextAt = now + BENCH_FRAME_MS
    }
    io.invalidate()
  }

  /** Odczyt wyjścia zadania w tle (ostatnie linie, po redakcji). Błąd odczytu tylko odsuwa następną próbę. */
  async readTask(io: Host, id: string, file?: string): Promise<void> {
    const t = (await io.get(S.tasks)).find(x => x.id === id)
    const path = file ?? t?.outputFile
    if (!t || !path) return
    const now = await io.now()
    try {
      const text = await io.fsRead(path)
      await io.set(S.tasks, list => withOutput(list, id, text, now).map(x => (x.id === id && !x.outputFile ? { ...x, outputFile: path } : x)))
    } catch {
      await io.set(S.tasks, list => list.map(x => (x.id === id ? { ...x, nextReadAt: now + 10_000 } : x)))
    }
  }

  /** Zmiana tempa działa od następnego kroku, także w trakcie odtwarzania. */
  async cycleSpeed(io: Host): Promise<void> {
    await io.set(S.sim, s => ({ ...s, speed: s.speed === 'fast' ? ('slow' as const) : s.speed === 'normal' ? ('fast' as const) : ('normal' as const) }))
  }

  /**
   * Animacja uruchomienia laboratorium: komórki wyniku odsłaniają się po kolei, a liczona
   * pokazuje, którą linię właśnie wykonuje. Wyniki są policzone od razu; animacja tylko je odsłania.
   */
  async animateBench(io: Host): Promise<void> {
    const b = (await io.get(S.lab)).bench
    if (!b || !b.cases.length) return
    await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: 0, frame: 0 } } : l))
    this.benchNextAt = (await io.now()) + BENCH_FRAME_MS
    this.wake(io)
  }

  /** „Pokaż od razu”: koniec animacji, wszystkie wyniki widoczne. */
  async skipBench(io: Host): Promise<void> {
    await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: undefined, frame: undefined } } : l))
  }

  /**
   * Odtwarzanie w Symulatorze: kursor idzie sam, krok po kroku. Tempo stałe na krok, żeby dało się
   * śledzić linię, zmienne i wyjście: wolno 8 s, średnio 4 s, szybko 1,8 s. Drugie wywołanie to pauza.
   */
  async playSim(io: Host): Promise<void> {
    const sim = await io.get(S.sim)
    if (sim.playing) return void (await io.set(S.sim, s => ({ ...s, playing: false })))
    const total = simTotal(sim)
    if (total <= 1) return
    await io.set(S.sim, s => ({ ...s, playing: true, cursor: s.cursor >= total - 1 ? 0 : s.cursor }))
    this.simNextAt = (await io.now()) + SPEED_MS[sim.speed ?? 'slow']
    this.wake(io)
  }

  /** Krótkie potwierdzenie (sukces albo błąd) na górze panelu; znika samo. */
  async flash(io: Host, text: string, tone: 'ok' | 'error' = 'ok', ms = 2600): Promise<void> {
    const now = await io.now()
    await io.set(S.flash, () => ({ text, tone, until: now + ms }))
    this.wake(io)
  }

  /** Alternatywa od modelu jako kolejna wersja w laboratorium tej zmiany. */
  async benchAddAlt(io: Host, id: string, index: number): Promise<void> {
    const alt = (await io.get(S.lab)).alt.items[index]
    if (!alt) return
    if ((await io.get(S.lab)).bench?.forId !== id) await this.openBench(io, id)
    await io.set(S.lab, l => {
      const b = l.bench
      if (!b) return l
      if (b.variants.some(v => v.origin === 'alt' && v.code === alt.code)) return l
      const vid = nextVariantId(b.variants)
      if (!vid) return { ...l, bench: { ...b, error: 'Najwyżej 4 wersje. Usuń jedną, żeby dodać kolejną.' } }
      return { ...l, bench: { ...b, variants: [...b.variants, { id: vid, label: alt.title, code: alt.code, origin: 'alt' as const }], sel: vid, line: 1, error: null } }
    })
  }

  /** Przykład do nauki w Symulatorze: para A/B (przed i po przeróbce) albo jeden kod. */
  async showExample(io: Host, ex: Example): Promise<void> {
    const pair = ex.before ? { a: ex.before, b: ex.code, aStart: 1, bStart: 1, aLabel: 'przed', bLabel: 'po', hint: '' } : null
    await io.set(S.sim, s => ({ ...s, mode: 'js' as const, dialect: ex.dialect, source: ex.code, origin: `przykład: ${ex.label}`, note: ex.note, pair, edits: [], cursor: 0, variant: (pair ? 'B' : 'A') as 'A' | 'B', panel: 'state' as const, callArgs: '', playing: false }))
    await io.set(S.tab, () => 'sim' as MentorTab)
    // przykład od razu się odtwarza, drzewo widgetów nie ma kroków
    if (!ex.widgets) void this.playSim(io)
  }

  /** „Krok po kroku” dla wybranej wersji i przypadku: pełny symulator w swojej zakładce. */
  async benchStep(io: Host, caseIndex = 0): Promise<void> {
    const lab = await io.get(S.lab)
    const b = lab.bench
    const c = b ? this.changeCache.get(b.forId) : undefined
    const v = b?.variants.find(x => x.id === b.sel)
    if (!b || !c || !v) return
    const dialect = simDialect(c.lang) ?? 'js'
    const call = b.cases[caseIndex]
    await io.set(S.sim, s => ({ ...s, mode: 'js' as const, dialect, source: v.code, origin: `${c.file}: ${v.id} ${v.label}`, note: undefined, playing: false, pair: null, edits: [], cursor: 0, variant: 'A' as const, panel: 'state' as const, callArgs: call ? caseStatement(call, dialect) : '' }))
    await io.set(S.tab, () => 'sim' as MentorTab)
  }

  /** Wyjaśnienie zmiany na miejscu, w jej szczegółach, zawsze na kodzie tej zmiany. */
  async lessonForChange(io: Host, id: string): Promise<void> {
    const c = this.changeCache.get(id)
    if (!c) return
    // drugie kliknięcie chowa wyjaśnienie
    if ((await io.get(S.lab)).lessonFor === id) return void (await io.set(S.lab, l => ({ ...l, lessonFor: null, lessonId: null })))
    const levels = Object.fromEntries((await io.get(S.knowledge)).map(k => [k.id, k.level]))
    const concept = interestingConcepts(c.concepts, levels, true)[0]
    if (!concept) return
    const now = await io.now()
    const obsId = `chg-${id}`
    // kod tej zmiany jako źródło lekcji: działa też po przeładowaniu i dla zmian z historii
    this.details.set(obsId, { snippet: c.after ?? '', start: c.afterStart, lang: c.lang, unified: c.unified, facts: null })
    const obs: MentorObservation = {
      id: obsId, ts: c.ts, turn: this.turn, kind: c.kind === 'create' ? 'create' : 'edit', tool: c.tool, file: c.file, line: c.line, summary: c.summary,
      added: c.added, removed: c.removed, lang: c.lang, concepts: c.concepts, symbols: [], failed: false, blocked: false, preexisting: false,
    }
    this.enqueue({ id: makeId('j', now), kind: 'manual', conceptId: concept, obsId, deep: false, task: c.turnLabel, note: null, at: now, obs, inline: true })
    this.taught.delete(concept)
    await io.set(S.lab, l => ({ ...l, lessonFor: id, lessonId: null, lessonAt: now }))
    await io.set(S.job, () => ({ state: 'queued' as const, message: `Piszę wyjaśnienie: ${BY_ID.get(concept)!.name}.`, at: now }))
    void this.tick(io)
  }

  /**
   * „Sprawdź się” w zmianie: najpierw pytanie z pary przed/po (wynik liczy symulator),
   * gdy się nie da, zgadywanie zmiany po kodzie przed, a na końcu zwykłe ćwiczenie z pojęcia.
   */
  async quizForChange(io: Host, id: string): Promise<void> {
    const c = this.changeCache.get(id)
    if (!c) return
    const levels = Object.fromEntries((await io.get(S.knowledge)).map(k => [k.id, k.level]))
    const concept = interestingConcepts(c.concepts, levels, true)[0] ?? 'functions'
    const now = await io.now()
    const built = changeQuestion(makeId('q', now), c, concept)
    if (built) return void (await this.presentQuiz(io, built, true))
    if (c.before && c.unified) return void (await io.set(S.lab, l => ({ ...l, guess: { id, hints: [], revealed: false } })))
    await this.startQuiz(io, 'concept', concept)
  }

  async requestAlternatives(io: Host, id: string): Promise<void> {
    const c = this.changeCache.get(id)
    if (!c) return
    const fail = (message: string) => io.set(S.lab, l => ({ ...l, alt: { status: 'error' as const, forId: id, items: [], message } }))
    if (this.settings.cost === 'off') return void (await fail('Lekcje AI są wyłączone (Ustawienia, koszty). Inne podejście potrzebuje modelu.'))
    if (this.settings.sendCode === 'off') return void (await fail('Masz ustawione „nie wysyłaj kodu”, a bez kodu model nie zaproponuje innego podejścia.'))
    if (!c.after) return void (await fail('Ta zmiana nie ma zapisanego kodu.'))
    await io.set(S.lab, l => ({ ...l, confirm: null, handed: null, alt: { status: 'loading' as const, forId: id, items: [], message: '' } }))
    const now = await io.now()
    const system = 'Jesteś mentorem programowania. Odpowiadasz wyłącznie poprawnym JSON. Teksty po polsku, proste zdania, bez myślników jako interpunkcji.'
    const prompt = [
      `Plik: ${c.file} (język: ${c.lang}).`,
      `Polecenie, po którym Claude zmienił kod: ${c.turnLabel ?? 'nieznane'}.`,
      c.before ? `Kod przed zmianą:\n\`\`\`\n${c.before.slice(0, 3000)}\n\`\`\`` : 'Plik powstał w tej zmianie.',
      `Kod po zmianie:\n\`\`\`\n${c.after.slice(0, 6000)}\n\`\`\``,
      'Zaproponuj do 2 naprawdę innych sposobów osiągnięcia tego samego celu: inne podejście, a nie kosmetykę ani zmianę nazw. Każdy musi zachować to samo działanie. Gdy obecne rozwiązanie jest jedynym sensownym, zwróć pustą listę.',
      'Zachowaj nazwę i parametry funkcji, żeby obie wersje dało się uruchomić tym samym wywołaniem. Kod ma być kompletny (całe funkcje), bez „...”.',
      'Nie podawaj wyników pomiarów ani twierdzeń o szybkości bez uzasadnienia w kodzie.',
      'Format: {"alternatives":[{"title":"krótka nazwa podejścia","idea":"1-2 zdania, jak działa","code":"kod w tym samym języku, do 30 linii","pros":["zaleta"],"cons":["wada"],"when":"kiedy to wybrać"}]}',
    ].join('\n\n')
    const text = await this.callModel(io, 'manual', system, prompt, 2500, now).catch(() => null)
    if (!text) return void (await fail('Model jest niedostępny albo wyczerpał się dzienny limit. Spróbuj później.'))
    const j = extractJson(text)
    const raw = Array.isArray(j?.alternatives) ? (j!.alternatives as unknown[]) : null
    if (!raw) return void (await fail('Model zwrócił odpowiedź w złym formacie. Spróbuj jeszcze raz.'))
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 4) : [])
    const items: MentorAlternative[] = raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map(x => ({ title: String(x.title ?? '').slice(0, 80), idea: String(x.idea ?? '').slice(0, 400), code: redact(String(x.code ?? '')).text.split('\n').slice(0, 40).join('\n'), pros: strs(x.pros), cons: strs(x.cons), when: String(x.when ?? '').slice(0, 300) }))
      .filter(x => x.title && x.code.trim())
      .slice(0, 2)
    await io.set(S.lab, l => ({ ...l, alt: { status: 'ready' as const, forId: id, items, message: items.length ? '' : 'Model uznał, że obecne rozwiązanie jest tu najprostsze i nie ma sensownej alternatywy.' } }))
  }

  /** Porównanie obecnego kodu z alternatywą w symulatorze (A = obecne, B = alternatywa). */
  /** Wkłada prośbę do pola wiadomości. Claude dostaje ją dopiero, gdy użytkownik wyśle Enterem. */
  async handOff(io: Host, id: string, index: number): Promise<void> {
    const c = this.changeCache.get(id)
    const alt = (await io.get(S.lab)).alt.items[index]
    if (!c || !alt) return
    // ta sama decyzja, którą użytkownik widział na karcie, idzie do Claude jako polecenie
    const d = decisionFor(c, alt, (await io.get(S.lab)).bench)
    const text = decisionPrompt(d, c.lang, redact(alt.code).text)
    const ok = await io.fillPrompt(text).catch(() => false)
    await io.set(S.lab, l => ({ ...l, confirm: null, handed: ok ? 'Prośba czeka w polu wiadomości. Popraw ją albo wyślij Enterem.' : `Nie mogę wpisać do pola wiadomości. Skopiuj i wyślij sam: ${text}` }))
    if (ok) await this.flash(io, 'Polecenie czeka w polu wiadomości. Kod zmieni się dopiero po wysłaniu.')
  }

  private observeBash(input: Record<string, unknown>, ran: { isError?: true; deny?: string; text?: string }, now: number): MentorObservation | null {
    const cmd = String(input.command ?? '')
    if (!cmd.trim()) return null
    const f = classifyCommand(cmd)
    if (f.kind === 'bash' && !ran.isError) return null // zwykłe komendy bez błędu nie są lekcją
    const id = makeId('o', now)
    const key = cmd.trim().split(/\s+/).slice(0, 3).join(' ')
    const failed = !!ran.isError || ran.deny !== undefined
    const base: MentorObservation = {
      id, ts: now, turn: this.turn, kind: f.kind, tool: 'Bash', file: null, line: null, summary: redact(f.summary).text, added: 0, removed: 0, lang: 'sh',
      concepts: f.concepts, symbols: f.packages, failed, blocked: false, preexisting: false,
    }
    if (failed) {
      this.failedCommands.set(key, { obsId: id, ts: now })
      this.touchedSince.clear()
      const firstErr = redact((ran.text ?? ran.deny ?? '').split(/\r?\n/).find(l => /error|fail|exception|cannot|not found|denied/i.test(l)) ?? (ran.text ?? '').split(/\r?\n/)[0] ?? '').text.slice(0, 180)
      return { ...base, kind: 'error', summary: `Błąd: ${base.summary}${firstErr ? ` → ${firstErr}` : ''}`, concepts: [...new Set([...f.concepts, 'debugging'])] }
    }
    const prev = this.failedCommands.get(key)
    if (prev) {
      this.failedCommands.delete(key)
      const files = [...this.touchedSince].slice(0, 4).map(p => p.split('/').pop())
      this.touchedSince.clear()
      return { ...base, kind: 'fix', summary: `Naprawione: „${key}” wcześniej kończyło się błędem, teraz przechodzi${files.length ? `. Zmienione w międzyczasie: ${files.join(', ')}` : ''}`, concepts: [...new Set([...f.concepts, 'debugging'])] }
    }
    return base
  }

  /** Koniec tury głównej pętli: zapis, priorytety, kolejka lekcji. */
  async onTurnComplete(io: Host, answer: string): Promise<void> {
    const obs = this.turnObs
    this.turnObs = []
    if (!obs.length || this.settings.paused) return
    const now = await io.now()
    const useful = obs.filter(o => !o.blocked && !o.failed)
    const concepts = [...new Set(useful.flatMap(o => o.concepts))].filter(id => BY_ID.has(id))
    for (const id of concepts) this.projectConcepts[id] = (this.projectConcepts[id] ?? 0) + 1
    const ops: Op[] = [
      {
        op: 'addObservations',
        args: {
          items: obs.map(o => ({
            session_id: this.sessionId, project_id: this.projectId, turn_id: String(o.turn), ts: o.ts, kind: o.kind, tool: o.tool, file_path: o.file, line: o.line,
            summary: o.summary, added: o.added, removed: o.removed, snippet: this.details.get(o.id)?.snippet ?? null, concepts: o.concepts,
            meta: { symbols: o.symbols, failed: o.failed, blocked: o.blocked, preexisting: o.preexisting },
          })),
        },
      },
    ]
    if (concepts.length) ops.push({ op: 'recordExposure', args: { conceptIds: concepts, projectId: this.projectId, now } })
    if (this.ctx) ops.push({ op: 'getKnowledge' })
    const res = await write(io, this.ctx, ops)
    const kn = res?.at(-1)
    if (kn?.ok && this.ctx) {
      const v = kn.value as { knowledge: KnowledgeDb[]; misconceptions: MisDb[] }
      await this.applyKnowledge(io, v.knowledge, v.misconceptions)
    }
    // priorytet: co najbardziej warto teraz zrozumieć
    const knowledge = await io.get(S.knowledge)
    const lv = Object.fromEntries(knowledge.map(k => [k.id, k]))
    let best: { o: MentorObservation; c: ConceptDef; score: number } | null = null
    // Sam build/test bez błędu nie jest materiałem na lekcję (brak kodu do pokazania).
    const teachable = useful.filter(o => o.file !== null || o.kind === 'error' || o.kind === 'fix' || o.kind === 'dependency')
    for (const o of teachable) {
      for (const id of o.concepts) {
        const c = BY_ID.get(id)
        if (!c) continue
        const k = lv[id]
        const mastery = k?.mastery ?? 0
        let score = c.weight * (1.2 - mastery)
        if (o.symbols.length) score *= 1.3
        if (o.kind === 'fix' || o.kind === 'error') score *= 1.4
        if (this.taught.has(id)) score *= 0.15
        if ((k?.level ?? 0) >= 4 && !k?.due) score *= 0.1
        // Konkretniejsze pojęcie (głębiej w grafie zależności) mówi o zmianie więcej niż ogólne.
        score *= 1 + 0.12 * (DEPTH.get(id) ?? 0)
        if (!best || score > best.score) best = { o, c, score }
      }
    }
    if (!best) return
    const levels = Object.fromEntries(knowledge.map(k => [k.id, k.level]))
    const missing = missingPrereqs(best.c, levels, CONCEPTS)
    await io.set(S.focus, () => ({
      conceptId: best!.c.id,
      title: best!.c.name,
      reason: `${best!.o.summary}${best!.o.file ? ` w ${best!.o.file}${best!.o.line ? `:${best!.o.line}` : ''}` : ''}. Twój poziom: ${levelName(levels[best!.c.id] ?? 0)}.`,
      file: best!.o.file,
      line: best!.o.line,
      obsId: best!.o.id,
      missingPrereqs: missing.map(m => m.id),
    }))
    // To samo pojęcie najwyżej raz na 30 min (lista lekcji przeżywa przeładowanie moda, pamięć sesji nie).
    const recent = (await io.get(S.lessons)).some(l => l.conceptIds[0] === best!.c.id && now - l.ts < 30 * 60000)
    if (this.settings.autoTeach && best.score > 0.4 && !this.taught.has(best.c.id) && !recent) {
      const note = redact(answer).text.slice(0, 1500) || null
      this.enqueue({ id: makeId('j', now), kind: 'auto', conceptId: best.c.id, obsId: best.o.id, deep: false, task: this.taskContext, note, at: now })
    }
  }

  private enqueue(job: Job): void {
    this.jobs = [...this.jobs.filter(j => !(j.conceptId === job.conceptId && j.kind === job.kind)), job].slice(-4)
    if (job.kind === 'manual') this.jobs.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'manual' ? -1 : 1))
  }

  // ===================== kolejka lekcji =====================

  async tick(io: Host): Promise<void> {
    if (this.working || !this.jobs.length) return
    const now = await io.now()
    const job = this.jobs[0]!
    if (job.kind === 'auto' && now - this.lastAutoAt < MIN_GAP_MS[this.settings.frequency]) {
      await io.set(S.job, j => (j.state === 'queued' ? j : { state: 'queued' as const, message: `Lekcja „${BY_ID.get(job.conceptId)?.name ?? job.conceptId}” czeka (limit częstotliwości: ${this.settings.frequency}).`, at: now }))
      return
    }
    this.jobs.shift()
    this.working = true
    try {
      await this.runLessonJob(io, job, now)
    } catch (e) {
      await io.set(S.job, () => ({ state: 'error' as const, message: `Nie udało się przygotować lekcji: ${errText(e)}`, at: now }))
    } finally {
      this.working = false
    }
  }

  private async snippetFor(io: Host, obsId: string, file: string | null, line: number | null): Promise<Detail> {
    const d = this.details.get(obsId)
    if (d) return d
    // po przeładowaniu moda: fragment z aktualnej wersji pliku (oznaczony jako taki)
    if (file && !isSensitivePath(file)) {
      try {
        const abs = /^[A-Za-z]:|^\//.test(file) ? file : joinPath(this.projectRoot, file)
        const text = await io.fsRead(abs)
        const lines = text.split('\n')
        const center = Math.max(1, line ?? 1)
        const from = Math.max(1, center - 10)
        const s = safeSnippet(file, lines.slice(from - 1, from + 29).join('\n'), this.settings.maxSnippetLines)
        return { snippet: s.text, start: from, lang: langOf(file), unified: '', facts: null }
      } catch {
        /* plik mógł zniknąć */
      }
    }
    return { snippet: '', start: 1, lang: langOf(file), unified: '', facts: null }
  }

  private async findObs(io: Host, obsId: string): Promise<MentorObservation | null> {
    return (await io.get(S.feed)).find(o => o.id === obsId) ?? null
  }

  private async runLessonJob(io: Host, job: Job, now: number): Promise<void> {
    const c = BY_ID.get(job.conceptId)
    if (!c) return
    const obs = (await this.findObs(io, job.obsId)) ?? job.obs ?? {
      id: job.obsId, ts: now, turn: this.turn, kind: 'edit' as const, tool: '—', file: null, line: null, summary: 'Lekcja na żądanie', added: 0, removed: 0, lang: 'text',
      concepts: [c.id], symbols: [], failed: false, blocked: false, preexisting: false,
    }
    await io.set(S.job, () => ({ state: 'working' as const, message: `Przygotowuję lekcję: ${c.name}…`, at: now }))
    const knowledge = await io.get(S.knowledge)
    const levels = Object.fromEntries(knowledge.map(k => [k.id, k.level]))
    const related = obs.concepts.filter(id => id !== c.id).map(id => BY_ID.get(id)).filter((x): x is ConceptDef => !!x).slice(0, 3)
    const d = await this.snippetFor(io, obs.id, obs.file, obs.line)
    const input: LessonInput = {
      concept: c,
      related,
      obs,
      snippet: { text: d.snippet, start: d.start, lang: d.lang },
      unified: d.unified,
      level: levels[c.id] ?? 0,
      levelsByConcept: Object.fromEntries([c, ...related].map(x => [x.id, levels[x.id] ?? 0])),
      missingPrereqs: missingPrereqs(c, levels, CONCEPTS),
      taskContext: job.task,
      claudeNote: job.note,
      // oceny poprzednich lekcji zmieniają sposób pisania, nigdy poziom wiedzy
      settings: { ...this.settings, detail: detailFor(this.feedback, this.settings.detail as 'short' | 'normal' | 'deep', c.id, this.projectId) },
      deep: job.deep,
      prefs: lessonPrefs(this.feedback, c.id, this.projectId),
    }
    let body = builtinLesson(input)
    let source: 'model' | 'builtin' = 'builtin'
    let modelName: string | null = null
    let tokensIn = 0
    let tokensOut = 0
    let cacheKey: string | null = null
    const why: string[] = []
    const allowModel = job.kind === 'manual' ? true : this.settings.cost !== 'off'
    if (!allowModel) why.push('wywołania modelu wyłączone w ustawieniach kosztów')
    else if (this.breaker.open(now)) why.push('model chwilowo wstrzymany po serii błędów API')
    else if (!this.ctx) why.push('baza niedostępna (nie mogę pilnować limitów)')
    if (allowModel && !this.breaker.open(now) && this.ctx) {
      const sendCode = this.settings.sendCode !== 'off' && !obs.blocked
      const req = lessonRequest(input, sendCode)
      cacheKey = hash(`${c.id}|${d.snippet}|${input.settings.detail}|${job.deep}|${levels[c.id] ?? 0}|${this.settings.model}|${sendCode}|${(input.prefs ?? []).join('|')}`)
      const cached = await one<{ body: unknown } | Record<string, unknown> | null>(io, this.ctx, 'cacheGet', { key: cacheKey }).catch(() => null)
      if (cached && typeof cached === 'object') {
        body = mergeModelLesson(body, cached as Record<string, unknown>)
        source = 'model'
        modelName = `${this.settings.model} (z cache)`
      } else {
        const profile = COST_PROFILES[this.settings.cost]
        const maxOut = Math.round((job.deep ? 1.6 : 1) * (profile.maxTokensPerLesson || 2200))
        const est = estimateTokens(req.system + req.prompt, maxOut)
        const day = today(now)
        const limits = job.kind === 'manual' ? { maxCalls: MANUAL_LIMIT.calls, maxTokens: MANUAL_LIMIT.tokens } : { maxCalls: profile.autoCallsPerDay, maxTokens: profile.tokensPerDay }
        const grant = await one<{ granted: boolean; calls: number }>(io, this.ctx, 'reserveBudget', { day, kind: job.kind, maxCalls: limits.maxCalls, maxTokens: limits.maxTokens, estTokens: est }).catch(() => ({ granted: false, calls: -1 }))
        if (!grant.granted) why.push(`dzienny limit ${job.kind === 'manual' ? 'ręcznych' : 'automatycznych'} wywołań wyczerpany`)
        else {
          const r = await io.complete({ model: this.settings.model, system: req.system, prompt: req.prompt, maxTokens: maxOut, timeoutMs: 120000 })
          tokensIn = r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0)
          tokensOut = r.usage.output_tokens
          await write(io, this.ctx, [{ op: 'commitUsage', args: { day, kind: job.kind, tokensIn, tokensOut } }])
          if (r.isAnswered) {
            const json = extractJson(r.text)
            if (json) {
              body = mergeModelLesson(body, json)
              source = 'model'
              modelName = this.settings.model
              this.breaker.ok()
              await write(io, this.ctx, [{ op: 'cachePut', args: { key: cacheKey, body: json, now } }])
            } else {
              why.push('model zwrócił odpowiedź w złym formacie')
              this.breaker.fail(now)
            }
          } else {
            why.push(r.reason === 'api-error' ? `błąd API${'status' in r && r.status ? ` (${r.status})` : ''}` : r.reason === 'aborted' ? 'przekroczony czas' : 'pusta odpowiedź')
            this.breaker.fail(now)
          }
          await this.countUsage(io, job.kind, tokensIn + tokensOut)
        }
      }
    }
    if (source === 'builtin' && why.length) body = { ...body, uncertainty: [...body.uncertainty, `Lekcja wbudowana (bez AI): ${why.join('; ')}.`] }
    const lesson: MentorLesson = {
      id: makeId('l', now),
      title: body.title,
      ts: now,
      conceptIds: body.conceptIds,
      file: body.file,
      line: body.line,
      source,
      status: 'new',
      body,
      model: modelName,
    }
    await write(io, this.ctx, [
      {
        op: 'saveLesson',
        args: {
          lesson: {
            id: lesson.id, project_id: this.projectId, session_id: this.sessionId, ts: now, title: lesson.title, concept_ids: lesson.conceptIds, file_path: lesson.file, line: lesson.line,
            body: { ...body, model: modelName }, source, model: modelName, tokens_in: tokensIn, tokens_out: tokensOut, cache_key: cacheKey, status: 'new',
          },
        },
      },
    ])
    this.taught.add(c.id)
    if (job.kind === 'auto') this.lastAutoAt = now
    await io.set(S.lessons, l => [toMeta(lesson), ...l.filter(x => x.id !== lesson.id)].slice(0, 30))
    const tab = await io.get(S.tab)
    const current = await io.get(S.lesson)
    if (job.kind === 'manual' || tab !== 'lesson' || !current) await io.set(S.lesson, () => lesson)
    if (job.inline) await io.set(S.lab, l => ({ ...l, lessonId: lesson.id }))
    else await io.set(S.unseen, n => n + 1)
    await io.set(S.job, () => ({ state: 'idle' as const, message: `Gotowe: ${lesson.title} (${source === 'model' ? `AI: ${modelName}` : 'wbudowana'})`, at: now }))
    if (!this.settings.focusMode && job.kind === 'auto') io.toast(`Mentor: nowa lekcja „${c.name}”`)
    if (job.kind === 'manual' && !job.inline) await io.set(S.tab, () => 'lesson' as MentorTab)
    if (this.settings.autoQuiz && job.kind === 'auto' && !(await io.get(S.quiz))) {
      const built = this.deterministicQuiz(c, d, obs.file, now)
      if (built) await this.presentQuiz(io, built, false)
    }
  }

  /** Lekcja na żądanie (przycisk, /mentor explain): także dla dowolnego pojęcia. */
  async requestLesson(io: Host, conceptId?: string, deep = true): Promise<string> {
    const now = await io.now()
    const focus = await io.get(S.focus)
    const lesson = await io.get(S.lesson)
    const id = conceptId ?? lesson?.conceptIds[0] ?? focus?.conceptId
    if (!id || !BY_ID.has(id)) return 'Brak zmiany do wyjaśnienia. Gdy Claude coś zmieni w kodzie, pojawi się tu lekcja.'
    const obsId = focus && focus.conceptId === id ? focus.obsId : lesson && lesson.conceptIds[0] === id ? (await io.get(S.feed)).find(o => o.file === lesson.file)?.id ?? 'none' : 'none'
    this.enqueue({ id: makeId('j', now), kind: 'manual', conceptId: id, obsId, deep, task: this.taskContext, note: null, at: now })
    this.taught.delete(id)
    await io.set(S.job, () => ({ state: 'queued' as const, message: `W kolejce: pogłębiona lekcja „${BY_ID.get(id)!.name}”.`, at: now }))
    void this.tick(io)
    return `Przygotowuję lekcję: ${BY_ID.get(id)!.name}`
  }

  /**
   * Dopytanie pod lekcją: „co jest pod spodem” albo „inny przykład”. Dopisuje krótką odpowiedź
   * pod lekcją zamiast ją podmieniać. Bez AI daje treść z biblioteki i mówi dlaczego.
   */
  // ===================== informacja zwrotna do lekcji =====================

  /** Oceny lekcji (w pamięci; trwała kopia w $.store). */
  feedback: FeedbackStore = EMPTY_FEEDBACK

  private async loadFeedback(io: Host): Promise<void> {
    this.feedback = parseFeedback(await io.storeGet('lesson-feedback').catch(() => null))
  }

  /** Głos ucznia o bieżącej lekcji: za proste, za trudne, więcej przykładów, dalej nie rozumiem. */
  async lessonFeedback(io: Host, kind: FeedbackKind): Promise<void> {
    const l = await io.get(S.lesson)
    if (!l) return
    const now = await io.now()
    this.feedback = applyFeedback(this.feedback, { lessonId: l.id, conceptId: l.conceptIds[0] ?? null, projectId: this.projectId, kind, now })
    await io.storeSet('lesson-feedback', this.feedback).catch(() => undefined)
    io.invalidate()
    // od razu coś, co pomaga: przykład albo inne wyjaśnienie; ocena trudności działa od następnej lekcji
    if (kind === 'examples') return this.lessonFollowUp(io, 'example')
    if (kind === 'confused') return this.lessonFollowUp(io, 'simpler')
    await this.flash(io, `Zapamiętane (${FEEDBACK_LABEL[kind]}). Kolejne wyjaśnienia będą ${kind === 'hard' ? 'prostsze' : 'bardziej szczegółowe'}.`)
  }

  async lessonFollowUp(io: Host, kind: 'under' | 'example' | 'simpler'): Promise<void> {
    const l = await io.get(S.lesson)
    if (!l) return
    const c = BY_ID.get(l.conceptIds[0] ?? '')
    const title = kind === 'under' ? 'Co jest pod spodem' : kind === 'simpler' ? 'Jeszcze raz, prościej' : 'Inny przykład'
    const put = (f: { status: 'loading' | 'ready'; text: string; note?: string }) =>
      io.set(S.lesson, x => (x && x.id === l.id ? { ...x, followUps: [...(x.followUps ?? []).filter(y => y.kind !== kind), { kind, title, ...f }] } : x))
    await put({ status: 'loading', text: '' })
    let why = ''
    if (this.settings.cost === 'off') why = 'lekcje AI są wyłączone w Ustawieniach'
    else if (!this.ctx) why = 'baza jeszcze startuje'
    let text: string | null = null
    if (!why) {
      const now = await io.now()
      const code = this.settings.sendCode === 'off' ? '' : redact(l.body.snippet ?? '').text.slice(0, 4000)
      const name = c?.name ?? l.title
      const system = 'Jesteś mentorem programowania dla początkującego. Piszesz po polsku, prostymi zdaniami, w Markdown, bez wstępu i bez podsumowania, bez myślników jako interpunkcji.'
      const prompt =
        kind === 'simpler'
          ? `Pojęcie: ${name}.${code ? `\nKod ucznia:\n\`\`\`\n${code}\n\`\`\`` : ''}\nUczeń nadal nie rozumie poprzedniego wyjaśnienia. Wyjaśnij jeszcze raz z innej strony: najpierw analogia z codziennego życia (2 zdania), potem krok po kroku, co robi kod ucznia. Bez żargonu, a każdy termin objaśnij. Do 8 zdań.`
          : kind === 'under'
          ? `Pojęcie: ${name}.${code ? `
Kod ucznia:
\`\`\`
${code}
\`\`\`` : ''}
Wyjaśnij, co dokładnie dzieje się pod spodem, gdy ten kod się wykonuje: kolejne kroki silnika albo środowiska, co jest w pamięci, na stosie i w kolejkach. Odnoś się do konkretnych linii kodu. 5 do 8 zdań albo krótka lista kroków.`
          : `Pojęcie: ${name}.${code ? `
Kod ucznia (NIE powtarzaj go):
\`\`\`
${code}
\`\`\`` : ''}
Pokaż inny, krótki przykład tego samego mechanizmu w innym kontekście (np. zakupy, szkoła, gra). Jeden blok kodu do 12 linii, potem 2 do 3 zdania: co pokazuje i czym różni się od kodu ucznia.`
      text = await this.callModel(io, 'manual', system, prompt, 1100, now).catch(() => null)
      if (!text) why = 'model jest niedostępny albo wyczerpał się dzienny limit'
    }
    if (text) return void (await put({ status: 'ready', text }))
    const fallback = kind === 'simpler' ? (c?.intuition ?? l.body.observed) : kind === 'under' ? (c?.mechanism ?? l.body.mechanism) : [c?.practice, c?.quiz.find(q => /```/.test(q.q))?.q].filter(Boolean).join(String.fromCharCode(10, 10))
    await put({ status: 'ready', text: fallback || 'Brak treści w bibliotece dla tego pojęcia.', note: `Z biblioteki Mentora, bez AI: ${why}.` })
  }

  async openLesson(io: Host, id: string): Promise<void> {
    if (!this.ctx) return
    try {
      const row = await one<LessonDb>(io, this.ctx, 'getLesson', { id })
      if (!row?.body) return
      const body = row.body as MentorLessonBody & { model?: string | null }
      await io.set(S.lesson, () => ({ ...toMeta(row), body, model: body.model ?? row.model ?? null }))
      await io.set(S.tab, () => 'lesson' as MentorTab)
    } catch (e) {
      await this.notice(io, `Nie mogę otworzyć lekcji: ${errText(e)}`)
    }
  }

  async markRead(io: Host): Promise<void> {
    const l = await io.get(S.lesson)
    if (!l || l.status === 'read') return
    const now = await io.now()
    await write(io, this.ctx, [
      { op: 'markLesson', args: { id: l.id, status: 'read' } },
      ...l.conceptIds.slice(0, 1).map(cid => ({ op: 'recordEvidence', args: { conceptId: cid, kind: 'lesson_read', source: 'user', projectId: this.projectId, lessonId: l.id, now } })),
    ])
    await io.set(S.lesson, x => (x ? { ...x, status: 'read' } : x))
    await io.set(S.lessons, ls => ls.map(x => (x.id === l.id ? { ...x, status: 'read' } : x)))
    await this.refreshKnowledge(io)
  }

  // ===================== ćwiczenia =====================

  private deterministicQuiz(c: ConceptDef, d: Detail | null, file: string | null, now: number): Built | null {
    const id = makeId('q', now)
    if (d?.snippet && (d.lang === 'js' || d.lang === 'ts')) {
      const b = boundaryQuestion(id, d.snippet, d.start, file, ['loops', 'conditionals', 'equality'].includes(c.id) ? c.id : 'conditionals')
      if (b && this.quizCount % 2 === 0) return b
      const p = predictOutputQuestion(id, d.snippet, d.start, file, c.id)
      if (p) return p
      if (b) return b
    }
    return c.quiz.length ? fromTemplate(id, c, this.quizCount) : null
  }

  private async presentQuiz(io: Host, built: Built, switchTab: boolean): Promise<void> {
    const now = await io.now()
    this.quizCount++
    await write(io, this.ctx, [
      {
        op: 'saveExercise',
        args: { exercise: { id: built.question.id, concept_id: built.question.conceptId, project_id: this.projectId, ts: now, kind: built.question.kind, question: { ...built.question, key: built.key } } },
      },
    ])
    const state: MentorQuizState = { question: built.question, answer: '', status: 'asking' as const, verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null, hints: [], revealed: false }
    await io.set(S.quizKey, () => built.key)
    await io.set(S.quiz, () => state)
    if (switchTab) await io.set(S.tab, () => 'practice' as MentorTab)
    else await io.set(S.unseen, n => n + 1)
  }

  async startQuiz(io: Host, mode: 'focus' | 'review' | 'misconception' | 'concept' = 'focus', conceptId?: string): Promise<string> {
    const now = await io.now()
    const knowledge = await io.get(S.knowledge)
    const lesson = await io.get(S.lesson)
    const focus = await io.get(S.focus)
    let id = conceptId
    if (!id && mode === 'review') id = knowledge.filter(k => k.due).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0))[0]?.id
    if (!id && mode === 'misconception') id = (await io.get(S.misconceptions)).filter(m => !m.resolved).sort((a, b) => b.count - a.count)[0]?.conceptId
    if (!id) id = lesson?.conceptIds[0] ?? focus?.conceptId
    if (!id) id = knowledge.filter(k => k.inProject > 0 && k.level < 3).sort((a, b) => b.inProject - a.inProject)[0]?.id ?? 'variables'
    const c = BY_ID.get(id)
    if (!c) return 'Nieznane pojęcie.'
    // fragment: z lekcji (jeśli o tym pojęciu), inaczej z bieżącego fokusu
    let d: Detail | null = null
    let file: string | null = null
    if (lesson && lesson.conceptIds.includes(c.id) && lesson.body.snippet) {
      d = { snippet: lesson.body.snippet, start: lesson.body.snippetStart, lang: lesson.body.lang, unified: '', facts: null }
      file = lesson.file
    } else if (focus) {
      d = await this.snippetFor(io, focus.obsId, focus.file, focus.line)
      file = focus.file
    }
    await io.set(S.tab, () => 'practice' as MentorTab)
    let built: Built | null = null
    const canModel = this.settings.cost !== 'off' && this.ctx && !this.breaker.open(now)
    const preferModel = canModel && this.quizCount % 2 === 1
    if (!preferModel) built = this.deterministicQuiz(c, d, file, now)
    if (!built && canModel) {
      await io.set(S.quiz, () => ({ question: { id: 'tmp', conceptId: c.id, kind: 'explain' as const, source: 'model' as const, prompt: 'Przygotowuję pytanie…', code: null, codeLang: 'text', codeStart: 1, file: null, options: null }, answer: '', status: 'grading' as const, verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null }))
      built = await this.modelQuiz(io, c, d, file, now)
    }
    if (!built) built = this.deterministicQuiz(c, d, file, now)
    if (!built) {
      await io.set(S.quiz, () => null)
      return `Brak ćwiczenia dla „${c.name}”.`
    }
    await this.presentQuiz(io, built, true)
    return `Ćwiczenie: ${c.name}`
  }

  private async modelQuiz(io: Host, c: ConceptDef, d: Detail | null, file: string | null, now: number): Promise<Built | null> {
    if (!this.ctx) return null
    const levels = Object.fromEntries((await io.get(S.knowledge)).map(k => [k.id, k.level]))
    const mis = (await io.get(S.misconceptions)).filter(m => m.conceptId === c.id && !m.resolved).map(m => m.description)
    const sendCode = this.settings.sendCode !== 'off'
    const req = quizRequest(c, sendCode && d?.snippet ? d.snippet : null, d?.start ?? 1, d?.lang ?? 'text', levels[c.id] ?? 0, mis)
    const r = await this.callModel(io, 'manual', req.system, req.prompt, 900, now)
    if (!r) return null
    return parseQuiz(makeId('q', now), c, r, d?.snippet ?? null, d?.start ?? 1, d?.lang ?? 'text', file)
  }

  /** Jedno wywołanie modelu z budżetem i bezpiecznikiem. Zwraca tekst albo null. */
  private async callModel(io: Host, kind: 'auto' | 'manual', system: string, prompt: string, maxOut: number, now: number): Promise<string | null> {
    if (!this.ctx || this.breaker.open(now)) return null
    const day = today(now)
    const est = estimateTokens(system + prompt, maxOut)
    const limits = kind === 'manual' ? { maxCalls: MANUAL_LIMIT.calls, maxTokens: MANUAL_LIMIT.tokens } : { maxCalls: COST_PROFILES[this.settings.cost].autoCallsPerDay, maxTokens: COST_PROFILES[this.settings.cost].tokensPerDay }
    const grant = await one<{ granted: boolean }>(io, this.ctx, 'reserveBudget', { day, kind, ...limits, estTokens: est }).catch(() => ({ granted: false }))
    if (!grant.granted) return null
    const r = await io.complete({ model: this.settings.model, system, prompt, maxTokens: maxOut, timeoutMs: 90000 })
    await write(io, this.ctx, [{ op: 'commitUsage', args: { day, kind, tokensIn: r.usage.input_tokens, tokensOut: r.usage.output_tokens } }])
    await this.countUsage(io, kind, r.usage.input_tokens + r.usage.output_tokens)
    if (!r.isAnswered) {
      this.breaker.fail(now)
      return null
    }
    this.breaker.ok()
    return r.text
  }

  /** Kolejna podpowiedź: najpierw naprowadzenie, potem odrzucenie części złych odpowiedzi. Bez modelu. */
  async quizHint(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status !== 'asking') return
    const c = BY_ID.get(q.question.conceptId)
    const hints = q.hints ?? []
    const first = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? ''
    let next: string | null = null
    if (hints.length === 0) next = c ? `Pomyśl o tym: ${first(c.intuition)}` : null
    if (hints.length <= 1 && !next) {
      const opts = q.question.options
      if (opts && key.answer !== null) {
        const wrong = opts.map((_, i) => i).filter(i => i !== key.answer)
        const drop = wrong.slice(0, Math.max(1, Math.floor(wrong.length / 2) + (wrong.length > 2 ? 0 : 0)))
        next = `To na pewno nie ${drop.map(i => 'ABCDE'[i]).join(' ani ')}.`
      } else if (key.rubric) next = `Dobra odpowiedź mówi o tym: ${first(key.rubric)}`
      else if (c?.pitfalls[0]) next = `Uważaj na: ${c.pitfalls[0]}`
    }
    if (!next) next = 'Więcej podpowiedzi nie ma. Możesz odsłonić odpowiedź.'
    await io.set(S.quiz, x => (x ? { ...x, hints: [...(x.hints ?? []), next!] } : x))
  }

  /** Odsłania poprawną odpowiedź z wyjaśnieniem. Nie zmienia poziomu wiedzy. */
  async quizReveal(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status !== 'asking') return
    const opts = q.question.options
    const correct = opts && key.answer !== null ? `${'ABCDE'[key.answer]}. ${opts[key.answer]}` : (key.expected ?? '')
    const feedback = [correct ? `**Poprawna odpowiedź:** ${correct}` : '', key.explain].filter(Boolean).join('\n\n')
    await io.set(S.quiz, x => (x ? { ...x, status: 'graded' as const, verdict: null, revealed: true, feedback, misconceptions: [], otherExample: '', followUp: '', levelChange: null } : x))
  }

  async answer(io: Host, pickedOrText: number | string): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status === 'graded' || q.status === 'grading') return
    const now = await io.now()
    const c = BY_ID.get(q.question.conceptId)
    let grade: Grade | null = null
    let answerText = ''
    if (typeof pickedOrText === 'number') {
      grade = gradeChoice(key, pickedOrText)
      answerText = q.question.options?.[pickedOrText] ?? String(pickedOrText)
    } else {
      answerText = pickedOrText.trim()
      if (answerText.length < 3) {
        await io.set(S.quiz, x => (x ? { ...x, feedback: 'Napisz odpowiedź własnymi słowami (co najmniej kilka słów).' } : x))
        return
      }
      await io.set(S.quiz, x => (x ? { ...x, answer: answerText, status: 'grading' as const, feedback: 'Oceniam…' } : x))
      if (c) {
        const req = gradeRequest(c, q.question, key, redact(answerText).text)
        const text = await this.callModel(io, 'manual', req.system, req.prompt, 900, now).catch(() => null)
        grade = text ? parseGrade(text) : null
      }
      if (!grade) {
        await io.set(S.quiz, x => (x ? { ...x, status: 'pending' as const, feedback: 'Nie udało się ocenić odpowiedzi (model niedostępny, limit albo zły format). Odpowiedź NIE wpłynęła na Twój postęp. Spróbuj „Oceń ponownie”.' } : x))
        return
      }
    }
    if (q.hints?.length && grade.verdict === 'correct') {
      grade = { ...grade, verdict: 'partial', feedback: `${grade.feedback}\n\nOdpowiedź z podpowiedzią liczy się jako częściowo poprawna.` }
    }
    const task = q.question.kind
    const evidence = [{ conceptId: q.question.conceptId, kind: grade.verdict, task, source: 'quiz', projectId: this.projectId, misconceptions: grade.misconceptions.map(m => ({ key: m.key, description: m.description, example: q.question.prompt.slice(0, 200) })) }]
    let levelChange: string | null = null
    const res = await write(io, this.ctx, [{ op: 'gradeExercise', args: { id: q.question.id, verdict: grade.verdict, grade: { ...grade, answer: answerText }, evidence, now } }])
    const g = res?.[0]
    if (g?.ok) {
      const v = g.value as { levelChanges?: { conceptId?: string; concept_id?: string; levelBefore?: number; levelAfter?: number; level_before?: number; level_after?: number }[] }
      const ch = v.levelChanges?.[0]
      if (ch) {
        const before = ch.levelBefore ?? ch.level_before ?? 0
        const after = ch.levelAfter ?? ch.level_after ?? 0
        levelChange = `${c?.name ?? q.question.conceptId}: ${levelName(before)} → ${levelName(after)}`
      }
    } else if (!this.ctx) {
      levelChange = 'Baza niedostępna: wynik zapisany w buforze, poziom zaktualizuje się po dosłaniu.'
    }
    const other = grade.otherExample || (grade.verdict !== 'correct' && c ? c.intuition : '')
    await io.set(S.quiz, x =>
      x
        ? {
            ...x,
            answer: answerText,
            status: 'graded' as const,
            verdict: grade!.verdict,
            feedback: grade!.feedback,
            misconceptions: grade!.misconceptions.map(m => m.description || m.key),
            otherExample: other,
            followUp: grade!.followUp,
            levelChange,
          }
        : x,
    )
    await this.refreshKnowledge(io)
  }

  async retryGrade(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    if (!q || q.status !== 'pending') return
    await io.set(S.quiz, x => (x ? { ...x, status: 'asking' as const } : x))
    await this.answer(io, q.answer)
  }

  // ===================== test poziomu =====================

  private async loadPlacement(io: Host): Promise<void> {
    const saved = (await io.storeGet('placement').catch(() => null)) as { status?: string } | null
    if (saved?.status === 'done' || saved?.status === 'skipped') await io.set(S.placement, p => ({ ...p, status: saved.status as 'done' | 'skipped' }))
  }

  async startPlacement(io: Host): Promise<void> {
    await io.set(S.placement, () => ({ status: 'running' as const, index: 0, answers: [], last: null }))
    await io.set(S.lab, l => ({ ...l, selected: null }))
    await io.set(S.tab, () => 'changes' as MentorTab)
  }

  async skipPlacement(io: Host): Promise<void> {
    await io.set(S.placement, () => ({ status: 'skipped' as const, index: 0, answers: [], last: null }))
    await io.storeSet('placement', { status: 'skipped' }).catch(() => undefined)
  }

  /** Odpowiedź na pytanie testu. Po ostatnim zapisuje wynik: dobra odpowiedź = to pojęcie i jego podstawy znane. */
  async answerPlacement(io: Host, option: number): Promise<void> {
    const p = await io.get(S.placement)
    const q = PLACEMENT[p.index]
    if (p.status !== 'running' || !q) return
    const answers = [...p.answers.slice(0, p.index), option]
    const correct = option === q.answer
    const last = p.index + 1 >= PLACEMENT.length
    await io.set(S.placement, () => ({ status: last ? ('done' as const) : ('running' as const), index: p.index + 1, answers, last: { index: p.index, correct } }))
    if (!last) return
    await io.storeSet('placement', { status: 'done', answers }).catch(() => undefined)
    const now = await io.now()
    const known = new Set<string>()
    const ops: Op[] = []
    PLACEMENT.forEach((x, i) => {
      if (answers[i] === x.answer) {
        ops.push({ op: 'recordEvidence', args: { conceptId: x.conceptId, kind: 'correct', task: 'predict', source: 'user', projectId: this.projectId, now } })
        const walk = (id: string) => {
          for (const pre of BY_ID.get(id)?.prereqs ?? []) if (!known.has(pre)) (known.add(pre), walk(pre))
        }
        walk(x.conceptId)
      }
    })
    const asked = new Set(PLACEMENT.map(x => x.conceptId))
    for (const id of known) if (!asked.has(id)) ops.push({ op: 'recordEvidence', args: { conceptId: id, kind: 'self_report_known', source: 'user', projectId: this.projectId, now } })
    PLACEMENT.forEach((x, i) => {
      if (answers[i] !== x.answer && !known.has(x.conceptId)) ops.push({ op: 'recordEvidence', args: { conceptId: x.conceptId, kind: 'self_report_unknown', source: 'user', projectId: this.projectId, now } })
    })
    await write(io, this.ctx, ops)
    await this.refreshKnowledge(io)
  }

  async selfReport(io: Host, conceptId: string, known: boolean): Promise<void> {
    const now = await io.now()
    await write(io, this.ctx, [{ op: 'recordEvidence', args: { conceptId, kind: known ? 'self_report_known' : 'self_report_unknown', source: 'user', projectId: this.projectId, now } }])
    await this.refreshKnowledge(io)
  }

  async simExperiment(io: Host, conceptIds: string[]): Promise<void> {
    if (!conceptIds.length) return
    const now = await io.now()
    await write(io, this.ctx, conceptIds.slice(0, 2).map(id => ({ op: 'recordEvidence', args: { conceptId: id, kind: 'sim_experiment', source: 'sim', projectId: this.projectId, now } })))
  }

  // ===================== ustawienia i dane =====================

  getSettings(): MentorSettings {
    return this.settings
  }

  async setSettings(io: Host, patch: Partial<MentorSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await io.set(S.settings, () => this.settings)
    await write(io, this.ctx, [{ op: 'setSettings', args: { patch } }])
    const p = COST_PROFILES[this.settings.cost]
    await io.set(S.usage, u => ({ ...u, limitCalls: p.autoCallsPerDay, limitTokens: p.tokensPerDay }))
    if (patch.paused === false) this.jobs = []
  }

  async notice(io: Host, text: string | null): Promise<void> {
    await io.set(S.view, v => ({ ...v, notice: text }))
  }

  async refreshUsage(io: Host): Promise<void> {
    if (!this.ctx) return
    const now = await io.now()
    try {
      const v = await one<{ usageToday: { kind: string; calls: number; tokens_in: number; tokens_out: number }[] }>(io, this.ctx, 'bootstrap', {
        project: { id: this.projectId, root: this.projectRoot, name: this.projectRoot.split(/[\\/]/).pop() ?? '' },
        session: { id: this.sessionId, surface: this.surface ?? 'unknown' },
        concepts: CONCEPTS.map(c => ({ id: c.id, name: c.name, area: c.area, langs: c.langs, prereqs: c.prereqs, weight: c.weight })),
        now,
        day: today(now),
      })
      await this.applyUsage(io, v.usageToday)
    } catch {
      /* ignoruj */
    }
  }

  async exportData(io: Host): Promise<void> {
    if (!this.ctx) return this.notice(io, 'Eksport niemożliwy: baza niedostępna.')
    try {
      const v = await one<{ path: string; counts: Record<string, number> }>(io, this.ctx, 'export', {})
      await this.notice(io, `Wyeksportowano do:\n${v.path}\n(${Object.entries(v.counts).map(([k, n]) => `${k}: ${n}`).join(', ')})`)
    } catch (e) {
      await this.notice(io, `Eksport nieudany: ${errText(e)}`)
    }
  }

  async importData(io: Host, path: string, mode: 'merge' | 'replace'): Promise<void> {
    if (!this.ctx) return this.notice(io, 'Import niemożliwy: baza niedostępna.')
    try {
      const v = await one<{ counts: Record<string, number>; backup?: string }>(io, this.ctx, 'import', { path: path.trim().replace(/^"|"$/g, ''), mode })
      await this.notice(io, `Zaimportowano (${mode === 'merge' ? 'scalenie' : 'zastąpienie'}). Kopia sprzed importu: ${v.backup ?? '—'}`)
      await this.refreshKnowledge(io)
    } catch (e) {
      await this.notice(io, `Import nieudany: ${errText(e)}`)
    }
  }

  async backup(io: Host): Promise<void> {
    if (!this.ctx) return this.notice(io, 'Kopia niemożliwa: baza niedostępna.')
    try {
      const v = await one<{ path: string }>(io, this.ctx, 'backup', { keep: 10 })
      await this.notice(io, `Kopia zapasowa: ${v.path}`)
    } catch (e) {
      await this.notice(io, `Kopia nieudana: ${errText(e)}`)
    }
  }

  async wipe(io: Host): Promise<void> {
    if (!this.ctx) return this.notice(io, 'Usuwanie niemożliwe: baza niedostępna.')
    try {
      const v = await one<{ backup?: string }>(io, this.ctx, 'wipe', { confirm: 'USUN-WSZYSTKO', keepBackup: true })
      await io.storeDelete('pendingOps')
      this.taught.clear()
      this.settings = DEFAULT_SETTINGS
      await io.set(S.settings, () => DEFAULT_SETTINGS)
      await io.set(S.lessons, () => [])
      await io.set(S.lesson, () => null)
      await io.set(S.quiz, () => null)
      await io.set(S.quizKey, () => null)
      await this.refreshKnowledge(io)
      await this.notice(io, `Usunięto wszystkie dane nauki. Ostatnia kopia bezpieczeństwa: ${v.backup ?? 'brak'} (możesz ją skasować ręcznie).`)
    } catch (e) {
      await this.notice(io, `Usuwanie nieudane: ${errText(e)}`)
    }
  }

  async diagnose(io: Host): Promise<void> {
    const lines: string[] = []
    const boot = await io.get(S.boot)
    lines.push(`Silnik Claude Code: ${boot.engine}, powierzchnia: ${(await io.surfaces().catch(() => [])).join(', ') || 'brak'}`)
    lines.push(`Projekt: ${boot.project?.root ?? '—'} (git: ${boot.project?.isGit ? 'tak' : 'nie'})`)
    lines.push(`Katalog danych: ${boot.dataDir || 'BRAK'}`)
    try {
      const r = await io.run([boot.node || 'node', '--version'], { timeoutMs: 10000 })
      lines.push(`Node: ${boot.node} → ${r.stdout.trim() || r.stderr.trim()}`)
    } catch (e) {
      lines.push(`Node: NIE DZIAŁA (${errText(e)})`)
    }
    if (this.ctx) {
      try {
        const d = await one<Record<string, unknown>>(io, this.ctx, 'diag')
        lines.push(`SQLite ${String(d.sqliteVersion)}, schemat v${String(d.schemaVersion)}, tryb ${String(d.journalMode)}, integralność: ${String(d.integrity)}`)
        lines.push(`Rozmiar bazy: ${Math.round(Number(d.dbBytes ?? 0) / 1024)} KB, WAL: ${Math.round(Number(d.walBytes ?? 0) / 1024)} KB`)
        const counts = d.counts as Record<string, number> | undefined
        if (counts) lines.push(`Wiersze: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`)
      } catch (e) {
        lines.push(`Baza: BŁĄD (${errText(e)})`)
      }
    } else lines.push('Baza: niepodłączona (tryb awaryjny).')
    lines.push(`Bufor zapisów: ${await pendingCount(io)} operacji`)
    const panes = await io.panes().catch(() => [])
    lines.push(`Panel: ${panes.map(p => `${p.id} (${p.isPlaced ? 'widoczny' : 'czeka na miejsce'})`).join(', ') || 'zamknięty'}`)
    lines.push(`Model lekcji: ${this.settings.model}, koszty: ${COST_PROFILES[this.settings.cost].label}, bezpiecznik: ${this.breaker.open(Date.now()) ? 'WSTRZYMANY' : 'ok'}`)
    lines.push(`Kolejka lekcji: ${this.jobs.length}, praca: ${this.working ? 'tak' : 'nie'}`)
    await this.notice(io, lines.join('\n'))
  }

  async testModel(io: Host): Promise<void> {
    const now = await io.now()
    const r = await this.callModel(io, 'manual', 'Odpowiedz jednym słowem.', 'Napisz: działa', 20, now)
    await this.notice(io, r ? `Model ${this.settings.model} odpowiada: ${r.trim().slice(0, 40)}` : `Model ${this.settings.model} niedostępny (limit, błąd API albo brak bazy do pilnowania limitów).`)
  }

  async runSql(io: Host, setup: string, query: string): Promise<string> {
    if (!this.ctx) return JSON.stringify({ ok: false, error: 'Piaskownica SQL wymaga helpera Node (baza niedostępna).' })
    try {
      return JSON.stringify(await runSql(io, this.ctx, setup, query))
    } catch (e) {
      return JSON.stringify({ ok: false, error: errText(e) })
    }
  }
}

function toMeta(l: LessonDb | MentorLesson): MentorLessonMeta {
  const ids = 'conceptIds' in l ? l.conceptIds : (l.concept_ids ?? [])
  return {
    id: l.id,
    title: l.title,
    ts: l.ts,
    conceptIds: ids,
    file: 'file' in l ? l.file : l.file_path,
    line: l.line,
    source: l.source,
    status: l.status,
  }
}

export const mentor = new Mentor()
