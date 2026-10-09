# Changelog

## 1.4.1

### Change Lab

- Na górze ostatnie zadanie jednym zdaniem: polecenie, liczba zmian i plików, dodane i usunięte linie, nieudane.
- Lista zmian: każde polecenie to karta z czasem i podsumowaniem („17 edycji w 14 plikach +1007 −4”), a w niej każdy plik raz, z ikoną typu, katalogiem, liczbą edycji (×5) i sumą linii. Kliknięcie otwiera ostatnią edycję pliku. Długie karty pokazują 8 plików i „+ N plików więcej”. Pojęcia są w szczegółach zmiany, nie w liście.
- Gdy katalog projektu nie jest repozytorium (folder z wieloma worktree), gałąź i status gita są z repozytorium pliku, którego Claude dotknął ostatnio, z nazwą tego repozytorium przy gałęzi.
- Pliki jak w claude-code-filetree. W Zmianach karta „Teraz” (co Claude robi w tej chwili: myśli, czyta, edytuje, uruchamia komendę; ile plików otworzył i zmienił; gałąź i jej stan; legenda kolorów) i lista „Claude dotknął” z plakietkami Otwarty, Edytowany, Zacommitowany, Błąd, Odrzucony. Nazwa czytanego albo edytowanego pliku mieni się (shimmer). Kliknięcie pliku otwiera jego zmianę.
- Boczny panel „Pliki” (`/mentor-files` albo „Wszystkie pliki →”): karta Teraz, szukanie, Odśwież, Zwiń wszystko, ukryte pliki, Claude dotknął, a niżej całe drzewo projektu z ikonami typów, statusem gita (M, U, D), godziną zmiany i zielonym wierszem pliku, który wszedł commitem Claude; na dole „zacommitowane a1c9e42”. Katalogi wczytywane na żądanie, droga do dotkniętych plików rozwinięta sama, jeden `git status` na odświeżenie po edycji albo komendzie, nie przy każdym rysowaniu.
- Szczegóły zmiany jak w Replay Theater: „4 edycje w 3 plikach”, „6 linii dodanych, 6 usuniętych”, „Edycje po kolei” z kółkami na linii (zrobione ✓, bieżąca różowa z numerem, następne obrysowane, katalog i +/−), „Edycja 4 z 4”, plik i ścieżka. Diff w ramce pokazuje same zmiany i zaznacza zmienione słowa mocniejszym tłem, pod nim legenda i przyciski „Poprzednia edycja” i „Następna edycja” (klawisze `p` i `n`).
- Diff najpierw skrócony (zmiany z 1 linią kontekstu), cały na żądanie. W szerokim panelu widok „Obok”.
- Laboratorium: szybka zmiana operatora z listy i wartości wpisywanej wprost, „⏭ pokaż od razu” zamiast czekania na animację, wyniki liczone raz i zapamiętane.
- Karta decyzji przed poproszeniem Claude o inne podejście: zmiana, podejście, co zachować, różnice ze źródłem (symulator albo propozycja AI), co sprawdzić, co niepewne. Domyślnie „Anuluj”, polecenie zawiera te same sekcje.

### Nauka

- Pod lekcją „Jak było?”: za proste, za trudne, więcej przykładów, dalej nie rozumiem. Jeden głos na lekcję, liczony na pojęcie, projekt i globalnie. Wpływa na sposób pisania kolejnych lekcji (i szczegółowość lekcji wbudowanych), nigdy na poziom wiedzy. „Więcej przykładów” i „dalej nie rozumiem” od razu dają przykład albo wyjaśnienie z innej strony. Bez dodatkowych wywołań modelu poza tymi dwoma i bez zmian w instrukcjach Claude.

### Agenci i kraby

