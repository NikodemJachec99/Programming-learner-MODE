// Kontroler Mentora: integracja z Claude Code (obserwacje), silnik nauki
// (priorytety, kolejka lekcji, quizy), persystencja (helper SQLite) i stan UI.
// Zasada: nic stąd nie trafia do głównej rozmowy. Hooki zawsze oddają
// wynik narzędzia i tury bez zmian, a błędy Mentora są łapane lokalnie.

import type { Host } from './host'
import type {
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
import { classifyCommand, detectConcepts, isConfigFile, newSymbols } from './engine/detect'
import { factsFromContent, factsFromPatch, langOf } from './engine/diff'
import type { ChangeFacts, Hunk } from './engine/diff'
import { depthMap, missingPrereqs } from './engine/graph'
import { hash, makeId } from './engine/hash'
import { builtinLesson, extractJson, lessonRequest, levelName, mergeModelLesson } from './engine/lessons'
import type { LessonInput } from './engine/lessons'
import { boundaryQuestion, fromTemplate, gradeChoice, gradeRequest, parseGrade, parseQuiz, predictOutputQuestion, quizRequest } from './engine/quiz'
import type { Built, Grade } from './engine/quiz'
import { isSensitivePath, redact, safeSnippet } from './engine/redact'
import { batch, DbError, flushPending, joinPath, one, pendingCount, runSql, write } from './store/db'
import type { DbCtx, Op } from './store/db'
import { DEFAULT_SETTINGS, S } from './ui/state'


type Detail = { snippet: string; start: number; lang: string; unified: string; facts: ChangeFacts | null }
type Job = { id: string; kind: 'auto' | 'manual'; conceptId: string; obsId: string; deep: boolean; task: string | null; note: string | null; at: number }

const BY_ID = new Map<string, ConceptDef>(CONCEPTS.map(c => [c.id, c]))
const DEPTH = depthMap(CONCEPTS)
export const conceptById = (id: string): ConceptDef | undefined => BY_ID.get(id)

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

export class Mentor {
  ctx: DbCtx | null = null
  projectId = ''
  projectRoot = ''
  sessionId = ''
  surface: string | null = null
  turn = 0
  private taskContext: string | null = null
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
    const local = (await io.localAppData()) ?? ''
    const dataDir = local ? joinPath(local, 'ClaudeCodeMentor') : ''
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
      messages.push('Brak zmiennej LOCALAPPDATA: nie wiem, gdzie trzymać bazę.')
    }
    candidates.push('C:\\Program Files\\nodejs\\node.exe', 'node')
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
      await this.applyUsage(io, v.usageToday)
      const schema = (init.value as { schemaVersion: number }).schemaVersion
      await io.set(S.boot, b => ({ ...b, status: 'ready' as const, schemaVersion: schema, messages }))
    } catch (e) {
      messages.push(`Baza niedostępna: ${errText(e)}. Mentor działa w trybie awaryjnym: zapisy trafiają do bufora i zostaną dosłane.`)
      const pending = await pendingCount(io)
      await io.set(S.boot, b => ({ ...b, status: 'degraded' as const, messages, pending }))
    }
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
  }

  /** Po wykonaniu narzędzia. Nie zmienia wyniku; błędy połyka. */
  async onTool(io: Host, tool: string, input: Record<string, unknown>, ran: { isError?: true; deny?: string; result?: unknown; text?: string }): Promise<void> {
    if (this.settings.paused) return
    const now = await io.now()
    let obs: MentorObservation | null = null
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') obs = this.observeEdit(tool, input, ran, now)
    else if (tool === 'Bash') obs = this.observeBash(input, ran, now)
    if (!obs) return
    this.turnObs.push(obs)
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
      return { ...base, failed: true, summary: ran.deny ? `Operacja odrzucona: ${ran.deny.slice(0, 160)}` : result.staged ? 'Zmiana wstrzymana do przeglądu, plik bez zmian' : `Edycja nie powiodła się: ${(ran.text ?? '').slice(0, 160)}` }
    }
    let facts: ChangeFacts | null = null
    if (tool === 'Write' && (result.type === 'create' || !result.structuredPatch?.length)) facts = factsFromContent(String(input.content ?? result.content ?? ''), this.settings.maxSnippetLines)
    else if (result.structuredPatch) facts = factsFromPatch(result.structuredPatch, this.settings.maxSnippetLines)
    else if (tool === 'NotebookEdit') facts = factsFromContent(String(input.new_source ?? ''), this.settings.maxSnippetLines)
    const kind: MentorObservation['kind'] = tool === 'Write' && result.type === 'create' ? 'create' : isConfigFile(path) ? 'config' : 'edit'
    if (isSensitivePath(path)) {
      return { ...base, kind, blocked: true, added: facts?.added ?? 0, removed: facts?.removed ?? 0, summary: 'Plik wrażliwy: treść nie jest analizowana ani zapisywana' }
    }
    if (!facts) return { ...base, kind, summary: 'Zmiana bez szczegółów diffu' }
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
    return { ...base, kind: k2, line, added: facts.added, removed: facts.removed, concepts: hits.map(x => x.id), symbols, summary }
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
      id, ts: now, turn: this.turn, kind: f.kind, tool: 'Bash', file: null, line: null, summary: f.summary, added: 0, removed: 0, lang: 'sh',
      concepts: f.concepts, symbols: f.packages, failed, blocked: false, preexisting: false,
    }
    if (failed) {
      this.failedCommands.set(key, { obsId: id, ts: now })
      this.touchedSince.clear()
      const firstErr = redact((ran.text ?? ran.deny ?? '').split(/\r?\n/).find(l => /error|fail|exception|cannot|not found|denied/i.test(l)) ?? (ran.text ?? '').split(/\r?\n/)[0] ?? '').text.slice(0, 180)
      return { ...base, kind: 'error', summary: `Błąd: ${f.summary}${firstErr ? ` → ${firstErr}` : ''}`, concepts: [...new Set([...f.concepts, 'debugging'])] }
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
    const obs = (await this.findObs(io, job.obsId)) ?? {
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
      settings: this.settings,
      deep: job.deep,
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
      cacheKey = hash(`${c.id}|${d.snippet}|${this.settings.detail}|${job.deep}|${levels[c.id] ?? 0}|${this.settings.model}|${sendCode}`)
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
    await io.set(S.unseen, n => n + 1)
    await io.set(S.job, () => ({ state: 'idle' as const, message: `Gotowe: ${lesson.title} (${source === 'model' ? `AI: ${modelName}` : 'wbudowana'})`, at: now }))
    if (!this.settings.focusMode && job.kind === 'auto') io.toast(`Mentor: nowa lekcja „${c.name}”`)
    if (job.kind === 'manual') await io.set(S.tab, () => 'lesson' as MentorTab)
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
    const state: MentorQuizState = { question: built.question, answer: '', status: 'asking' as const, verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null }
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
