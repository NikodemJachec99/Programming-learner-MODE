// Generowanie lekcji. Zawsze istnieje wersja wbudowana (bez modelu), oparta
// na bibliotece pojęć i faktach z obserwacji. Model, gdy wolno go użyć,
// pisze lekcję dopasowaną do konkretnego kodu, w ściśle określonym JSON.

import type { ConceptDef } from '../content/types'
import type { MentorLessonBody, MentorObservation, MentorSettings } from '../../types'

export type LessonInput = {
  concept: ConceptDef
  related: ConceptDef[]
  obs: MentorObservation
  snippet: { text: string; start: number; lang: string }
  unified: string
  level: number
  levelsByConcept: Record<string, number>
  missingPrereqs: ConceptDef[]
  taskContext: string | null
  claudeNote: string | null
  settings: MentorSettings
  deep: boolean
}

const LEVEL_NAMES = ['Nie znam', 'Uczę się', 'Rozumiem częściowo', 'Potrafię zastosować', 'Opanowane']
export const levelName = (n: number): string => LEVEL_NAMES[Math.max(0, Math.min(4, n))] ?? 'Nie znam'

/** Krótkie objaśnienia składni widocznej w fragmencie. */
const TOKEN_NOTES: { re: RegExp; note: string; langs?: string[] }[] = [
  { re: /\bconst\b/, note: '`const` tworzy stałe powiązanie nazwy z wartością: nie da się przypisać nowej wartości, ale obiekt pod tą nazwą wciąż można modyfikować.', langs: ['js', 'ts'] },
  { re: /\blet\b/, note: '`let` tworzy zmienną o zasięgu bloku `{ }`, którą można później nadpisać.', langs: ['js', 'ts'] },
  { re: /\bvar\b/, note: '`var` to stary sposób deklaracji: zasięg całej funkcji i hoisting. W nowym kodzie zwykle zastępuje go let/const.', langs: ['js', 'ts'] },
  { re: /=>/, note: '`=>` to funkcja strzałkowa (arrow function): krótszy zapis funkcji, która nie ma własnego `this`.', langs: ['js', 'ts'] },
  { re: /\basync\b/, note: '`async` oznacza, że funkcja zawsze zwraca Promise i może używać `await` w środku.' },
  { re: /\bawait\b/, note: '`await` zawiesza tylko TĘ funkcję do czasu rozstrzygnięcia obietnicy. Reszta programu działa dalej.' },
  { re: /===/, note: '`===` porównuje wartość i typ bez konwersji.', langs: ['js', 'ts', 'php'] },
  { re: /[^=!]==[^=]/, note: '`==` porównuje z konwersją typów (w JS i PHP). Częsta pułapka: 0 == "" jest true w JS.', langs: ['js', 'ts', 'php'] },
  { re: /\?\./, note: '`?.` (optional chaining) zwraca undefined zamiast rzucać błąd, gdy coś po lewej jest null/undefined.', langs: ['js', 'ts', 'php'] },
  { re: /\?\?/, note: '`??` zwraca prawą stronę tylko wtedy, gdy lewa to null albo undefined (nie dla 0 i "").', langs: ['js', 'ts', 'php'] },
  { re: /\.\.\./, note: '`...` to spread/rest: rozkłada elementy tablicy lub pola obiektu albo zbiera resztę argumentów.', langs: ['js', 'ts'] },
  { re: /`[^`]*\$\{/, note: 'Template literal `` `tekst ${wyrażenie}` `` wstawia wartość wyrażenia do napisu.', langs: ['js', 'ts'] },
  { re: /\bexport\b/, note: '`export` udostępnia nazwę innym plikom, które mogą ją zaimportować przez `import`.', langs: ['js', 'ts'] },
  { re: /\bimport\b/, note: '`import` wczytuje kod z innego modułu. Moduł wykonuje się raz, przy pierwszym imporcie.' },
  { re: /\btry\b/, note: '`try { } catch (e) { }` przechwytuje wyjątek rzucony w bloku try, zamiast przerywać program.' },
  { re: /\bclass\b/, note: '`class` definiuje szablon obiektów: konstruktor i metody współdzielone przez instancje (przez prototyp).' },
  { re: /\bnew\b/, note: '`new` tworzy nowy obiekt i wywołuje konstruktor z `this` wskazującym na ten obiekt.' },
  { re: /\breturn\b/, note: '`return` kończy funkcję i oddaje wartość do miejsca wywołania.' },
  { re: /:\s*(string|number|boolean|Promise<)/, note: 'Adnotacja typu TypeScript (`: string`) istnieje tylko w czasie kompilacji. W działającym JS jej nie ma.', langs: ['ts'] },
  { re: /\binterface\b|\btype\s+\w+\s*=/, note: '`interface` / `type` opisują kształt danych dla TypeScriptu. Nie generują kodu w JS.', langs: ['ts'] },
  { re: /\bdef\b/, note: '`def` definiuje funkcję w Pythonie. Wcięcie wyznacza jej ciało.', langs: ['py'] },
  { re: /\bself\b/, note: '`self` to bieżąca instancja klasy w Pythonie (odpowiednik `this`).', langs: ['py'] },
  { re: /\$this->/, note: '`$this->pole` w PHP odwołuje się do pola lub metody bieżącego obiektu.', langs: ['php'] },
  { re: /->/, note: '`->` w PHP to dostęp do pola/metody obiektu.', langs: ['php'] },
  { re: /\bSELECT\b/i, note: '`SELECT … FROM …` wybiera wiersze i kolumny. Logicznie baza wykonuje najpierw FROM/JOIN, potem WHERE, GROUP BY, a SELECT prawie na końcu.' },
  { re: /\bJOIN\b/i, note: '`JOIN … ON …` łączy wiersze dwóch tabel według warunku.' },
]