- Boczny panel „Agenci” jak w savvy-progress: tytuł zadania, kafelki koszt (szacunek z cennika), tokeny i czas, sekcje Pracują i Skończeni (zwijane), widok zwinięty z rzędem krabów, pod spodem zadania w tle. Każdy subagent: krab w kostiumie roli, zadanie, rola, model i effort, co robi teraz („edytuje forms/register.ts”), kontekst w %, tokeny, koszt, czas i znacznik stanu. Otwiera się sam raz na turę (gdy autootwieranie jest włączone), `/mentor-agents` i ×N w pasku go pokazują albo chowają.
- Nad promptem pasek zadania jak w savvy-progress przy każdym poleceniu: tytuł z pierwszej linii promptu, pasek z migoczących pikseli, pigułka, krab i ✕ (chowa do następnego polecenia). Bez agentów w trakcie pracy po pasku jedzie pasmo pikseli, pigułka mówi „Myśli…” albo „Pracuje · 7 kroków · 2 pliki”, po prawej czas; po odpowiedzi zielony pasek „Gotowe · +42 −10”. Krab ubiera się w to, co Claude robi: detektyw z lupą przy czytaniu i szukaniu, inżynier z kluczem przy edycji, wyścigowiec przy komendach, astronauta w sieci. Z subagentami pigułka „Agenci k/n”, procent i ×N. Obok treści innych modów.
- Krab i 6 kostiumów z savvy-progress: Explore pirat, Plan detektyw, zwykły agent inżynier, przewodnik astronauta, szybkie zadania wyścigowiec, kucharz. Chodzi i rusza rekwizytem, gdy agent pracuje.
- W Zmianach skrót: rząd krabów, podsumowanie i przycisk do panelu.
- Boczny panel „Zadania w tle” (`/mentor-tasks`, otwiera się sam raz na turę przy pierwszym zadaniu): kafelki Pracują, Skończone, Czas razem; sekcja Pracują z animowanym wierszem, „▸ wyjście” rozwija ostatnie 30 linii, „■ Zatrzymaj” wywołuje TaskStop dopiero po kliknięciu; zwijana sekcja Skończone ze znacznikiem ✓ ✗ ⊘, stanem i czasem. W Zmianach i w panelu agentów skrót z przyciskiem do panelu. Natywnego panelu Background tasks mod nie może przerysować, więc to osobny panel.
- Zadania w tle (komendy Bash uruchomione w tle): opis, komenda, czas, ostatnie 4 linie wyjścia na żywo i stan końcowy. Na desktopie wiersz z ikoną terminala z mrugającym kursorem, paskiem „trwa” i pulsującą najnowszą linią. Wyjście czytane co 2 s (rzadziej przy dużym), bez kodów kolorów i po redakcji sekretów; koniec z powiadomienia o zadaniu albo z TaskStop.
- Dane wyłącznie z `agent.spawn`, `turn.step`, `tool.call` z `agentId` i `turn.complete`; zdarzenia przechodzą bez zmian.

### Wygląd i animacje

- Shimmer z claude-code-filetree: po nazwie pliku, którego Claude dotyka, przesuwa się pasmo światła (fiolet odczyt, pomarańcz edycja, zieleń świeżo zmieniony). Przy plikach liczniki `+dodane −usunięte` z tej tury.
- Pasek postępu z migoczących pikseli z pigułką etykiety (savvy-progress) w odtwarzaniu Symulatora i w laboratorium.
- Pogoda kontekstu w pasku nad promptem (token-weather): ☀ pogodnie, ☁ pochmurno, ☂ przelotnie, ☇ burzowo, ↯ pełno.
- Licencje zapożyczeń: THIRD_PARTY_NOTICES.md.
- Jedna paleta w całym panelu: zielony dodane i sukces, czerwony usunięte i błąd, pomarańczowy edycja, fioletowy odczyt i analiza.
- Na desktopie znaczniki stanu i oczekiwanie to małe SVG animowane przez CSS (z `prefers-reduced-motion`), bez przerysowań panelu. W terminalu tekstowe odpowiedniki.
- Jeden harmonogram dla całego ruchu (odtwarzanie, laboratorium, błyski plików, oczekiwanie w terminalu, potwierdzenia) zamiast osobnych pętli. Śpi do najbliższej zmiany i kończy się, gdy nic się nie rusza. Odtwarzanie zatrzymuje się po zmianie zakładki.
- Krótkie potwierdzenia na górze panelu, np. po wstawieniu polecenia albo zapisaniu oceny lekcji.

