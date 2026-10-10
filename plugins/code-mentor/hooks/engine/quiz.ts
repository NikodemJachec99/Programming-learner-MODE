// Ćwiczenia: deterministyczne (z biblioteki i z prawdziwego kodu przez
// symulator) oraz otwarte z modelu. Odpowiedź wzorcowa nigdy nie trafia do
// widoku przed udzieleniem odpowiedzi.

import { getLang } from '../i18n'
import type { ConceptDef } from '../content/types'
import type { MentorQuizKey, MentorQuizQuestion } from '../../types'
import { parse } from '../sim/parser'
import type { Expr, Stmt } from '../sim/ast'
import { evalCond, parseLiteral } from '../sim/conditions'
import { simulate } from '../sim/interp'
import { applyEdits, findSites } from '../sim/variants'
import { extractJson } from './lessons'

export type QuizKey = MentorQuizKey

export type Built = { question: MentorQuizQuestion; key: QuizKey }

export function fromTemplate(id: string, c: ConceptDef, index: number): Built | null {
  const t = c.quiz[index % Math.max(1, c.quiz.length)]
  if (!t) return null
  const mis: QuizKey['misconceptionByOption'] = {}
  for (const [k, v] of Object.entries(t.misconceptionByOption ?? {})) {
    const m = c.misconceptions.find(x => x.key === v)
    if (m) mis[String(k)] = { key: m.key, description: m.text }
  }
  return {
    question: { id, conceptId: c.id, kind: t.kind, source: 'builtin', prompt: t.q, code: null, codeLang: 'javascript', codeStart: 1, file: null, options: t.options },
    key: { id, conceptId: c.id, kind: t.kind, answer: t.answer, explain: t.explain, misconceptionByOption: mis, rubric: null, expected: null },
  }
}

type Comparison = { expr: string; op: string; varName: string; literal: string; line: number; varOnLeft: boolean }

function findComparisons(source: string): Comparison[] {
  let body: Stmt[]
  try {
    body = parse(source).body
  } catch {
    return []
  }
  const out: Comparison[] = []
  const isLit = (e: Expr) => e.type === 'Num' || (e.type === 'Unary' && e.op === '-' && e.arg.type === 'Num')
  const name = (e: Expr): string | null => (e.type === 'Ident' ? e.name : e.type === 'Member' && !e.computed ? `${name(e.object) ?? '…'}.${(e.prop as { value: string }).value}` : null)
  const visit = (x: unknown): void => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(visit)
    const e = x as Expr
    if (e.type === 'Binary' && ['<', '<=', '>', '>='].includes(e.op)) {
      const ln = name(e.left)
      const rn = name(e.right)
      if (ln && isLit(e.right)) out.push({ expr: source.slice(e.start, e.end), op: e.op, varName: ln, literal: source.slice(e.right.start, e.right.end), line: e.line, varOnLeft: true })
      else if (rn && isLit(e.left)) out.push({ expr: source.slice(e.start, e.end), op: e.op, varName: rn, literal: source.slice(e.left.start, e.left.end), line: e.line, varOnLeft: false })
    }
    for (const v of Object.values(x as Record<string, unknown>)) if (v && typeof v === 'object') visit(v)
  }
  visit(body)
  return out
}

/** Pytanie o przypadek brzegowy warunku z prawdziwego kodu projektu. */
export function boundaryQuestion(id: string, snippet: string, start: number, file: string | null, conceptId = 'loops'): Built | null {
  const comps = findComparisons(snippet)
  const c = comps[0]
  if (!c) return null
  const lit = parseLiteral(c.literal, 'js')
  if ('error' in lit || lit.t !== 'num') return null
  // zmienna równa literałowi: obie strony porównania mają tę samą wartość
  const res = evalCond('js', c.op, lit, lit)
  const correct = res.value === true ? 0 : 1
  const line = start + c.line - 1
  return {
    question: {
      id,
      conceptId,
      kind: 'predict',
      source: 'sim',
      prompt: `W Twoim kodzie (linia ${line}) jest warunek \`${c.expr}\`. Załóżmy, że \`${c.varName}\` ma wartość dokładnie ${c.literal}. Jaki będzie wynik warunku?`,
      code: snippet,
      codeLang: 'typescript',
      codeStart: start,
      file,
      options: ['true: warunek jest spełniony', 'false: warunek nie jest spełniony', 'Zależy od typu zmiennej, nie da się określić'],
    },
    key: {
      id,
      conceptId,
      kind: 'predict',
      answer: correct,
      explain: `Dla ${c.varName} = ${c.literal} obie strony są równe. ${c.op} ${c.op.includes('=') ? 'dopuszcza równość, więc wynik to true' : 'jest porównaniem ostrym (bez równości), więc wynik to false'}. To jest przypadek brzegowy, w którym < różni się od <= (i > od >=).`,
      misconceptionByOption: { [String(1 - correct)]: { key: 'off-by-one', description: 'Mylenie porównania ostrego (<, >) z nieostrym (<=, >=) na granicy przedziału' } },
      rubric: null,
      expected: null,
    },
  }
}

