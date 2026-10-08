// Typy danych Claude Code Mentor (stan UI sesji i rekordy z bazy).
// Trwała kopia: baza SQLite w %LOCALAPPDATA%\ClaudeCodeMentor.

export type MentorTab = 'now' | 'lesson' | 'sim' | 'practice' | 'knowledge' | 'path' | 'settings'

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
}

export type MentorBoot = {
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

export type MentorLesson = MentorLessonMeta & { body: MentorLessonBody; model: string | null }

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
}

export type MentorSimState = {
  source: string
  origin: string
  mode: 'js' | 'sql' | 'cond'
  edits: { siteId: string; start: number; end: number; text: string; before: string; line: number }[]
  variant: 'A' | 'B'
  cursor: number
  panel: 'state' | 'explain' | 'why' | 'compare'
  sqlSetup: string
  sqlQuery: string
  sqlResult: string | null
  condLang: 'js' | 'py' | 'php'
  condOp: string
  condLeft: string
  condRight: string
  callArgs: string
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
  notice: string | null
  importPath: string
}