export function syntaxNotes(snippet: string, lang: string, max = 6): string[] {
  const out: string[] = []
  for (const t of TOKEN_NOTES) {
    if (t.langs && !t.langs.includes(lang)) continue
    if (t.re.test(snippet)) out.push(t.note)
    if (out.length >= max) break
  }
  return out
}

function verb(obs: MentorObservation): string {
  switch (obs.kind) {
    case 'create':
      return 'utworzył plik'
    case 'edit':
    case 'config':
      return 'zmienił plik'
    default:
      return 'wykonał operację na'
  }
}

export function builtinLesson(i: LessonInput): MentorLessonBody {
  const c = i.concept
  const o = i.obs
  const short = i.settings.detail === 'short' && !i.deep
  const advanced = i.level >= 3 || i.settings.level === 'advanced'
  const where = o.file ? `${o.file}${o.line ? `:${o.line}` : ''}` : 'komenda w terminalu'
  const observed = o.file
    ? `Claude ${verb(o)} \`${o.file}\` (+${o.added} / −${o.removed} linii)${o.symbols.length ? `. Nowe nazwy: ${o.symbols.map(s => `\`${s}\``).join(', ')}` : ''}.`
    : o.summary
  const notes = syntaxNotes(i.snippet.text, i.snippet.lang)
  const missing = i.missingPrereqs.map(p => `${p.name} (${levelName(i.levelsByConcept[p.id] ?? 0)})`)
  const uncertainty: string[] = ['Cel zmiany jest wywnioskowany automatycznie z kodu i Twojego polecenia, bez modelu AI. Traktuj go jako hipotezę.']
  if (o.preexisting) uncertainty.push('Ten plik miał niezatwierdzone zmiany jeszcze przed tą sesją. Lekcja dotyczy tylko fragmentu zmienionego przez Claude w tej sesji.')
  if (o.blocked) uncertainty.push('Plik uznany za wrażliwy (np. .env, klucze): treść nie jest pokazywana ani analizowana.')
  const relatedNames = i.related.map(r => r.name)
  return {
    title: `${c.name}: ${o.file ? o.file.split(/[\\/]/).pop() : 'terminal'}`,
    conceptIds: [c.id, ...i.related.map(r => r.id)],
    file: o.file,
    line: o.line,
    lang: i.snippet.lang,
    snippet: i.snippet.text,
    snippetStart: i.snippet.start,
    observed,
    where: `${where}. Fragment poniżej pochodzi z pliku po zmianie (numery linii z pliku).`,
    problem: i.taskContext
      ? `Twoje polecenie w tej turze: „${i.taskContext.slice(0, 300)}${i.taskContext.length > 300 ? '…' : ''}”. Ta zmiana jest częścią jego realizacji.`
      : 'Brak polecenia z tej tury w kontekście: cel trzeba odczytać z samego kodu.',
    purpose: {
      likely: o.symbols.length
        ? `Prawdopodobnie: dodanie/zmiana ${o.symbols.map(s => `\`${s}\``).join(', ')} z użyciem mechanizmu „${c.name}”.`
        : `Prawdopodobnie: zastosowanie mechanizmu „${c.name}” w ${where}.`,
      confirmed: null,
    },
    syntax: notes.length ? notes.map(n => `- ${n}`).join('\n') : 'W tym fragmencie nie ma składni wymagającej osobnego objaśnienia.',
    mechanism: c.mechanism,
    dependencies: [
      c.prereqs.length ? `Ten mechanizm opiera się na: ${c.prereqs.join(', ')}.` : '',
      relatedNames.length ? `W tej samej zmianie występują też: ${relatedNames.join(', ')}.` : '',
      missing.length ? `Brakujące podstawy u Ciebie: ${missing.join(', ')}. Warto je uzupełnić najpierw.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    why: c.why,
    alternatives: c.why,
    pitfalls: c.pitfalls.map(p => `- ${p}`).join('\n'),
    verify: `${c.verify}${i.snippet.lang === 'js' || i.snippet.lang === 'ts' ? '\n\nMożesz też przejść ten fragment krok po kroku w zakładce Symulator (bez zmiany plików).' : ''}`,
    layers: {
      intuition: advanced || short ? '' : c.intuition,
      code: notes.length ? `W linii ${o.line ?? '?'} widać: ${notes.slice(0, 3).join(' ')}` : `Zobacz fragment z ${where}.`,
      mechanism: short ? c.mechanism.split('\n').slice(0, 4).join('\n') : c.mechanism,
      why: c.why,
      practice: c.practice,
      check: 'Kliknij „Sprawdź, czy rozumiem”, żeby dostać pytanie o ten fragment.',
    },
    uncertainty,
    simplifications: c.simplification ? [c.simplification] : [],
    missingPrereqs: i.missingPrereqs.map(p => p.id),
    taskContext: i.taskContext,
  }
}

