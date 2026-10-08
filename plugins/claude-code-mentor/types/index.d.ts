// Typy danych Claude Code Mentor (stan UI sesji i rekordy z bazy).
// Trwała kopia: baza SQLite w %LOCALAPPDATA%\ClaudeCodeMentor.

/** Test poziomu na start. `none` = jeszcze nie zrobiony i nie pominięty. */
export interface MentorPlacement {
  status: 'none' | 'running' | 'done' | 'skipped'
  index: number
  answers: (number | null)[]
  /** Ostatnio kliknięta odpowiedź i czy była dobra, do krótkiej informacji pod pytaniem. */
  last: { index: number; correct: boolean } | null
}

export type MentorTab = 'changes' | 'now' | 'lesson' | 'sim' | 'practice' | 'knowledge' | 'path' | 'settings'

export type MentorLevelPref = 'beginner' | 'intermediate' | 'advanced' | 'adaptive'
export type MentorDetail = 'short' | 'normal' | 'deep'
export type MentorFrequency = 'rare' | 'normal' | 'often'
export type MentorCost = 'off' | 'saver' | 'balanced' | 'generous'
export type MentorModel = 'haiku' | 'sonnet' | 'opus'
export type MentorSendCode = 'off' | 'redacted'

export type MentorSettings = {
  autoTeach: boolean
  autoOpen: boolean
  band: boolean
  paused: boolean
  level: MentorLevelPref
  detail: MentorDetail
  frequency: MentorFrequency
  focusMode: boolean
  autoQuiz: boolean
  cost: MentorCost
  model: MentorModel
  sendCode: MentorSendCode
  maxSnippetLines: number
  /** Change Lab: zapisuj kod przed i po zmianie (lokalnie, z limitem). */
  saveChanges: boolean
  /** Pasek kontekstu nad promptem (kategorie okna, procent, licznik cache). */
  contextBar: boolean
  /** Czas życia cache promptu w minutach: 5 albo 60. */
  cacheTtl: number
}

export type MentorBoot = {
  /** Wersja zainstalowana w Claude Code (installed_plugins.json); null, gdy nieznana. */
  installedVersion?: string | null
  status: 'starting' | 'ready' | 'degraded'
  messages: string[]
  dataDir: string
  node: string
  sessionId: string
  project: { id: string; name: string; root: string; isGit: boolean } | null
  engine: string
  schemaVersion: number
  pending: number
}

export type MentorObservation = {
  id: string
  ts: number
  turn: number
  kind: 'create' | 'edit' | 'bash' | 'dependency' | 'config' | 'test' | 'build' | 'error' | 'fix' | 'git'
  tool: string
  file: string | null
  line: number | null
  summary: string
  added: number
  removed: number
  lang: string
  concepts: string[]
  symbols: string[]
  failed: boolean
  blocked: boolean
  preexisting: boolean
}

export type MentorFocus = {
  conceptId: string
  title: string
  reason: string
  file: string | null
  line: number | null
  obsId: string
  missingPrereqs: string[]
}

export type MentorLessonMeta = {
  id: string
  title: string
  ts: number
  conceptIds: string[]
  file: string | null
  line: number | null
  source: 'model' | 'builtin'
  status: string
}

export type MentorLessonBody = {
  title: string
  conceptIds: string[]
  file: string | null
  line: number | null
  lang: string
  snippet: string
  snippetStart: number
  observed: string
  where: string
  problem: string
  purpose: { likely: string; confirmed: string | null }
  syntax: string
  mechanism: string
  dependencies: string
  why: string
  alternatives: string
  pitfalls: string
  verify: string
  layers: { intuition: string; code: string; mechanism: string; why: string; practice: string; check: string }
  uncertainty: string[]
  simplifications: string[]
  missingPrereqs: string[]
  taskContext: string | null
}

export type MentorLessonFollowUp = { kind: 'under' | 'example'; title: string; status: 'loading' | 'ready'; text: string; note?: string }

export type MentorLesson = MentorLessonMeta & { body: MentorLessonBody; model: string | null; followUps?: MentorLessonFollowUp[] }

export type MentorJob = { state: 'idle' | 'queued' | 'working' | 'error'; message: string; at: number }

export type MentorKnowledgeRow = {
  id: string
  name: string
  area: string
  level: number
  mastery: number
  confidence: number
  exposures: number
  correct: number
  incorrect: number
  due: boolean
  nextReviewAt: number | null
  lastVerifiedAt: number | null
  inProject: number
}

export type MentorMisconception = {
  conceptId: string
  key: string
  description: string
  count: number
  resolved: boolean
  lastSeen: number
}

