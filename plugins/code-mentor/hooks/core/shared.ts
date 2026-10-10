// Drobne rzeczy wspólne dla Mentora i jego części (ćwiczenia, dane): katalog pojęć po id,
// tekst błędu, wycinek kodu obserwacji.

import { CONCEPTS } from '../content/concepts'
import type { ConceptDef } from '../content/types'
import type { ChangeFacts } from '../engine/diff'

export const BY_ID = new Map<string, ConceptDef>(CONCEPTS.map(c => [c.id, c]))

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Kod obserwacji do lekcji i ćwiczeń: wycinek, pierwsza linia, język, diff. */
export type Detail = { snippet: string; start: number; lang: string; unified: string; facts: ChangeFacts | null }
