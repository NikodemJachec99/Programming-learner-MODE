# mentor-db: lokalny helper persystencji

Jedyny trwały magazyn postępów nauki w Claude Code Mentor. Czysty ESM, zero zależności npm, wbudowany `node:sqlite` (Node 24, SQLite 3.51).

```
node --no-warnings <plugin>/helper/mentor-db.mjs  < request.json
```

Jeden krótki proces na batch. Kilka sesji Claude Code może go odpalać równolegle.

## Protokół

stdin:

```json
{ "v": 1, "dataDir": "opcjonalnie", "ops": [ { "op": "init" }, { "op": "recordEvidence", "args": { } } ] }
```

stdout, zawsze dokładnie jedna linia JSON:

```json
{ "ok": true, "schemaVersion": 1, "results": [ { "ok": true, "value": {} }, { "ok": false, "error": "..." } ] }
```

Błąd krytyczny (zły JSON, zła wersja protokołu, nie da się otworzyć bazy): `{ "ok": false, "error": "..." }` i exit code 1. Błąd pojedynczej operacji nie przerywa batcha, trafia do jej `results[i]`.

`dataDir` domyślnie `%LOCALAPPDATA%\ClaudeCodeMentor` (fallback `~/AppData/Local/ClaudeCodeMentor`). Baza: `<dataDir>\mentor.db`, kopie: `<dataDir>\backups\`, eksporty: `<dataDir>\exports\`.

## Pliki

| plik | co robi |
|---|---|
| `mentor-db.mjs` | CLI: stdin, batch, jedna linia na stdout |
| `db.mjs` | otwarcie, pragmy (WAL, synchronous=NORMAL, foreign_keys, busy_timeout=10000), migracje przez `PRAGMA user_version`, `VACUUM INTO` |
| `ops.mjs` | operacje, `executeBatch()` |
| `mastery.mjs` | czysty model opanowania i powtórek (bez I/O) |
| `test/helper.test.mjs` | testy `node:test` |

## Bezpieczeństwo danych

Każda operacja zapisu to osobne `BEGIN IMMEDIATE … COMMIT`, przy błędzie `ROLLBACK`. `SQLITE_BUSY` jest ponawiane do 5 razy (backoff 25 do 400 ms) ponad `busy_timeout`. Migracje idą w `BEGIN EXCLUSIVE` z ponownym odczytem `user_version` po złapaniu blokady. Przed migracją istniejącej bazy powstaje `backups\pre-migration-v<N>-<czas>.db`. Baza nowsza niż helper jest odrzucana bez dotykania. Tabele są `STRICT`, kolumny JSON mają `CHECK(json_valid(...))`. Kopie i eksporty zapisuje się do pliku `.tmp` i robi rename, więc nie zostają pół-pliki.

## Operacje

| op | args | wynik |
|---|---|---|
| `init` | | `{schemaVersion, dbPath, sqliteVersion}` |
| `bootstrap` | `project{id,root,name,remote?}`, `session{id,surface?}`, `concepts[]`, `now`, `day?` | ustawienia, projekt, cała wiedza, otwarte misconceptions (top 30), 20 ostatnich lekcji projektu, `dueCount`, `usageToday`, `stats`, `conceptsUpdated` |
| `getSettings` / `setSettings` | `patch` (wartość `null` usuwa klucz) | obiekt ustawień |
| `addObservations` | `items[]` (snake_case albo camelCase) | `{ids}` |
| `recordEvidence` | `conceptId, kind, task?, source?, projectId?, lessonId?, exerciseId?, misconceptions?, detail?, now` | `{knowledge, levelChanged, levelBefore, levelAfter}` |
| `recordExposure` | `conceptIds[], projectId, now` | `{count, skipped}` (nieznane koncepty pomijane) |
| `saveLesson` / `getLessons` / `getLesson` / `markLesson` | `lesson` / `projectId?, limit=30, offset=0, includeBody?` / `id` / `id, status` | |
| `cacheGet` / `cachePut` | `key` / `key, body, now` | body albo `null` (hits+1) |
| `reserveBudget` | `day, kind, maxCalls, maxTokens?, estTokens?` | `{granted, calls, tokens}`, atomowo |
| `commitUsage` / `releaseBudget` | `day, kind, tokensIn, tokensOut` / `day, kind` | |
| `saveExercise` | `exercise` (ponowny zapis nie rusza oceny) | `{id}` |
| `gradeExercise` | `id, verdict, grade, evidence[], now, force?` | `{knowledge[], levelChanges[]}`, jedna transakcja, druga ocena bez `force` odrzucona |
| `getKnowledge` | | `{knowledge, misconceptions}` (z rozwiązanymi) |
| `getGraph` | | `{concepts, edges, knowledge}` |
| `getConceptHistory` | `conceptId` | `{knowledge, evidence(100), history, exercises(30), misconceptions}` |
| `getProjectHistory` | `projectId, limit=100` | obserwacje od najnowszych |
| `dueReviews` | `now, limit=10` | wiersze z `next_review_at <= now` |
| `setNotes` | `conceptId, notes` | |
| `stats` | | `{counts, dbBytes, walBytes}` |
| `export` | `path?` | `{path, counts}` |
| `import` | `path, mode: merge\|replace` | `{counts, backup}` |
| `backup` | `keep=10` | `{path, removed}` |
| `maybeDailyBackup` | `now` | `{path}` albo `{path: null}` |
| `wipe` | `confirm: "USUN-WSZYSTKO"`, `keepBackup?` | `{wiped, vacuumed, backup?}` |
| `diag` | | wersje, `journalMode`, `quick_check`, liczniki, rozmiary, `dataDir` |

Wiersze wychodzą z kolumnami `*_json` już sparsowanymi (`correct_days_json` → `correct_days`, `body_json` → `body` itd.). Wiedza dostaje dodatkowo `name`, `area`, `level_name`, `effectiveConfidence`, `isDue`.

## Model opanowania (`mastery.mjs`)

Dowody:

* `exposure_claude`: Claude użył konceptu. Tylko `exposures += 1`, nigdy nie zmienia mastery ani confidence.
* `lesson_read`, `sim_experiment`: `engagements += 1`.
* `self_report_known` / `self_report_unknown`: tylko gdy nie było jeszcze żadnej ocenionej odpowiedzi. mastery 0.3 / 0.0, confidence 0.1. Później tylko zapis w `evidence`.
* `correct` / `partial` / `incorrect` z `task`:

| task | waga w |
|---|---|
| choice | 0.2 |
| predict, diagnose, explain | 0.35 |
| apply | 0.45 |

`mastery' = mastery + w * (t - mastery)`, gdzie t = 1 / 0.5 / 0. Silne zadania to wszystkie poza `choice`. Confidence `= min(0.97, 1 - 0.7^n)`, n to liczba ocenionych odpowiedzi. Dni z poprawną odpowiedzią (lokalna data) trzymane unikalnie, ostatnie 30.

