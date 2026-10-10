// Generowanie lekcji. Zawsze istnieje wersja wbudowana (bez modelu), oparta
// na bibliotece pojęć i faktach z obserwacji. Model, gdy wolno go użyć,
// pisze lekcję dopasowaną do konkretnego kodu, w ściśle określonym JSON.

import { getLang, tr } from '../i18n'
import type { ConceptDef } from '../content/types'
import type { MentorLessonBody, MentorObservation, MentorSettings, MentorLessonTask } from '../../types'

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
  /** Wskazówki z ocen poprzednich lekcji (za trudne, więcej przykładów...). */
  prefs?: string[]
  /** Całe zadanie (polecenie), z którego jest ta lekcja. */
  task?: MentorLessonTask | null
}

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

/** Jedno zdanie o całym zadaniu: co Claude zrobił, w ilu edycjach i plikach. */
export function taskSentence(t: MentorLessonTask): string {
  const names = t.files.slice(0, 3).map(f => `\`${baseName(f)}\``).join(', ') + (t.files.length > 3 ? ` i ${t.files.length - 3} ${plural(t.files.length - 3, 'inny', 'inne', 'innych')}` : '')
  return `${t.label ? `W zadaniu „${t.label}” Claude` : 'Claude'} zrobił ${t.edits} ${plural(t.edits, 'edycję', 'edycje', 'edycji')} w ${t.files.length} ${t.files.length === 1 ? 'pliku' : 'plikach'} (${names}, +${t.added} −${t.removed}).`
}

const LEVEL_NAMES: [string, string][] = [
  ['Nie znam', 'Unknown'],
  ['Uczę się', 'Learning'],
  ['Rozumiem częściowo', 'Partly understood'],
  ['Potrafię zastosować', 'Can apply'],
  ['Opanowane', 'Mastered'],
]
export const levelName = (n: number): string => {
  const [pl, en] = LEVEL_NAMES[Math.max(0, Math.min(4, n))] ?? LEVEL_NAMES[0]!
  return tr(pl, en)
}

