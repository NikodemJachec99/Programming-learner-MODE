import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import { conceptById, mentor } from '../mentor'
import { codeLanguage } from '../engine/diff'
import { card, code, md, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { loadSim } from './sim'
import { runnable } from '../engine/runnable'
import { tr } from '../i18n'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

export async function renderPractice(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button, Input } = k.E
  const quiz = await io.get(S.quiz)
  const knowledge = await io.get(S.knowledge)
  const mis = (await io.get(S.misconceptions)).filter(m => !m.resolved)
  const due = knowledge.filter(r => r.due).length

  const starters = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="q-focus" variant="primary" onPress={() => mentor.quiz.startQuiz(io, 'focus')}>
        {tr('Sprawdź, czy rozumiem', 'Check that I understand')}
      </Button>
      <Button key="q-review" onPress={() => mentor.quiz.startQuiz(io, 'review')}>
        {`${tr('Powtórka', 'Review')}${due ? ` (${due})` : ''}`}
      </Button>
      {mis.length > 0 && (
        <Button key="q-mis" onPress={() => mentor.quiz.startQuiz(io, 'misconception')}>
          {`${tr('Moje błędy', 'My mistakes')} (${mis.length})`}
        </Button>
      )}
    </Box>
  )

  if (!quiz) {
    return (
      <Box flexDirection="column">
        {starters}
        {card(k, 'subtle', <Text>{tr('Brak aktywnego ćwiczenia.', 'No active exercise.')}</Text>, muted(k, tr('Pytania dotyczą kodu, który naprawdę pojawił się w Twoim projekcie. Postęp zmienia się dopiero po ocenie odpowiedzi, nigdy za samo użycie czegoś przez Claude.', 'Questions are about code that really appeared in your project. Progress changes only after an answer is graded, never because Claude used something.')))}
      </Box>
    )
  }
  const q = quiz.question
  const c = conceptById(q.conceptId)
  const answered = quiz.status === 'graded'
  const verdictColor = quiz.revealed ? 'subtle' : quiz.verdict === 'correct' ? 'success' : quiz.verdict === 'partial' ? 'warning' : 'error'
  const verdictText = quiz.revealed ? tr('Odpowiedź', 'Answer') : quiz.verdict === 'correct' ? tr('Poprawnie', 'Correct') : quiz.verdict === 'partial' ? tr('Częściowo poprawnie', 'Partly correct') : tr('Niepoprawnie', 'Incorrect')
  const hints = quiz.hints ?? []
  const kindLabel = { predict: tr('przewidź wynik', 'predict the output'), diagnose: tr('znajdź błąd', 'find the bug'), explain: tr('wyjaśnij mechanizm', 'explain the mechanism'), apply: tr('zastosuj', 'apply'), choice: tr('wybór', 'choice') }[q.kind]

  return (
    <Box flexDirection="column">
      {starters}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="claude">{`${c?.name ?? q.conceptId} · ${kindLabel}`}</Text>
        <Text dimColor>{q.source === 'model' ? tr('Pytanie z AI, na Twoim kodzie', 'AI question on your code') : q.source === 'sim' ? tr('Pytanie z Twojego kodu, sprawdzone w symulatorze', 'Question from your code, checked in the simulator') : tr('Pytanie z biblioteki Mentora', 'Question from Mentor’s library')}</Text>
      </Box>
      {md(k, q.prompt)}
      {q.code && code(k, q.code, codeLanguage(q.codeLang === 'typescript' ? 'ts' : q.codeLang), q.codeStart, q.file)}
      {quiz.status === 'grading' && <Text color="suggestion">{quiz.feedback || 'Oceniam…'}</Text>}
      {q.options && !answered && (
        <Box flexDirection="column" marginTop={1}>
          {q.options.map((o, i) => (
            <Button key={`opt-${i}`} onPress={() => mentor.quiz.answer(io, i)}>
              {`${LETTERS[i]}. ${o}`}
            </Button>
          ))}
        </Box>
      )}
      {!q.options && !answered && quiz.status !== 'grading' && (
        <Input key={`ans-${q.id}`} label={tr('Twoja odpowiedź:', 'Your answer:')} placeholder={tr('Wyjaśnij własnymi słowami, Enter wysyła', 'Explain in your own words, Enter sends')} submitLabel={tr('wyślij', 'send')} value={quiz.answer} onSubmit={v => mentor.quiz.answer(io, v)} />
      )}
      {quiz.status === 'asking' && hints.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {hints.map((h, i) => md(k, `**${tr('Podpowiedź', 'Hint')} ${i + 1}:** ${h}`, `hint-${i}`))}
        </Box>
      )}
      {quiz.status === 'asking' && (
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Button key="q-hint" plain dimColor onPress={() => mentor.quiz.quizHint(io)}>
            {hints.length ? tr('Kolejna podpowiedź', 'Next hint') : tr('Podpowiedź', 'Hint')}
          </Button>
          <Button key="q-reveal" plain dimColor onPress={() => mentor.quiz.quizReveal(io)}>
            {tr('Pokaż odpowiedź', 'Show the answer')}
          </Button>
        </Box>
      )}
      {quiz.status === 'pending' &&
        card(
          k,
          'warning',
          <Text color="warning">{quiz.feedback}</Text>,
          <Button key="q-retry" onPress={() => mentor.quiz.retryGrade(io)}>
            {tr('Oceń ponownie', 'Grade again')}
          </Button>,
        )}
      {quiz.status === 'asking' && quiz.feedback && <Text color="warning">{quiz.feedback}</Text>}
      {answered &&
        card(
          k,
          verdictColor,
          <Text bold color={verdictColor}>{verdictText}</Text>,
          quiz.answer.length > 0 && q.options ? muted(k, `${tr('Twoja odpowiedź', 'Your answer')}: ${quiz.answer}`) : null,
          md(k, quiz.feedback),
          quiz.misconceptions.length > 0 && <Text color="warning">{`${tr('Wykryte nieporozumienie', 'Misconception found')}: ${quiz.misconceptions.join('; ')}`}</Text>,
          quiz.otherExample.length > 0 && section(k, tr('To samo na innym przykładzie', 'The same on another example'), md(k, quiz.otherExample)),
          quiz.followUp.length > 0 && section(k, tr('Zadanie utrwalające (zrób samodzielnie)', 'Follow-up task (do it yourself)'), md(k, quiz.followUp)),
          quiz.levelChange !== null && <Text color="success">{`${tr('Poziom', 'Level')}: ${quiz.levelChange}`}</Text>,
          quiz.revealed && muted(k, tr('Odsłonięta odpowiedź nie zmienia Twojego poziomu. Spróbuj kolejnego pytania.', 'A revealed answer does not change your level. Try the next question.')),
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="q-next" variant="primary" onPress={() => mentor.quiz.startQuiz(io, 'concept', q.conceptId)}>
              {tr('Kolejne pytanie', 'Next question')}
            </Button>
            {q.code && (q.codeLang === 'typescript' || q.codeLang === 'javascript') && runnable(q.code, 'js') && (
              <Button key="q-sim" onPress={() => loadSim(io, q.code!, tr('kod z ćwiczenia', 'exercise code'))}>
                {tr('Sprawdź w Symulatorze', 'Check in the Simulator')}
              </Button>
            )}
          </Box>,
        )}
    </Box>
  )
}
