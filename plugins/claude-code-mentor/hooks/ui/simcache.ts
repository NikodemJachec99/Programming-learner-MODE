// Pamięć podręczna wyników symulacji (render może się powtarzać często).
// Symulacja jest deterministyczna, więc wynik zależy tylko od tekstu.

import { simulate } from '../sim/interp'
import type { SimResult } from '../sim/interp'

const cache = new Map<string, SimResult>()

export function simulateCached(source: string): SimResult {
  const hit = cache.get(source)
  if (hit) return hit
  const r = simulate(source, { maxSteps: 2000 })
  cache.set(source, r)
  if (cache.size > 24) cache.delete(cache.keys().next().value as string)
  return r
}

export const BOUNDARY_NOTE = 'Równość obu stron to przypadek brzegowy: < i > dają wtedy false, <= i >= dają true. Przy == / === liczy się też typ wartości (w zależności od języka).'
