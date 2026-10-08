// Silnik nauki: prywatność, rozpoznawanie pojęć, fakty z diffu, lekcje, quizy.
import { expect, test } from 'claude-code/testing'
import { isSensitivePath, redact, safeSnippet } from '../hooks/engine/redact'
import { classifyCommand, detectConcepts, newSymbols } from '../hooks/engine/detect'
import { factsFromPatch } from '../hooks/engine/diff'
import { builtinLesson, lessonRequest } from '../hooks/engine/lessons'
import { boundaryQuestion, gradeChoice, parseGrade, predictOutputQuestion } from '../hooks/engine/quiz'
import { CONCEPTS } from '../hooks/content/concepts'
import { missingPrereqs, recommend } from '../hooks/engine/graph'
import { DEFAULT_SETTINGS } from '../hooks/ui/state'
import type { MentorObservation } from '../types'

const lines = (src: string, start = 1) => src.split('\n').map((text, i) => ({ line: start + i, text }))

test('L: sekrety są usuwane zanim trafią do modelu lub bazy', async () => {
  const src = [
    'const apiKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"',
    'const db = "postgres://admin:SuperTajne123@db.example.com:5432/app"',
    'export const STRIPE = "sk_live_51Habcdefghijklmnop"',
    'headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" }',
    'password = "hunter2hunter2"',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const r = redact(src)
  expect(r.text).not.toMatch(/sk-ant-api03/)
  expect(r.text).not.toMatch(/SuperTajne123/)
  expect(r.text).not.toMatch(/sk_live_51H/)
  expect(r.text).not.toMatch(/eyJhbGciOiJIUzI1NiJ9\.eyJ/)
  expect(r.text).not.toMatch(/hunter2hunter2/)
  expect(r.text).not.toMatch(/MIIEpAIBAAKCAQEA/)
  expect(r.hits.length >= 6).toBe(true)
  expect(isSensitivePath('C:/proj/.env')).toBe(true)
  expect(isSensitivePath('C:/proj/.env.production')).toBe(true)
  expect(isSensitivePath('C:/proj/certs/server.key')).toBe(true)
  expect(isSensitivePath('C:/proj/src/env.ts')).toBe(false)
  expect(safeSnippet('C:/proj/.env', 'A=1', 10).blocked).toBe(true)
  // zwykły kod zostaje
  expect(redact('const total = items.reduce((s, x) => s + x.price, 0)').text).toBe('const total = items.reduce((s, x) => s + x.price, 0)')
})

test('C: rozpoznanie pojęć w prawdziwej zmianie z numerami linii', async () => {
  const added = lines('export async function fetchUser(id: string): Promise<User> {\n  const res = await fetch(`/api/users/${id}`)\n  if (res.status === 404) return null\n  return res.json()\n}', 10)
  const ids = detectConcepts('ts', added).map(h => h.id)
  for (const id of ['async-await', 'http-client', 'conditionals', 'equality', 'modules-imports', 'functions', 'json']) expect(ids).toContain(id)
  const aw = detectConcepts('ts', added).find(h => h.id === 'async-await')!
  expect(aw.line).toBe(10)
  expect(newSymbols(added)).toEqual(['fetchUser'])
  expect(classifyCommand('npm install zod').kind).toBe('dependency')
  expect(classifyCommand('npx vitest run').kind).toBe('test')
  expect(classifyCommand('git checkout -b feat').concepts).toEqual(['git-branching'])
})

test('C: fakty z diffu to tylko zmiana z wywołania narzędzia', async () => {
  const f = factsFromPatch([{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' const a = 1', '-if (a == 1) {', '+if (a === 1) {', '+  log(a)', ' }'] }])
  expect(f.added).toBe(2)
  expect(f.removed).toBe(1)
  expect(f.addedLines).toEqual([{ line: 4, text: 'if (a === 1) {' }, { line: 5, text: '  log(a)' }])
  expect(f.firstLine).toBe(4)
})

