// Ćwiczenia, quizy i test poziomu: pytania z kodu zmian, ocena odpowiedzi, dowody do modelu wiedzy.

import type { Host } from '../host'
import type { MentorQuizState, MentorTab } from '../../types'
import type { ConceptDef } from '../content/types'
import { makeId } from '../engine/hash'
import { levelName } from '../engine/lessons'
import { PLACEMENT } from '../engine/placement'
import { boundaryQuestion, fromTemplate, gradeChoice, gradeRequest, parseGrade, parseQuiz, predictOutputQuestion, quizRequest } from '../engine/quiz'
import type { Built, Grade } from '../engine/quiz'
import { redact } from '../engine/redact'
import { write } from '../store/db'
import type { Op } from '../store/db'
import { S } from '../ui/state'
import type { Mentor } from '../mentor'
import { BY_ID } from './shared'
import type { Detail } from './shared'

/** Ćwiczenia, quizy i test poziomu (część Mentora). */
export class QuizController {
  constructor(private readonly m: Mentor) {}

  private quizCount = 0

  // ===================== ćwiczenia =====================

  deterministicQuiz(c: ConceptDef, d: Detail | null, file: string | null, now: number): Built | null {
    const id = makeId('q', now)
    if (d?.snippet && (d.lang === 'js' || d.lang === 'ts')) {
      const b = boundaryQuestion(id, d.snippet, d.start, file, ['loops', 'conditionals', 'equality'].includes(c.id) ? c.id : 'conditionals')
      if (b && this.quizCount % 2 === 0) return b
      const p = predictOutputQuestion(id, d.snippet, d.start, file, c.id)
      if (p) return p
      if (b) return b
    }
    return c.quiz.length ? fromTemplate(id, c, this.quizCount) : null
  }

  async presentQuiz(io: Host, built: Built, switchTab: boolean): Promise<void> {
    const now = await io.now()
    this.quizCount++
    await write(io, this.m.ctx, [
      {
        op: 'saveExercise',
        args: { exercise: { id: built.question.id, concept_id: built.question.conceptId, project_id: this.m.projectId, ts: now, kind: built.question.kind, question: { ...built.question, key: built.key } } },
      },
    ])
    const state: MentorQuizState = { question: built.question, answer: '', status: 'asking' as const, verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null, hints: [], revealed: false }
    await io.set(S.quizKey, () => built.key)
    await io.set(S.quiz, () => state)
    if (switchTab) await io.set(S.tab, () => 'practice' as MentorTab)
    else await io.set(S.unseen, n => n + 1)
  }

