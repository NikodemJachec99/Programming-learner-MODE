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
   claude plugin install claude-code-mentor@programming-learner-mode --scope user
   ```

3. Po każdej zmianie w kodzie:

   ```bash
   node scripts/update-local.mjs
   ```

   i w otwartej sesji `/reload-plugins`. Skrypt wgrywa kod do cache Claude Code, więc nie trzeba otwierać nowej sesji.

Szybsza droga do jednorazowej próby: `claude --plugin-dir plugins/claude-code-mentor`.

## Gdzie co jest

| Katalog | Co tam jest |
|---|---|
| `plugins/claude-code-mentor/hooks/register.tsx` | podpięcie pod zdarzenia Claude Code (narzędzia, prompt, panele, pasek nad promptem) |
| `plugins/claude-code-mentor/hooks/mentor.ts` | logika Mentora: obserwacja zmian, lekcje, quizy, pliki, harmonogram animacji |
| `plugins/claude-code-mentor/hooks/engine/` | czyste funkcje bez I/O: diff, wykrywanie pojęć, agenci, zadania w tle, pliki i git |
| `plugins/claude-code-mentor/hooks/ui/` | widoki: Zmiany, Edycje po kolei, Pliki, Agenci, Zadania w tle, Symulator, pasek |
| `plugins/claude-code-mentor/hooks/sim/` | symulator JS/TS i Darta |
| `plugins/claude-code-mentor/hooks/content/` | pojęcia, lekcje wbudowane, Flutter |
| `plugins/claude-code-mentor/helper/` | baza SQLite (osobny proces Node) |
| `plugins/claude-code-mentor/tests/` | testy pluginu |

## Testy

Przed wysłaniem PR wszystko ma przechodzić:

```bash
claude plugin validate .
claude plugin validate plugins/claude-code-mentor
claude plugin test plugins/claude-code-mentor
node --no-warnings --test "plugins/claude-code-mentor/helper/test/*.test.mjs"
```

To samo odpala CI na każdym PR (Windows, macOS i Linux). Nowa funkcja albo poprawka błędu dostaje test. Zmiana wyglądu: dorzuć do PR zrzut ekranu z jasnego i ciemnego motywu.

## Zasady

- Jeden PR to jedna sprawa. Łatwiej przejrzeć, łatwiej cofnąć.
- Teksty w interfejsie i lekcjach po polsku. Kod i nazwy w kodzie mogą być po angielsku, komentarze po polsku, jak w reszcie projektu.
- Hooki niczego nie blokują i nie zmieniają: wynik narzędzia i odpowiedź Claude przechodzą bez zmian. Błąd w Mentorze nie może przeszkodzić w pracy.
- Dane zostają lokalnie. Bez telemetrii, bez wysyłania kodu na zewnątrz poza tym, co użytkownik włączy w ustawieniach.
- Żadnych sekretów, osobistych ścieżek ani danych z prywatnych projektów w kodzie, testach i zrzutach.
- Kopiujesz kod albo grafiki z innego projektu? Tylko na zgodnej licencji i z wpisem w `plugins/claude-code-mentor/THIRD_PARTY_NOTICES.md`.
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

Setup: fork, clone, then `claude plugin marketplace add ./` and `claude plugin install claude-code-mentor@programming-learner-mode --scope user`. After each change run `node scripts/update-local.mjs` and `/reload-plugins` in the open session.

Before opening a PR, run `claude plugin validate .`, `claude plugin test plugins/claude-code-mentor` and `node --no-warnings --test "plugins/claude-code-mentor/helper/test/*.test.mjs"`. Keep one topic per PR, add tests, attach light and dark screenshots for visual changes. The UI and lessons are in Polish. Hooks must never block or alter tool results, data stays local, no secrets or personal paths. Third-party code or graphics only under a compatible license, listed in `THIRD_PARTY_NOTICES.md`. Contributions are MIT licensed.
