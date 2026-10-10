// Stan UI sesji, trzymany w pamięci modułu (jeden proces Claude Code = jedna sesja).
// Każda zmiana prosi silnik o przerysowanie ($.ui.invalidate). Trwała kopia
// danych nauki jest w bazie SQLite, więc utrata tego stanu przy przeładowaniu
// moda niczego nie kasuje.

import type {
  MentorBoot,
  MentorFocus,
  MentorJob,
  MentorKnowledgeRow,
  MentorLab,
  MentorLesson,
  MentorLessonMeta,
  MentorMisconception,
  MentorObservation,
  MentorPlacement,
  MentorQuizKey,
  MentorQuizState,
  MentorRecap,
  MentorSettings,
  MentorSimState,
  MentorTab,
  MentorUsage,
  MentorView,
} from '../../types'
import type { ChangeMeta } from '../engine/change'
import type { BarSnapshot } from './bar'
import type { Activity } from '../engine/activity'
import type { AgentRun } from '../engine/agents'
import type { BgTask } from '../engine/tasks'
import type { FilesState } from '../engine/files'
import { EMPTY_FILES } from '../engine/files'

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
  modelId: '',
  effort: 'default',
  sendCode: 'redacted',
  maxSnippetLines: 80,
  saveChanges: true,
  contextBar: true,
  cacheTtl: 60,
  language: 'pl',
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
  pair: null,
}

export const DEFAULT_LAB: MentorLab = { selected: null, view: 'diff', loading: false, error: null, showAll: false, alt: { status: 'idle', forId: null, items: [], message: '' }, confirm: null, handed: null, guess: null, bench: null }

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
  changes: ChangeMeta[]
  lab: MentorLab
  bar: { snap: BarSnapshot | null; lastRequestAt: number; history: number[] }
  placement: MentorPlacement
  activity: Activity
  flash: { text: string; tone: 'ok' | 'error'; until: number } | null
  agents: AgentRun[]
  tasks: BgTask[]
  files: FilesState
  /** Podsumowanie ostatnich dni i kiedy ostatnio je zamknięto. */
  recap: { data: MentorRecap | null; seenAt: number }
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
  changes: 'changes',
  lab: 'lab',
  bar: 'bar',
  placement: 'placement',
  activity: 'activity',
  flash: 'flash',
  agents: 'agents',
  tasks: 'tasks',
  files: 'files',
  recap: 'recap',
} as const satisfies Record<StateKey, StateKey>

const initial = (): StateShape => ({
  tab: 'changes',
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
  changes: [],
  lab: DEFAULT_LAB,
  bar: { snap: null, lastRequestAt: 0, history: [] },
  placement: { status: 'none', index: 0, answers: [], last: null },
  activity: { turn: 0, files: [] },
  flash: null,
  agents: [],
  tasks: [],
  files: EMPTY_FILES,
  recap: { data: null, seenAt: 0 },
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