export type MentorQuizQuestion = {
  id: string
  conceptId: string
  kind: 'choice' | 'predict' | 'diagnose' | 'explain' | 'apply'
  source: 'builtin' | 'sim' | 'model'
  prompt: string
  code: string | null
  codeLang: string
  codeStart: number
  file: string | null
  options: string[] | null
}

/** Klucz odpowiedzi: nigdy nie jest rysowany przed udzieleniem odpowiedzi. */
export type MentorQuizKey = {
  id: string
  conceptId: string
  kind: MentorQuizQuestion['kind']
  answer: number | null
  explain: string
  misconceptionByOption: Record<string, { key: string; description: string }>
  rubric: string | null
  expected: string | null
}

export type MentorQuizState = {
  question: MentorQuizQuestion
  answer: string
  status: 'asking' | 'grading' | 'graded' | 'pending' | 'error'
  verdict: 'correct' | 'partial' | 'incorrect' | null
  feedback: string
  misconceptions: string[]
  otherExample: string
  followUp: string
  levelChange: string | null
  /** Podpowiedzi pokazane do tej pory (stopniowo). */
  hints?: string[]
  /** Odpowiedź odsłonięta bez odpowiadania: bez wpływu na poziom. */
  revealed?: boolean
}

export type MentorSimState = {
  source: string
  origin: string
  mode: 'js' | 'sql' | 'cond'
  /** Język kodu w trybie 'js': JavaScript/TypeScript albo Dart. */
  dialect?: 'js' | 'dart'
  edits: { siteId: string; start: number; end: number; text: string; before: string; line: number }[]
  variant: 'A' | 'B'
  cursor: number
  panel: 'state' | 'explain' | 'why' | 'compare' | 'whatif'
  sqlSetup: string
  sqlQuery: string
  sqlResult: string | null
  condLang: 'js' | 'py' | 'php' | 'dart'
  condOp: string
  condLeft: string
  condRight: string
  callArgs: string
  /** Change Lab: prawdziwa para przed (A) i po (B) zamiast ręcznych podmian. */
  pair?: MentorSimPair | null
}

export type MentorSimPair = {
  a: string
  b: string
  aStart: number
  bStart: number
  aLabel: string
  bLabel: string
  /** Podpowiedź wywołania, np. isAdult(…). */
  hint?: string
}

export type MentorAlternative = {
  title: string
  idea: string
  code: string
  pros: string[]
  cons: string[]
  when: string
}

/** Jedna wersja kodu w laboratorium zmiany. */
export type MentorBenchVariant = {
  /** A, B, C, D */
  id: string
  label: string
  code: string
  /** Skąd: kod przed i po z narzędzia, alternatywa od modelu albo własna kopia do edycji. */
  origin: 'before' | 'after' | 'alt' | 'edit'
}

/** Laboratorium w szczegółach zmiany: wersje, jawne przypadki i wybrana linia do edycji. */
export type MentorBench = {
  forId: string
  variants: MentorBenchVariant[]
  cases: string[]
  /** Wybrana wersja (do edycji i do „Krok po kroku”). */
  sel: string
  /** Linia wybranej wersji do edycji (od 1). */
  line: number
  error: string | null
  handed: string | null
}

export type MentorLab = {
  /** Wybrana zmiana albo null (lista). */
  selected: string | null
  view: 'diff' | 'before' | 'after'
  loading: boolean
  error: string | null
  showAll: boolean
  alt: { status: 'idle' | 'loading' | 'ready' | 'error'; forId: string | null; items: MentorAlternative[]; message: string }
  /** Indeks alternatywy czekającej na potwierdzenie przekazania do Claude. */
  confirm: number | null
  handed: string | null
  /** Tryb „Zgadnij zmianę”: kod przed, podpowiedzi, odsłonięcie zmiany. */
  guess: { id: string; hints: string[]; revealed: boolean } | null
  /** Zmiana, dla której pokazujemy wyjaśnienie na miejscu, i od kiedy. */
  lessonFor?: string | null
  lessonId?: string | null
  lessonAt?: number
  /** Laboratorium otwarte w szczegółach zmiany. */
  bench?: MentorBench | null
}

export type MentorUsage = {
  autoCalls: number
  manualCalls: number
  tokens: number
  limitCalls: number
  limitTokens: number
  breakerUntil: number
}

export type MentorView = {
  knowledgeFilter: number
  conceptDetail: string | null
  confirm: string | null
  pathMode: 'graph' | 'list'
  lessonMode: 'points' | 'layers'
  /** Rozwinięte sekcje lekcji (klucze sekcji). */
  openSections: string[]
  /** Czy lista ostatnich zmian jest rozwinięta. */
  feedExpanded: boolean
  notice: string | null
  importPath: string
}