/** Pytanie "co wypisze ten kod" z wykonania w symulatorze. */
export function predictOutputQuestion(id: string, snippet: string, start: number, file: string | null, conceptId: string): Built | null {
  const r = simulate(snippet, { maxSteps: 800 })
  if (!r.ok || !r.output.length || r.hypotheses.length || r.output.join('').length > 160) return null
  const correct = r.output.join(' | ')
  const distractors = new Set<string>()
  const sites = findSites(snippet)
  for (const op of sites.ops.slice(0, 6)) {
    const alt = op.op === '<' ? '<=' : op.op === '<=' ? '<' : op.op === '>' ? '>=' : op.op === '>=' ? '>' : op.op === '===' ? '==' : op.op === '&&' ? '||' : op.op === '||' ? '&&' : null
    if (!alt) continue
    const v = simulate(applyEdits(snippet, [{ start: op.start, end: op.end, text: alt }]), { maxSteps: 800 })
    const o = v.ok ? v.output.join(' | ') : null
    if (o && o !== correct) distractors.add(o)
  }
  distractors.add(r.output.slice(0, -1).join(' | ') || '(nic nie wypisze)')
  const opts = [correct, ...[...distractors].filter(d => d !== correct).slice(0, 2)]
  if (opts.length < 2) opts.push('(program rzuci wyjątek)')
  // deterministyczne przetasowanie
  const order = opts.map((o, i) => ({ o, k: (o.length * 31 + i * 17) % 7 })).sort((a, b) => a.k - b.k)
  const options = order.map(x => x.o)
  return {
    question: { id, conceptId, kind: 'predict', source: 'sim', prompt: 'Co wypisze ten fragment (kolejne linie oddzielone „|”)? Najpierw przewidź, potem sprawdź w Symulatorze.', code: snippet, codeLang: 'typescript', codeStart: start, file, options },
    key: { id, conceptId, kind: 'predict', answer: options.indexOf(correct), explain: `Symulator wykonał ten fragment krok po kroku i wypisał: ${correct}. Przejdź go w zakładce Symulator (STEP), żeby zobaczyć, gdzie Twoja przewidywana ścieżka się rozjechała.`, misconceptionByOption: {}, rubric: null, expected: null },
  }
}

export function quizRequest(c: ConceptDef, snippet: string | null, start: number, lang: string, level: number, misconceptions: string[]): { system: string; prompt: string } {
  const system = [
    `Tworzysz JEDNO krótkie ćwiczenie sprawdzające rozumienie kodu dla początkującego programisty. ${getLang() === 'en' ? 'In English.' : 'Po polsku, terminy także po angielsku.'}`,
    'Preferuj zadania wymagające myślenia: przewidywanie wyniku (predict), diagnoza błędu (diagnose), wyjaśnienie mechanizmu własnymi słowami (explain). Unikaj recytowania definicji.',
    'Pytanie musi dotyczyć pokazanego, prawdziwego kodu (jeśli jest). Nie zdradzaj odpowiedzi w pytaniu.',
    'Zwróć WYŁĄCZNIE JSON: {"kind":"predict|diagnose|explain","question":"…","focusLines":"np. 12-15","expected":"wzorcowa odpowiedź (ukryta przed użytkownikiem)","rubric":"kryteria oceny: co musi się znaleźć w poprawnej odpowiedzi, typowe błędne odpowiedzi","misconceptionKeys":["…"]}',
  ].join('\n')
  const parts = [`Pojęcie: ${c.name} [${c.id}]. Poziom użytkownika: ${level}/4.`, `Znane błędne przekonania dla tego pojęcia: ${c.misconceptions.map(m => `${m.key}: ${m.text}`).join('; ') || 'brak'}.`]
  if (misconceptions.length) parts.push(`Użytkownik wcześniej popełniał błędy: ${misconceptions.join('; ')}. Sprawdź, czy już je rozumie.`)
  if (snippet) parts.push(`Kod (${lang}, pierwsza linia ma numer ${start}):\n<code>\n${snippet}\n</code>`)
  return { system, prompt: parts.join('\n\n') }
}

