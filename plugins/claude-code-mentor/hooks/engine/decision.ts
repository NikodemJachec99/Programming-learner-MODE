// Decyzja „poproś Claude o inne podejście” pokazana przed wstawieniem polecenia (wzorzec Blast Radius):
// czego dotyczy, co zachować, co wiadomo o różnicach i skąd, co sprawdzić, co jest niepewne.
// Tylko fakty, które Mentor ma: wyniki z laboratorium są oznaczone jako symulacja, propozycja AI jako niesprawdzona.

import type { MentorAlternative, MentorBench } from '../../types'
import type { ChangeFull } from './change'
import { runBench } from './bench'
import { simDialect } from './change'

export type DecisionLine = { text: string; source: 'sim' | 'ai' | 'tool' | 'none' }

export type Decision = {
  change: string
  approach: string
  keep: DecisionLine[]
  differences: DecisionLine[]
  checks: string[]
  uncertain: string[]
}

/** Zbiera decyzję z danych zmiany, wybranej alternatywy i (jeśli otwarte) laboratorium tej zmiany. */
export function decisionFor(c: ChangeFull, alt: MentorAlternative, bench: MentorBench | null | undefined): Decision {
  const where = `${c.file}${c.line ? `:${c.line}` : ''}${c.turnLabel ? ` · „${c.turnLabel}”` : ''}`
  const dialect = simDialect(c.lang)
  const keep: DecisionLine[] = []
  const differences: DecisionLine[] = []
  const uncertain: string[] = []
  const b = bench && bench.forId === c.id ? bench : null
  const afterV = b?.variants.find(v => v.origin === 'after')
  const altV = b?.variants.find(v => v.origin === 'alt' && v.code === alt.code)
  if (b && afterV && dialect && b.cases.length) {
    const vs = altV ? [afterV, altV] : [afterV]
    const r = runBench(vs, b.cases, dialect)
    b.cases.forEach((cs, i) => {
      const now = r.cells[i]![0]!
      keep.push({ text: `\`${cs}\` daje teraz ${now.text}`, source: now.kind === 'ok' ? 'sim' : 'none' })
      if (altV) {
        const alt2 = r.cells[i]![1]!
        differences.push(
          now.text === alt2.text
            ? { text: `\`${cs}\`: ten sam wynik w obu (${now.text})`, source: 'sim' }
            : { text: `\`${cs}\`: obecnie ${now.text}, alternatywa ${alt2.text}`, source: 'sim' },
        )
      }
    })
    if (!altV) uncertain.push('Kodu alternatywy nie uruchomiono. Dodaj ją do laboratorium, żeby porównać wyniki przed decyzją.')
  } else {
    keep.push({ text: 'obecne działanie: nazwa, parametry i wynik funkcji widziane przez kod, który ją woła', source: 'none' })
    uncertain.push('Działania nie porównano na żadnym przypadku. Otwórz laboratorium („Uruchom i porównaj”), jeśli kod da się wykonać.')
  }
  for (const p of alt.pros) differences.push({ text: `+ ${p}`, source: 'ai' })
  for (const p of alt.cons) differences.push({ text: `− ${p}`, source: 'ai' })
  uncertain.push('Zalety i wady to propozycja AI, nikt ich nie zmierzył.')
  if (dialect) uncertain.push('Symulator to model języka, nie Twoje środowisko: biblioteki, sieć i baza mogą zachować się inaczej.')
  uncertain.push('Wpływu na inne pliki Mentor nie zna. Claude powinien to sprawdzić przed zmianą.')
  const checks = [
    'uruchomić istniejące testy tej części projektu',
    ...(b?.cases.length ? [`sprawdzić przypadki z laboratorium: ${b.cases.map(x => `\`${x}\``).join(', ')}`] : []),
    'jeśli tej funkcji nic nie testuje: dopisać test na przypadek, który obie wersje muszą obsłużyć tak samo',
  ]
  return { change: where, approach: `${alt.title}: ${alt.idea}`, keep, differences, checks, uncertain }
}

const SRC: Record<DecisionLine['source'], string> = { sim: 'symulator', ai: 'propozycja AI', tool: 'narzędzie', none: 'niesprawdzone' }

/** Ta sama decyzja jako tekst polecenia dla Claude. */
export function decisionPrompt(d: Decision, lang: string, code: string): string {
  const fence = '```'
  const lines = (xs: DecisionLine[]) => xs.map(x => `- ${x.text} (${SRC[x.source]})`).join('\n')
  return [
    `Przepisz zmianę w ${d.change} na inne podejście: ${d.approach}`,
    `Docelowy kod (propozycja, dopasuj do reszty pliku, ale nie zmieniaj podejścia):\n${fence}${lang}\n${code}\n${fence}`,
    `Zachowaj:\n${lines(d.keep)}`,
    d.differences.length ? `Znane różnice:\n${lines(d.differences)}` : '',
    'Ograniczenia: zachowaj nazwę, parametry i zwracaną wartość funkcji oraz to, co widzą jej wywołujący. Nie ruszaj innych plików, chyba że bez tego kod się nie skompiluje.',
    `Sprawdzenie:\n${d.checks.map(x => `- ${x}`).join('\n')}`,
    `Niepewne, sprawdź zanim zmienisz:\n${d.uncertain.map(x => `- ${x}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export { SRC as DECISION_SOURCE }