  async startQuiz(io: Host, mode: 'focus' | 'review' | 'misconception' | 'concept' = 'focus', conceptId?: string): Promise<string> {
    const now = await io.now()
    const knowledge = await io.get(S.knowledge)
    const lesson = await io.get(S.lesson)
    const focus = await io.get(S.focus)
    let id = conceptId
    if (!id && mode === 'review') id = knowledge.filter(k => k.due).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0))[0]?.id
    if (!id && mode === 'misconception') id = (await io.get(S.misconceptions)).filter(m => !m.resolved).sort((a, b) => b.count - a.count)[0]?.conceptId
    if (!id) id = lesson?.conceptIds[0] ?? focus?.conceptId
    if (!id) id = knowledge.filter(k => k.inProject > 0 && k.level < 3).sort((a, b) => b.inProject - a.inProject)[0]?.id ?? 'variables'
    const c = BY_ID.get(id)
    if (!c) return 'Nieznane pojęcie.'
    // fragment: z lekcji (jeśli o tym pojęciu), inaczej z bieżącego fokusu
    let d: Detail | null = null
    let file: string | null = null
    if (lesson && lesson.conceptIds.includes(c.id) && lesson.body.snippet) {
      d = { snippet: lesson.body.snippet, start: lesson.body.snippetStart, lang: lesson.body.lang, unified: '', facts: null }
      file = lesson.file
    } else if (focus) {
      d = await this.m.snippetFor(io, focus.obsId, focus.file, focus.line)
      file = focus.file
    }
    await io.set(S.tab, () => 'practice' as MentorTab)
    let built: Built | null = null
    const canModel = this.m.settings.cost !== 'off' && this.m.ctx && !this.m.breaker.open(now)
    const preferModel = canModel && this.quizCount % 2 === 1
    if (!preferModel) built = this.deterministicQuiz(c, d, file, now)
    if (!built && canModel) {
      await io.set(S.quiz, () => ({ question: { id: 'tmp', conceptId: c.id, kind: 'explain' as const, source: 'model' as const, prompt: 'Przygotowuję pytanie…', code: null, codeLang: 'text', codeStart: 1, file: null, options: null }, answer: '', status: 'grading' as const, verdict: null, feedback: '', misconceptions: [], otherExample: '', followUp: '', levelChange: null }))
      built = await this.modelQuiz(io, c, d, file, now)
    }
    if (!built) built = this.deterministicQuiz(c, d, file, now)
    if (!built) {
      await io.set(S.quiz, () => null)
      return `Brak ćwiczenia dla „${c.name}”.`
    }
    await this.presentQuiz(io, built, true)
    return `Ćwiczenie: ${c.name}`
  }

  private async modelQuiz(io: Host, c: ConceptDef, d: Detail | null, file: string | null, now: number): Promise<Built | null> {
    if (!this.m.ctx) return null
    const levels = Object.fromEntries((await io.get(S.knowledge)).map(k => [k.id, k.level]))
    const mis = (await io.get(S.misconceptions)).filter(m => m.conceptId === c.id && !m.resolved).map(m => m.description)
    const sendCode = this.m.settings.sendCode !== 'off'
    const req = quizRequest(c, sendCode && d?.snippet ? d.snippet : null, d?.start ?? 1, d?.lang ?? 'text', levels[c.id] ?? 0, mis)
    const r = await this.m.callModel(io, 'manual', req.system, req.prompt, 900, now)
    if (!r) return null
    return parseQuiz(makeId('q', now), c, r, d?.snippet ?? null, d?.start ?? 1, d?.lang ?? 'text', file)
  }

  /** Kolejna podpowiedź: najpierw naprowadzenie, potem odrzucenie części złych odpowiedzi. Bez modelu. */
  async quizHint(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status !== 'asking') return
    const c = BY_ID.get(q.question.conceptId)
    const hints = q.hints ?? []
    const first = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? ''
    let next: string | null = null
    if (hints.length === 0) next = c ? `Pomyśl o tym: ${first(c.intuition)}` : null
    if (hints.length <= 1 && !next) {
      const opts = q.question.options
      if (opts && key.answer !== null) {
        const wrong = opts.map((_, i) => i).filter(i => i !== key.answer)
        const drop = wrong.slice(0, Math.max(1, Math.floor(wrong.length / 2) + (wrong.length > 2 ? 0 : 0)))
        next = `To na pewno nie ${drop.map(i => 'ABCDE'[i]).join(' ani ')}.`
      } else if (key.rubric) next = `Dobra odpowiedź mówi o tym: ${first(key.rubric)}`
      else if (c?.pitfalls[0]) next = `Uważaj na: ${c.pitfalls[0]}`
    }
    if (!next) next = 'Więcej podpowiedzi nie ma. Możesz odsłonić odpowiedź.'
    await io.set(S.quiz, x => (x ? { ...x, hints: [...(x.hints ?? []), next!] } : x))
  }

  /** Odsłania poprawną odpowiedź z wyjaśnieniem. Nie zmienia poziomu wiedzy. */
  async quizReveal(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status !== 'asking') return
    const opts = q.question.options
    const correct = opts && key.answer !== null ? `${'ABCDE'[key.answer]}. ${opts[key.answer]}` : (key.expected ?? '')
    const feedback = [correct ? `**Poprawna odpowiedź:** ${correct}` : '', key.explain].filter(Boolean).join('\n\n')
    await io.set(S.quiz, x => (x ? { ...x, status: 'graded' as const, verdict: null, revealed: true, feedback, misconceptions: [], otherExample: '', followUp: '', levelChange: null } : x))
  }

  async answer(io: Host, pickedOrText: number | string): Promise<void> {
    const q = await io.get(S.quiz)
    const key = await io.get(S.quizKey)
    if (!q || !key || q.status === 'graded' || q.status === 'grading') return
    const now = await io.now()
    const c = BY_ID.get(q.question.conceptId)
    let grade: Grade | null = null
    let answerText = ''
    if (typeof pickedOrText === 'number') {
      grade = gradeChoice(key, pickedOrText)
      answerText = q.question.options?.[pickedOrText] ?? String(pickedOrText)
    } else {
      answerText = pickedOrText.trim()
      if (answerText.length < 3) {
        await io.set(S.quiz, x => (x ? { ...x, feedback: 'Napisz odpowiedź własnymi słowami (co najmniej kilka słów).' } : x))
        return
      }
      await io.set(S.quiz, x => (x ? { ...x, answer: answerText, status: 'grading' as const, feedback: 'Oceniam…' } : x))
      if (c) {
        const req = gradeRequest(c, q.question, key, redact(answerText).text)
        const text = await this.m.callModel(io, 'manual', req.system, req.prompt, 900, now).catch(() => null)
        grade = text ? parseGrade(text) : null
      }
      if (!grade) {
        await io.set(S.quiz, x => (x ? { ...x, status: 'pending' as const, feedback: 'Nie udało się ocenić odpowiedzi (model niedostępny, limit albo zły format). Odpowiedź NIE wpłynęła na Twój postęp. Spróbuj „Oceń ponownie”.' } : x))
        return
      }
    }
    if (q.hints?.length && grade.verdict === 'correct') {
      grade = { ...grade, verdict: 'partial', feedback: `${grade.feedback}\n\nOdpowiedź z podpowiedzią liczy się jako częściowo poprawna.` }
    }
    const task = q.question.kind
    const evidence = [{ conceptId: q.question.conceptId, kind: grade.verdict, task, source: 'quiz', projectId: this.m.projectId, misconceptions: grade.misconceptions.map(m => ({ key: m.key, description: m.description, example: q.question.prompt.slice(0, 200) })) }]
    let levelChange: string | null = null
    const res = await write(io, this.m.ctx, [{ op: 'gradeExercise', args: { id: q.question.id, verdict: grade.verdict, grade: { ...grade, answer: answerText }, evidence, now } }])
    const g = res?.[0]
    if (g?.ok) {
      const v = g.value as { levelChanges?: { conceptId?: string; concept_id?: string; levelBefore?: number; levelAfter?: number; level_before?: number; level_after?: number }[] }
      const ch = v.levelChanges?.[0]
      if (ch) {
        const before = ch.levelBefore ?? ch.level_before ?? 0
        const after = ch.levelAfter ?? ch.level_after ?? 0
        levelChange = `${c?.name ?? q.question.conceptId}: ${levelName(before)} → ${levelName(after)}`
      }
    } else if (!this.m.ctx) {
      levelChange = 'Baza niedostępna: wynik zapisany w buforze, poziom zaktualizuje się po dosłaniu.'
    }
    const other = grade.otherExample || (grade.verdict !== 'correct' && c ? c.intuition : '')
    await io.set(S.quiz, x =>
      x
        ? {
            ...x,
            answer: answerText,
            status: 'graded' as const,
            verdict: grade!.verdict,
            feedback: grade!.feedback,
            misconceptions: grade!.misconceptions.map(m => m.description || m.key),
            otherExample: other,
            followUp: grade!.followUp,
            levelChange,
          }
        : x,
    )
    await this.m.refreshKnowledge(io)
  }

  async retryGrade(io: Host): Promise<void> {
    const q = await io.get(S.quiz)
    if (!q || q.status !== 'pending') return
    await io.set(S.quiz, x => (x ? { ...x, status: 'asking' as const } : x))
    await this.answer(io, q.answer)
  }

  // ===================== test poziomu =====================

  async loadPlacement(io: Host): Promise<void> {
    const saved = (await io.storeGet('placement').catch(() => null)) as { status?: string } | null
    if (saved?.status === 'done' || saved?.status === 'skipped') await io.set(S.placement, p => ({ ...p, status: saved.status as 'done' | 'skipped' }))
  }

  async startPlacement(io: Host): Promise<void> {
    await io.set(S.placement, () => ({ status: 'running' as const, index: 0, answers: [], last: null }))
    await io.set(S.lab, l => ({ ...l, selected: null }))
    await io.set(S.tab, () => 'changes' as MentorTab)
  }

  async skipPlacement(io: Host): Promise<void> {
    await io.set(S.placement, () => ({ status: 'skipped' as const, index: 0, answers: [], last: null }))
    await io.storeSet('placement', { status: 'skipped' }).catch(() => undefined)
  }

  /** Odpowiedź na pytanie testu. Po ostatnim zapisuje wynik: dobra odpowiedź = to pojęcie i jego podstawy znane. */
  async answerPlacement(io: Host, option: number): Promise<void> {
    const p = await io.get(S.placement)
    const q = PLACEMENT[p.index]
    if (p.status !== 'running' || !q) return
    const answers = [...p.answers.slice(0, p.index), option]
    const correct = option === q.answer
    const last = p.index + 1 >= PLACEMENT.length
    await io.set(S.placement, () => ({ status: last ? ('done' as const) : ('running' as const), index: p.index + 1, answers, last: { index: p.index, correct } }))
    if (!last) return
    await io.storeSet('placement', { status: 'done', answers }).catch(() => undefined)
    const now = await io.now()
    const known = new Set<string>()
    const ops: Op[] = []
    PLACEMENT.forEach((x, i) => {
      if (answers[i] === x.answer) {
        ops.push({ op: 'recordEvidence', args: { conceptId: x.conceptId, kind: 'correct', task: 'predict', source: 'user', projectId: this.m.projectId, now } })
        const walk = (id: string) => {
          for (const pre of BY_ID.get(id)?.prereqs ?? []) if (!known.has(pre)) (known.add(pre), walk(pre))
        }
        walk(x.conceptId)
      }
    })
    const asked = new Set(PLACEMENT.map(x => x.conceptId))
    for (const id of known) if (!asked.has(id)) ops.push({ op: 'recordEvidence', args: { conceptId: id, kind: 'self_report_known', source: 'user', projectId: this.m.projectId, now } })
    PLACEMENT.forEach((x, i) => {
      if (answers[i] !== x.answer && !known.has(x.conceptId)) ops.push({ op: 'recordEvidence', args: { conceptId: x.conceptId, kind: 'self_report_unknown', source: 'user', projectId: this.m.projectId, now } })
    })
    await write(io, this.m.ctx, ops)
    await this.m.refreshKnowledge(io)
  }

  async selfReport(io: Host, conceptId: string, known: boolean): Promise<void> {
    const now = await io.now()
    await write(io, this.m.ctx, [{ op: 'recordEvidence', args: { conceptId, kind: known ? 'self_report_known' : 'self_report_unknown', source: 'user', projectId: this.m.projectId, now } }])
    await this.m.refreshKnowledge(io)
  }

  async simExperiment(io: Host, conceptIds: string[]): Promise<void> {
    if (!conceptIds.length) return
    const now = await io.now()
    await write(io, this.m.ctx, conceptIds.slice(0, 2).map(id => ({ op: 'recordEvidence', args: { conceptId: id, kind: 'sim_experiment', source: 'sim', projectId: this.m.projectId, now } })))
  }
}
