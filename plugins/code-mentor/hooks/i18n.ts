// Język interfejsu Mentora: polski (domyślnie) albo angielski. Teksty są pisane w miejscu użycia
// jako para tr('po polsku', 'in English'), więc obie wersje widać obok siebie w kodzie.
// Wbudowana biblioteka pojęć i lekcji jest po polsku; lekcje AI powstają w wybranym języku.

export type Lang = 'pl' | 'en'

let lang: Lang = 'pl'

export const setLang = (l: Lang | undefined): void => {
  lang = l === 'en' ? 'en' : 'pl'
}

export const getLang = (): Lang => lang

/** Tekst w języku interfejsu. */
export const tr = (pl: string, en: string): string => (lang === 'en' ? en : pl)

/** Liczebnik: polski ma 3 formy (1, 2-4, 5+), angielski 2 (1, reszta). */
export function plural(n: number, pl: readonly [string, string, string], en: readonly [string, string]): string {
  if (lang === 'en') return n === 1 ? en[0] : en[1]
  return n === 1 ? pl[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? pl[1] : pl[2]
}

/** Nazwa języka dla modelu (lekcje, quizy, propozycje AI). */
export const langForModel = (): string => (lang === 'en' ? 'English' : 'Polish (po polsku)')