export function parseQuiz(id: string, c: ConceptDef, text: string, snippet: string | null, start: number, lang: string, file: string | null): Built | null {
  const j = extractJson(text)
  if (!j || typeof j.question !== 'string') return null
  const kind = j.kind === 'predict' || j.kind === 'diagnose' || j.kind === 'explain' ? j.kind : 'explain'
  return {
    question: { id, conceptId: c.id, kind, source: 'model', prompt: j.question, code: snippet, codeLang: lang, codeStart: start, file, options: null },
    key: { id, conceptId: c.id, kind, answer: null, explain: '', misconceptionByOption: {}, rubric: typeof j.rubric === 'string' ? j.rubric : null, expected: typeof j.expected === 'string' ? j.expected : null },
  }
}

export function gradeRequest(c: ConceptDef, q: MentorQuizQuestion, key: QuizKey, answer: string): { system: string; prompt: string } {
  const system = [
    `Oceniasz odpowiedź początkującego programisty na pytanie o kod. ${getLang() === 'en' ? 'Answer in English.' : 'Po polsku.'} Rzeczowo: jeśli się myli, powiedz to wprost, wskaż przyczynę i właściwy mechanizm. Bez pochwał na zapas.`,
    'Oceniaj merytorykę, nie styl. "partial" gdy rdzeń jest dobry, ale brakuje istotnego elementu albo jest drobny błąd.',
    'Jeśli odpowiedź jest pusta, nie na temat albo nie da się jej ocenić, verdict = "incorrect" i napisz dlaczego.',
    `Klucze błędnych przekonań dla tego pojęcia: ${c.misconceptions.map(m => m.key).join(', ') || 'brak'}. Możesz dodać nowy klucz kebab-case, jeśli żaden nie pasuje.`,
    'Zwróć WYŁĄCZNIE JSON: {"verdict":"correct|partial|incorrect","feedback":"ocena i wyjaśnienie (2-6 zdań)","misconceptions":[{"key":"…","description":"…"}],"otherExample":"to samo zagadnienie na INNYM, krótkim przykładzie","followUp":"zadanie utrwalające do samodzielnego wykonania"}',
  ].join('\n')
  const prompt = [
    `Pojęcie: ${c.name}.`,
    q.code ? `Kod:\n<code>\n${q.code}\n</code>` : '',
    `Pytanie: ${q.prompt}`,
    key.expected ? `Wzorcowa odpowiedź (nie cytuj jej dosłownie): ${key.expected}` : '',
    key.rubric ? `Kryteria: ${key.rubric}` : '',
    `Odpowiedź użytkownika:\n<answer>\n${answer.slice(0, 3000)}\n</answer>`,
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, prompt }
}

export type Grade = { verdict: 'correct' | 'partial' | 'incorrect'; feedback: string; misconceptions: { key: string; description: string }[]; otherExample: string; followUp: string }

export function parseGrade(text: string): Grade | null {
  const j = extractJson(text)
  if (!j) return null
  const v = j.verdict
  if (v !== 'correct' && v !== 'partial' && v !== 'incorrect') return null
  const mis = Array.isArray(j.misconceptions)
    ? j.misconceptions
        .map(m => (m && typeof m === 'object' ? (m as Record<string, unknown>) : null))
        .filter((m): m is Record<string, unknown> => !!m && typeof m.key === 'string')
        .map(m => ({ key: String(m.key).slice(0, 60), description: typeof m.description === 'string' ? m.description : '' }))
    : []
  return {
    verdict: v,
    feedback: typeof j.feedback === 'string' ? j.feedback : '',
    misconceptions: mis,
    otherExample: typeof j.otherExample === 'string' ? j.otherExample : '',
    followUp: typeof j.followUp === 'string' ? j.followUp : '',
  }
}

/** Ocena odpowiedzi zamkniętej: deterministyczna. */
export function gradeChoice(key: QuizKey, picked: number): Grade {
  const ok = picked === key.answer
  const m = key.misconceptionByOption[String(picked)]
  const mis = ok || !m ? [] : [m]
  return {
    verdict: ok ? 'correct' : 'incorrect',
    feedback: ok ? `Poprawnie. ${key.explain}` : `Niepoprawnie. ${key.explain}`,
    misconceptions: mis,
    otherExample: '',
    followUp: ok ? '' : 'Zmień jedną wartość albo operator w Symulatorze i sprawdź, kiedy wynik się odwraca.',
  }
}
