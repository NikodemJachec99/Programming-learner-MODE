# Jak pomóc w rozwoju

Każdy może zgłosić błąd, zaproponować pomysł albo wysłać pull request. Zmiany do `main` wchodzą tylko przez PR, a PR-y przegląda i merguje [@NikodemJachec99](https://github.com/NikodemJachec99).

*English below.*

## Zanim zaczniesz

- Mały fix (literówka, oczywisty błąd): od razu PR.
- Większa zmiana (nowy widok, nowa funkcja, zmiana bazy): najpierw issue z krótkim opisem, żeby nie robić czegoś, co i tak nie wejdzie.
- Szukasz czegoś na start? Issues z etykietą `good first issue`.

## Ustawienie środowiska

Wymagania: Node 22.5+ (zalecany 24), Claude Code z obsługą modów (Claude Desktop, zakładka Code, albo CLI).

1. Zrób fork repozytorium i sklonuj swój fork.
2. Zainstaluj Mentora z lokalnego klonu, żeby Claude Code ładował Twój kod:

   ```bash
   claude plugin marketplace add ./
   claude plugin install code-mentor@programming-learner-mode --scope user
   ```

3. Po każdej zmianie w kodzie:

   ```bash
   node scripts/update-local.mjs
   ```

   i w otwartej sesji `/reload-plugins`. Skrypt wgrywa kod do cache Claude Code, więc nie trzeba otwierać nowej sesji.

Szybsza droga do jednorazowej próby: `claude --plugin-dir plugins/code-mentor`.

## Gdzie co jest

| Katalog | Co tam jest |
|---|---|
| `plugins/code-mentor/hooks/register.tsx` | podpięcie pod zdarzenia Claude Code (narzędzia, prompt, panele, pasek nad promptem) |
| `plugins/code-mentor/hooks/mentor.ts` | logika Mentora: obserwacja zmian, kolejka lekcji, koniec tury, podsumowanie |
| `plugins/code-mentor/hooks/core/` | części Mentora wydzielone z `mentor.ts`: pliki (`files.ts`), harmonogram animacji (`anim.ts`), quizy (`quiz.ts`), eksport i czyszczenie danych (`data.ts`) |
| `plugins/code-mentor/hooks/i18n.ts` | język interfejsu: `tr('pl', 'en')`, `plural` |
| `plugins/code-mentor/hooks/engine/` | czyste funkcje bez I/O: diff, wykrywanie pojęć, agenci, zadania w tle, pliki i git |
| `plugins/code-mentor/hooks/ui/` | widoki: Zmiany, Edycje po kolei, Pliki, Agenci, Zadania w tle, Symulator, pasek |
| `plugins/code-mentor/hooks/sim/` | symulator JS/TS i Darta |
| `plugins/code-mentor/hooks/content/` | pojęcia, lekcje wbudowane, Flutter |
| `plugins/code-mentor/helper/` | baza SQLite (osobny proces Node) |
| `plugins/code-mentor/tests/` | testy pluginu |

## Teksty w interfejsie

Interfejs jest po polsku i po angielsku. Każdy nowy tekst widoczny dla użytkownika idzie przez `tr('tekst po polsku', 'English text')` z `hooks/i18n.ts`, a liczebniki przez `plural(n, ['plik', 'pliki', 'plików'], ['file', 'files'])`. Etykiety w stałych mapach zrób jako gettery, żeby czytały bieżący język. Lekcje wbudowane i pojęcia zostają po polsku.

## Testy

Przed wysłaniem PR wszystko ma przechodzić:

```bash
claude plugin validate .
claude plugin validate plugins/code-mentor
claude plugin test plugins/code-mentor
node --no-warnings --test "plugins/code-mentor/helper/test/*.test.mjs"
```

To samo odpala CI na każdym PR (Windows, macOS i Linux), na przypiętej wersji Claude Code i dodatkowo na `@latest`. Nowa funkcja albo poprawka błędu dostaje test. Zmiana wyglądu: dorzuć do PR zrzut ekranu z jasnego i ciemnego motywu.

## Zasady

- Jeden PR to jedna sprawa. Łatwiej przejrzeć, łatwiej cofnąć.
- Teksty w interfejsie i lekcjach po polsku. Kod i nazwy w kodzie mogą być po angielsku, komentarze po polsku, jak w reszcie projektu.
- Hooki niczego nie blokują i nie zmieniają: wynik narzędzia i odpowiedź Claude przechodzą bez zmian. Błąd w Mentorze nie może przeszkodzić w pracy.
- Dane zostają lokalnie. Bez telemetrii, bez wysyłania kodu na zewnątrz poza tym, co użytkownik włączy w ustawieniach.
- Żadnych sekretów, osobistych ścieżek ani danych z prywatnych projektów w kodzie, testach i zrzutach.
- Kopiujesz kod albo grafiki z innego projektu? Tylko na zgodnej licencji i z wpisem w `plugins/code-mentor/THIRD_PARTY_NOTICES.md`.
- Animacje: przez jeden harmonogram w `mentor.ts`, z `prefers-reduced-motion` w SVG. Bez nowych timerów.
- Przyciski nie mogą czekać dłużej niż chwilę (silnik przerywa je po 10 s). Dłuższa praca idzie w tle.

## Pull request

- Opisz krótko, co zmieniasz i po co, i jak to sprawdziłeś.
- Wersję w `plugin.json` i wpis w `CHANGELOG.md` dodaje maintainer przy wydaniu, nie trzeba tego robić w PR.
- PR-y są mergowane jako jeden commit (squash).

Wysyłając PR, zgadzasz się, że Twój wkład jest na licencji MIT, tak jak cały projekt.

---

## In English

Bug reports, ideas and pull requests are welcome. Everything lands in `main` through a PR reviewed and merged by [@NikodemJachec99](https://github.com/NikodemJachec99). For anything bigger than a small fix, open an issue first.

Setup: fork, clone, then `claude plugin marketplace add ./` and `claude plugin install code-mentor@programming-learner-mode --scope user`. After each change run `node scripts/update-local.mjs` and `/reload-plugins` in the open session.

Before opening a PR, run `claude plugin validate .`, `claude plugin test plugins/code-mentor` and `node --no-warnings --test "plugins/code-mentor/helper/test/*.test.mjs"`. Keep one topic per PR, add tests, attach light and dark screenshots for visual changes. The UI and lessons are in Polish. Hooks must never block or alter tool results, data stays local, no secrets or personal paths. Third-party code or graphics only under a compatible license, listed in `THIRD_PARTY_NOTICES.md`. Contributions are MIT licensed.
