// EXPLAIN i WHY dla kroku symulacji: deterministyczne wyjaśnienia
// mechanizmu, bez modelu. Model może je pogłębić na żądanie.

import type { SimResult, Step } from './interp'

export function explainStep(step: Step, r: SimResult): string[] {
  const out: string[] = []
  const line = r.lines[step.line - 1]?.trim() ?? ''
  if (line) out.push(`Linia ${step.line}: \`${line}\``)
  switch (step.kind) {
    case 'cond':
      if (step.loop) {
        out.push(`To sprawdzenie należy do pętli z linii ${step.loop.line}. Pętla powtarza ciało tak długo, jak warunek jest prawdziwy (truthy). Licznik iteracji: ${step.loop.iteration}.`)
      } else {
        out.push('Instrukcja warunkowa oblicza wyrażenie w nawiasie do jednej wartości, a potem sprawdza jej prawdziwość. true → blok if, false → blok else (albo nic).')
      }
      if (step.cond?.detail.length) out.push(`Jak powstał wynik: ${step.cond.detail.join('; ')}.`)
      out.push('W JS falsy są tylko: false, 0, -0, 0n, "", null, undefined, NaN. Wszystko inne (także "0", [] i {}) jest truthy.')
      break
    case 'call':
      out.push('Wywołanie funkcji tworzy nową ramkę na stosie wywołań (call stack). W ramce żyją parametry i zmienne lokalne. Argumenty są kopiowane do parametrów: prymitywy (liczby, napisy) jako wartości, obiekty i tablice jako referencje do tego samego obiektu.')
      out.push(`Stos teraz: ${step.stack.join(' → ')}. Funkcja na górze stosu wykonuje się, reszta czeka na jej wynik.`)
      break
    case 'return':
      out.push('return kończy funkcję natychmiast i oddaje wartość do miejsca wywołania. Ramka znika ze stosu, a jej zmienne lokalne przestają być osiągalne (chyba że złapało je domknięcie).')
      break
    case 'await':
      out.push('await nie blokuje wątku. Funkcja async zostaje zawieszona, jej dalsza część czeka jako kontynuacja, a sterowanie wraca do kodu, który ją wywołał. Gdy obietnica się rozstrzygnie, kontynuacja trafia do kolejki mikrozadań.')
      out.push('Gwarantowane: kod po await wykona się dopiero po zakończeniu bieżącego kodu synchronicznego. Niedeterministyczne w prawdziwym programie: KIEDY rozstrzygnie się obietnica zależna od sieci, dysku czy timera.')
      break
    case 'task':
      out.push('Pętla zdarzeń (event loop) działa tylko wtedy, gdy stos wywołań jest pusty. Najpierw opróżnia CAŁĄ kolejkę mikrozadań (reakcje Promise, kontynuacje await, queueMicrotask), dopiero potem bierze JEDNO makrozadanie (setTimeout, I/O) i znów opróżnia mikrozadania.')
      out.push(`Kolejki teraz: mikro [${step.queues.micro.join(', ') || 'pusta'}], makro [${step.queues.macro.join(', ') || 'pusta'}].`)
      break
    case 'throw':
      out.push('throw przerywa normalny przepływ. Silnik szuka najbliższego try/catch w bieżącej funkcji, a jeśli go nie ma, zdejmuje ramkę ze stosu i szuka u wywołującego. Tak aż do znalezienia catch albo końca stosu (wtedy program kończy się błędem).')
      break
    case 'catch':
      out.push('catch przechwycił wyjątek: program działa dalej od bloku catch. Kod między miejscem rzucenia a catch, który się nie wykonał, został pominięty.')
      break
    case 'unwind':
      out.push('Propagacja wyjątku: ta funkcja nie miała catch, więc jej ramka znika ze stosu, a wyjątek trafia do funkcji, która ją wywołała. W funkcji async zamiast tego Promise zostaje odrzucona.')
      break
    case 'loop-end':
      out.push('Koniec pętli: warunek przestał być spełniony albo wykonano break. Program przechodzi do pierwszej instrukcji za pętlą.')
      break
    case 'end':
      out.push('Program skończył się: nie ma już kodu synchronicznego ani zadań w kolejkach.')
      break
    default:
      if (step.changed.length) out.push(`Ta instrukcja zmieniła stan: ${step.changed.map(k => `${k} = ${step.vars[k]}`).join(', ')}. Przypisanie (=) najpierw oblicza prawą stronę, potem zapisuje wynik pod nazwą po lewej.`)
      else out.push('Instrukcja wykonała się bez zmiany widocznych zmiennych (np. wypisanie albo wywołanie bez przypisania wyniku).')
  }
  if (step.hypothetical) out.push('Uwaga: ten krok opiera się na założeniu symulatora (np. odpowiedź sieci), a nie na zweryfikowanym wykonaniu.')
  return out
}

export function whyStep(step: Step, r: SimResult): string {
  const prev = r.steps[step.i - 1]
  const base = `Dlaczego ten krok: ${step.why}.`
  if (step.kind === 'task') return base
  if (prev && prev.kind === 'cond' && prev.cond) return `${base} Bezpośrednio wcześniej warunek ${prev.cond.expr} dał ${prev.cond.result}.`
  return base
}