/** Krótkie objaśnienia składni widocznej w fragmencie. */
const TOKEN_NOTES: { re: RegExp; note: string; langs?: string[] }[] = [
  { re: /\bsetState\s*\(/, note: '`setState(() { ... })` zmienia stan i każe Flutterowi ponownie wywołać build() tego widgetu. Zmiana pola bez setState nie odświeży ekranu.', langs: ['dart'] },
  { re: /\bWidget\s+build\s*\(/, note: '`build(BuildContext context)` opisuje, jak widget wygląda teraz. Flutter wywołuje go wiele razy, więc nie rób tu zapytań ani ciężkich obliczeń.', langs: ['dart'] },
  { re: /\b(StatelessWidget|StatefulWidget)\b/, note: '`StatelessWidget` nie ma własnego stanu. `StatefulWidget` trzyma stan w osobnej klasie `State`, która przeżywa przebudowy widgetu.', langs: ['dart'] },
  { re: /\b(child|children)\s*:/, note: '`child:` i `children:` budują drzewo widgetów: jeden potomek albo lista potomków.', langs: ['dart'] },
  { re: /\bfactory\b/, note: '`factory` to konstruktor, który sam decyduje, co zwrócić, np. `User.fromJson(json)` buduje obiekt z mapy.', langs: ['dart'] },
  { re: /\blate\b/, note: '`late` obiecuje, że zmienna dostanie wartość przed pierwszym odczytem. Odczyt wcześniej rzuca LateInitializationError.', langs: ['dart'] },
  { re: /\brequired\b/, note: '`required` przy parametrze nazwanym (`{required this.name}`) znaczy, że wywołujący musi go podać.', langs: ['dart'] },
  { re: /\b(int|double|String|bool|num|List<[^>]*>|Map<[^>]*>|[A-Z]\w*)\?\s+[a-z_]/, note: '`String?` to typ, który dopuszcza null. Bez `?` kompilator gwarantuje, że null tam nie trafi (null safety).', langs: ['dart'] },
  { re: /[\w)\]]!(\.|;|\)|,|\s)/, note: '`x!` mówi kompilatorowi: tu na pewno nie ma null. Jeśli jednak jest, program rzuca wyjątek w tym miejscu.', langs: ['dart'] },
  { re: /\?\./, note: '`?.` zwraca null zamiast rzucać błąd, gdy obiekt po lewej to null.', langs: ['dart'] },
  { re: /\?\?/, note: '`??` zwraca prawą stronę, gdy lewa to null. `x ??= 0` przypisze 0 tylko wtedy, gdy x jest null.', langs: ['dart'] },
  { re: /\bFuture</, note: '`Future<T>` to wartość typu T dostępna później, odpowiednik Promise z JS.', langs: ['dart'] },
  { re: /\basync\b/, note: '`async` w Darcie: funkcja zwraca Future, a w środku może używać `await`.', langs: ['dart'] },
  { re: /\bawait\b/, note: '`await` czeka na Future i zawiesza tylko tę funkcję. Pętla zdarzeń działa dalej, więc interfejs nie zamarza.', langs: ['dart'] },
  { re: /\bfinal\b/, note: '`final` w Darcie: wartość przypisuje się raz. Obiekt pod tą nazwą (np. lista) nadal można zmieniać.', langs: ['dart'] },
  { re: /\bconst\b/, note: '`const` w Darcie to stała czasu kompilacji. We Flutterze `const Text(...)` to jedna współdzielona instancja, której nie trzeba przebudowywać.', langs: ['dart'] },
  { re: /~\//, note: '`~/` to dzielenie całkowite: 7 ~/ 2 daje 3. Zwykłe `/` zawsze daje double (3.5).', langs: ['dart'] },
  { re: /'[^'\n]*\$[\w{]/, note: "`'Cześć $name'` wstawia wartość do napisu. Dla wyrażeń piszesz `${a + b}`.", langs: ['dart'] },
  { re: /@override\b/, note: '`@override` oznacza nadpisanie metody z klasy bazowej. Analizator ostrzeże, gdy takiej metody tam nie ma.', langs: ['dart'] },
  { re: /=>/, note: '`=> wyrażenie` to skrót funkcji, która tylko zwraca to wyrażenie.', langs: ['dart'] },
  { re: /\bconst\b/, note: '`const` tworzy stałe powiązanie nazwy z wartością: nie da się przypisać nowej wartości, ale obiekt pod tą nazwą wciąż można modyfikować.', langs: ['js', 'ts'] },
  { re: /\blet\b/, note: '`let` tworzy zmienną o zasięgu bloku `{ }`, którą można później nadpisać.', langs: ['js', 'ts'] },
  { re: /\bvar\b/, note: '`var` to stary sposób deklaracji: zasięg całej funkcji i hoisting. W nowym kodzie zwykle zastępuje go let/const.', langs: ['js', 'ts'] },
  { re: /=>/, note: '`=>` to funkcja strzałkowa (arrow function): krótszy zapis funkcji, która nie ma własnego `this`.', langs: ['js', 'ts'] },
  { re: /\basync\b/, note: '`async` oznacza, że funkcja zawsze zwraca Promise i może używać `await` w środku.', langs: ['js', 'ts', 'py'] },
  { re: /\bawait\b/, note: '`await` zawiesza tylko TĘ funkcję do czasu rozstrzygnięcia obietnicy. Reszta programu działa dalej.', langs: ['js', 'ts', 'py'] },
  { re: /===/, note: '`===` porównuje wartość i typ bez konwersji.', langs: ['js', 'ts', 'php'] },
  { re: /[^=!]==[^=]/, note: '`==` porównuje z konwersją typów (w JS i PHP). Częsta pułapka: 0 == "" jest true w JS.', langs: ['js', 'ts', 'php'] },
  { re: /\?\./, note: '`?.` (optional chaining) zwraca undefined zamiast rzucać błąd, gdy coś po lewej jest null/undefined.', langs: ['js', 'ts', 'php'] },
  { re: /\?\?/, note: '`??` zwraca prawą stronę tylko wtedy, gdy lewa to null albo undefined (nie dla 0 i "").', langs: ['js', 'ts', 'php'] },
  { re: /\.\.\./, note: '`...` to spread/rest: rozkłada elementy tablicy lub pola obiektu albo zbiera resztę argumentów.', langs: ['js', 'ts'] },
  { re: /`[^`]*\$\{/, note: 'Template literal `` `tekst ${wyrażenie}` `` wstawia wartość wyrażenia do napisu.', langs: ['js', 'ts'] },
  { re: /\bexport\b/, note: '`export` udostępnia nazwę innym plikom, które mogą ją zaimportować przez `import`.', langs: ['js', 'ts'] },
  { re: /\bimport\b/, note: '`import` wczytuje kod z innego modułu. Moduł wykonuje się raz, przy pierwszym imporcie.' },
  { re: /\btry\b/, note: '`try { } catch (e) { }` przechwytuje wyjątek rzucony w bloku try, zamiast przerywać program.' },
  { re: /\bclass\b/, note: '`class` definiuje szablon obiektów: konstruktor i metody współdzielone przez instancje (przez prototyp).', langs: ['js', 'ts'] },
  { re: /\bnew\b/, note: '`new` tworzy nowy obiekt i wywołuje konstruktor z `this` wskazującym na ten obiekt.', langs: ['js', 'ts', 'php'] },
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
    // lekcja z całego zadania: najpierw co Claude zrobił w zadaniu, potem kluczowy mechanizm na tej edycji
    observed: i.task && i.task.files.length > 1 ? `${taskSentence(i.task)} Kluczowy mechanizm to „${c.name}”, widać go tutaj: ${observed.charAt(0).toLowerCase()}${observed.slice(1)}` : observed,
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
    ...(i.task ? { task: i.task } : {}),
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
    getLang() === 'en' ? 'Write in English. Keep code identifiers in `backticks`.' : 'Piszesz po polsku. Terminy techniczne podawaj też po angielsku w nawiasie lub w `backtickach`.',
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
  if (i.prefs?.length) parts.push(`Preferencje ucznia (z jego ocen poprzednich lekcji): ${i.prefs.join(' ')}`)
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
  if (i.task && i.task.files.length > 1)
    parts.push(
      `Całe zadanie: edycje ${i.task.edits}, pliki ${i.task.files.length} (${i.task.files.slice(0, 8).join(', ')}), +${i.task.added} −${i.task.removed} linii. Lekcja ma dotyczyć zadania jako całości: pole "observed" zacznij jednym zdaniem, co Claude zrobił w całym zadaniu, a potem pokaż, jak kluczowy mechanizm „${i.concept.name}” działa na pokazanej edycji. Nie opisuj plików po kolei.`,
    )
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