### Pasek kontekstu

- Trend 12 ostatnich tur i zmiana względem poprzedniej tury. Historia przeżywa przeładowanie moda.
- W wąskim oknie znika najpierw trend, potem zmiana tury, na końcu licznik cache.
- Mentor dokłada pasek do treści innych modów nad promptem zamiast ją zastępować.

### Prywatność

- Polecenia Bash w opisach błędów i nagłówki `Authorization: Bearer` przechodzą przez redakcję.
- Jednorazowe czyszczenie starej historii (opisy zmian, polecenia, obserwacje) z kopią bazy przed zapisem. Historia wczytana do panelu jest czyszczona także w pamięci.

## 1.4.0

### Laboratorium w Zmianach

- „▶ Uruchom i porównaj” otwiera laboratorium pod kodem zmiany zamiast przenosić do Symulatora.
- Wersje A (przed), B (po), alternatywy od modelu i własne kopie, najwyżej 4. Kopie edytujesz linia po linii, kod z narzędzia zostaje nietknięty.
- Jawne przypadki (do 6) puszczone przez wszystkie wersje. Wiersz z różnymi wynikami jest oznaczony, brak funkcji w wersji nie udaje wyniku, wynik oparty na założeniu ma znak ≈.
- „Sprawdź w projekcie” wstawia prośbę do Claude o uruchomienie prawdziwych testów z tymi przypadkami i porównanie z przewidywaniem. Mentor sam niczego z projektu nie uruchamia.
- Alternatywa: „Dodaj do laboratorium” zamiast osobnego porównania w Symulatorze.
- Symulator rozumie wyrażenia regularne (`/…/g`, `new RegExp`, `replace` z funkcją, `split`, `match`, `test`, `search`) i ma `trimStart`, `trimEnd`, `lastIndexOf` i kilka innych metod napisów. Wcześniej kod z regexem kończył się błędem „Nieznany znak”.
- „Warto zrozumieć” nie pokazuje podstaw, gdy w zmianie nie ma nic poza nimi.

### Animacja uruchomienia

- Symulator: „▶ Odtwórz” przechodzi kod sam, krok po kroku, z podświetloną linią, zmiennymi, wyjściem i paskiem postępu. Domyślnie wolno, 8 s na krok, przełącznik tempa (średnio 4 s, szybko 1,8 s), „⏸ Pauza” w każdej chwili, każdy ręczny krok zatrzymuje odtwarzanie. Przykład do nauki odtwarza się od razu.
- Laboratorium: po „Uruchom i porównaj” wyniki odsłaniają się po kolei, a liczona komórka (ok. 4 s) pokazuje, którą linię i który krok właśnie wykonuje. „▶ jeszcze raz” powtarza animację.

### Prawdziwy kod czy przykład

- Zmiany pokazują prawdziwy kod (przed, po, wyjaśnienie, testy przez Claude), a Symulator uczy na czystych przykładach.
- „Zobacz na przykładzie” w zmianie i „Na przykładzie” w lekcji: para A/B dla każdej z 10 rozpoznanych przeróbek i przykład dla 25 pojęć, w tym Dart i drzewo widgetów Fluttera.
- „Uruchom i porównaj”, „Krok po kroku” i pytanie ze zmiany tylko dla kodu, który wykonuje się bez importów, zaślepek, dopisków i założeń. Kod zależny od reszty projektu nie kończy się już czerwonym błędem, dostaje przykład.

### Poprawki

