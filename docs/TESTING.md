# Testy

## Automatyczne

```bash
claude plugin validate .
claude plugin test plugins/claude-code-mentor
node --no-warnings --test "plugins/claude-code-mentor/helper/test/*.test.mjs"
```

| Zestaw | Wynik |
|---|---|
| Testy pluginu (Change Lab, test poziomu, symulator JS i Darta, Flutter, silnik, prywatność, UI desktop i terminal, hooki) | 69 / 69 |
| Helper bazy (migracje v1 → v2, model opanowania, współbieżność 8 procesów, eksport i import, historia zmian) | 18 / 18 |
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
| Change Lab: przed i po z narzędzia | PASS | test: edycja, nowy plik („przed” = brak), nieudana edycja i plik wrażliwy bez kodu, patch niezgodny z plikiem nie jest zgadywany |
| Change Lab: symulacja przed i po | PASS | test: `x < 10` → `x <= 10`, dla `label(10)` A wypisuje „dużo”, B „mało”, warunek false/true |
| Change Lab: inne podejście | PASS | test: prośba trafia do pola wiadomości dopiero po potwierdzeniu, nic nie jest wysyłane samo. Odpowiedzi modelu w teście nie było (wymaga konta) |
| Podpowiedzi i odsłonięcie | PASS | test: podpowiedzi nie wskazują poprawnej odpowiedzi ani nowego kodu, odsłonięcie bez zmiany poziomu, odpowiedź po podpowiedzi = częściowa, „Zgadnij zmianę” w panelu |
| Change Lab: panel | PASS | test UI na desktop i terminal: lista, otwarcie jednym kliknięciem, Przed/Po, przejście do symulatora |
| Wyjaśnienie na miejscu | PASS | test: „Wyjaśnij” pokazuje lekcję pod kodem zmiany bez zmiany zakładki, drugie kliknięcie ją chowa |
| Sprawdź się ze zmiany | PASS | test: pytanie o wynik po zmianie, poprawna odpowiedź policzona z pary przed/po. Bez kodu przed pytania nie ma. Dla Pythona zgadywanie zmiany |
| Rozpoznawanie przeróbek | PASS | test: `Promise.all`, `map`, `.then` → `await`, `try`, `null`, `var`, Dart `Future.wait`. Zmiana operatora nie jest opisywana jako przeróbka |
| Test poziomu | PASS | test: 6/6 poprawnych odpowiedzi zgodnych z tym, co wypisuje symulator. Panel: start, 6 odpowiedzi, wynik 5/6, karta znika |
| Sekrety w opisie zmiany | PASS | test: klucz API i hasło zmienione w literale nie trafiają do opisu zmiany, listy ani obserwacji, z zapisem kodu i bez. Kontrola: bez poprawki test pada |
| Uczciwe porównanie A i B | PASS | test: gdy A i B nie mają wspólnej funkcji albo wpisane wywołanie nie istnieje w obu, porównania nie ma, jest komunikat |
| Laboratorium | PASS | test: A/B/C/D na 2 przypadkach, 6/6/7 i „brak `sum`” dla wersji z inną nazwą, oznaczenie różnych wyników, edycja linii, limit 4 wersji, prośba „Sprawdź w projekcie” z przewidywaniem i kodem kopii. Panel: otwarcie w Zmianach, dodanie przypadku, kopia, przejście do kroków. Dart sprawdzony ręcznie: `label(10)` dużo/mało, `async` |
| Pytania bez założeń | PASS | test: pytanie ze zmiany nie powstaje, gdy wynik zależy od zaślepki albo `Math.random` |
| Ustawienia i Moja wiedza | PASS | test: na wierzchu 3 ustawienia, reszta po „Zaawansowane”. Bez danych brak pustych filtrów poziomów |
| Aktualizacja bazy v1 → v2 | PASS | test: dane z v1 bez zmian po migracji, kopia przed migracją |
| Flutter i Dart | PASS | test: wynik symulatora Darta zgodny z Dartem (`~/`, `%`, null safety, Future), drzewo widgetów, pojęcia Fluttera w kodzie ekranu, komendy `flutter` |
| macOS | częściowo | CI: helper i baza na macos-latest, składnia skryptów `.sh`. Instalacji w Claude Desktop na Macu nie sprawdzałem ręcznie |

## Ręczne

### G. Restart aplikacji

1. W panelu: Ustawienia, zmień „Szczegółowość” na „bardzo szczegółowo”.
2. Zamknij Claude Desktop całkowicie (także z zasobnika systemowego) i uruchom ponownie.
3. Otwórz nową sesję Code.
4. Oczekiwane: panel otwiera się sam, „Moja wiedza” pokazuje te same pojęcia i poziomy, ustawienie zostało.

### I. Zmiana konta Claude

1. `pwsh -File scripts\diagnose.ps1` (macOS: `bash scripts/diagnose.sh`) i zanotuj liczby wierszy (`knowledge`, `lessons`, `exercises`).
2. Wyloguj się z Claude Desktop i zaloguj na drugie konto.
3. Otwórz nową sesję Code w dowolnym projekcie.
4. Oczekiwane: panel działa, wiedza i ustawienia są te same, `diagnose.ps1` pokazuje te same liczby.
5. Wróć na pierwsze konto i powtórz punkt 4.

Baza leży w `%LOCALAPPDATA%\ClaudeCodeMentor` (macOS: `~/Library/Application Support/ClaudeCodeMentor`), a instalacja pluginu w `~/.claude/settings.json`. Żadne z nich nie jest przypisane do konta Anthropic.
