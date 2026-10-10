import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorSettings } from '../../types'
import { mentor } from '../mentor'
import { COST_PROFILES, MODEL_LABELS } from '../engine/budget'
import { card, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'
import { tr } from '../i18n'

export async function renderSettings(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Text, Button, Select, Input } = k.E
  const s = await io.get(S.settings)
  const usage = await io.get(S.usage)
  const boot = await io.get(S.boot)
  const view = await io.get(S.view)
  const set = (patch: Partial<MentorSettings>) => () => mentor.setSettings(io, patch)
  const toggle = (key: keyof MentorSettings, label: string, hint: string) => (
    <Box key={`t-${key}`} flexDirection="column">
      <Button key={`tg-${key}`} variant={s[key] ? 'primary' : undefined} onPress={set({ [key]: !s[key] } as Partial<MentorSettings>)}>
        {`${label}: ${s[key] ? tr('WŁ.', 'ON') : tr('WYŁ.', 'OFF')}`}
      </Button>
      <Text dimColor wrap="wrap">{hint}</Text>
    </Box>
  )
  const adv = view.openSections.includes('settings-adv')
  const pick = <K extends keyof MentorSettings>(key: K, label: string, options: { value: string; label: string }[]) => (
    <Select key={`s-${String(key)}`} label={label} value={String(s[key])} options={options} onSelect={v => mentor.setSettings(io, { [key]: v } as Partial<MentorSettings>)} />
  )

  return (
    <Box flexDirection="column">
      {view.notice &&
        card(
          k,
          'suggestion',
          ...view.notice.split('\n').map(l => <Text wrap="wrap">{l}</Text>),
          <Button key="n-close" role="dismiss" onPress={() => io.set(S.view, v => ({ ...v, notice: null }))}>
            {tr('Zamknij', 'Close')}
          </Button>,
        )}
      {section(
        k,
        tr('Najważniejsze', 'Essentials'),
        pick('language', 'Język / Language:', [
          { value: 'pl', label: 'polski' },
          { value: 'en', label: 'English (lekcje AI po angielsku, biblioteka wbudowana po polsku)' },
        ]),
        toggle('autoTeach', tr('Automatyczne nauczanie', 'Automatic teaching'), tr('Lekcje po istotnych zmianach w kodzie. Wyłączone: tylko na żądanie.', 'Lessons after meaningful code changes. Off: on demand only.')),
        toggle('contextBar', tr('Pasek kontekstu', 'Context bar'), tr('Kolorowy pasek okna kontekstu nad promptem: kategorie, procent i licznik cache promptu. Także /mentor pasek.', 'A colored context-window bar above the prompt: categories, percent and the prompt-cache countdown. Also /mentor pasek.')),
        pick('cost', tr('Koszty AI:', 'AI costs:'), (Object.keys(COST_PROFILES) as (keyof typeof COST_PROFILES)[]).map(key => ({ value: key, label: COST_PROFILES[key].label }))),
        <Text dimColor>{tr(`Dziś: automatyczne ${usage.autoCalls}/${usage.limitCalls}, ręczne ${usage.manualCalls}`, `Today: automatic ${usage.autoCalls}/${usage.limitCalls}, manual ${usage.manualCalls}`)}</Text>,
      )}
      <Box marginTop={1}>
        <Button key="set-adv" plain dimColor={!adv} onPress={() => io.set(S.view, v => ({ ...v, openSections: adv ? v.openSections.filter(x => x !== 'settings-adv') : [...v.openSections, 'settings-adv'] }))}>
          {`${adv ? '▾' : '▸'}  ${tr('Zaawansowane', 'Advanced')}`}
        </Button>
      </Box>
      {adv && section(
        k,
        tr('Nauka', 'Learning'),
        toggle('paused', tr('Pauza', 'Pause'), tr('Wstrzymuje obserwację i lekcje (także /mentor pause).', 'Stops observing and lessons (also /mentor pause).')),
        toggle('autoQuiz', tr('Automatyczne quizy', 'Automatic quizzes'), tr('Po lekcji przygotowuje pytanie w zakładce Ćwiczenia (bez kosztu: pytania deterministyczne).', 'After a lesson, prepares a question in the Practice tab (free: deterministic questions).')),
        pick('level', tr('Poziom:', 'Level:'), [
          { value: 'adaptive', label: tr('adaptacyjny (wg Twoich wyników)', 'adaptive (from your results)') },
          { value: 'beginner', label: tr('początkujący', 'beginner') },
          { value: 'intermediate', label: tr('średniozaawansowany', 'intermediate') },
          { value: 'advanced', label: tr('zaawansowany', 'advanced') },
        ]),
        pick('detail', tr('Szczegółowość:', 'Detail:'), [
          { value: 'short', label: tr('krótko', 'short') },
          { value: 'normal', label: tr('normalnie', 'normal') },
          { value: 'deep', label: tr('bardzo szczegółowo', 'in depth') },
        ]),
        pick('frequency', tr('Częstotliwość lekcji:', 'Lesson frequency:'), [
          { value: 'rare', label: tr('rzadko (co ≥ 20 min)', 'rarely (every ≥ 20 min)') },
          { value: 'normal', label: tr('normalnie (co ≥ 5 min)', 'normal (every ≥ 5 min)') },
          { value: 'often', label: tr('często (co ≥ 1 min)', 'often (every ≥ 1 min)') },
        ]),
      )}
      {adv && section(
        k,
        tr('Interfejs', 'Interface'),
        toggle('autoOpen', tr('Automatyczne otwieranie panelu', 'Open the panel automatically'), tr('Panel otwiera się na starcie sesji (bez przejmowania klawiatury).', 'The panel opens when a session starts (without taking the keyboard).')),
        toggle('band', tr('Temat nad promptem', 'Topic above the prompt'), tr('Dyskretna linia z bieżącym tematem nauki.', 'A quiet line with the current learning topic.')),
        pick('cacheTtl', tr('Czas życia cache promptu:', 'Prompt cache lifetime:'), [
          { value: '60', label: tr('60 minut (plany Claude)', '60 minutes (Claude plans)') },
          { value: '5', label: tr('5 minut (API)', '5 minutes (API)') },
        ]),
        toggle('focusMode', tr('Tryb skupienia', 'Focus mode'), tr('Bez powiadomień (toastów). Lekcje dalej powstają w panelu.', 'No notifications (toasts). Lessons still appear in the panel.')),
      )}
      {adv && section(
        k,
        'AI',
        pick('model', tr('Model lekcji:', 'Lesson model:'), (Object.keys(MODEL_LABELS) as (keyof typeof MODEL_LABELS)[]).map(key => ({ value: key, label: MODEL_LABELS[key] }))),
        <Text>{tr(`Dziś: automatyczne ${usage.autoCalls}/${usage.limitCalls}, ręczne ${usage.manualCalls}, tokeny ≈ ${usage.tokens.toLocaleString('pl-PL')}/${usage.limitTokens.toLocaleString('pl-PL')}`, `Today: automatic ${usage.autoCalls}/${usage.limitCalls}, manual ${usage.manualCalls}, tokens ≈ ${usage.tokens.toLocaleString('en-US')}/${usage.limitTokens.toLocaleString('en-US')}`)}</Text>,
        usage.breakerUntil > (await io.now()) && <Text color="warning">Model wstrzymany po serii błędów API do {new Date(usage.breakerUntil).toLocaleTimeString('pl-PL')}.</Text>,
        muted(k, tr('Każda lekcja AI to dodatkowe wywołanie modelu z Twojego konta Claude (te same limity co Claude Code). Nie startuje tury w rozmowie i nie zmienia kodu. Cache: identyczna zmiana nie jest wysyłana drugi raz.', 'Each AI lesson is an extra model call on your Claude account (same limits as Claude Code). It does not start a conversation turn and does not change code. Cache: an identical change is not sent twice.')),
        <Button key="m-test" onPress={() => mentor.data.testModel(io)}>
          Test modelu (1 krótkie wywołanie)
        </Button>,
      )}
      {adv && section(
        k,
        tr('Prywatność', 'Privacy'),
        pick('sendCode', tr('Kod w zapytaniach AI:', 'Code in AI requests:'), [
          { value: 'redacted', label: tr('fragment zmiany, z usuniętymi sekretami', 'the changed fragment, secrets removed') },
          { value: 'off', label: tr('nie wysyłaj kodu (lekcje ogólniejsze)', 'do not send code (more general lessons)') },
        ]),
        toggle('saveChanges', tr('Zapisuj kod zmian', 'Save change code'), tr('Zakładka Zmiany trzyma lokalnie kod przed i po każdej zmianie Claude: do 400 zmian na projekt, najwyżej 60 dni, bez sekretów. Wyłączone: tylko opis zmiany.', 'The Changes tab keeps the code before and after every Claude change locally: up to 400 changes per project, at most 60 days, no secrets. Off: only a description.')),
        muted(k, tr('Pliki .env, klucze, certyfikaty i podobne nie są nigdy analizowane. Tokeny, hasła, klucze API i JWT są zamieniane na [USUNIĘTO] zanim cokolwiek trafi do bazy lub modelu. Brak telemetrii i synchronizacji: dane są tylko na tym komputerze.', '.env files, keys, certificates and the like are never analysed. Tokens, passwords, API keys and JWTs are replaced with [USUNIĘTO] before anything reaches the database or a model. No telemetry and no sync: data stays on this computer.')),
      )}
      {adv && section(
        k,
        tr('Dane', 'Data'),
        <Text dimColor wrap="wrap">{`${tr('Baza', 'Database')}: ${boot.dataDir}\\mentor.db · ${tr('schemat', 'schema')} v${boot.schemaVersion} · ${tr('stan', 'state')}: ${boot.status}${boot.pending ? ` · ${tr('w buforze', 'buffered')} ${boot.pending}` : ''}`}</Text>,
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="d-export" onPress={() => mentor.data.exportData(io)}>
            {tr('Eksportuj (JSON)', 'Export (JSON)')}
          </Button>
          <Button key="d-backup" onPress={() => mentor.data.backup(io)}>
            {tr('Kopia zapasowa', 'Backup')}
          </Button>
          <Button key="d-diag" onPress={() => mentor.data.diagnose(io)}>
            {tr('Diagnostyka', 'Diagnostics')}
          </Button>
        </Box>,
        <Input key="d-import" label={tr('Import z pliku (ścieżka .json):', 'Import from file (.json path):')} placeholder="C:\\Users\\…\\mentor-export-….json" value={view.importPath} submitLabel={tr('scal', 'merge')} onSubmit={v => mentor.data.importData(io, v, 'merge')} />,
        <Text dimColor wrap="wrap">{tr('Czyszczenie: „Wyczyść historię” usuwa zmiany, obserwacje i lekcje z pracy Claude, a Twoja wiedza i odpowiedzi zostają. „Resetuj postęp” zeruje wiedzę i odpowiedzi, a historia zostaje. Przed każdym czyszczeniem powstaje kopia.', 'Cleanup: “Clear history” removes changes, observations and lessons from Claude’s work, your knowledge and answers stay. “Reset progress” zeroes knowledge and answers, history stays. A backup is made before every cleanup.')}</Text>,
        view.confirm === 'clear-history' || view.confirm === 'reset-progress'
          ? card(
              k,
              'warning',
              <Text color="warning" wrap="wrap">{view.confirm === 'clear-history' ? tr('Usunąć zmiany, obserwacje i lekcje? Wiedza, odpowiedzi i ustawienia zostają.', 'Remove changes, observations and lessons? Knowledge, answers and settings stay.') : tr('Wyzerować wiedzę, poziomy i odpowiedzi? Zmiany, lekcje i ustawienia zostają.', 'Reset knowledge, levels and answers? Changes, lessons and settings stay.')}</Text>,
              <Box flexDirection="row" columnGap={1}>
                <Button key="c-yes" onPress={async () => {
                  const part = view.confirm === 'clear-history' ? ('history' as const) : ('progress' as const)
                  await io.set(S.view, v => ({ ...v, confirm: null }))
                  await mentor.data.clearPart(io, part)
                }}>
                  {view.confirm === 'clear-history' ? tr('Tak, wyczyść historię', 'Yes, clear history') : tr('Tak, resetuj postęp', 'Yes, reset progress')}
                </Button>
                <Button key="c-no" variant="primary" onPress={() => io.set(S.view, v => ({ ...v, confirm: null }))}>
                  {tr('Anuluj', 'Cancel')}
                </Button>
              </Box>,
            )
          : (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Button key="d-clear-history" onPress={() => io.set(S.view, v => ({ ...v, confirm: 'clear-history' }))}>
                {tr('Wyczyść historię…', 'Clear history…')}
              </Button>
              <Button key="d-reset-progress" onPress={() => io.set(S.view, v => ({ ...v, confirm: 'reset-progress' }))}>
                {tr('Resetuj postęp…', 'Reset progress…')}
              </Button>
            </Box>
          ),
        view.confirm === 'wipe'
          ? card(
              k,
              'error',
              <Text color="error">{tr('Na pewno usunąć całą historię nauki, wiedzę, lekcje i ustawienia? Przed usunięciem powstanie jedna kopia bezpieczeństwa.', 'Really delete all learning history, knowledge, lessons and settings? One safety backup is made first.')}</Text>,
              <Box flexDirection="row" columnGap={1}>
                <Button key="w-yes" onPress={async () => {
                  await io.set(S.view, v => ({ ...v, confirm: null }))
                  await mentor.data.wipe(io)
                }}>
                  {tr('Tak, usuń trwale', 'Yes, delete permanently')}
                </Button>
                <Button key="w-no" variant="primary" onPress={() => io.set(S.view, v => ({ ...v, confirm: null }))}>
                  {tr('Anuluj', 'Cancel')}
                </Button>
              </Box>,
            )
          : (
            <Button key="d-wipe" onPress={() => io.set(S.view, v => ({ ...v, confirm: 'wipe' }))}>
              {tr('Usuń wszystkie dane…', 'Delete all data…')}
            </Button>
          ),
      )}
    </Box>
  )
}