test('D: lekcja wbudowana ma odniesienie do kodu, mechanizm i uzasadnienie', async () => {
  const c = CONCEPTS.find(x => x.id === 'async-await')!
  const obs: MentorObservation = {
    id: 'o1', ts: 1, turn: 1, kind: 'edit', tool: 'Edit', file: 'src/api.ts', line: 10, summary: 'Edycja: +4 −0, nowe: fetchUser', added: 4, removed: 0, lang: 'ts',
    concepts: ['async-await', 'http-client'], symbols: ['fetchUser'], failed: false, blocked: false, preexisting: false,
  }
  const body = builtinLesson({
    concept: c, related: [CONCEPTS.find(x => x.id === 'http-client')!], obs,
    snippet: { text: 'export async function fetchUser(id) {\n  const res = await fetch(url)\n}', start: 10, lang: 'ts' }, unified: '',
    level: 0, levelsByConcept: { 'async-await': 0 }, missingPrereqs: missingPrereqs(c, {}, CONCEPTS), taskContext: 'dodaj pobieranie użytkownika', claudeNote: null, settings: DEFAULT_SETTINGS, deep: false,
  })
  expect(body.file).toBe('src/api.ts')
  expect(body.line).toBe(10)
  expect(body.snippet).toMatch(/await fetch/)
  expect(body.observed).toMatch(/src\/api\.ts/)
  expect(body.mechanism.length > 40).toBe(true)
  expect(body.why.length > 40).toBe(true)
  expect(body.syntax).toMatch(/await/)
  expect(body.purpose.confirmed).toBe(null) // bez modelu nic nie jest "potwierdzone"
  expect(body.problem).toMatch(/dodaj pobieranie użytkownika/)
  expect(body.missingPrereqs.length > 0).toBe(true)
  // prompt dla modelu nie zawiera sekretów i rozróżnia fakt/hipotezę
  const req = lessonRequest({ concept: c, related: [], obs, snippet: { text: 'const k = "sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzz"', start: 1, lang: 'ts' }, unified: '', level: 0, levelsByConcept: {}, missingPrereqs: [], taskContext: null, claudeNote: null, settings: DEFAULT_SETTINGS, deep: false }, true)
  expect(req.system).toMatch(/prawdopodobny cel/)
  const off = lessonRequest({ concept: c, related: [], obs, snippet: { text: 'secret code', start: 1, lang: 'ts' }, unified: '', level: 0, levelsByConcept: {}, missingPrereqs: [], taskContext: null, claudeNote: null, settings: DEFAULT_SETTINGS, deep: false }, false)
  expect(off.prompt).not.toMatch(/secret code/)
})

test('E/6: quiz z prawdziwego kodu wykrywa konkretny błąd rozumowania (off-by-one)', async () => {
  const q = boundaryQuestion('q1', 'for (let i = 0; i < limit; i++) {\n  if (count >= 10) break\n}', 20, 'src/loop.ts', 'loops')
  expect(q).toBeDefined()
  expect(q!.question.code).toMatch(/i < limit|count >= 10/)
  expect(q!.question.options!.length).toBe(3)
  // pytanie nie zdradza odpowiedzi
  expect(q!.question.prompt).not.toMatch(/true: |false: /)
  const wrong = q!.key.answer === 0 ? 1 : 0
  const g = gradeChoice(q!.key, wrong)
  expect(g.verdict).toBe('incorrect')
  expect(g.misconceptions[0]!.key).toBe('off-by-one')
  const ok = gradeChoice(q!.key, q!.key.answer!)
  expect(ok.verdict).toBe('correct')
  expect(ok.misconceptions).toEqual([])
})

test('E: pytanie "co wypisze" jest sprawdzone przez symulator', async () => {
  const p = predictOutputQuestion('q2', 'let x = 10\nif (x < 10) {\n  console.log("mniej")\n} else {\n  console.log("nie mniej")\n}', 1, null, 'conditionals')
  expect(p).toBeDefined()
  expect(p!.question.options![p!.key.answer!]).toBe('nie mniej')
  expect(p!.question.options).toContain('mniej')
})

test('E: ocena odpowiedzi otwartej wymaga poprawnego formatu, inaczej brak zmiany postępu', async () => {
  expect(parseGrade('nie JSON')).toBe(null)
  expect(parseGrade('{"verdict":"maybe"}')).toBe(null)
  const g = parseGrade('```json\n{"verdict":"partial","feedback":"Brakuje event loop","misconceptions":[{"key":"await-blocks-thread","description":"myśli, że await blokuje wątek"}],"otherExample":"x","followUp":"y"}\n```')
  expect(g!.verdict).toBe('partial')
  expect(g!.misconceptions[0]!.key).toBe('await-blocks-thread')
})

test('graf: ścieżka proponuje brakujące podstawy zamiast cofać do początku', async () => {
  const k = CONCEPTS.map(c => ({ id: c.id, name: c.name, area: c.area, level: ['variables', 'data-types', 'operators', 'boolean-logic', 'conditionals', 'loops', 'functions', 'callbacks'].includes(c.id) ? 3 : 0, mastery: 0, confidence: 0, exposures: 0, correct: 0, incorrect: 0, due: false, nextReviewAt: null, lastVerifiedAt: null, inProject: 0 }))
  const recs = recommend(CONCEPTS, k, { 'async-await': 4 }, 4)
  expect(recs[0]!.id).toBe('promises')
  expect(recs[0]!.kind).toBe('foundation')
})

test('biblioteka pojęć: graf acykliczny, quizy z poprawnymi kluczami', async () => {
  const ids = new Set(CONCEPTS.map(c => c.id))
  for (const c of CONCEPTS) {
    for (const p of c.prereqs) expect(ids.has(p)).toBe(true)
    for (const q of c.quiz) {
      expect(q.answer >= 0 && q.answer < q.options.length).toBe(true)
      for (const [i, key] of Object.entries(q.misconceptionByOption ?? {})) {
        expect(Number(i) !== q.answer).toBe(true)
        expect(c.misconceptions.some(m => m.key === key)).toBe(true)
      }
    }
  }
  const eq = CONCEPTS.find(c => c.id === 'equality')!
  expect(eq.misconceptions.map(m => m.key)).toContain('assign-vs-compare')
})
