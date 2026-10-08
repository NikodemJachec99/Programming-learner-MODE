import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorSettings } from '../../types'
import { mentor } from '../mentor'
import { COST_PROFILES, MODEL_LABELS } from '../engine/budget'
import { card, muted, section } from './kit'
import type { Kit } from './kit'
import { S } from './state'

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
        {`${label}: ${s[key] ? 'WŁ.' : 'WYŁ.'}`}
      </Button>
      <Text dimColor wrap="wrap">{hint}</Text>
    </Box>
  )
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
            Zamknij
          </Button>,
        )}
      {section(
        k,
        'Nauka',
        toggle('autoTeach', 'Automatyczne nauczanie', 'Lekcje po istotnych zmianach w kodzie. Wyłączone: tylko na żądanie.'),
        toggle('paused', 'Pauza', 'Wstrzymuje obserwację i lekcje (także /mentor pause).'),
        toggle('autoQuiz', 'Automatyczne quizy', 'Po lekcji przygotowuje pytanie w zakładce Ćwiczenia (bez kosztu: pytania deterministyczne).'),
        pick('level', 'Poziom:', [
          { value: 'adaptive', label: 'adaptacyjny (wg Twoich wyników)' },
          { value: 'beginner', label: 'początkujący' },
          { value: 'intermediate', label: 'średniozaawansowany' },
          { value: 'advanced', label: 'zaawansowany' },
        ]),
        pick('detail', 'Szczegółowość:', [
          { value: 'short', label: 'krótko' },
          { value: 'normal', label: 'normalnie' },
          { value: 'deep', label: 'bardzo szczegółowo' },
        ]),
        pick('frequency', 'Częstotliwość lekcji:', [
          { value: 'rare', label: 'rzadko (co ≥ 20 min)' },
          { value: 'normal', label: 'normalnie (co ≥ 5 min)' },
          { value: 'often', label: 'często (co ≥ 1 min)' },
        ]),
      )}
      {section(
        k,
        'Interfejs',
        toggle('autoOpen', 'Automatyczne otwieranie panelu', 'Panel otwiera się na starcie sesji (bez przejmowania klawiatury).'),
        toggle('band', 'Pasek nad promptem', 'Dyskretna linia z bieżącym tematem.'),
        toggle('focusMode', 'Tryb skupienia', 'Bez powiadomień (toastów). Lekcje dalej powstają w panelu.'),
      )}
      {section(
        k,
        'AI i koszty',
        pick('cost', 'Profil kosztów:', (Object.keys(COST_PROFILES) as (keyof typeof COST_PROFILES)[]).map(key => ({ value: key, label: COST_PROFILES[key].label }))),
        pick('model', 'Model lekcji:', (Object.keys(MODEL_LABELS) as (keyof typeof MODEL_LABELS)[]).map(key => ({ value: key, label: MODEL_LABELS[key] }))),
        <Text>{`Dziś: automatyczne ${usage.autoCalls}/${usage.limitCalls}, ręczne ${usage.manualCalls}, tokeny ≈ ${usage.tokens.toLocaleString('pl-PL')}/${usage.limitTokens.toLocaleString('pl-PL')}`}</Text>,
        usage.breakerUntil > (await io.now()) && <Text color="warning">Model wstrzymany po serii błędów API do {new Date(usage.breakerUntil).toLocaleTimeString('pl-PL')}.</Text>,
        muted(k, 'Każda lekcja AI to dodatkowe wywołanie modelu z Twojego konta Claude (te same limity co Claude Code). Nie startuje tury w rozmowie i nie zmienia kodu. Cache: identyczna zmiana nie jest wysyłana drugi raz.'),
        <Button key="m-test" onPress={() => mentor.testModel(io)}>
          Test modelu (1 krótkie wywołanie)
        </Button>,
      )}
      {section(
        k,
        'Prywatność',
        pick('sendCode', 'Kod w zapytaniach AI:', [
          { value: 'redacted', label: 'fragment zmiany, z usuniętymi sekretami' },
          { value: 'off', label: 'nie wysyłaj kodu (lekcje ogólniejsze)' },
        ]),
        muted(k, 'Pliki .env, klucze, certyfikaty i podobne nie są nigdy analizowane. Tokeny, hasła, klucze API i JWT są zamieniane na [USUNIĘTO] zanim cokolwiek trafi do bazy lub modelu. Brak telemetrii i synchronizacji: dane są tylko na tym komputerze.'),
      )}
      {section(
        k,
        'Dane',
        <Text dimColor wrap="wrap">{`Baza: ${boot.dataDir}\\mentor.db · schemat v${boot.schemaVersion} · stan: ${boot.status}${boot.pending ? ` · w buforze ${boot.pending}` : ''}`}</Text>,
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="d-export" onPress={() => mentor.exportData(io)}>
            Eksportuj (JSON)
          </Button>
          <Button key="d-backup" onPress={() => mentor.backup(io)}>
            Kopia zapasowa
          </Button>
          <Button key="d-diag" onPress={() => mentor.diagnose(io)}>
            Diagnostyka
          </Button>
        </Box>,
        <Input key="d-import" label="Import z pliku (ścieżka .json):" placeholder="C:\\Users\\…\\mentor-export-….json" value={view.importPath} submitLabel="scal" onSubmit={v => mentor.importData(io, v, 'merge')} />,
        view.confirm === 'wipe'
          ? card(
              k,
              'error',
              <Text color="error">Na pewno usunąć całą historię nauki, wiedzę, lekcje i ustawienia? Przed usunięciem powstanie jedna kopia bezpieczeństwa.</Text>,
              <Box flexDirection="row" columnGap={1}>
                <Button key="w-yes" onPress={async () => {
                  await io.set(S.view, v => ({ ...v, confirm: null }))
                  await mentor.wipe(io)
                }}>
                  Tak, usuń trwale
                </Button>
                <Button key="w-no" variant="primary" onPress={() => io.set(S.view, v => ({ ...v, confirm: null }))}>
                  Anuluj
                </Button>
              </Box>,
            )
          : (
            <Button key="d-wipe" onPress={() => io.set(S.view, v => ({ ...v, confirm: 'wipe' }))}>
              Usuń wszystkie dane…
            </Button>
          ),
      )}
    </Box>
  )
}