- Opis zmiany powstaje z linii po usunięciu sekretów, więc klucz albo hasło zmienione w literale nie trafia do bazy ani panelu, także przy wyłączonym zapisie kodu. Opisy zapisane wcześniej zostają w bazie, czyszczenie ich nie jest częścią tej wersji.
- Porównanie A i B uruchamia tylko wywołanie, którego funkcje istnieją w obu wersjach. Gdy takiego nie ma, panel to mówi zamiast porównywać błędy. Przy wyniku opartym na założeniach (zaślepki, sieć, losowość, zegar) jest ostrzeżenie.
- „Sprawdź się” ze zmiany nie robi ocenianego pytania, gdy wynik zależy od założenia symulatora.
- „Poproś Claude o to” przekazuje pełny kod wybranej alternatywy, ograniczenia (ta sama sygnatura, bez ruszania innych plików) i sposób sprawdzenia. Model dostaje polecenie, żeby alternatywa miała tę samą nazwę i parametry.
- CI uruchamia testy pluginu i walidację marketplace.

## 1.3.0

### Jeden mod

- Pasek kontekstu wszedł do Mentora: osobny plugin context-bar zniknął z marketplace. Pasek włączasz w Ustawieniach albo przez `/mentor pasek`, czas cache przez `/mentor pasek ttl 5|60`. Przycisk Mentor na pasku otwiera panel bezpośrednio.
- Nagłówek panelu pokazuje wersję: „Claude Code Mentor 1.3.0”. Gdy w Claude Code jest już nowsza wersja niż ta w sesji, panel mówi, żeby przeładować.
- `scripts/update-local.mjs`: jedna komenda po zmianie kodu, wersja z `plugin.json` trafia wszędzie, a nowy kod do cache, więc otwarte sesje biorą go po `/reload-plugins`.
- Skrypty instalacyjne odinstalowują stary context-bar, jeśli był zainstalowany.

### Claude Code Mentor

- Change Lab, nowa pierwsza zakładka **Zmiany**: lista zmian Claude pogrupowana po poleceniach, trwała między sesjami.
- Kod przed i po każdej zmianie prosto z wyniku Edit/Write (`originalFile` + patch). Gdy poprzedniej wersji nie ma, jest to oznaczone, nic nie jest odtwarzane.
- Krótki opis zmiany z samego diffu: podmieniony operator albo wartość, nowe i usunięte nazwy, nowe mechanizmy.
- „Uruchom przed i po”: obie wersje w symulatorze na tych samych danych, z automatycznym wywołaniem dla przypadku brzegowego i porównaniem gałęzi oraz wyjścia.
- „Inne podejście”: do 2 alternatyw od modelu z zaletami i wadami, porównanie w symulatorze i przekazanie prośby do pola wiadomości dopiero po potwierdzeniu.
- Baza w schemacie v2 (tabela `changes`), migracja z kopią zapasową, retencja 400 zmian na projekt i 60 dni, kod zmian poza eksportem.
- Ustawienie „Zapisuj kod zmian”.
- „Zgadnij zmianę”: kod przed i polecenie, stopniowe podpowiedzi z diffu, odsłonięcie prawdziwej zmiany.
- Symulator wykonuje wycinki: domyka nawiasy, dokłada `try` przed osieroconym `catch`, nazwy spoza wycinka dostają wartości zastępcze. Każdy dopisek jest opisany w założeniach.
- Ćwiczenia: podpowiedzi (naprowadzenie, potem odrzucenie części złych odpowiedzi) i „Pokaż odpowiedź”. Odsłonięta odpowiedź nie zmienia poziomu, poprawna po podpowiedzi liczy się jako częściowa.

### Mniej ekranów, mniej przycisków