const LESSON_KEYS = [
  'title', 'observed', 'where', 'problem', 'purposeLikely', 'purposeConfirmed', 'syntax', 'mechanism', 'dependencies', 'why',
  'alternatives', 'pitfalls', 'verify', 'intuition', 'codeWalkthrough', 'practice', 'check', 'uncertainty', 'simplifications',
] as const

export function lessonRequest(i: LessonInput, sendCode: boolean): { system: string; prompt: string } {
  const levels = Object.entries(i.levelsByConcept)
    .map(([id, l]) => `${id}: ${levelName(l)}`)
    .join(', ')
  const depth =
    i.deep || i.settings.detail === 'deep'
      ? 'szczegółowo, ale każde pole najwyżej ~900 znaków, cała odpowiedź do ~4500 tokenów'
      : i.settings.detail === 'short'
        ? 'krótko: każde pole 1-2 zdania, cała odpowiedź do ~1500 tokenów'
        : 'zwięźle: każde pole 1-4 zdania (najwyżej ~450 znaków), mechanism do 6 kroków, cała odpowiedź do ~2500 tokenów'
  const system = [
    'Jesteś nauczycielem programowania dla początkującego programisty, który pracuje nad prawdziwymi projektami z pomocą Claude Code.',
    'Piszesz po polsku. Terminy techniczne podawaj też po angielsku w nawiasie lub w `backtickach`.',
    'Uczysz mechanizmów: co dzieje się pod spodem, w jakiej kolejności, dlaczego tak, jakie są alternatywy i kompromisy.',
    'Zasady rzetelności:',
    '- Opisuj WYŁĄCZNIE zmianę, którą dostajesz. Nie wymyślaj innych zmian ani plików.',
    '- Rozróżniaj: zaobserwowana zmiana (fakt), prawdopodobny cel (hipoteza), cel potwierdzony kontekstem (tylko jeśli wynika z polecenia użytkownika lub notatki Claude), niepewności.',
    '- Odwołując się do kodu, podawaj numery linii z fragmentu.',
    '- Jeśli upraszczasz, dopisz to do pola simplifications razem z dokładniejszym modelem.',
    '- Nie chwal, nie motywuj, bez emoji. Bez myślników jako interpunkcji.',
    `- Dopasuj głębokość do poziomu użytkownika (${levels || 'brak danych: zakładaj początkującego'}). Przy poziomie „Potrafię zastosować” lub „Opanowane” pomiń podstawy i skup się na niuansach.`,
    `Długość: ${depth}.`,
    `Zwróć WYŁĄCZNIE jeden obiekt JSON (bez markdownu wokół) z kluczami: ${LESSON_KEYS.join(', ')}.`,
    'Wszystkie wartości to napisy (markdown dozwolony), poza: purposeConfirmed (napis albo null), uncertainty i simplifications (tablice napisów).',
    'intuition = warstwa 1 (prosto), codeWalkthrough = warstwa 2 (fragment linia po linii), mechanism = warstwa 3 (krok po kroku, przepływ wykonania i danych), why = warstwa 4 (motywacja, kompromisy), practice = warstwa 5 (gdzie się przyda), check = warstwa 6 (jedno pytanie kontrolne BEZ odpowiedzi).',
  ].join('\n')
  const parts: string[] = []
  parts.push(`Główne pojęcie: ${i.concept.name} [${i.concept.id}]. Powiązane w tej zmianie: ${i.related.map(r => r.name).join(', ') || 'brak'}.`)
  if (i.missingPrereqs.length) parts.push(`Użytkownikowi brakuje podstaw: ${i.missingPrereqs.map(p => p.name).join(', ')}. Wyjaśnij je krótko tam, gdzie są potrzebne.`)
  parts.push(`Zaobserwowana operacja: narzędzie ${i.obs.tool}, rodzaj ${i.obs.kind}, plik ${i.obs.file ?? '(brak)'}, +${i.obs.added}/−${i.obs.removed} linii${i.obs.symbols.length ? `, nowe nazwy: ${i.obs.symbols.join(', ')}` : ''}.`)
  if (i.obs.preexisting) parts.push('Uwaga: plik miał zmiany sprzed sesji. Mów tylko o pokazanym fragmencie.')
  if (sendCode && i.snippet.text) {
    parts.push(`Fragment pliku PO zmianie (${i.snippet.lang}, pierwsza linia ma numer ${i.snippet.start}). Dane wrażliwe zostały zamienione na [USUNIĘTO]:\n<code>\n${numbered(i.snippet.text, i.snippet.start)}\n</code>`)
    if (i.unified) parts.push(`Diff tej zmiany:\n<diff>\n${i.unified.slice(0, 4000)}\n</diff>`)
  } else {
    parts.push('Kod nie jest udostępniony (ustawienie prywatności). Wyjaśnij mechanizm ogólnie i zaznacz w uncertainty, że nie widzisz kodu.')
  }
  if (i.taskContext) parts.push(`Polecenie użytkownika w tej turze (kontekst celu):\n<task>\n${i.taskContext.slice(0, 1500)}\n</task>`)
  if (i.claudeNote) parts.push(`Końcowa odpowiedź Claude w tej turze (może wyjaśniać cel):\n<claude>\n${i.claudeNote.slice(0, 1500)}\n</claude>`)
  return { system, prompt: parts.join('\n\n') }
}

