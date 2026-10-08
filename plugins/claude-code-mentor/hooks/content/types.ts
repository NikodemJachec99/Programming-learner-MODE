// Kontrakt biblioteki pojęć. Treść jest statyczna i działa bez modelu:
// to z niej powstają lekcje offline, quizy deterministyczne i graf.

export type Area =
  | 'fundamentals'
  | 'data-structures'
  | 'functions'
  | 'errors'
  | 'oop'
  | 'modules'
  | 'async'
  | 'network'
  | 'sql'
  | 'algorithms'
  | 'testing'
  | 'git'
  | 'frontend'
  | 'backend'
  | 'architecture'
  | 'security'
  | 'devops'
  | 'ai'
  | 'mobile'

export type Lang = 'js' | 'ts' | 'py' | 'php' | 'sql' | 'sh' | 'dart' | 'any'

export type ConceptMisconception = {
  /** Stały klucz, np. 'assign-vs-compare'. Unikalny w obrębie pojęcia. */
  key: string
  /** Na czym polega błędne przekonanie, jednym zdaniem. */
  text: string
  /** Jak to poprawnie rozumieć, 1-3 zdania. */
  fix: string
}

export type QuizTemplate = {
  /** Pytanie. Kod w backtickach albo w bloku ```. */
  q: string
  /** Rodzaj: przewidywanie wyniku, diagnoza błędu, wybór koncepcji. */
  kind: 'predict' | 'diagnose' | 'choice'
  /** 3-4 odpowiedzi. */
  options: string[]
  /** Indeks poprawnej odpowiedzi. */
  answer: number
  /** Wyjaśnienie poprawnej odpowiedzi, 1-4 zdania. */
  explain: string
  /** Indeks złej odpowiedzi -> klucz misconception z tego pojęcia. */
  misconceptionByOption?: Record<number, string>
}

export type ConceptDef = {
  /** kebab-case, stały identyfikator. */
  id: string
  /** Nazwa po polsku z angielskim terminem, np. 'Pętle (loops)'. */
  name: string
  /** Angielski termin techniczny. */
  en: string
  area: Area
  langs: Lang[]
  /** Pojęcia wymagane wcześniej (id). Graf musi być acykliczny. */
  prereqs: string[]
  /** 1 = poboczne, 2 = ważne, 3 = fundament. */
  weight: 1 | 2 | 3
  /** Warstwa 1: intuicja prostym językiem, 2-4 zdania. */
  intuition: string
  /** Warstwa 3: mechanizm krok po kroku. Markdown dozwolony. */
  mechanism: string
  /** Warstwa 4: dlaczego tak, alternatywy, kompromisy. */
  why: string
  /** Warstwa 5: gdzie i kiedy się przyda. */
  practice: string
  /** Typowe błędy, 2-4 pozycje. */
  pitfalls: string[]
  /** Jak zweryfikować / przetestować / zdebugować. */
  verify: string
  /** Jeśli intuicja upraszcza: co jest uproszczeniem i jaki jest dokładny model. */
  simplification?: string
  misconceptions: ConceptMisconception[]
  quiz: QuizTemplate[]
}
