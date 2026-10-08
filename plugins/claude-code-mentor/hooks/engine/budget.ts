// Kontrola kosztów dodatkowych wywołań modelu. Limity dzienne są pilnowane
// atomowo w bazie (wspólne dla równoległych sesji), a odstępy i bezpiecznik
// błędów w pamięci sesji.

import type { MentorCost, MentorFrequency, MentorModel } from '../../types'

export type CostProfile = { autoCallsPerDay: number; tokensPerDay: number; maxTokensPerLesson: number; label: string }

export const COST_PROFILES: Record<MentorCost, CostProfile> = {
  off: { autoCallsPerDay: 0, tokensPerDay: 0, maxTokensPerLesson: 0, label: 'Wyłączone: tylko lekcje wbudowane, bez wywołań modelu' },
  saver: { autoCallsPerDay: 8, tokensPerDay: 40000, maxTokensPerLesson: 1400, label: 'Oszczędny: do 8 automatycznych lekcji AI dziennie' },
  balanced: { autoCallsPerDay: 25, tokensPerDay: 150000, maxTokensPerLesson: 2200, label: 'Zrównoważony: do 25 lekcji AI dziennie' },
  generous: { autoCallsPerDay: 60, tokensPerDay: 400000, maxTokensPerLesson: 3200, label: 'Hojny: do 60 lekcji AI dziennie' },
}

/** Ręczne prośby (przycisk, /mentor explain) mają osobny, wyższy limit. */
export const MANUAL_LIMIT = { calls: 80, tokens: 600000 }

export const MIN_GAP_MS: Record<MentorFrequency, number> = { rare: 20 * 60000, normal: 5 * 60000, often: 60000 }

export const MODEL_LABELS: Record<MentorModel, string> = {
  haiku: 'Haiku (najtańszy, szybki)',
  sonnet: 'Sonnet (lepsze wyjaśnienia)',
  opus: 'Opus (najdokładniejszy, najdroższy)',
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
