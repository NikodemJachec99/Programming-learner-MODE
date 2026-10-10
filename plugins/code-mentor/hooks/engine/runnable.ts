// Czy prawdziwy kod da się uczciwie uruchomić w symulatorze: bez błędu składni,
// bez dopisków do wycinka i bez założeń (zaślepki, sieć, losowość, zegar).
// Gdy nie, panel nie pokazuje uruchomienia, tylko przykład do nauki.

import type { SimResult } from '../sim/interp'
import { autoCall, pairCall } from '../sim/autocall'
import { simulateCached } from '../ui/simcache'

const healed = (r: SimResult) => r.hypotheses.some(h => h.startsWith('Kod to wycinek'))

/** Wynik bez założeń albo null. `allowThrow`: wyjątek w czasie działania też jest wynikiem. */
export function cleanRun(src: string, dialect: 'js' | 'dart', allowThrow = false): SimResult | null {
  const r = simulateCached(src, dialect)
  if (r.assumed || healed(r)) return null
  if (r.ok) return r
  return allowThrow && r.error?.kind === 'runtime' ? r : null
}

/** Pojedynczy kod: wykonuje się sam albo z dobranym wywołaniem i coś wypisuje. */
export function runnable(code: string, dialect: 'js' | 'dart'): boolean {
  const ac = autoCall(code, dialect)
  const r = cleanRun(ac ? `${code}\n${ac.call}` : code, dialect)
  return !!r && r.output.length > 0
}

/**
 * Para przed/po: wspólne wywołanie istnieje w obu, „po” działa czysto i coś wypisuje,
 * „przed” może skończyć się wyjątkiem (zmiana często naprawia właśnie błąd).
 */
export function pairRunnable(before: string, after: string, dialect: 'js' | 'dart'): boolean {
  const pc = pairCall(before, after, dialect)
  if (pc.problem) return false
  const call = pc.call ? `\n${pc.call}` : ''
  const b = cleanRun(after + call, dialect)
  if (!b || !b.output.length) return false
  return !!cleanRun(before + call, dialect, true)
}
