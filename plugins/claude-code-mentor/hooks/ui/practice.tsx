import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import { conceptById, mentor } from '../mentor'
import { codeLanguage } from '../engine/diff'
import { card, code, md, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { loadSim } from './sim'
import { runnable } from '../engine/runnable'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

export async function renderPractice(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button, Input } = k.E
  const quiz = await io.get(S.quiz)
  const knowledge = await io.get(S.knowledge)
  const mis = (await io.get(S.misconceptions)).filter(m => !m.resolved)
  const due = knowledge.filter(r => r.due).length

  const starters = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="q-focus" variant="primary" onPress={() => mentor.startQuiz(io, 'focus')}>
        Sprawdź, czy rozumiem
      </Button>
      <Button key="q-review" onPress={() => mentor.startQuiz(io, 'review')}>
        {`Powtórka${due ? ` (${due})` : ''}`}
      </Button>
      {mis.length > 0 && (
        <Button key="q-mis" onPress={() => mentor.startQuiz(io, 'misconception')}>
          {`Moje błędy (${mis.length})`}
        </Button>
      )}
    </Box>
  )

  if (!quiz) {
    return (
      <Box flexDirection="column">
        {starters}
        {card(k, 'subtle', <Text>Brak aktywnego ćwiczenia.</Text>, muted(k, 'Pytania dotyczą kodu, który naprawdę pojawił się w Twoim projekcie. Postęp zmienia się dopiero po ocenie odpowiedzi, nigdy za samo użycie czegoś przez Claude.'))}
      </Box>
    )
  }
  const q = quiz.question
  const c = conceptById(q.conceptId)
  const answered = quiz.status === 'graded'
  const verdictColor = quiz.revealed ? 'subtle' : quiz.verdict === 'correct' ? 'success' : quiz.verdict === 'partial' ? 'warning' : 'error'
  const verdictText = quiz.revealed ? 'Odpowiedź' : quiz.verdict === 'correct' ? 'Poprawnie' : quiz.verdict === 'partial' ? 'Częściowo poprawnie' : 'Niepoprawnie'
  const hints = quiz.hints ?? []
  const kindLabel = { predict: 'przewidź wynik', diagnose: 'znajdź błąd', explain: 'wyjaśnij mechanizm', apply: 'zastosuj', choice: 'wybór' }[q.kind]

  return (
    <Box flexDirection="column">
      {starters}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="claude">{`${c?.name ?? q.conceptId} · ${kindLabel}`}</Text>
        <Text dimColor>{q.source === 'model' ? 'Pytanie z AI, na Twoim kodzie' : q.source === 'sim' ? 'Pytanie z Twojego kodu, sprawdzone w symulatorze' : 'Pytanie z biblioteki Mentora'}</Text>
      </Box>
      {md(k, q.prompt)}
      {q.code && code(k, q.code, codeLanguage(q.codeLang === 'typescript' ? 'ts' : q.codeLang), q.codeStart, q.file)}
      {quiz.status === 'grading' && <Text color="suggestion">{quiz.feedback || 'Oceniam…'}</Text>}
      {q.options && !answered && (
        <Box flexDirection="column" marginTop={1}>
          {q.options.map((o, i) => (
            <Button key={`opt-${i}`} onPress={() => mentor.answer(io, i)}>
              {`${LETTERS[i]}. ${o}`}
            </Button>
          ))}
        </Box>
      )}
      {!q.options && !answered && quiz.status !== 'grading' && (
        <Input key={`ans-${q.id}`} label="Twoja odpowiedź:" placeholder="Wyjaśnij własnymi słowami, Enter wysyła" submitLabel="wyślij" value={quiz.answer} onSubmit={v => mentor.answer(io, v)} />
      )}
      {quiz.status === 'asking' && hints.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {hints.map((h, i) => md(k, `**Podpowiedź ${i + 1}:** ${h}`, `hint-${i}`))}
        </Box>
      )}
      {quiz.status === 'asking' && (
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Button key="q-hint" plain dimColor onPress={() => mentor.quizHint(io)}>
            {hints.length ? 'Kolejna podpowiedź' : 'Podpowiedź'}
          </Button>
          <Button key="q-reveal" plain dimColor onPress={() => mentor.quizReveal(io)}>
            Pokaż odpowiedź
          </Button>
        </Box>
      )}
      {quiz.status === 'pending' &&
        card(
          k,
          'warning',
          <Text color="warning">{quiz.feedback}</Text>,
          <Button key="q-retry" onPress={() => mentor.retryGrade(io)}>
            Oceń ponownie
          </Button>,
        )}
      {quiz.status === 'asking' && quiz.feedback && <Text color="warning">{quiz.feedback}</Text>}
      {answered &&
        card(
          k,
          verdictColor,
          <Text bold color={verdictColor}>{verdictText}</Text>,
          quiz.answer.length > 0 && q.options ? muted(k, `Twoja odpowiedź: ${quiz.answer}`) : null,
          md(k, quiz.feedback),
          quiz.misconceptions.length > 0 && <Text color="warning">{`Wykryte nieporozumienie: ${quiz.misconceptions.join('; ')}`}</Text>,
          quiz.otherExample.length > 0 && section(k, 'To samo na innym przykładzie', md(k, quiz.otherExample)),
          quiz.followUp.length > 0 && section(k, 'Zadanie utrwalające (zrób samodzielnie)', md(k, quiz.followUp)),
          quiz.levelChange !== null && <Text color="success">{`Poziom: ${quiz.levelChange}`}</Text>,
          quiz.revealed && muted(k, 'Odsłonięta odpowiedź nie zmienia Twojego poziomu. Spróbuj kolejnego pytania.'),
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            <Button key="q-next" variant="primary" onPress={() => mentor.startQuiz(io, 'concept', q.conceptId)}>
              Kolejne pytanie
            </Button>
            {q.code && (q.codeLang === 'typescript' || q.codeLang === 'javascript') && runnable(q.code, 'js') && (
              <Button key="q-sim" onPress={() => loadSim(io, q.code!, 'kod z ćwiczenia')}>
                Sprawdź w Symulatorze
              </Button>
            )}
          </Box>,
        )}
    </Box>
  )
}