Powtórki (SM-2 w skrócie): correct: interwał 1 dzień albo `interwał * ease` (max 180), ease +0.05 (max 3.0). partial: `max(1, interwał * 0.6)`, ease -0.15. incorrect: 0.5 dnia, ease -0.2. Ease nie spada poniżej 1.3.

Poziomy:

| poziom | warunek |
|---|---|
| 4 Opanowane | mastery ≥ 0.85, ≥ 3 poprawne, ≥ 2 różne dni, ≥ 1 silne zadanie |
| 3 Potrafię zastosować | mastery ≥ 0.65, ≥ 2 poprawne, ≥ 1 silne zadanie |
| 2 Rozumiem częściowo | mastery ≥ 0.35, ≥ 1 poprawna |
| 1 Uczę się | jakiekolwiek zaangażowanie, ocena albo „znam” z samooceny |
| 0 Nie znam | reszta |

Przykład: same poprawne `predict` dają mastery `1 - 0.65^n`, czyli 0.35, 0.578, 0.725, 0.821, 0.884. Poziom 4 pojawia się dopiero przy piątej odpowiedzi, i to tylko gdy były co najmniej 2 różne dni.

`effectiveConfidence = confidence * exp(-dni_od_weryfikacji / 60)`, 0 gdy nigdy nie weryfikowano. Każda zmiana poziomu zapisuje wiersz w `history`.

Misconceptions: `incorrect`/`partial` z `misconceptions: [{key, description, example?}]` robi upsert (count+1, reset `correct_since`, zdjęcie `resolved_at`, ostatnie 5 przykładów, lista projektów). Każde `correct` dla konceptu to `correct_since + 1` dla otwartych, przy 2 ustawia `resolved_at`.

## Testy

```
node --no-warnings --test plugins/code-mentor/helper/test/
```

`test/package.json` ma `"main": "helper.test.mjs"`. Bez tego Node 24 nie przyjmuje katalogu jako argumentu `--test`.
