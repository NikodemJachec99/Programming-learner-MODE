// Informacja zwrotna do lekcji (pomysł z claude-reflect, bez jego zapisu do CLAUDE.md i bez modelu):
// cztery jawne oceny, liczone na pojęcie, projekt i globalnie. Jeden głos na lekcję, zmiana głosu
// go zastępuje, więc powtórzenia nie mnożą wpisów. Wpływa tylko na sposób pisania kolejnych lekcji:
// poziom wiedzy dalej wynika wyłącznie z odpowiedzi w ćwiczeniach.

import { tr } from '../i18n'

export type FeedbackKind = 'easy' | 'hard' | 'examples' | 'confused'
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['easy', 'hard', 'examples', 'confused']
export const FEEDBACK_LABEL: Record<FeedbackKind, string> = {
  get easy() {
    return tr('za proste', 'too easy')
  },
  get hard() {
    return tr('za trudne', 'too hard')
  },
  get examples() {
    return tr('więcej przykładów', 'more examples')
  },
  get confused() {
    return tr('dalej nie rozumiem', 'still confused')
  },
}

type Count = { n: number; at: number }
export type Counts = Partial<Record<FeedbackKind, Count>>
export type FeedbackStore = {
  v: 1
  global: Counts
  projects: Record<string, Counts>
  concepts: Record<string, Counts>
  /** Ostatni głos na lekcję (do zastępowania i podświetlenia przycisku). */
  lessons: Record<string, { kind: FeedbackKind; at: number }>
}

export const EMPTY_FEEDBACK: FeedbackStore = { v: 1, global: {}, projects: {}, concepts: {}, lessons: {} }
const MAX_LESSONS = 300

const bump = (c: Counts, k: FeedbackKind, d: number, now: number): Counts => {
  const n = Math.max(0, (c[k]?.n ?? 0) + d)
  const next = { ...c }
  if (n) next[k] = { n, at: now }
  else delete next[k]
  return next
}

/** Zapisuje głos. Ten sam głos drugi raz nic nie zmienia; inny zastępuje poprzedni tej lekcji. */
export function applyFeedback(s: FeedbackStore, v: { lessonId: string; conceptId: string | null; projectId: string; kind: FeedbackKind; now: number }): FeedbackStore {
  const prev = s.lessons[v.lessonId]?.kind
  if (prev === v.kind) return s
  const move = (c: Counts) => bump(prev ? bump(c, prev, -1, v.now) : c, v.kind, 1, v.now)
  const lessons = { ...s.lessons, [v.lessonId]: { kind: v.kind, at: v.now } }
  const keep = Object.entries(lessons).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_LESSONS)
  return {
    v: 1,
    global: move(s.global),
    projects: { ...s.projects, [v.projectId]: move(s.projects[v.projectId] ?? {}) },
    concepts: v.conceptId ? { ...s.concepts, [v.conceptId]: move(s.concepts[v.conceptId] ?? {}) } : s.concepts,
    lessons: Object.fromEntries(keep),
  }
}

/** Waga: pojęcie najmocniej, projekt średnio, reszta słabo. */
function score(s: FeedbackStore, k: FeedbackKind, conceptId: string | null, projectId: string): number {
  return 3 * (conceptId ? (s.concepts[conceptId]?.[k]?.n ?? 0) : 0) + 2 * (s.projects[projectId]?.[k]?.n ?? 0) + (s.global[k]?.n ?? 0)
}

/** Wskazówki do polecenia lekcji (po polsku). Pusta lista, gdy nie ma ocen. */
export function lessonPrefs(s: FeedbackStore, conceptId: string | null, projectId: string): string[] {
  const out: string[] = []
  const net = score(s, 'hard', conceptId, projectId) - score(s, 'easy', conceptId, projectId)
  if (net >= 2) out.push('Uczeń oceniał wyjaśnienia jako za trudne: pisz prościej, krótszymi zdaniami, zacznij od analogii, objaśniaj terminy.')
  else if (net <= -2) out.push('Uczeń oceniał wyjaśnienia jako za proste: pomiń oczywistości, skup się na mechanizmie i niuansach.')
  if (score(s, 'examples', conceptId, projectId) >= 2) out.push('Uczeń prosił o więcej przykładów: daj co najmniej dwa krótkie przykłady w różnych kontekstach.')
  if (conceptId && (s.concepts[conceptId]?.confused?.n ?? 0) > 0) out.push('Poprzednie wyjaśnienie tego pojęcia nie wystarczyło: podejdź z innej strony niż zwykle, krok po kroku.')
  return out
}

/** Szczegółowość lekcji wbudowanej po ocenach (bez modelu). */
export function detailFor(s: FeedbackStore, base: 'short' | 'normal' | 'deep', conceptId: string | null, projectId: string): 'short' | 'normal' | 'deep' {
  const net = score(s, 'hard', conceptId, projectId) - score(s, 'easy', conceptId, projectId)
  if (net >= 2) return base === 'deep' ? 'normal' : 'short'
  if (net <= -2) return base === 'short' ? 'normal' : 'deep'
  return base
}

/** Odczyt ze $.store odporny na stare albo uszkodzone dane. */
export function parseFeedback(raw: unknown): FeedbackStore {
  const r = raw as Partial<FeedbackStore> | null | undefined
  if (!r || r.v !== 1 || typeof r !== 'object') return EMPTY_FEEDBACK
  return { v: 1, global: r.global ?? {}, projects: r.projects ?? {}, concepts: r.concepts ?? {}, lessons: r.lessons ?? {} }
}
