// Wersja Mentora pokazywana w nagłówku panelu. Źródłem prawdy jest .claude-plugin/plugin.json:
// scripts/update-local.mjs przepisuje tę stałą, a test pilnuje zgodności.
export const MENTOR_VERSION = '1.4.2'

/** Czy wersja a jest nowsza niż b (porównanie liczbowe x.y.z). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
