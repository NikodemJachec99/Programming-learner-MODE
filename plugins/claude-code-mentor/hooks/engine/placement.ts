// Test poziomu na start: 6 krótkich pytań „co wypisze ten kod”, od podstaw do pętli
// zdarzeń. Wynik ustawia punkt startowy: Ścieżka nie poleca tego, co już umiesz.

export type PlacementQuestion = { conceptId: string; code: string; options: string[]; answer: number; explain: string }

export const PLACEMENT: PlacementQuestion[] = [
  {
    conceptId: 'variables',
    code: 'let a = 5\na = a + 2\nconsole.log(a)',
    options: ['5', '7', '52'],
    answer: 1,
    explain: 'Druga linia nadpisuje `a` nową wartością: 5 + 2.',
  },
  {
    conceptId: 'equality',
    code: 'console.log(3 == "3", 3 === "3")',
    options: ['true true', 'false false', 'true false'],
    answer: 2,
    explain: '`==` przed porównaniem zamienia tekst na liczbę, `===` porównuje też typ.',
  },
  {
    conceptId: 'functions',
    code: 'function dbl(x) {\n  return x * 2\n}\nconsole.log(dbl(dbl(2)))',
    options: ['4', '8', '16'],
    answer: 1,
    explain: 'Najpierw wewnętrzne `dbl(2)` daje 4, potem `dbl(4)` daje 8.',
  },
  {
    conceptId: 'arrays',
    code: 'const r = [1, 2, 3].map(x => x * 2).filter(x => x > 2)\nconsole.log(r)',
    options: ['[2, 4, 6]', '[4, 6]', '[3]'],
    answer: 1,
    explain: '`map` daje [2, 4, 6], a `filter` zostawia większe od 2.',
  },
  {
    conceptId: 'closures',
    code: 'function counter() {\n  let n = 0\n  return () => ++n\n}\nconst c = counter()\nc()\nconsole.log(c())',
    options: ['1', '2', '0'],
    answer: 1,
    explain: 'Funkcja zwrócona z `counter` pamięta swoje `n` między wywołaniami (domknięcie).',
  },
  {
    conceptId: 'event-loop',
    code: "console.log('A')\nsetTimeout(() => console.log('B'), 0)\nPromise.resolve().then(() => console.log('C'))\nconsole.log('D')",
    options: ['A B C D', 'A D C B', 'A D B C'],
    answer: 1,
    explain: 'Najpierw cały kod synchroniczny (A, D), potem mikrozadania (`then`: C), na końcu timery (B).',
  },
]

export const placementScore = (answers: readonly (number | null)[]): number => answers.filter((a, i) => a === PLACEMENT[i]?.answer).length

/** Krótki opis wyniku do karty po teście. */
export function placementSummary(answers: readonly (number | null)[], name: (id: string) => string): { score: number; known: string[]; learn: string[] } {
  const known: string[] = []
  const learn: string[] = []
  PLACEMENT.forEach((q, i) => (answers[i] === q.answer ? known : learn).push(name(q.conceptId)))
  return { score: placementScore(answers), known, learn }
}
