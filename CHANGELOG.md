# Changelog

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
