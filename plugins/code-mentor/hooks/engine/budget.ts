// Kontrola kosztów dodatkowych wywołań modelu. Limity dzienne są pilnowane
// atomowo w bazie (wspólne dla równoległych sesji), a odstępy i bezpiecznik
// błędów w pamięci sesji.

import type { MentorCost, MentorFrequency, MentorModel } from '../../types'
import { tr } from '../i18n'

export type CostProfile = { autoCallsPerDay: number; tokensPerDay: number; maxTokensPerLesson: number; label: string }

export const COST_PROFILES: Record<MentorCost, CostProfile> = {
  off: { autoCallsPerDay: 0, tokensPerDay: 0, maxTokensPerLesson: 0, get label() {
      return tr('Wyłączone: tylko lekcje wbudowane, bez wywołań modelu', 'Off: built-in lessons only, no model calls')
    } },
  saver: { autoCallsPerDay: 8, tokensPerDay: 40000, maxTokensPerLesson: 2500, get label() {
      return tr('Oszczędny: do 8 automatycznych lekcji AI dziennie', 'Saver: up to 8 automatic AI lessons a day')
    } },
  balanced: { autoCallsPerDay: 25, tokensPerDay: 150000, maxTokensPerLesson: 4000, get label() {
      return tr('Zrównoważony: do 25 lekcji AI dziennie', 'Balanced: up to 25 AI lessons a day')
    } },
  generous: { autoCallsPerDay: 60, tokensPerDay: 400000, maxTokensPerLesson: 6000, get label() {
      return tr('Hojny: do 60 lekcji AI dziennie', 'Generous: up to 60 AI lessons a day')
    } },
}

/** Ręczne prośby (przycisk, /mentor explain) mają osobny, wyższy limit. */
export const MANUAL_LIMIT = { calls: 80, tokens: 600000 }

export const MIN_GAP_MS: Record<MentorFrequency, number> = { rare: 20 * 60000, normal: 5 * 60000, often: 60000 }

export const MODEL_LABELS: Record<MentorModel, string> = {
  get haiku() {
    return tr('Haiku (najtańszy, szybki)', 'Haiku (cheapest, fast)')
  },
  get sonnet() {
    return tr('Sonnet (lepsze wyjaśnienia)', 'Sonnet (better explanations)')
  },
  get opus() {
    return tr('Opus (najdokładniejszy, najdroższy)', 'Opus (most thorough, priciest)')
  },
}

export function today(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export class Breaker {
  private failures = 0
  until = 0
  ok(): void {
    this.failures = 0
  }
  fail(now: number): void {
    this.failures++
    if (this.failures >= 3) {
      this.until = now + 15 * 60000
      this.failures = 0
    }
  }
  open(now: number): boolean {
    return now < this.until
  }
}

/** Zgrubne oszacowanie tokenów (4 znaki ≈ 1 token) do rezerwacji budżetu. */
export function estimateTokens(text: string, maxOut: number): number {
  return Math.ceil(text.length / 4) + maxOut
}
