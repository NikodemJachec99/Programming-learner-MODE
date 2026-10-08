# Changelog

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