- Na pasku 3 zakładki: Zmiany, Ćwiczenia, Symulator. Lekcje, Moja wiedza, Ścieżka i Ustawienia w „Więcej”. Przegląd usunięty, jego „najważniejsza rzecz do zrozumienia” jest jedną linią nad listą zmian.
- „Wyjaśnij” w zmianie pokazuje lekcję pod kodem, na miejscu. Drugie kliknięcie ją chowa.
- W szczegółach zmiany 4 przyciski: Wyjaśnij, Uruchom przed i po, Sprawdź się, Inne podejście. „Zgadnij zmianę” jest teraz zapasową wersją „Sprawdź się” dla kodu, którego symulator nie wykona.
- „Sprawdź się” w zmianie: pytanie „co wypisze wersja po zmianie”, odpowiedź z symulatora na parze przed/po.
- „Co się zmieniło” rozpoznaje 10 typowych przeróbek (`Promise.all`, `map`/`filter`, `.then` → `await`, `switch`, `var` → `let`, `try`/`catch`, sprawdzenie `null`, `throw`, test, typy).
- Mechanizmy w zmianie bez podstaw i bez tego, co już opanowane.
- Lekcja: jedno zdanie, kod i 3 sekcje do rozwinięcia. Zamiast „Pogłęb” trzy dopytania pod lekcją: „Co jest pod spodem”, „Krok po kroku”, „Inny przykład”, z widocznym ładowaniem.
- Karta na start i test poziomu (6 pytań). Ścieżka przed testem nie poleca podstaw.
- Symulator: jeden przycisk „Krok ▶”, karta kroku z „dlaczego teraz”, what-if pod przyciskiem. Kod z samymi definicjami funkcji dostaje wywołanie z przykładowymi danymi.
- Graf zależności: tylko pojęcia z projektu i polecane plus ich podstawy (najwyżej 14), czytelny w jasnym i ciemnym motywie.
- Moja wiedza: filtry tylko dla poziomów, które coś zawierają. Ustawienia: 3 najważniejsze na wierzchu, reszta w „Zaawansowane”.

## 1.2.0

### Claude Code Mentor

- Flutter i Dart: wykrywanie pojęć w plikach `.dart`, 10 nowych pojęć (widgety, stan, layout, nawigacja, zarządzanie stanem, FutureBuilder, null safety, Future i Stream, wieloplatformowość) z 30 pytaniami.
- Symulator wykonuje podzbiór Darta krok po kroku: null safety, parametry nazwane, klasy z `factory` i getterami, enumy, wyjątki, `Future`, `async`/`await`, wypis w formacie Darta.
- Drzewo widgetów dla kodu interfejsu Fluttera.
- Eksplorator warunków z semantyką Darta 3.
- Komendy `flutter`/`dart` (pub add, test, run, analyze) i zależności z `pubspec.yaml`.
- macOS i Linux: katalog danych zgodny z systemem, szukanie Node w Homebrew, skrypty `install.sh`, `uninstall.sh`, `diagnose.sh`.

### Licencja

- Projekt na licencji MIT.

## 1.1.0

### Claude Code Mentor

- Nowy widok lekcji: wybór lekcji z listy, karta z najważniejszymi informacjami, zwijane sekcje, oznaczone hipotezy i potwierdzenia.
- Brak lekcji z samego uruchomienia builda lub testów bez błędu.
- To samo pojęcie dostaje lekcję najwyżej raz na 30 minut.
- Pasek nad promptem dokłada się do pasków innych pluginów zamiast je zastępować.
- Automatyczny wybór działającego `node.exe`, także przy nvm.

### Context Bar 1.0.0

- Pasek SVG z dymkami kategorii na Claude Desktop.
- Licznik czasu do wygaśnięcia cache promptu (`/context-bar ttl 5|60`).
- Przycisk Mentor. Usunięta legenda i linia statusu pod promptem.

## 1.0.0

- Pierwsze wydanie Claude Code Mentor:
  - obserwacja zmian,
  - lekcje wbudowane i AI,
  - symulator JS/TS z event loop,
  - eksplorator warunków (JS, Python, PHP),
  - piaskownica SQL,
  - ćwiczenia,
  - model wiedzy w SQLite z powtórkami,
  - eksport, import i kopie zapasowe,
  - instalacja w user scope.
