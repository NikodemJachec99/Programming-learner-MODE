// Stan UI sesji, trzymany w pamięci modułu (jeden proces Claude Code = jedna sesja).
// Każda zmiana prosi silnik o przerysowanie ($.ui.invalidate). Trwała kopia
// danych nauki jest w bazie SQLite, więc utrata tego stanu przy przeładowaniu
// moda niczego nie kasuje.

import type {
  MentorBoot,
  MentorFocus,
  MentorJob,
  MentorKnowledgeRow,
  MentorLesson,
  MentorLessonMeta,
  MentorMisconception,
  MentorObservation,
  MentorQuizKey,
  MentorQuizState,
  MentorSettings,
  MentorSimState,
  MentorTab,
  MentorUsage,
  MentorView,
} from '../../types'

export const DEFAULT_SETTINGS: MentorSettings = {
  autoTeach: true,
  autoOpen: true,
  band: true,
  paused: false,
  level: 'adaptive',
  detail: 'normal',
  frequency: 'normal',
  focusMode: false,
  autoQuiz: true,
  cost: 'balanced',
  model: 'haiku',
  sendCode: 'redacted',
  maxSnippetLines: 80,
}

export const DEFAULT_SIM: MentorSimState = {
  source: 'let x = 7\nif (x < 10) {\n  console.log("x jest mniejsze od 10")\n} else {\n  console.log("x jest co najmniej 10")\n}',
  origin: 'przykład: warunek if',
  mode: 'js',
  edits: [],
  variant: 'A',
  cursor: 0,
  panel: 'state',
  sqlSetup:
    "CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, city TEXT);\nINSERT INTO users VALUES (1,'Ala','Opole'),(2,'Ola',NULL),(3,'Jan','Brzeg');\nCREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);\nINSERT INTO orders VALUES (10,1,50),(11,1,20),(12,3,NULL);",
  sqlQuery:
    'SELECT u.name, COUNT(o.id) AS orders, SUM(o.total) AS total\nFROM users u LEFT JOIN orders o ON o.user_id = u.id\nWHERE u.city IS NOT NULL OR u.id = 2\nGROUP BY u.name\nORDER BY u.name',
  sqlResult: null,
  condLang: 'js',
  condOp: '<',
  condLeft: '7',
  condRight: '10',
  callArgs: '',
}

export const DEFAULT_BOOT: MentorBoot = { status: 'starting', messages: [], dataDir: '', node: '', sessionId: '', project: null, engine: '', schemaVersion: 0, pending: 0 }

export type StateShape = {
  tab: MentorTab
  boot: MentorBoot
  settings: MentorSettings
  feed: MentorObservation[]
  focus: MentorFocus | null
  lessons: MentorLessonMeta[]
  lesson: MentorLesson | null
  job: MentorJob
  knowledge: MentorKnowledgeRow[]
  misconceptions: MentorMisconception[]
  quiz: MentorQuizState | null
  quizKey: MentorQuizKey | null
  sim: MentorSimState
  usage: MentorUsage
  view: MentorView
  unseen: number
}
export type StateKey = keyof StateShape

export const S = {
  tab: 'tab',
  boot: 'boot',
  settings: 'settings',
  feed: 'feed',
  focus: 'focus',
  lessons: 'lessons',
  lesson: 'lesson',
  job: 'job',
  knowledge: 'knowledge',
  misconceptions: 'misconceptions',
  quiz: 'quiz',
  quizKey: 'quizKey',
  sim: 'sim',
  usage: 'usage',
  view: 'view',
  unseen: 'unseen',
} as const satisfies Record<StateKey, StateKey>

const initial = (): StateShape => ({
  tab: 'now',
  boot: DEFAULT_BOOT,
  settings: DEFAULT_SETTINGS,
  feed: [],
  focus: null,
  lessons: [],
  lesson: null,
  job: { state: 'idle', message: '', at: 0 },
  knowledge: [],
  misconceptions: [],
  quiz: null,
  quizKey: null,
  sim: DEFAULT_SIM,
  usage: { autoCalls: 0, manualCalls: 0, tokens: 0, limitCalls: 0, limitTokens: 0, breakerUntil: 0 },
  view: { knowledgeFilter: -1, conceptDetail: null, confirm: null, pathMode: 'list', lessonMode: 'points', openSections: ['observed', 'mechanism', 'why', 'l-intuition', 'l-code', 'l-mechanism'], notice: null, importPath: '', feedExpanded: false },
  unseen: 0,
})

const mem: StateShape = initial()

export function getState<K extends StateKey>(k: K): StateShape[K] {
  return mem[k]
}

export function setState<K extends StateKey>(k: K, change: (v: StateShape[K]) => StateShape[K]): StateShape[K] {
  mem[k] = change(mem[k])
  return mem[k]
}

/** Tylko dla testów: powrót do stanu początkowego. */
export function resetState(): void {
  Object.assign(mem, initial())
}

