# Testy

## Automatyczne

```powershell
claude plugin validate .
claude plugin test plugins\claude-code-mentor
node --no-warnings --test "plugins/claude-code-mentor/helper/test/*.test.mjs"
```

| Zestaw | Wynik |
|---|---|
| Testy pluginu (symulator, silnik, prywatność, UI desktop i terminal, hooki) | 26 / 26 |
| Helper bazy (migracje, model opanowania, współbieżność 8 procesów, eksport i import) | 15 / 15 |
| Piaskownica SQL | 5 / 5 |
| Walidacja marketplace i obu pluginów | ✔ |

## Status testów akceptacyjnych

| Test | Status | Jak sprawdzone |
|---|---|---|
| A. Ładowanie w lokalnej sesji Code | PASS | plugin w `claude plugin list` (user scope), panel otwarty w Claude Desktop |
| B. Panel i przyciski | PASS | test UI na desktop i terminal oraz ręcznie w Claude Desktop |
| C. Rozpoznanie prawdziwej zmiany | PASS | obserwacje edycji, testów i buildu z wykrytymi pojęciami w żywej sesji |
| D. Jakość lekcji | PASS | test: odniesienie do pliku i linii, mechanizm, uzasadnienie. Lekcje AI wygenerowane w żywej sesji |
| E. Quiz aktualizuje postęp dopiero po ocenie | PASS | test: ocena deterministyczna, wykryte błędne przekonanie, brak zmiany bez oceny |
| F. Nowy projekt bez ponownej instalacji | PASS | user scope, baza rejestruje sesje z wielu projektów |
| G. Restart aplikacji | ręczny | procedura niżej |
| H. Równoległe sesje | PASS | 8 procesów równolegle, 200/200 zapisów, integralność `ok` |
| I. Zmiana konta Claude | ręczny | procedura niżej |
| J. Brak ingerencji w narzędzia | PASS | test: wynik narzędzia i odpowiedź Claude przechodzą bez zmian. Git tylko do odczytu |
| K. Limity kosztów | PASS | atomowa rezerwacja budżetu w bazie, profil „wyłączone” = 0 wywołań |
| L. Ochrona danych wrażliwych | PASS | test: klucze, tokeny, hasła, JWT, klucze prywatne usuwane. Pliki `.env` pomijane |
| P0-1. `<` na `>` zmienia gałąź | PASS | test symulatora i panelu |
| P0-2. Przypadki brzegowe i równość wg języka | PASS | JS, Python 3, PHP 8 |
| P0-3. Co najmniej 5 kroków pętli | PASS | 6 sprawdzeń warunku, 5 kroków licznika |
| P0-4. Wywołanie funkcji, argumenty, wynik | PASS | ramka stosu z argumentami i zwrócona wartość |
| P0-5. Symulacja nie zmienia pliku | PASS | warianty powstają w pamięci, oryginał nietknięty |
| P0-6. Quiz zapisuje konkretny błąd | PASS | `off-by-one` zapisany jako błędne przekonanie |
| P0-9. Wyjaśnienia tylko w panelu | PASS | brak `prompt.submit`, `session.append`, `prompt.context` |
| P0-10. Hipotezy oznaczone | PASS | `fetch`, `Math.random`, `Date.now` jako założenia |

## Ręczne

### G. Restart aplikacji

1. W panelu: Ustawienia, zmień „Szczegółowość” na „bardzo szczegółowo”.
2. Zamknij Claude Desktop całkowicie (także z zasobnika systemowego) i uruchom ponownie.
3. Otwórz nową sesję Code.
4. Oczekiwane: panel otwiera się sam, „Moja wiedza” pokazuje te same pojęcia i poziomy, ustawienie zostało.

### I. Zmiana konta Claude

1. `pwsh -File scripts\diagnose.ps1` i zanotuj liczby wierszy (`knowledge`, `lessons`, `exercises`).
2. Wyloguj się z Claude Desktop i zaloguj na drugie konto.
3. Otwórz nową sesję Code w dowolnym projekcie.
4. Oczekiwane: panel działa, wiedza i ustawienia są te same, `diagnose.ps1` pokazuje te same liczby.
5. Wróć na pierwsze konto i powtórz punkt 4.

Baza leży w `%LOCALAPPDATA%\ClaudeCodeMentor`, a instalacja pluginu w `~/.claude/settings.json`. Żadne z nich nie jest przypisane do konta Anthropic.