function numbered(text: string, start: number): string {
  return text
    .split('\n')
    .map((l, k) => `${String(start + k).padStart(4)}| ${l}`)
    .join('\n')
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/**
 * Wyciąga obiekt JSON z odpowiedzi modelu. Gdy odpowiedź ucięto na limicie tokenów,
 * zostawia pola zakończone w całości (cięcie po ostatnim kompletnym `",` / `"],`) i zamyka obiekt.
 */
/** Surowe znaki nowej linii i tabulacji wewnątrz napisów JSON (modele czasem je wstawiają) zamienia na escape. */
function escapeControlInStrings(s: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (ch === '\\') {
        out += ch + (s[i + 1] ?? '')
        i++
        continue
      }
      if (ch === '"') inString = false
      else if (ch === '\n') {
        out += '\\n'
        continue
      } else if (ch === '\r') continue
      else if (ch === '\t') {
        out += '\\t'
        continue
      }
    } else if (ch === '"') inString = true
    out += ch
  }
  return out
}

export function extractJson(raw: string): Record<string, unknown> | null {
  const text = escapeControlInStrings(raw)
  const start = text.indexOf('{')
  if (start < 0) return null
  const end = text.lastIndexOf('}')
  if (end > start) {
    try {
      const v = asObject(JSON.parse(text.slice(start, end + 1)))
      if (v) return v
    } catch {
      /* ucięta odpowiedź: próbujemy naprawić niżej */
    }
  }
  const body = text.slice(start)
  const cuts: number[] = []
  const re = /("|\]|null|true|false|\d)\s*,\s*"/g
  for (let m = re.exec(body); m; m = re.exec(body)) cuts.push(m.index + m[1]!.length)
  for (const cut of cuts.reverse().slice(0, 40)) {
    try {
      const v = asObject(JSON.parse(body.slice(0, cut) + '}'))
      if (v) return v
    } catch {
      /* następne cięcie */
    }
  }
  return null
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n') : fallback)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [])

/** Łączy odpowiedź modelu z lekcją wbudowaną (braki uzupełnia wbudowana). */
export function mergeModelLesson(base: MentorLessonBody, json: Record<string, unknown>): MentorLessonBody {
  return {
    ...base,
    title: str(json.title, base.title) || base.title,
    observed: str(json.observed, base.observed) || base.observed,
    where: str(json.where, base.where) || base.where,
    problem: str(json.problem, base.problem) || base.problem,
    purpose: {
      likely: str(json.purposeLikely, base.purpose.likely) || base.purpose.likely,
      confirmed: typeof json.purposeConfirmed === 'string' && json.purposeConfirmed.trim() ? json.purposeConfirmed : null,
    },
    syntax: str(json.syntax, base.syntax) || base.syntax,
    mechanism: str(json.mechanism, base.mechanism) || base.mechanism,
    dependencies: str(json.dependencies, base.dependencies) || base.dependencies,
    why: str(json.why, base.why) || base.why,
    alternatives: str(json.alternatives, base.alternatives) || base.alternatives,
    pitfalls: str(json.pitfalls, base.pitfalls) || base.pitfalls,
    verify: str(json.verify, base.verify) || base.verify,
    layers: {
      intuition: str(json.intuition, base.layers.intuition),
      code: str(json.codeWalkthrough, base.layers.code) || base.layers.code,
      mechanism: str(json.mechanism, base.layers.mechanism) || base.layers.mechanism,
      why: str(json.why, base.layers.why) || base.layers.why,
      practice: str(json.practice, base.layers.practice) || base.layers.practice,
      check: str(json.check, base.layers.check) || base.layers.check,
    },
    uncertainty: [...strs(json.uncertainty), ...base.uncertainty.filter(u => !u.startsWith('Cel zmiany jest wywnioskowany automatycznie'))],
    simplifications: strs(json.simplifications).length ? strs(json.simplifications) : base.simplifications,
  }
}
