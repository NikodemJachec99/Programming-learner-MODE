// Ćwiczenie z prawdziwej zmiany: ten sam przykład puszczamy przez kod przed i po,
// a pytanie dotyczy wyniku wersji po zmianie. Odpowiedź liczy symulator, nie model.

import type { Built } from './quiz'
import type { ChangeFull } from './change'
import { simDialect } from './change'
import { autoCall } from '../sim/autocall'
import { simulateCached } from '../ui/simcache'

const SAME = 'Taki sam jak przed zmianą'
const THROWS = '(program rzuci wyjątek)'

function outputOf(src: string, dialect: 'js' | 'dart'): string | null {
  const r = simulateCached(src, dialect)
  if (!r.ok) return r.error ? THROWS : null
  const out = r.output.join(' | ')
  return out && out.length <= 160 ? out : null
}

/** Pytanie „co wypisze wersja po zmianie” albo null, gdy symulator nie da rady albo kod nic nie wypisuje. */
export function changeQuestion(qid: string, c: ChangeFull, conceptId: string): Built | null {
  const dialect = simDialect(c.lang)
  if (!dialect || !c.after || !c.before) return null
  const ac = autoCall(c.after, dialect)
  const call = ac ? `\n${ac.call}` : ''
  const before = outputOf(c.before + call, dialect)
  const after = outputOf(c.after + call, dialect)
  if (!after || !before || after === THROWS) return null
  const same = before === after
  const correct = same ? `${SAME}: ${after}` : after
  const options = same ? [correct, 'Inny niż przed zmianą', THROWS] : [correct, `${SAME}: ${before}`, THROWS]
  // deterministyczne przetasowanie, żeby poprawna nie stała zawsze pierwsza
  const shuffled = options.map((o, i) => ({ o, k: (o.length * 31 + i * 17) % 7 })).sort((a, b) => a.k - b.k).map(x => x.o)
  const run = ac ? `Uruchamiamy \`${ac.label}\`.` : 'Uruchamiamy ten kod.'
  return {
    question: {
      id: qid,
      conceptId,
      kind: 'predict',
      source: 'sim',
      prompt: `${run} Przed zmianą wynik był: ${before}. Co wypisze wersja po zmianie (pokazana niżej)?`,
      code: c.after,
      codeLang: c.lang,
      codeStart: c.afterStart,
      file: c.file,
      options: shuffled,
    },
    key: {
      id: qid,
      conceptId,
      kind: 'predict',
      answer: shuffled.indexOf(correct),
      explain: same
        ? `Symulator puścił te same dane przez obie wersje i obie wypisały: ${after}. Zmiana nie zmienia wyniku dla tego przykładu, zmienia sposób, w jaki kod do niego dochodzi.`
        : `Symulator puścił te same dane przez obie wersje. Przed: ${before}. Po: ${after}. W Zmianach kliknij „Uruchom przed i po”, żeby zobaczyć krok, w którym drogi się rozchodzą.`,
      misconceptionByOption: {},
      rubric: null,
      expected: null,
    },
  }
}
