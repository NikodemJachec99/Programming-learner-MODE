// Pojęcia mobilne: Dart i Flutter (PL). Dane statyczne: działa bez modelu.
// Graf zależności (prereqs) jest acykliczny; quizy mają zweryfikowane klucze.
import type { ConceptDef } from './types'

export const FLUTTER_CONCEPTS: readonly ConceptDef[] = [
  // ───────────────────────── mobile: Dart ─────────────────────────
  {
    id: 'dart-basics',
    name: 'Podstawy Darta (Dart basics)',
    en: 'Dart basics',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['variables', 'data-types', 'functions'],
    weight: 3,
    intuition: `Dart to język, w którym pisze się aplikacje Flutter. Składnią przypomina mieszankę TypeScriptu i Javy: klamry, średniki, klasy, typy. Program startuje od funkcji \`main()\`. Typy sprawdza kompilator przed uruchomieniem, ale często nie musisz ich pisać, bo Dart sam je wywnioskuje z wartości.`,
    mechanism: `1. \`void main() { ... }\` to punkt wejścia. Każda instrukcja kończy się \`;\`. We Flutterze \`main\` wywołuje \`runApp(...)\`.
2. \`var x = 5;\` to inferencja typu (type inference): \`x\` dostaje typ \`int\` na stałe, więc \`x = 'a'\` to błąd kompilacji. \`var x;\` bez wartości ma typ \`dynamic\` (bez kontroli typów).
3. \`final\` pozwala przypisać wartość tylko raz, ale wartość może powstać w runtime (\`final teraz = DateTime.now();\`). \`const\` to stała czasu kompilacji, w całości niezmienna: \`const [1, 2]\` nie da się zmodyfikować. \`final\` nie zamraża obiektu: do \`final lista = [1]\` można dodać element.
4. Typy podstawowe: \`int\`, \`double\`, \`num\`, \`String\`, \`bool\`, \`List<T>\`, \`Map<K, V>\`, \`Set<T>\`. Wszystko jest obiektem, nawet liczba: \`5.toString()\`.
5. Dzielenie: \`7 / 2\` daje zawsze \`double\` (3.5), \`7 ~/ 2\` daje \`int\` (3, część całkowita), \`7 % 2\` daje 1. \`7 / 0\` to \`Infinity\`, a \`7 ~/ 0\` rzuca wyjątek.
6. Funkcje: \`int dodaj(int a, int b) => a + b;\`. Pozycyjne opcjonalne w nawiasach kwadratowych: \`void f(int a, [int b = 0])\`. Nazwane w klamrach: \`void g({required String imie, int wiek = 0})\`, wywołanie \`g(imie: 'Ola')\`.
7. Interpolacja: \`'Cześć $imie'\` dla samej zmiennej, \`'Suma: \${a + b}'\` dla wyrażenia, w tym dostępu do pola: \`'\${user.name}'\`.
8. Kolekcje: \`[1, 2]\` to \`List\`, \`{'a': 1}\` to \`Map\`, \`{'x', 'y'}\` to \`Set\`. Puste \`{}\` to \`Map\`; pusty zbiór to \`<String>{}\`. Działa też \`...\` (spread) oraz \`if\` i \`for\` wewnątrz literału listy.`,
    why: `Flutter wybrał Darta, bo ten sam język kompiluje się na dwa sposoby: JIT w trakcie developmentu (to umożliwia hot reload) i AOT do kodu maszynowego w wersji release (szybki start, brak interpretera). Do tego sound null safety i składnia znajoma dla osób po JS i Javie. Alternatywy: Kotlin (Android, Kotlin Multiplatform), Swift (iOS), TypeScript w React Native. Kompromis: ekosystem Darta jest mniejszy niż JS, a sam język poza Flutterem jest używany rzadko.`,
    practice: `Każdy plik w \`lib/\` Twojego projektu Flutter to Dart. Najczęściej spotkasz go w modelach danych (klasa z \`fromJson\`), funkcjach pomocniczych (formatowanie ceny, daty), parametrach widgetów (\`required this.title\`) i w budowaniu tekstów w UI przez interpolację.`,
    pitfalls: [
      `\`int wynik = suma / ilosc;\`: błąd kompilacji, bo \`/\` zwraca \`double\`. Użyj \`~/\` albo \`(suma / ilosc).round()\`.`,
      `\`'$user.name'\` wstawia \`user.toString()\` i doklejony tekst \`.name\`. Dostęp do pola wymaga klamer: \`'\${user.name}'\`.`,
      `\`const teraz = DateTime.now();\`: błąd kompilacji, bo wartość nie jest znana przy kompilacji. Tu pasuje \`final\`.`,
      `\`var s = {};\` w przekonaniu, że to zbiór, a to pusta \`Map<dynamic, dynamic>\`.`,
    ],
    verify: `\`flutter analyze\` (albo \`dart analyze\`) wyłapuje błędy typów przed uruchomieniem i pokazuje je w IDE na czerwono. Mały fragment sprawdzisz w DartPad (dartpad.dev) albo przez \`dart run plik.dart\`. W aplikacji wypisuj wartości przez \`debugPrint\`. Pamiętaj: hot reload nie uruchamia ponownie \`main()\` ani inicjalizacji zmiennych globalnych, więc po zmianie w nich zrób hot restart.`,
    simplification: `Wyniki \`print\` dla liczb dotyczą Dart VM (Android, iOS, desktop, \`dart run\`). Na web liczby są liczbami JS, więc \`print(6 / 2)\` wypisze tam \`3\`, a nie \`3.0\`, a \`int\` nie ma pełnych 64 bitów.`,
    misconceptions: [
      {
        key: 'slash-int-division',
        text: `\`/\` na dwóch liczbach \`int\` daje \`int\`, jak w C albo Javie.`,
        fix: `W Darcie \`/\` zawsze zwraca \`double\`: \`7 / 2\` to 3.5, a \`6 / 2\` to 3.0. Dzielenie całkowite to osobny operator \`~/\`.`,
      },
      {
        key: 'var-is-dynamic',
        text: `\`var\` działa jak w JS: zmienna może później przechować wartość dowolnego typu.`,
        fix: `\`var x = 0\` ustala typ \`int\` na stałe na podstawie wartości początkowej. Przypisanie tekstu to błąd kompilacji. Dowolny typ daje dopiero \`dynamic\` (albo \`var x;\` bez wartości), czego warto unikać.`,
      },
      {
        key: 'final-freezes-object',
        text: `\`final\` sprawia, że lista albo obiekt nie mogą się już zmienić.`,
        fix: `\`final\` blokuje tylko ponowne przypisanie zmiennej. Zawartość listy można zmieniać (\`add\`, \`remove\`). Niezmienną listę daje \`const [...]\` albo \`List.unmodifiable(...)\`.`,
      },
    ],
    quiz: [
      {
        q: `Co wypisze kod uruchomiony przez \`dart run\`?
\`\`\`dart
void main() {
  int a = 7;
  int b = 2;
  print(a / b);
  print(a ~/ b);
  print(6 / 2);
}
\`\`\``,
        kind: 'predict',
        options: ['3, 3, 3', '3.5, 3, 3.0', '3.5, 4, 3.0', '3, 3.5, 3'],
        answer: 1,
        explain: `\`/\` zawsze zwraca \`double\`, więc 3.5 i 3.0 (VM wypisuje double z kropką). \`~/\` to dzielenie całkowite, które obcina część ułamkową: 3, a nie zaokrąglenie do 4.`,
        misconceptionByOption: { 0: 'slash-int-division', 3: 'slash-int-division' },
      },
      {
        q: `Co się stanie?
\`\`\`dart
void main() {
  var licznik = 0;
  licznik = 'zero';
  print(licznik);
}
\`\`\``,
        kind: 'predict',
        options: [
          'Wypisze zero',
          'Wypisze 0',
          'Błąd kompilacji: String nie może być przypisany do zmiennej typu int',
          'Program się uruchomi i rzuci wyjątek dopiero w linii z print',
        ],
        answer: 2,
        explain: `\`var licznik = 0\` wywnioskował typ \`int\` i ten typ jest stały. Analyzer zgłasza błąd, zanim program w ogóle ruszy.`,
        misconceptionByOption: { 0: 'var-is-dynamic' },
      },
      {
        q: `Co wypisze kod?
\`\`\`dart
void main() {
  final lista = [1, 2];
  lista.add(3);
  print(lista);
}
\`\`\``,
        kind: 'predict',
        options: ['[1, 2, 3]', 'Błąd kompilacji: lista jest final', '[1, 2]'],
        answer: 0,
        explain: `\`final\` zabrania tylko \`lista = [...]\` drugi raz. Sama lista jest zwykłą, modyfikowalną \`List<int>\`. Przy \`const [1, 2]\` wywołanie \`add\` rzuciłoby \`UnsupportedError\`.`,
        misconceptionByOption: { 1: 'final-freezes-object', 2: 'final-freezes-object' },
      },
    ],
  },
  {
    id: 'dart-null-safety',
    name: 'Null safety w Darcie (sound null safety)',
    en: 'sound null safety',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['dart-basics', 'null-undefined', 'static-typing'],
    weight: 2,
    intuition: `W Darcie zmienna typu \`String\` nigdy nie jest \`null\`. Jeśli brak wartości jest dopuszczalny, piszesz \`String?\`. Kompilator pilnuje, żebyś przed użyciem \`String?\` obsłużył przypadek \`null\`, więc większość błędów „null nie ma metody X” wychodzi w edytorze, a nie u użytkownika.`,
    mechanism: `1. \`String a = 'x';\` nie może być \`null\`. \`String? b;\` może i domyślnie jest \`null\`.
2. Na \`T?\` nie wywołasz metody wprost: \`b.length\` to błąd kompilacji.
3. \`b?.length\` zwraca \`null\`, gdy \`b\` to \`null\` (typ wyniku \`int?\`). \`b ?? 'brak'\` daje wartość zastępczą. \`b ??= 'domyślne'\` przypisuje tylko, gdy \`b\` to \`null\`.
4. \`b!\` mówi kompilatorowi „wiem, że tu nie ma null”. Jeśli jednak jest, w runtime leci wyjątek \`Null check operator used on a null value\`.
5. Analiza przepływu (flow analysis) i promocja typu (type promotion): w \`if (b != null) { b.length }\` wewnątrz \`if\` zmienna \`b\` ma typ \`String\`. Działa dla zmiennych lokalnych i parametrów. Pola klasy są promowane tylko, gdy są prywatne i \`final\` (Dart 3.2+); w pozostałych przypadkach skopiuj pole do zmiennej lokalnej.
6. \`late String x;\` to obietnica: przypiszę przed pierwszym odczytem. Odczyt przed przypisaniem rzuca \`LateInitializationError\`. \`late final x = policz();\` liczy wartość leniwie, przy pierwszym odczycie.
7. Nazwany parametr nienullowalny bez wartości domyślnej musi mieć \`required\`: \`Karta({required this.tytul})\`.
8. „Sound” znaczy, że gwarancja obowiązuje także w runtime: wartość typu \`String\` naprawdę nie może być \`null\`, więc kompilator pomija zbędne sprawdzenia. Dart 3 wymaga null safety w całym kodzie i wszystkich pakietach.`,
    why: `\`null\` w miejscu, gdzie kod oczekuje obiektu, to jedna z najczęstszych przyczyn crashy. Null safety przenosi to sprawdzenie do kompilacji. Alternatywy: Java bez adnotacji (\`NullPointerException\` dopiero w runtime), TypeScript ze \`strictNullChecks\` (podobna idea, ale nie „sound”: \`any\` i rzutowania potrafią przemycić \`null\`), Kotlin (prawie identyczny model: \`?\`, \`!!\`, \`?:\`). Kompromis: więcej adnotacji w kodzie, a \`!\` i \`late\` to furtki, które z powrotem przenoszą ryzyko do runtime.`,
    practice: `Dane z API i JSON (pole może nie przyjść, więc \`String?\` w modelu), \`TextEditingController\` jako \`late final\` w \`State\` inicjalizowany w \`initState\`, parametry widgetów \`required this.title\`, wyniki \`Navigator.push\` (\`T?\`, bo użytkownik mógł się cofnąć bez wyboru), \`snapshot.data\` w \`FutureBuilder\`.`,
    pitfalls: [
      `\`!\` dopisywane wszędzie, żeby uciszyć analyzer. Aplikacja kompiluje się, a crash pojawia się u użytkownika przy brakujących danych.`,
      `\`late\` dla pola, które w jakiejś ścieżce kodu nie zostanie przypisane: \`LateInitializationError\` w runtime.`,
      `Oczekiwanie promocji na publicznym polu klasy: \`if (user.name != null) user.name.length\` nadal jest błędem. Skopiuj: \`final n = user.name;\`.`,
      `\`Text('Witaj \${user?.name}')\` bez \`??\`: na ekranie pojawia się dosłownie „Witaj null”.`,
    ],
    verify: `\`flutter analyze\` pokazuje naruszenia null safety jako błędy, zanim uruchomisz aplikację. W runtime komunikat \`Null check operator used on a null value\` ze stack trace wskazuje dokładnie linię z \`!\`; w DevTools (zakładka Debugger) możesz zatrzymać się na wyjątku. Przeszukaj plik pod kątem \`!\` i \`late\` i dla każdego zadaj pytanie: co gwarantuje, że tu nie ma null? W teście widgetu podaj \`null\` jako dane (\`pumpWidget(MaterialApp(home: Profil(user: null)))\`) i sprawdź, czy ekran się nie wysypuje.`,
    misconceptions: [
      {
        key: 'bang-is-safe',
        text: `\`!\` to bezpieczne sprawdzenie: gdy wartość jest \`null\`, Dart po prostu ją pominie albo podstawi coś pustego.`,
        fix: `\`!\` niczego nie obsługuje. Wyłącza ochronę kompilatora, a gdy wartość to \`null\`, rzuca wyjątek w runtime. Bezpieczne odpowiedniki to \`?.\`, \`??\` i sprawdzenie \`if (x != null)\`.`,
      },
      {
        key: 'null-safety-no-runtime-errors',
        text: `Skoro Dart ma null safety, aplikacja nie może dostać w runtime żadnego błędu związanego z \`null\`.`,
        fix: `Gwarancja dotyczy kodu bez furtek. \`!\`, \`late\` i rzutowania danych z zewnątrz (\`json['imie'] as String\`, gdy pola brak) nadal mogą rzucić wyjątek w runtime.`,
      },
      {
        key: 'promotion-works-on-fields',
        text: `Po \`if (pole != null)\` każde pole klasy jest już traktowane jako nienullowalne.`,
        fix: `Promocja działa dla zmiennych lokalnych, parametrów oraz prywatnych pól \`final\`. Publiczne albo niefinalne pole mogłoby zwrócić coś innego przy drugim odczycie (np. getter w podklasie), więc kompilator go nie promuje. Skopiuj je do zmiennej lokalnej.`,
      },
    ],
    quiz: [
      {
        q: `Co wypisze kod?
\`\`\`dart
void pokaz(String? imie) {
  print(imie?.length);
  print(imie ?? 'Gość');
  print(imie!.length);
}

void main() => pokaz(null);
\`\`\``,
        kind: 'predict',
        options: [
          'null, Gość, 0',
          'Błąd kompilacji w linii z imie!',
          'null, null, 0',
          'null, Gość, a potem wyjątek w runtime',
        ],
        answer: 3,
        explain: `\`?.\` zwraca \`null\`, \`??\` podstawia \`'Gość'\`. \`imie!\` kompiluje się, ale przy \`null\` rzuca \`Null check operator used on a null value\`.`,
        misconceptionByOption: { 0: 'bang-is-safe', 2: 'bang-is-safe' },
      },
      {
        q: `Ekran profilu pokazuje czerwony błąd, zanim dane użytkownika się załadują. Dlaczego?
\`\`\`dart
class Profil extends StatelessWidget {
  const Profil({super.key, this.user});
  final User? user;

  @override
  Widget build(BuildContext context) {
    return Text(user!.name);
  }
}
\`\`\``,
        kind: 'diagnose',
        options: [
          '`!` zwraca pusty obiekt, gdy user to null, więc błąd jest w widgecie Text',
          '`user!` rzuca wyjątek, gdy user to null; trzeba obsłużyć brak danych, np. `Text(user?.name ?? \'Ładowanie...\')`',
          'Null safety gwarantuje, że user nie jest null, więc to błąd Fluttera',
          'Brakuje słowa const przed Text',
        ],
        answer: 1,
        explain: `Pole jest zadeklarowane jako \`User?\`, więc \`null\` jest legalne. \`!\` przy \`null\` rzuca wyjątek podczas \`build\`, a Flutter w trybie debug pokazuje go jako czerwony ekran.`,
        misconceptionByOption: { 0: 'bang-is-safe', 2: 'null-safety-no-runtime-errors' },
      },
      {
        q: `Analyzer zgłasza błąd w linii z \`kupon.length\`. Dlaczego?
\`\`\`dart
class Koszyk {
  String? kupon;

  int dlugoscKuponu() {
    if (kupon != null) {
      return kupon.length;
    }
    return 0;
  }
}
\`\`\``,
        kind: 'diagnose',
        options: [
          '`kupon` to publiczne, niefinalne pole, więc Dart go nie promuje; trzeba skopiować je do zmiennej lokalnej: `final k = kupon;`',
          'Analyzer się myli, bo po `!= null` każde pole jest promowane do String',
          'Pole klasy nie może mieć typu nullable',
        ],
        answer: 0,
        explain: `Promocja typu działa dla zmiennych lokalnych, parametrów i prywatnych pól \`final\`. Po \`final k = kupon; if (k != null) return k.length;\` kod się skompiluje.`,
        misconceptionByOption: { 1: 'promotion-works-on-fields' },
      },
    ],
  },
  {
    id: 'dart-futures-streams',
    name: 'Future i Stream (asynchroniczność w Darcie)',
    en: 'Future and Stream',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['dart-basics', 'async-await'],
    weight: 2,
    intuition: `\`Future<T>\` to wartość, która będzie dostępna później: odpowiedź z serwera, odczyt pliku. \`Stream<T>\` to wiele wartości przychodzących w czasie: kolejne pozycje GPS, wiadomości z czatu. Dart wykonuje Twój kod w jednym wątku i w czasie czekania obsługuje inne rzeczy, na przykład rysowanie klatek UI.`,
    mechanism: `1. Funkcja \`async\` zawsze zwraca \`Future\`. Jej ciało wykonuje się synchronicznie do pierwszego \`await\`.
2. \`await f\` zawiesza tylko bieżącą funkcję. Sterowanie wraca do wywołującego, a pętla zdarzeń (event loop) obsługuje w tym czasie inne zadania. Błąd z \`Future\` łapiesz zwykłym \`try/catch\`.
3. Bez \`async\`: \`f.then((v) => ...).catchError(...)\`. Równolegle: \`final wyniki = await Future.wait([a(), b()]);\` (oba startują od razu).
4. Kolejność wykonania w izolacie: najpierw cały kod synchroniczny, potem cała kolejka mikrozadań (microtask queue: \`scheduleMicrotask\`, \`Future.microtask\`, callbacki \`then\` zakończonych \`Future\`), dopiero potem jedno zdarzenie z kolejki zdarzeń (event queue: \`Future(() ...)\`, \`Future.delayed\`, \`Timer\`, I/O, dotyk, klatki). Po każdym zdarzeniu znów cała kolejka mikrozadań.
5. \`Stream\`: \`stream.listen((x) => ...)\` albo w funkcji async \`await for (final x in stream) { ... }\`. Własny stream: funkcja \`async*\` z \`yield\`.
\`\`\`dart
Stream<int> odliczaj(int n) async* {
  for (var i = n; i > 0; i--) {
    await Future.delayed(const Duration(seconds: 1));
    yield i;
  }
}
\`\`\`
6. Stream single-subscription (domyślny, np. \`File.openRead()\`) można słuchać tylko raz. Broadcast (\`StreamController.broadcast()\`, \`asBroadcastStream()\`) przyjmuje wielu słuchaczy, ale zdarzenia sprzed subskrypcji przepadają.
7. \`listen\` zwraca \`StreamSubscription\`; wywołaj \`cancel()\`, gdy już nie słuchasz (we Flutterze w \`dispose\`).
8. Ciężkie obliczenia blokują jedyny wątek, nawet w funkcji \`async\`. Przenosi się je do osobnego izolatu (isolate): \`await Isolate.run(...)\` albo \`compute(...)\` we Flutterze. Izolat ma własną pamięć i komunikuje się wiadomościami.`,
    why: `Jeden wątek z pętlą zdarzeń oznacza brak wyścigów na współdzielonej pamięci i proste UI: kod Darta nigdy nie jest przerywany w połowie przez inny kod Darta. Alternatywy: wątki ze współdzieloną pamięcią i blokadami (Java, Kotlin bez korutyn), callbacki, Rx (RxDart dokłada operatory do Streamów). Kompromis: wszystko, co długo liczy się synchronicznie, zatrzymuje rysowanie klatek, więc obliczenia trzeba świadomie wynosić do izolatów.`,
    practice: `Żądania HTTP (\`http.get\` zwraca \`Future<Response>\`), odczyt i zapis plików, \`SharedPreferences.getInstance()\`, Firebase (\`snapshots()\` zwraca \`Stream\`), nasłuch pozycji GPS, \`StreamController\` jako prosty kanał zdarzeń, parsowanie dużego JSON-a w \`compute\`.`,
    pitfalls: [
      `Brak \`await\`: \`final r = http.get(url);\` to \`Future<Response>\`, a nie odpowiedź. Analyzer z lintem \`unawaited_futures\` to wyłapuje.`,
      `\`await\` w pętli dla niezależnych żądań: 5 żądań po 300 ms trwa 1,5 s zamiast 300 ms z \`Future.wait\`.`,
      `Drugie \`listen\` na streamie single-subscription: \`Bad state: Stream has already been listened to.\`.`,
      `Brak \`cancel()\` subskrypcji w \`dispose\`: callback wywołuje \`setState\` na usuniętym widgecie i trzyma go w pamięci.`,
    ],
    verify: `Wstaw \`debugPrint\` z etykietami (sync, micro, event) i porównaj z regułą kolejek. W DevTools zakładka Performance pokazuje klatki: długi pasek na wątku UI (powyżej około 16 ms przy 60 Hz) to blokujące obliczenie. W testach jednostkowych \`expect(await pobierz(), 42)\` oraz \`expect(stream, emitsInOrder([3, 2, 1]))\`. \`flutter analyze\` z lintem \`unawaited_futures\` znajdzie zapomniane \`await\`.`,
    simplification: `„Jeden wątek” dotyczy jednego izolatu. Silnik Fluttera ma osobne wątki, np. raster i I/O, a Ty możesz uruchomić kolejne izolaty. Na web izolaty nie działają w ten sam sposób i \`compute\` wykonuje pracę w tym samym wątku.`,
    misconceptions: [
      {
        key: 'await-blocks-ui',
        text: `\`await\` zatrzymuje cały program i UI, dopóki \`Future\` się nie zakończy.`,
        fix: `\`await\` zawiesza tylko bieżącą funkcję. Pętla zdarzeń w tym czasie rysuje klatki i obsługuje dotyk. UI blokuje natomiast długi kod synchroniczny, również taki, który leży w funkcji \`async\`.`,
      },
      {
        key: 'async-runs-in-background',
        text: `Oznaczenie funkcji jako \`async\` przenosi jej kod do osobnego wątku w tle.`,
        fix: `Funkcja \`async\` działa w tym samym izolacie co UI. \`async\` tylko pozwala czekać bez blokowania. Prawdziwie równoległe obliczenia daje \`Isolate.run\` albo \`compute\`.`,
      },
      {
        key: 'future-before-microtask',
        text: `\`Future(() => ...)\` wykona się od razu albo przed mikrozadaniami, bo zostało utworzone wcześniej.`,
        fix: `\`Future(() => ...)\` trafia do kolejki zdarzeń. Wykona się dopiero po całym kodzie synchronicznym i po opróżnieniu kolejki mikrozadań, niezależnie od kolejności w kodzie.`,
      },
    ],
    quiz: [
      {
        q: `Co wypisze kod?
\`\`\`dart
import 'dart:async';

void main() {
  print('A');
  Future(() => print('B'));
  Future.microtask(() => print('C'));
  scheduleMicrotask(() => print('D'));
  print('E');
}
\`\`\``,
        kind: 'predict',
        options: ['A B C D E', 'A E B C D', 'A E C D B', 'A C D E B'],
        answer: 2,
        explain: `Najpierw kod synchroniczny: A i E. Potem cała kolejka mikrozadań w kolejności dodania: C, D. Na końcu zdarzenie z kolejki zdarzeń utworzone przez \`Future(() ...)\`: B.`,
        misconceptionByOption: { 0: 'future-before-microtask', 1: 'future-before-microtask' },
      },
      {
        q: `Co wypisze kod?
\`\`\`dart
Future<void> pobierz() async {
  print('2');
  await Future.delayed(const Duration(seconds: 1));
  print('4');
}

void main() {
  print('1');
  pobierz();
  print('3');
}
\`\`\``,
        kind: 'predict',
        options: ['1 2 4 3', '1 2 3 4', '1 3 2 4'],
        answer: 1,
        explain: `\`pobierz\` wykonuje się synchronicznie do \`await\` (2), potem jest zawieszona i sterowanie wraca do \`main\` (3). Po sekundzie kontynuacja wypisuje 4. \`main\` nie czeka, bo nie ma tam \`await\`.`,
        misconceptionByOption: { 0: 'await-blocks-ui', 2: 'async-runs-in-background' },
      },
      {
        q: `Po naciśnięciu przycisku animacja ładowania zamarza na kilka sekund. Dlaczego?
\`\`\`dart
Future<int> policz() async {
  var suma = 0;
  for (var i = 0; i < 2000000000; i++) {
    suma += i;
  }
  return suma;
}

// w onPressed:
final wynik = await policz();
\`\`\``,
        kind: 'diagnose',
        options: [
          '`await` blokuje UI; wystarczy zamienić je na `.then(...)`',
          'Funkcja async działa w tle, więc wystarczy dodać async także do onPressed',
          'Pętla jest synchroniczna i blokuje jedyny wątek UI, async tego nie zmienia; trzeba użyć `await Isolate.run(...)` albo `compute`',
        ],
        answer: 2,
        explain: `Kod do pierwszego \`await\` wykonuje się synchronicznie, a tu \`await\` w środku w ogóle nie ma. Pętla zajmuje wątek, więc nie powstają nowe klatki. \`then\` niczego nie zmieni, bo problemem jest obliczenie, a nie czekanie.`,
        misconceptionByOption: { 0: 'await-blocks-ui', 1: 'async-runs-in-background' },
      },
    ],
  },

  // ───────────────────────── mobile: Flutter ─────────────────────────
  {
    id: 'flutter-widgets',
    name: 'Widgety we Flutterze (widgets)',
    en: 'widgets',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['classes', 'dart-basics'],
    weight: 3,
    intuition: `We Flutterze ekran opisujesz jako drzewo widgetów: \`Scaffold\` zawiera \`AppBar\` i \`Column\`, a w kolumnie są \`Text\` i \`ElevatedButton\`. Widget to lekki, niezmienny opis kawałka UI („tak ma wyglądać”), a nie sam element na ekranie. Gdy coś się zmienia, Flutter buduje nowy opis i porównuje go z poprzednim.`,
    mechanism: `1. \`runApp(const MojaApka())\` ustawia korzeń drzewa widgetów.
2. \`StatelessWidget\` ma pola \`final\` (konfigurację) i metodę \`Widget build(BuildContext context)\`, która zwraca poddrzewo.
\`\`\`dart
class Powitanie extends StatelessWidget {
  const Powitanie({super.key, required this.imie});
  final String imie;

  @override
  Widget build(BuildContext context) => Text('Cześć, $imie');
}
\`\`\`
3. \`build\` może być wywołane wiele razy, np. przy każdej przebudowie rodzica albo zmianie rozmiaru ekranu. Ma być szybkie i bez efektów ubocznych.
4. \`BuildContext\` to położenie widgetu w drzewie. Przez niego \`Theme.of(context)\`, \`MediaQuery.of(context)\` i \`Navigator.of(context)\` szukają przodków.
5. \`const\` konstruktor i \`const Text('Hej')\`: instancja powstaje raz, przy kompilacji. Gdy przy przebudowie Flutter dostaje tę samą instancję, pomija przebudowę tego poddrzewa.
6. Kompozycja zamiast dziedziczenia: własny przycisk to \`StatelessWidget\`, którego \`build\` zwraca \`ElevatedButton\` ze stylem, a nie klasa \`extends ElevatedButton\`. Same widgety Fluttera są tak zbudowane: \`Container\` składa się z \`Padding\`, \`DecoratedBox\`, \`ConstrainedBox\` i innych.
7. Trzy drzewa: Widget (niezmienny opis, tani do utworzenia), Element (trwała instancja w drzewie, trzyma \`State\`), RenderObject (rozmiar, pozycja, malowanie). Gdy w tym samym miejscu pojawia się widget tego samego typu i z tym samym \`key\`, Element aktualizuje istniejący RenderObject zamiast tworzyć nowy.`,
    why: `To UI deklaratywne: opisujesz wygląd dla danego stanu, a framework sam liczy, co zmienić na ekranie. Alternatywy: UI imperatywne (klasyczne Android View z \`textView.setText(...)\`, UIKit), gdzie ręcznie zmieniasz istniejące kontrolki; React z bardzo podobnym modelem komponentów; SwiftUI i Jetpack Compose, czyli deklaratywne UI natywne. Kompromis: głębokie zagnieżdżenia w \`build\` i dużo krótko żyjących obiektów. Pierwsze rozwiązuje się dzieleniem na mniejsze widgety, drugie jest tanie, bo Dart ma zbieracz śmieci (GC) zoptymalizowany pod takie obiekty.`,
    practice: `Każdy ekran w Twojej aplikacji. Gdy \`build\` rośnie, wydziel fragmenty do osobnych klas widgetów zamiast metod \`Widget _buildNaglowek()\`: klasa ma własny Element, może być \`const\` i przebudowuje się niezależnie. Claude generuje zwykle \`StatelessWidget\` dla elementów bez własnego stanu.`,
    pitfalls: [
      `Ciężka praca w \`build\`: żądania HTTP, parsowanie JSON, tworzenie kontrolerów. Wykona się przy każdej przebudowie.`,
      `Brak \`const\` przy stałych widgetach i niepotrzebne przebudowy. Lint \`prefer_const_constructors\` to podpowiada.`,
      `Dziedziczenie po widgetach Fluttera zamiast kompozycji.`,
      `\`Scaffold.of(context)\` wywołane z \`context\` tego samego \`build\`, który tworzy \`Scaffold\`: ten context leży nad \`Scaffold\`, więc go nie znajdzie. Pomaga \`Builder\` albo wydzielony widget.`,
    ],
    verify: `Flutter DevTools, zakładka Widget Inspector: drzewo widgetów, tryb „Select Widget Mode” wskazuje widget po kliknięciu na ekranie. \`debugPrint('build Powitanie')\` w \`build\` pokaże, ile razy jest wywoływany. Test widgetu:
\`\`\`dart
testWidgets('pokazuje imię', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: Powitanie(imie: 'Ola')));
  expect(find.text('Cześć, Ola'), findsOneWidget);
});
\`\`\`
Hot reload ponownie wywołuje \`build\` z nowym kodem i zachowuje stan; hot restart buduje aplikację od zera.`,
    simplification: `„Wszystko jest widgetem” dotyczy opisu UI. Pod spodem działają Elementy i RenderObjecty, a stan trzyma obiekt \`State\`, który widgetem nie jest. Widget może być też niewidoczny: \`Padding\`, \`Theme\` czy \`GestureDetector\` niczego nie rysują same.`,
    misconceptions: [
      {
        key: 'widget-is-view',
        text: `Widget to obiekt na ekranie, który można zmieniać, tak jak \`View\` na Androidzie.`,
        fix: `Widget to niezmienny opis z polami \`final\`. Zmiana wyglądu oznacza zbudowanie nowego widgetu. Trwałe są Element i RenderObject, które Flutter aktualizuje na podstawie nowego opisu.`,
      },
      {
        key: 'build-called-once',
        text: `\`build\` wywołuje się raz, gdy widget pojawia się na ekranie.`,
        fix: `\`build\` może się wykonać wiele razy: przy przebudowie rodzica, zmianie motywu, rozmiaru ekranu, klawiatury. Dlatego nie umieszcza się w nim żądań ani tworzenia zasobów.`,
      },
      {
        key: 'extend-to-customize',
        text: `Żeby dostosować wygląd gotowego widgetu, trzeba po nim dziedziczyć.`,
        fix: `Flutter stawia na kompozycję: tworzysz nowy widget, który w \`build\` składa gotowe widgety z odpowiednimi parametrami. Większość widgetów Fluttera nie jest projektowana do dziedziczenia.`,
      },
    ],
    quiz: [
      {
        q: `Serwer dostaje dziesiątki żądań, choć ekran otwarto raz. Dlaczego?
\`\`\`dart
class Lista extends StatelessWidget {
  const Lista({super.key});

  @override
  Widget build(BuildContext context) {
    http.get(Uri.parse('https://api.example.com/items'));
    return const Text('Lista');
  }
}
\`\`\``,
        kind: 'diagnose',
        options: [
          'Flutter wywołuje build tylko raz, więc problem leży po stronie serwera',
          '`build` jest wywoływane wiele razy, a każde wywołanie wysyła żądanie; pobieranie trzeba przenieść poza build',
          'StatelessWidget w ogóle nie może wysyłać żądań, to błąd kompilacji',
        ],
        answer: 1,
        explain: `\`build\` wykonuje się przy każdej przebudowie, np. gdy zmieni się \`MediaQuery\` albo przebuduje się rodzic. Dane pobiera się w \`initState\` widgetu stanowego albo w warstwie stanu.`,
        misconceptionByOption: { 0: 'build-called-once' },
      },
      {
        q: `Co się stanie?
\`\`\`dart
@override
Widget build(BuildContext context) {
  final t = Text('A');
  t.data = 'B';
  return t;
}
\`\`\``,
        kind: 'predict',
        options: [
          'Błąd kompilacji: pole data w Text jest final',
          'Ekran pokaże B',
          'Ekran pokaże A, a potem zmieni się na B',
        ],
        answer: 0,
        explain: `Widgety są niezmienne, ich pola są \`final\`. Żeby pokazać B, tworzysz nowy widget \`Text('B')\`, zwykle w kolejnym \`build\` po zmianie stanu.`,
        misconceptionByOption: { 1: 'widget-is-view', 2: 'widget-is-view' },
      },
      {
        q: `Chcesz mieć w całej aplikacji jednolity przycisk z ikoną i zaokrąglonymi rogami. Jak to zrobić we Flutterze?`,
        kind: 'choice',
        options: [
          'Napisać `class MojPrzycisk extends ElevatedButton` i nadpisać w nim build',
          'Skopiować kod ElevatedButton z SDK i go zmienić',
          'Napisać `StatelessWidget` MojPrzycisk, który w build zwraca `ElevatedButton.icon(...)` z ustawionym stylem',
        ],
        answer: 2,
        explain: `Kompozycja: nowy widget składa gotowy przycisk z parametrami. Wspólny wygląd wszystkich przycisków da się też ustawić w motywie (\`ThemeData(elevatedButtonTheme: ...)\`).`,
        misconceptionByOption: { 0: 'extend-to-customize' },
      },
    ],
  },
  {
    id: 'flutter-state',
    name: 'Stan widgetu (StatefulWidget i setState)',
    en: 'StatefulWidget and setState',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['flutter-widgets'],
    weight: 3,
    intuition: `Stan to dane widgetu, które zmieniają się w czasie i wpływają na wygląd: licznik, zaznaczony checkbox, wpisany tekst. \`StatefulWidget\` trzyma je w osobnym obiekcie \`State\`, który przetrwa przebudowy. Zmieniasz je w \`setState(() { ... })\`, a Flutter wtedy ponownie wywołuje \`build\` i odświeża ekran.`,
    mechanism: `1. Dwie klasy: niezmienny widget i trwały \`State\`.
\`\`\`dart
class Licznik extends StatefulWidget {
  const Licznik({super.key});
  @override
  State<Licznik> createState() => _LicznikState();
}

class _LicznikState extends State<Licznik> {
  int _n = 0;
  @override
  Widget build(BuildContext context) => TextButton(
        onPressed: () => setState(() => _n++),
        child: Text('$_n'),
      );
}
\`\`\`
2. \`setState(fn)\` wykonuje \`fn\` od razu, oznacza Element jako „brudny” (dirty) i planuje \`build\` w najbliższej klatce. Callback musi być synchroniczny.
3. Zmiana pola bez \`setState\` zmienia wartość w pamięci, ale Flutter o tym nie wie i nie wywoła \`build\`. Ekran pokaże nową wartość dopiero przy jakiejś innej przebudowie.
4. Cykl życia: \`createState\`, \`initState\` (raz: kontrolery, subskrypcje, start pobierania), \`didChangeDependencies\`, \`build\` (wiele razy), \`didUpdateWidget(oldWidget)\` (rodzic przekazał nową konfigurację, porównaj \`widget.x\` z \`oldWidget.x\`), \`dispose\` (raz: zwolnij kontrolery, anuluj subskrypcje i timery).
5. W \`State\` konfigurację z widgetu czytasz przez \`widget.pole\`; zawsze wskazuje aktualny widget.
6. \`mounted\` jest \`true\`, dopóki \`State\` jest w drzewie. Po \`dispose\` wynosi \`false\`.
7. \`setState\` po \`dispose\` kończy się błędem \`setState() called after dispose()\`. Typowy scenariusz: \`await\` na odpowiedź z sieci, a użytkownik w tym czasie zamknął ekran. Ochrona: \`if (!mounted) return;\` po każdym \`await\`, przed \`setState\`.
8. \`State\` przetrwa przebudowę rodzica, jeśli w tym samym miejscu drzewa jest widget tego samego typu z tym samym \`key\`.`,
    why: `Podział na widget i \`State\` pozwala, by opis UI był tani i niezmienny, a dane przetrwały kolejne przebudowy. \`setState\` daje Flutterowi jawny sygnał, co odświeżyć. Alternatywy: \`ValueNotifier\` z \`ValueListenableBuilder\` (przebudowuje tylko fragment), przeniesienie stanu wyżej (lifting state up) albo biblioteka do zarządzania stanem (Provider, Riverpod, Bloc). Kompromis: \`setState\` przebudowuje cały \`build\` danego \`State\`, więc widgety stanowe warto trzymać małe i nisko w drzewie.`,
    practice: `Formularze z \`TextEditingController\`, przełączniki i checkboxy, liczniki, rozwijane sekcje, animacje (\`AnimationController\` tworzony w \`initState\`, zwalniany w \`dispose\`), ekran pobierający dane w \`initState\`. Claude w kodzie z \`await\` przed \`setState\` powinien dodawać sprawdzenie \`mounted\`; jeśli go brakuje, to sygnał do poprawki.`,
    pitfalls: [
      `\`setState\` po \`await\` bez \`if (!mounted) return;\`: błąd, gdy użytkownik wyjdzie z ekranu przed końcem żądania.`,
      `Brak \`dispose\` dla \`AnimationController\`, \`TextEditingController\`, \`StreamSubscription\`, \`Timer\`: wycieki pamięci i callbacki działające po zamknięciu ekranu.`,
      `\`TextEditingController()\` utworzony w \`build\`: nowy kontroler przy każdej przebudowie gubi wpisany tekst i kursor.`,
      `Skopiowanie \`widget.wartosc\` do pola w \`initState\` bez obsługi \`didUpdateWidget\`: gdy rodzic przekaże nową wartość, ekran pokazuje starą.`,
    ],
    verify: `\`debugPrint\` w \`initState\`, \`build\` i \`dispose\` pokazuje cykl życia w konsoli. W DevTools Widget Inspector zobaczysz widget i jego właściwości; zakładka Performance pomaga wychwycić zbyt częste przebudowy. Test widgetu:
\`\`\`dart
await tester.pumpWidget(const MaterialApp(home: Licznik()));
await tester.tap(find.byType(TextButton));
await tester.pump();
expect(find.text('1'), findsOneWidget);
\`\`\`
\`pump()\` jest potrzebne, bo \`setState\` tylko planuje przebudowę. Hot reload zachowuje \`State\` i nie uruchamia ponownie \`initState\`; zmiany w \`initState\` albo wartościach początkowych pól wymagają hot restartu.`,
    misconceptions: [
      {
        key: 'setstate-after-dispose',
        text: `Po \`await\` można spokojnie wywołać \`setState\`, bo widget na pewno nadal jest na ekranie.`,
        fix: `W trakcie \`await\` użytkownik może zamknąć ekran i \`State\` dostaje \`dispose\`. Wtedy \`setState\` kończy się błędem \`setState() called after dispose()\`. Po każdym \`await\` sprawdzaj \`if (!mounted) return;\`, a subskrypcje anuluj w \`dispose\`.`,
      },
      {
        key: 'setstate-mutates-without-rebuild',
        text: `Wystarczy zmienić pole w \`State\`, a ekran sam się odświeży; \`setState\` to tylko ładniejszy zapis.`,
        fix: `Flutter nie śledzi pól. Bez \`setState\` wartość zmienia się w pamięci, ale \`build\` nie jest wywołany i ekran pokazuje starą wartość, dopóki coś innego nie wymusi przebudowy.`,
      },
      {
        key: 'initstate-every-build',
        text: `\`initState\` wywołuje się przy każdej przebudowie widgetu.`,
        fix: `\`initState\` wykonuje się raz, gdy \`State\` trafia do drzewa. Przy każdej przebudowie wywoływany jest tylko \`build\`, a przy nowej konfiguracji od rodzica dodatkowo \`didUpdateWidget\`.`,
      },
    ],
    quiz: [
      {
        q: `Użytkownik klika przycisk trzy razy. Co pokazuje ekran?
\`\`\`dart
class _LicznikState extends State<Licznik> {
  int _n = 0;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () {
        _n++;
      },
      child: Text('$_n'),
    );
  }
}
\`\`\``,
        kind: 'predict',
        options: ['3', '0', '1', 'Błąd: pole nie może być zmienione poza setState'],
        answer: 1,
        explain: `\`_n\` w pamięci wynosi 3, ale bez \`setState\` Flutter nie wywołał ponownie \`build\`, więc \`Text\` nadal pokazuje 0. Poprawnie: \`onPressed: () => setState(() => _n++)\`.`,
        misconceptionByOption: { 0: 'setstate-mutates-without-rebuild' },
      },
      {
        q: `W logach pojawia się \`setState() called after dispose()\`, gdy użytkownik szybko cofa się z ekranu. Dlaczego?
\`\`\`dart
Future<void> _laduj() async {
  final dane = await api.pobierz();
  setState(() => _dane = dane);
}
\`\`\``,
        kind: 'diagnose',
        options: [
          'setState trzeba wywołać przed await',
          'setState po await jest zawsze bezpieczne, to błąd w Flutterze',
          'Ekran został zamknięty (dispose) przed końcem await; przed setState trzeba dodać `if (!mounted) return;`',
          'api.pobierz zwraca zły typ danych',
        ],
        answer: 2,
        explain: `\`await\` trwa, a w tym czasie \`Navigator.pop\` usuwa ekran i wywołuje \`dispose\`. Kontynuacja po \`await\` i tak się wykona, a \`setState\` na usuniętym \`State\` zgłasza błąd.`,
        misconceptionByOption: { 1: 'setstate-after-dispose' },
      },
      {
        q: `Ekran pojawia się, a potem użytkownik dwa razy klika przycisk, który wywołuje \`setState\`. Co jest w konsoli?
\`\`\`dart
@override
void initState() {
  super.initState();
  debugPrint('init');
}

@override
Widget build(BuildContext context) {
  debugPrint('build');
  return ElevatedButton(
    onPressed: () => setState(() {}),
    child: const Text('Klik'),
  );
}
\`\`\``,
        kind: 'predict',
        options: ['init build build build', 'init build init build init build', 'init build'],
        answer: 0,
        explain: `\`initState\` wykonuje się raz. Pierwszy \`build\` przy wyświetleniu, potem po jednym \`build\` na każde \`setState\`.`,
        misconceptionByOption: { 1: 'initstate-every-build' },
      },
    ],
  },
  {
    id: 'flutter-layout',
    name: 'Układ we Flutterze (layout)',
    en: 'layout',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['flutter-widgets'],
    weight: 3,
    intuition: `Układ we Flutterze działa według jednej zasady: ograniczenia idą w dół, rozmiary idą w górę, a pozycję ustala rodzic (constraints go down, sizes go up, parent sets position). Rodzic mówi dziecku „możesz mieć od 0 do 400 px szerokości”, dziecko wybiera rozmiar w tych granicach, a rodzic decyduje, gdzie je postawić. Większość błędów layoutu to sytuacje, w których któraś strona nie dostała sensownych granic.`,
    mechanism: `1. Rodzic przekazuje dziecku \`BoxConstraints\` (min i max szerokości oraz wysokości). Dziecko wybiera rozmiar w tych granicach i go zwraca. Rodzic ustawia pozycję dziecka.
2. Widget nie może wyjść poza ograniczenia: \`Container(width: 100, height: 100)\` jako korzeń aplikacji i tak wypełni cały ekran, bo ekran narzuca dokładny rozmiar (tight constraints). Żeby był kwadratem 100 x 100, potrzebny jest rodzic dający luźne granice, np. \`Center\`.
3. \`Row\` i \`Column\` (Flex): oś główna (main axis) i poprzeczna (cross axis). Najpierw układają dzieci bez \`flex\`, dając im nieograniczony wymiar w osi głównej, potem resztę miejsca dzielą między \`Expanded\` i \`Flexible\` według \`flex\`. Wyrównanie: \`mainAxisAlignment\`, \`crossAxisAlignment\`.
4. \`Expanded\` wymusza zajęcie całego przydzielonego miejsca. \`Flexible\` pozwala dziecku być mniejszym. Oba działają tylko jako bezpośrednie dziecko \`Row\`, \`Column\` albo \`Flex\`.
5. Gdy dzieci bez \`flex\` są większe niż dostępne miejsce: \`A RenderFlex overflowed by 42 pixels on the right\` i żółto-czarne paski w trybie debug.
6. \`Padding\` dodaje odstęp, \`SizedBox\` daje stały rozmiar albo pusty odstęp (\`SizedBox(height: 16)\`), \`Stack\` z \`Positioned\` nakłada widgety na siebie, \`ListView\` przewija zawartość; \`ListView.builder\` tworzy elementy leniwie, tylko widoczne.
7. \`ListView\` w osi przewijania chce zająć całe dostępne miejsce, a \`Column\` daje dzieciom nieograniczoną wysokość. Razem: \`Vertical viewport was given unbounded height\`. Rozwiązanie: \`Expanded(child: ListView(...))\` albo \`SizedBox\` z wysokością. \`shrinkWrap: true\` też usuwa błąd, ale buduje od razu wszystkie elementy.`,
    why: `Jednoprzebiegowy layout jest szybki i przewidywalny: każdy RenderObject jest układany raz na klatkę, w czasie liniowym względem liczby widgetów. Alternatywy: CSS (flexbox jest podobny, ale przeglądarka ma wiele trybów układu i rozmiary zależne od treści), Android \`ConstraintLayout\`, iOS Auto Layout (układ równań więzów, elastyczny, ale wolniejszy i trudniejszy do debugowania). Kompromis: dziecko nie zna rozmiaru rodzica wprost (potrzebny \`LayoutBuilder\`), a błędy „unbounded” są dla początkujących częste i mało intuicyjne.`,
    practice: `Każdy ekran: formularz w \`Column\` z \`Padding\` i odstępami \`SizedBox\`, wiersz listy z ikoną i tekstem (\`Row\` + \`Expanded\` na tekście), lista produktów (\`ListView.builder\`), napis na zdjęciu (\`Stack\`), ekran z nagłówkiem i przewijaną listą pod spodem (\`Column\` + \`Expanded(child: ListView...)\`).`,
    pitfalls: [
      `\`ListView\` albo \`GridView\` bezpośrednio w \`Column\` bez \`Expanded\`: błąd unbounded height.`,
      `Długi \`Text\` w \`Row\` bez \`Expanded\` lub \`Flexible\`: overflow na wąskich telefonach, choć na emulatorze tabletu wszystko wyglądało dobrze.`,
      `\`Expanded\` poza \`Row\`/\`Column\`/\`Flex\` (np. w \`Stack\` albo \`Padding\` nad nim): \`Incorrect use of ParentDataWidget\`.`,
      `\`shrinkWrap: true\` na długiej liście jako „naprawa”: tracisz leniwe budowanie i płynność przewijania.`,
    ],
    verify: `DevTools, Widget Inspector, panel Layout Explorer pokazuje ograniczenia, rozmiary i \`flex\` dla \`Row\`/\`Column\`. Przełącznik „Show Guidelines” (albo \`debugPaintSizeEnabled = true\`) rysuje granice wszystkich widgetów. Test na wąskim ekranie: \`await tester.binding.setSurfaceSize(const Size(320, 640));\` przed \`pumpWidget\`; overflow w teście widgetu zgłasza wyjątek i test nie przechodzi. Zmiany layoutu widać po hot reload.`,
    misconceptions: [
      {
        key: 'unbounded-listview-in-column',
        text: `\`ListView\` w \`Column\` sama dopasuje wysokość do zawartości, tak jak \`div\` w HTML.`,
        fix: `\`Column\` daje dzieciom nieograniczoną wysokość, a \`ListView\` chce zająć całe dostępne miejsce w osi przewijania. Bez granic nie da się jej ułożyć. Owiń ją w \`Expanded\` (weź resztę ekranu) albo \`SizedBox(height: ...)\`.`,
      },
      {
        key: 'child-picks-any-size',
        text: `Jeśli ustawię \`width: 100\`, widget zawsze będzie miał 100 px szerokości.`,
        fix: `Rozmiar podany w widgecie to prośba, którą rodzic może zignorować przez swoje ograniczenia. Przy ograniczeniach ścisłych (tight) dziecko dostaje dokładnie wymiar rodzica. Wtedy trzeba zmienić rodzica, np. dodać \`Center\` albo \`Align\`.`,
      },
      {
        key: 'overflow-is-cosmetic',
        text: `Żółto-czarne paski overflow to tylko ostrzeżenie w trybie debug, w wersji release problemu nie ma.`,
        fix: `W release pasków nie widać, ale treść nadal się nie mieści i jest ucięta. Overflow trzeba naprawić: \`Expanded\`/\`Flexible\`, \`TextOverflow.ellipsis\`, zawijanie albo przewijanie.`,
      },
    ],
    quiz: [
      {
        q: `Ekran wyrzuca \`Vertical viewport was given unbounded height\`. Dlaczego?
\`\`\`dart
Column(
  children: [
    const Text('Produkty'),
    ListView(
      children: [for (final p in produkty) Text(p)],
    ),
  ],
)
\`\`\``,
        kind: 'diagnose',
        options: [
          'ListView powinna sama dopasować się do zawartości, więc lista produkty musi być pusta',
          'Column daje ListView nieograniczoną wysokość, a ListView chce zająć całe dostępne miejsce; trzeba owinąć ją w Expanded',
          'Każdy element ListView musi mieć key',
          'Column nie może mieć więcej niż jednego dziecka',
        ],
        answer: 1,
        explain: `\`Column\` układa dzieci bez \`flex\` z nieograniczoną wysokością. \`ListView\` w osi przewijania rozszerza się do maksimum, a maksimum to nieskończoność. \`Expanded\` daje jej skończoną wysokość: resztę ekranu.`,
        misconceptionByOption: { 0: 'unbounded-listview-in-column' },
      },
      {
        q: `Co zobaczysz na ekranie?
\`\`\`dart
void main() {
  runApp(
    Container(width: 100, height: 100, color: Colors.red),
  );
}
\`\`\``,
        kind: 'predict',
        options: [
          'Czerwony kwadrat 100 x 100 w lewym górnym rogu',
          'Czerwony kwadrat 100 x 100 na środku',
          'Cały ekran na czerwono',
          'Błąd: brak MaterialApp',
        ],
        answer: 2,
        explain: `Korzeń aplikacji dostaje ograniczenia ścisłe równe rozmiarowi ekranu, więc \`Container\` nie może wybrać 100 x 100. Z \`Center(child: Container(...))\` byłby kwadrat na środku, bo \`Center\` daje dziecku luźne granice.`,
        misconceptionByOption: { 0: 'child-picks-any-size', 1: 'child-picks-any-size' },
      },
      {
        q: `Na wąskim telefonie w trybie debug przy prawej krawędzi pojawia się żółto-czarny pasek. Co z tym zrobić?
\`\`\`dart
Row(
  children: [
    const Icon(Icons.person),
    Text(uzytkownik.pelnaNazwaIAdresEmail),
  ],
)
\`\`\``,
        kind: 'diagnose',
        options: [
          'Owinąć Text w Expanded (opcjonalnie z overflow: TextOverflow.ellipsis), żeby dostał skończoną szerokość',
          'Nic, to ostrzeżenie tylko w debug, w release tekst będzie w porządku',
          'Zamienić Row na Stack',
        ],
        answer: 0,
        explain: `\`Row\` daje \`Text\` bez \`flex\` nieograniczoną szerokość, więc tekst układa się w jednej linii i wychodzi poza ekran. \`Expanded\` ogranicza go do pozostałego miejsca, więc tekst się zawinie albo zostanie ucięty wielokropkiem.`,
        misconceptionByOption: { 1: 'overflow-is-cosmetic' },
      },
    ],
  },
  {
    id: 'flutter-navigation',
    name: 'Nawigacja we Flutterze (Navigator, routing)',
    en: 'navigation and routing',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['flutter-widgets'],
    weight: 2,
    intuition: `Ekrany w aplikacji mobilnej układają się w stos (stack), jak talia kart. Otwarcie nowego ekranu kładzie kartę na wierzch (\`push\`), a „wstecz” zdejmuje ją (\`pop\`) i pokazuje tę pod spodem. Poprzedni ekran cały czas leży pod spodem razem ze swoim stanem.`,
    mechanism: `1. \`Navigator\` (tworzy go \`MaterialApp\`) trzyma stos obiektów \`Route\`. Widoczna jest górna trasa.
2. \`Navigator.push(context, MaterialPageRoute(builder: (context) => Szczegoly(produkt: p)))\` kładzie nowy ekran na stos. Dane w przód przekazujesz przez konstruktor nowego ekranu.
3. \`Navigator.pop(context, wynik)\` zdejmuje górny ekran. \`push\` zwraca \`Future<T?>\`, który kończy się wartością z \`pop\`:
\`\`\`dart
final kolor = await Navigator.push<String>(
  context,
  MaterialPageRoute(builder: (_) => const WyborKoloru()),
);
// kolor == null, gdy użytkownik cofnął się bez wyboru
\`\`\`
4. \`pushReplacement\` podmienia górny ekran (np. logowanie na start), \`pushAndRemoveUntil\` czyści stos do warunku, \`popUntil\` zdejmuje kilka ekranów.
5. Named routes: \`MaterialApp(routes: {'/szczegoly': (context) => const Szczegoly()})\` i \`Navigator.pushNamed(context, '/szczegoly', arguments: p)\`; odczyt: \`ModalRoute.of(context)!.settings.arguments as Produkt\`. Argumenty nie są typowane, a dokumentacja Fluttera nie poleca już tego podejścia w większości aplikacji.
6. go_router: routing oparty na ścieżkach URL (Router API). \`GoRoute(path: '/produkt/:id', builder: ...)\`; \`context.go('/produkt/7')\` ustawia stos według ścieżki, \`context.push('/produkt/7')\` kładzie ekran na wierzch. Obsługuje deep linki i adresy w przeglądarce.
7. Przycisk wstecz w Androidzie i gest na iOS wywołują \`pop\`. \`PopScope\` (następca \`WillPopScope\`) pozwala to przechwycić, np. przy niezapisanym formularzu.`,
    why: `Stos odpowiada temu, jak użytkownik rozumie „wstecz”, a zachowanie poprzednich ekranów w pamięci daje natychmiastowy powrót z zachowaną pozycją przewijania. Alternatywy: imperatywny \`Navigator\` (prosty, idealny na start), deklaratywny Router API przez go_router albo auto_route (URL, deep linki, web), zakładki z \`IndexedStack\` dla dolnej nawigacji. Kompromis: \`Navigator.push\` jest najprostszy, ale trudno odtworzyć z niego stan aplikacji z linku; go_router wymaga konfiguracji tras, za to stos wynika z adresu.`,
    practice: `Lista produktów i ekran szczegółów, ekran wyboru (kolor, adres) zwracający wynik przez \`pop\`, logowanie zamieniane na ekran główny przez \`pushReplacement\`, otwarcie konkretnego ekranu z powiadomienia push albo linku (go_router), dialogi (\`showDialog\` to też trasa na stosie, zamykana przez \`Navigator.pop\`).`,
    pitfalls: [
      `\`Navigator.push\` z \`context\`, nad którym nie ma \`Navigator\` (np. \`context\` widgetu, który sam tworzy \`MaterialApp\`): \`Navigator operation requested with a context that does not include a Navigator\`.`,
      `\`Navigator.push(context, ...)\` po \`await\` bez sprawdzenia \`if (!context.mounted) return;\`.`,
      `Brak obsługi \`null\` z \`await Navigator.push\`, gdy użytkownik wróci strzałką zamiast wybrać wartość.`,
      `Mieszanie \`context.go\` i \`context.push\` w go_router: \`go\` przebudowuje stos według ścieżki, więc „wstecz” może nie wrócić tam, gdzie się spodziewasz.`,
    ],
    verify: `\`debugPrint\` wyniku \`await Navigator.push\` pokaże, co zwrócił ekran (albo \`null\`). W DevTools Widget Inspector widać \`Navigator\` i jego trasy w \`Overlay\`. Test widgetu:
\`\`\`dart
await tester.tap(find.text('Szczegóły'));
await tester.pumpAndSettle(); // czeka na animację przejścia
expect(find.byType(Szczegoly), findsOneWidget);
\`\`\`
Hot reload zachowuje bieżący stos ekranów. Jeśli konfiguracja \`GoRouter\` leży w zmiennej globalnej, jej zmiana wymaga hot restartu.`,
    misconceptions: [
      {
        key: 'push-replaces-screen',
        text: `\`Navigator.push\` zamyka bieżący ekran i otwiera nowy w jego miejscu.`,
        fix: `\`push\` kładzie nowy ekran na wierzch stosu, a poprzedni zostaje pod spodem z całym stanem. Zastąpienie ekranu to \`pushReplacement\` albo \`pushAndRemoveUntil\`.`,
      },
      {
        key: 'push-returns-immediately',
        text: `Wynik z drugiego ekranu jest dostępny w linii zaraz po \`Navigator.push\`, bez czekania.`,
        fix: `\`push\` zwraca \`Future<T?>\`, który kończy się dopiero po \`pop\` drugiego ekranu. Trzeba go \`await\`, a wynik może być \`null\`, jeśli użytkownik wrócił bez wyboru.`,
      },
    ],
    quiz: [
      {
        q: `Użytkownik naciska przycisk, a na drugim ekranie wybiera „zielony” (\`Navigator.pop(context, 'zielony')\`). Co i kiedy pojawi się w konsoli?
\`\`\`dart
onPressed: () async {
  print('A');
  final kolor = await Navigator.push<String>(
    context,
    MaterialPageRoute(builder: (_) => const WyborKoloru()),
  );
  print('B: $kolor');
},
\`\`\``,
        kind: 'predict',
        options: [
          'A i od razu B: null',
          'A od razu, a B: zielony dopiero po wyborze koloru',
          'Tylko A, bo pierwszy ekran został zamknięty przy push',
        ],
        answer: 1,
        explain: `\`push\` zwraca \`Future\`, który kończy się w chwili \`pop\` z wartością \`'zielony'\`. Pierwszy ekran leży cały czas pod spodem, więc jego kod po \`await\` normalnie się wykona.`,
        misconceptionByOption: { 0: 'push-returns-immediately', 2: 'push-replaces-screen' },
      },
      {
        q: `Po udanym logowaniu chcesz pokazać ekran \`Start\` tak, żeby przycisk wstecz nie wracał do logowania. Czego użyć?`,
        kind: 'choice',
        options: [
          '`Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const Start()))`',
          '`Navigator.push(...)`, bo push i tak zamyka ekran logowania',
          '`Navigator.pop(context)` z ekranu logowania',
        ],
        answer: 0,
        explain: `\`pushReplacement\` usuwa ekran logowania ze stosu i kładzie \`Start\` w jego miejsce. Zwykły \`push\` zostawiłby logowanie pod spodem, więc „wstecz” by do niego wróciło.`,
        misconceptionByOption: { 1: 'push-replaces-screen' },
      },
      {
        q: `Aplikacja rzuca \`type 'int' is not a subtype of type 'Produkt' in type cast\` po wejściu w szczegóły. Dlaczego?
\`\`\`dart
// lista:
Navigator.pushNamed(context, '/szczegoly', arguments: produkt.id);
// ekran szczegółów:
final p = ModalRoute.of(context)!.settings.arguments as Produkt;
\`\`\``,
        kind: 'diagnose',
        options: [
          'pushNamed nie potrafi przekazywać argumentów',
          'Operator ! usuwa argumenty trasy',
          'Przekazano int (id), a odczytano jako Produkt; named routes nie sprawdzają typu argumentów przy kompilacji',
        ],
        answer: 2,
        explain: `\`arguments\` ma typ \`Object?\`, więc kompilator przepuszcza dowolną wartość, a błąd wychodzi dopiero przy rzutowaniu w runtime. Przekazanie danych przez konstruktor ekranu (\`MaterialPageRoute\`) albo typowane trasy w go_router tego unikają.`,
      },
    ],
  },
  {
    id: 'flutter-state-management',
    name: 'Zarządzanie stanem (Provider, Riverpod, Bloc)',
    en: 'state management',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['flutter-state'],
    weight: 2,
    intuition: `\`setState\` dobrze działa, dopóki stan jest potrzebny jednemu widgetowi. Gdy koszyk ma być widoczny na liście produktów, w ikonie w \`AppBar\` i na ekranie podsumowania, potrzebujesz miejsca na stan wyżej w drzewie i sposobu, żeby zainteresowane widgety dowiadywały się o zmianach. To robią Provider, Riverpod i Bloc, każdy trochę inaczej.`,
    mechanism: `1. Lifting state up: stan potrzebny dwóm widgetom trzymasz w ich wspólnym przodku i przekazujesz w dół przez konstruktor razem z callbackami (\`onChanged\`). Przy wielu poziomach to przekazywanie (prop drilling) staje się uciążliwe.
2. \`InheritedWidget\`: dowolny potomek odczyta go przez \`context.dependOnInheritedWidgetOfExactType<T>()\` (tak działa \`Theme.of(context)\`). Flutter zapamiętuje zależność i przy zmianie przebudowuje tylko zależne widgety.
3. Provider to wygodna nakładka na \`InheritedWidget\`. Klasa \`extends ChangeNotifier\` wywołuje \`notifyListeners()\` po zmianie. \`ChangeNotifierProvider(create: (_) => Koszyk(), child: ...)\` udostępnia obiekt w dół drzewa. \`context.watch<Koszyk>()\` w \`build\` subskrybuje zmiany, \`context.read<Koszyk>()\` w handlerach tylko pobiera obiekt, \`context.select\` i \`Consumer\` zawężają przebudowę.
4. Riverpod: providery to globalne deklaracje niezależne od drzewa widgetów, \`ProviderScope\` w korzeniu aplikacji, \`ConsumerWidget\` z \`ref.watch(...)\` w \`build\` i \`ref.read(...)\` w handlerach. Brak providera wykrywa kompilator, w testach łatwo podmienić provider (\`overrides\`), a \`AsyncValue\` porządkuje stany ładowania i błędu.
5. Bloc: UI wysyła zdarzenia (events), Bloc emituje nowe stany (states) jako \`Stream\`, \`BlocBuilder\` przebudowuje UI. \`Cubit\` to uproszczona wersja z metodami zamiast zdarzeń. Więcej kodu, za to jednoznaczny przepływ danych i łatwe testy.
6. Kiedy \`setState\` wystarcza: stan lokalny jednego widgetu (rozwinięta sekcja, wpisany tekst, animacja). Rozwiązanie współdzielone: dane potrzebne na kilku ekranach (zalogowany użytkownik, koszyk, motyw).
7. Gdzie umieścić provider: nad wszystkimi widgetami, które go czytają. Ekrany otwierane przez \`Navigator.push\` są dziećmi \`Navigator\`, więc stan wspólny dla ekranów kładzie się nad \`MaterialApp\`.`,
    why: `Oddzielenie stanu od widgetów upraszcza testy, pozwala dzielić dane między ekranami i ogranicza przebudowy do widgetów, które naprawdę zależą od zmiany. Alternatywy: samo \`setState\` z lifting state up, \`ValueNotifier\`, \`InheritedWidget\` pisany ręcznie, MobX, GetX. Kompromisy: Provider jest prosty, ale brak providera wychodzi dopiero w runtime (\`ProviderNotFoundException\`); Riverpod jest bezpieczniejszy, ale ma więcej pojęć do nauki; Bloc wymaga najwięcej kodu, a w zamian daje przewidywalność w dużych zespołach. W jednym projekcie ważniejsza jest konsekwencja niż wybór konkretnej biblioteki.`,
    practice: `Koszyk w sklepie, zalogowany użytkownik i token, motyw jasny/ciemny, lista danych z API współdzielona przez kilka ekranów. Sprawdź \`pubspec.yaml\`: jeśli jest tam \`provider\`, \`flutter_riverpod\` albo \`flutter_bloc\`, kod od Claude powinien trzymać się tej biblioteki, a nie mieszać kilku.`,
    pitfalls: [
      `Zmiana danych w \`ChangeNotifier\` bez \`notifyListeners()\`: UI się nie odświeża.`,
      `Provider umieszczony pod \`MaterialApp\` przy jednym ekranie, a odczyt na ekranie otwartym przez \`push\`: \`ProviderNotFoundException\`.`,
      `\`context.watch\` w handlerze \`onPressed\` zamiast \`context.read\`: Provider zgłasza błąd w trybie debug.`,
      `\`context.watch<DuzyStan>()\` w korzeniu aplikacji: każda zmiana przebudowuje cały ekran. Lepiej \`context.select((DuzyStan s) => s.licznik)\` nisko w drzewie.`,
    ],
    verify: `DevTools: w zakładce Performance sprawdzisz, które widgety się przebudowują; pakiety provider i Riverpod mają też własne rozszerzenia DevTools z podglądem stanu. Logowanie zmian: \`ProviderObserver\` w Riverpod, \`BlocObserver.onChange\` w Bloc, \`debugPrint\` w metodzie, która woła \`notifyListeners\`. Logikę \`ChangeNotifier\` testujesz zwykłym testem jednostkowym bez UI, a widget owijasz w provider w \`pumpWidget(ChangeNotifierProvider(create: (_) => Koszyk(), child: const MaterialApp(home: KoszykEkran())))\`. Hot reload nie wywołuje ponownie \`create\`, więc zmiana stanu początkowego wymaga hot restartu.`,
    misconceptions: [
      {
        key: 'notify-automatic',
        text: `\`ChangeNotifier\` sam wykrywa zmianę pola albo listy i odświeża UI.`,
        fix: `\`ChangeNotifier\` nie śledzi pól. Słuchacze dowiadują się o zmianie dopiero, gdy wywołasz \`notifyListeners()\` po modyfikacji danych.`,
      },
      {
        key: 'always-need-library',
        text: `\`setState\` to zła praktyka i każdy stan powinien trafić do Providera, Riverpod albo Bloca.`,
        fix: `Stan lokalny jednego widgetu najlepiej trzymać w \`setState\`. Biblioteka ma sens dla stanu współdzielonego między widgetami i ekranami albo dla złożonej logiki biznesowej.`,
      },
      {
        key: 'read-vs-watch',
        text: `\`context.read\` i \`context.watch\` robią to samo, różnią się tylko nazwą.`,
        fix: `\`watch\` rejestruje zależność i przebudowuje widget przy zmianie, więc używa się go w \`build\`. \`read\` tylko jednorazowo pobiera obiekt bez subskrypcji, więc pasuje do handlerów jak \`onPressed\`.`,
      },
    ],
    quiz: [
      {
        q: `Licznik w \`AppBar\` (\`context.watch<Koszyk>().produkty.length\`) nie zmienia się po dodaniu produktu. Dlaczego?
\`\`\`dart
class Koszyk extends ChangeNotifier {
  final List<String> produkty = [];

  void dodaj(String p) {
    produkty.add(p);
  }
}
\`\`\``,
        kind: 'diagnose',
        options: [
          'W AppBar trzeba użyć `context.read` zamiast `watch`, bo read zawsze pobiera świeże dane',
          'ChangeNotifier sam wykrywa zmianę listy, więc to błąd Fluttera',
          'Lista final nie pozwala dodawać elementów',
          'Po zmianie listy brakuje `notifyListeners()`, więc słuchacze nie wiedzą o zmianie',
        ],
        answer: 3,
        explain: `\`produkty.add\` zmienia listę w pamięci, ale nikt nie zostaje powiadomiony. Po \`notifyListeners()\` widgety z \`watch\` przebudują się i pokażą nową liczbę.`,
        misconceptionByOption: { 0: 'read-vs-watch', 1: 'notify-automatic' },
      },
      {
        q: `W jednym widgecie chcesz pamiętać, czy sekcja FAQ jest rozwinięta. Nikt poza nim tego nie potrzebuje. Co wybrać?`,
        kind: 'choice',
        options: [
          '`StatefulWidget` z polem bool i `setState`',
          'Globalny Bloc, bo setState to zła praktyka',
          'ChangeNotifierProvider nad MaterialApp, bo każdy stan musi być w providerze',
        ],
        answer: 0,
        explain: `To stan lokalny: żyje i umiera razem z widgetem. Przeniesienie go do globalnej warstwy dodaje kod i sprawia, że stan przetrwa dłużej, niż powinien.`,
        misconceptionByOption: { 1: 'always-need-library', 2: 'always-need-library' },
      },
      {
        q: `\`KoszykEkran\` rzuca \`ProviderNotFoundException\`. Dlaczego?
\`\`\`dart
MaterialApp(
  home: ChangeNotifierProvider(
    create: (_) => Koszyk(),
    child: const ListaProduktow(),
  ),
)
// w ListaProduktow:
Navigator.push(
  context,
  MaterialPageRoute(builder: (_) => const KoszykEkran()),
);
// w KoszykEkran.build:
final koszyk = context.watch<Koszyk>();
\`\`\``,
        kind: 'diagnose',
        options: [
          'Trzeba użyć context.read zamiast context.watch',
          'Nowy ekran jest dzieckiem Navigator, a nie ListaProduktow, więc provider nie jest jego przodkiem; trzeba przenieść ChangeNotifierProvider nad MaterialApp',
          'Koszyk nie wywołuje notifyListeners',
        ],
        answer: 1,
        explain: `Provider jest widoczny tylko dla swoich potomków. \`MaterialApp\` tworzy \`Navigator\`, a każdy ekran z \`push\` trafia pod \`Navigator\`, obok \`home\`, a nie pod nim. \`read\` szuka tak samo, więc też by nie znalazł.`,
      },
    ],
  },
  {
    id: 'flutter-async-ui',
    name: 'Asynchroniczność w UI (FutureBuilder, StreamBuilder)',
    en: 'FutureBuilder and StreamBuilder',
    area: 'mobile',
    langs: ['dart'],
    prereqs: ['flutter-state', 'dart-futures-streams'],
    weight: 2,
    intuition: `Dane z sieci nie przychodzą od razu, więc ekran musi mieć co najmniej trzy wersje: ładowanie, błąd i dane. \`FutureBuilder\` i \`StreamBuilder\` słuchają \`Future\` albo \`Stream\` i przy każdej zmianie wywołują Twoją funkcję \`builder\` z aktualnym stanem (\`snapshot\`). Ty tylko decydujesz, co pokazać w każdym przypadku.`,
    mechanism: `1. \`FutureBuilder<T>(future: _future, builder: (context, snapshot) { ... })\` subskrybuje \`Future\` i przebudowuje się, gdy ten się zakończy.
2. \`snapshot.connectionState\`: \`none\` (brak future), \`waiting\` (czeka), \`done\` (zakończony). Dla \`Stream\` dochodzi \`active\` (przyszło co najmniej jedno zdarzenie, stream otwarty).
3. \`snapshot.hasError\` i \`snapshot.error\`, \`snapshot.hasData\` i \`snapshot.data\`. Sprawdzaj w kolejności: błąd, ładowanie, dane. \`hasData\` to po prostu \`data != null\`, więc dla \`Future<void>\` albo wyniku \`null\` sprawdzaj \`connectionState == ConnectionState.done\`.
4. \`Future\` tworzysz raz i trzymasz w polu \`State\`:
\`\`\`dart
late final Future<User> _user;

@override
void initState() {
  super.initState();
  _user = api.pobierzUzytkownika();
}
\`\`\`
Gdy \`build\` przekaże nowy obiekt \`Future\`, \`FutureBuilder\` subskrybuje go od nowa: stan wraca do \`waiting\`, a zapytanie leci ponownie.
5. \`initialData\` pozwala pokazać dane, zanim \`Future\` się zakończy.
6. \`StreamBuilder\` działa tak samo dla \`Stream\`: każde zdarzenie to nowy \`snapshot\` i nowe wywołanie \`builder\`. Po zamknięciu streamu stan to \`done\`, a \`data\` zostaje z ostatniego zdarzenia. Stream też twórz poza \`build\`.
7. Odświeżenie (np. \`RefreshIndicator\`): \`setState(() => _user = api.pobierzUzytkownika());\`.`,
    why: `\`FutureBuilder\` deklaratywnie mapuje stan operacji asynchronicznej na UI, bez ręcznych flag. Alternatywy: \`StatefulWidget\` z polami \`_ladowanie\`, \`_blad\`, \`_dane\` i \`setState\` po \`await\` (pamiętaj o \`mounted\`), Riverpod \`FutureProvider\` z \`AsyncValue.when(data:, loading:, error:)\`, Bloc ze stanami Loading/Loaded/Error. Kompromis: \`FutureBuilder\` nie ma cache ani ponawiania i łatwo użyć go źle; w większych aplikacjach dane z API zwykle obsługuje warstwa stanu.`,
    practice: `Ekran pobierający listę z API, profil użytkownika, odczyt z lokalnej bazy (sqflite, Drift), nasłuch Firestore przez \`snapshots()\` w \`StreamBuilder\`, status połączenia z \`connectivity_plus\`, odliczanie z \`Stream.periodic\`.`,
    pitfalls: [
      `\`future: api.pobierz()\` wpisane bezpośrednio w \`build\`: nowe żądanie przy każdej przebudowie, migający spinner, a przy \`setState\` w okolicy nawet pętla żądań.`,
      `Sprawdzanie tylko \`hasData\`: przy błędzie sieci spinner kręci się w nieskończoność i użytkownik nie wie, co się stało.`,
      `\`snapshot.data!\` bez sprawdzenia stanu: wyjątek null check przy pierwszym \`build\`, gdy dane jeszcze nie przyszły.`,
      `\`hasData\` dla \`Future<void>\`: zawsze \`false\`, więc ekran nigdy nie wychodzi z ładowania.`,
    ],
    verify: `\`debugPrint(snapshot.connectionState.toString())\` w \`builder\` pokaże przejścia \`waiting\` i \`done\`; jeśli \`waiting\` wraca przy każdym dotknięciu ekranu, \`Future\` powstaje w \`build\`. Zakładka Network w DevTools pokaże liczbę żądań HTTP. W teście widgetu podaj fałszywe API (prawdziwe żądania HTTP w testach widgetów zwracają 400): \`Future.value(dane)\` albo \`Future.error(Exception('offline'))\`. Po \`pumpWidget\` sprawdź spinner, po \`await tester.pump()\` dane albo komunikat błędu. Uwaga: \`pumpAndSettle\` przy widocznym \`CircularProgressIndicator\` kończy się przekroczeniem czasu, bo animacja trwa bez końca.`,
    misconceptions: [
      {
        key: 'future-in-build',
        text: `Można pisać \`future: api.pobierz()\` bezpośrednio w \`build\`, bo \`FutureBuilder\` i tak wykona to raz i zapamięta wynik.`,
        fix: `Wywołanie \`api.pobierz()\` w \`build\` wysyła nowe żądanie przy każdej przebudowie, a \`FutureBuilder\` widzi nowy \`Future\` i wraca do \`waiting\`. \`Future\` utwórz w \`initState\` i trzymaj w polu \`State\`.`,
      },
      {
        key: 'hasdata-covers-all',
        text: `Wystarczy sprawdzić \`hasData\`, a w innym przypadku pokazać spinner; błąd i tak sam się wyświetli.`,
        fix: `\`FutureBuilder\` nie pokazuje błędów sam. Przy błędzie \`hasData\` jest \`false\`, więc taki kod pokaże spinner na zawsze. Obsłuż \`snapshot.hasError\` osobno.`,
      },
    ],
    quiz: [
      {
        q: `Spinner miga, a serwer dostaje nowe żądanie przy każdym wpisanym znaku w pole tekstowe na tym ekranie. Dlaczego?
\`\`\`dart
class _ProfilState extends State<Profil> {
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<User>(
      future: api.pobierzUzytkownika(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const CircularProgressIndicator();
        return Text(snapshot.data!.name);
      },
    );
  }
}
\`\`\``,
        kind: 'diagnose',
        options: [
          'FutureBuilder zapamiętuje wynik, więc problem jest po stronie serwera',
          '`Future` powstaje w build, więc każda przebudowa wysyła żądanie i resetuje FutureBuilder; trzeba go utworzyć w initState',
          'Brakuje key na FutureBuilder',
          'Brakuje await przed api.pobierzUzytkownika()',
        ],
        answer: 1,
        explain: `Wpisanie znaku przebudowuje ekran, \`build\` wywołuje \`api.pobierzUzytkownika()\` od nowa, a \`FutureBuilder\` dostaje nowy \`Future\` i wraca do \`waiting\`. Pole \`late final Future<User> _user\` ustawione w \`initState\` to naprawia.`,
        misconceptionByOption: { 0: 'future-in-build' },
      },
      {
        q: `\`_future\` kończy się błędem (brak internetu). Co zobaczy użytkownik?
\`\`\`dart
FutureBuilder<int>(
  future: _future,
  builder: (context, snapshot) {
    if (snapshot.hasData) {
      return Text('Wynik: \${snapshot.data}');
    }
    return const CircularProgressIndicator();
  },
)
\`\`\``,
        kind: 'predict',
        options: [
          'Komunikat błędu, który FutureBuilder pokazuje sam',
          'Wynik: null',
          'Spinner, który kręci się w nieskończoność',
        ],
        answer: 2,
        explain: `Przy błędzie \`hasData\` jest \`false\`, więc kod trafia w gałąź ze spinnerem. Błąd jest w \`snapshot.error\`, ale nikt go nie wyświetla. Dodaj \`if (snapshot.hasError) return Text('Błąd: \${snapshot.error}');\`.`,
        misconceptionByOption: { 0: 'hasdata-covers-all' },
      },
      {
        q: `\`_stream\` utworzono w \`initState\` jako \`Stream.periodic(const Duration(seconds: 1), (i) => i).take(3)\`. Co pokazuje ekran po 5 sekundach?
\`\`\`dart
StreamBuilder<int>(
  stream: _stream,
  builder: (context, s) => Text('\${s.connectionState.name} \${s.data}'),
)
\`\`\``,
        kind: 'predict',
        options: ['active 2', 'done 2', 'done null', 'waiting null'],
        answer: 1,
        explain: `Stream wysyła 0, 1, 2 w sekundach 1, 2 i 3, a \`take(3)\` go zamyka. Po zamknięciu stan to \`done\`, a \`data\` zostaje z ostatniego zdarzenia, czyli 2.`,
      },
    ],
  },
  {
    id: 'cross-platform-basics',
    name: 'Aplikacje wieloplatformowe (cross-platform)',
    en: 'cross-platform development',
    area: 'mobile',
    langs: ['dart', 'js', 'ts'],
    prereqs: ['flutter-widgets'],
    weight: 2,
    intuition: `Aplikacja wieloplatformowa (cross-platform) to jedna baza kodu, z której budujesz aplikację na Androida, iOS, a często też web i desktop. Flutter robi to, rysując cały interfejs samodzielnie, piksel po pikselu. React Native tłumaczy Twoje komponenty na prawdziwe kontrolki systemu. Oba podejścia oszczędzają pisania dwóch aplikacji, ale płacą za to w innych miejscach.`,
    mechanism: `1. Flutter w release kompiluje Darta AOT do kodu maszynowego (ARM, x64); na web do JavaScriptu albo WebAssembly. W trybie debug działa JIT z hot reload.
2. Rysowanie: Flutter nie używa natywnych przycisków. Framework buduje drzewo RenderObjectów, a silnik (engine, C++) rasteryzuje je przez Impeller (domyślny na iOS i na nowszych Androidach) albo Skia na powierzchni udostępnionej przez system.
3. Skutek: ten sam wygląd na każdej platformie, ale „natywny” wygląd trzeba odtworzyć widgetami Material albo Cupertino, a nowe kontrolki systemowe nie pojawiają się w aplikacji same.
4. React Native: kod JS działa w silniku Hermes, a \`<View>\` i \`<Text>\` są mapowane na natywne widoki Androida i iOS. Stara architektura komunikowała się przez asynchroniczny most (bridge) z serializacją JSON; nowa (Fabric, TurboModules, JSI, domyślna od RN 0.76) wywołuje kod natywny bezpośrednio przez C++.
5. Sprawdzanie platformy w Flutterze: \`kIsWeb\` z \`package:flutter/foundation.dart\` najpierw, potem \`Platform.isIOS\` / \`Platform.isAndroid\` z \`dart:io\` (na web rzucają wyjątek). W UI lepiej \`Theme.of(context).platform\`, które da się nadpisać w testach.
6. Widgety adaptacyjne: \`Switch.adaptive\`, \`CircularProgressIndicator.adaptive\`, \`showAdaptiveDialog\` wybierają styl Material albo Cupertino. Pełny wygląd iOS: \`CupertinoButton\`, \`CupertinoNavigationBar\`.
7. Platform channels: \`const MethodChannel('app/bateria').invokeMethod<int>('poziom')\` wysyła wiadomość do kodu Kotlin lub Swift, który odpowiada asynchronicznie. Pigeon generuje typowane kanały, a \`dart:ffi\` wywołuje biblioteki C. Pluginy z pub.dev (camera, geolocator) to gotowe kanały.
8. Natywnie (Kotlin, Swift) warto pisać, gdy aplikacja mocno integruje się z systemem (widżety ekranu głównego, zegarki, zaawansowane AR), musi wyglądać dokładnie jak systemowa albo liczy się każdy MB rozmiaru (silnik Fluttera dodaje kilka MB).`,
    why: `Jedna baza kodu to jeden zespół, jedna logika biznesowa i szybsze wdrażanie zmian na obie platformy. Alternatywy: natywnie (Kotlin z Jetpack Compose, Swift ze SwiftUI), React Native, Kotlin Multiplatform (wspólna logika, UI natywny albo Compose Multiplatform), aplikacja webowa PWA. Kompromisy: wydajność (Flutter AOT jest blisko natywnej, w RN dochodzi warstwa JS), wygląd (Flutter jest identyczny wszędzie, ale nie systemowy; RN używa kontrolek systemu, więc różni się między platformami), rozmiar (Flutter większy o silnik), dostęp do nowych API systemu (czekasz na plugin albo piszesz kanał sam).`,
    practice: `W Twoim projekcie Flutter folder \`lib/\` jest wspólny, a \`android/\` i \`ios/\` to natywne projekty: tam są uprawnienia (\`AndroidManifest.xml\`, \`Info.plist\`), ikony, podpisywanie i kod kanałów. Typowe zadania: inny wygląd dialogu na iOS, obsługa wycięcia ekranu (\`SafeArea\`), porównanie Fluttera z React Native na zajęciach albo przy wyborze technologii.`,
    pitfalls: [
      `\`Platform.isIOS\` bez wcześniejszego \`kIsWeb\`: aplikacja wysypuje się po \`flutter run -d chrome\`.`,
      `Założenie, że każdy plugin z pub.dev działa na każdej platformie. Strona pakietu pokazuje obsługiwane platformy.`,
      `Kod Darta poprawny, ale brak wpisu w \`Info.plist\` (np. \`NSCameraUsageDescription\`) albo uprawnienia w \`AndroidManifest.xml\`: crash albo odmowa dostępu tylko na jednej platformie.`,
      `Testowanie tylko na Androidzie: na iOS inaczej działa gest wstecz, czcionki, klawiatura i bezpieczne obszary ekranu.`,
    ],
    verify: `\`flutter devices\` pokazuje dostępne urządzenia; uruchom aplikację na emulatorze Androida i symulatorze iOS (symulator wymaga macOS) oraz \`flutter run -d chrome\`. Wygląd iOS na Androidzie podejrzysz, ustawiając \`debugDefaultTargetPlatformOverride = TargetPlatform.iOS\` w \`main\`. W testach: \`testWidgets(..., variant: TargetPlatformVariant.only(TargetPlatform.iOS))\`. \`flutter build apk --analyze-size\` pokazuje, co zajmuje miejsce. Zmiany w kodzie natywnym (Kotlin, Swift) i w uprawnieniach wymagają pełnego zatrzymania i ponownego \`flutter run\`; hot reload ani hot restart ich nie wczytają.`,
    simplification: `„Jedna baza kodu” dotyczy głównie UI i logiki. Konfiguracja, uprawnienia, podpisywanie, publikacja w sklepach i część integracji pozostają osobne dla każdej platformy.`,
    misconceptions: [
      {
        key: 'flutter-uses-native-widgets',
        text: `Flutter zamienia swoje widgety na natywne przyciski i pola tekstowe Androida oraz iOS.`,
        fix: `Flutter rysuje cały UI sam przez swój silnik (Impeller albo Skia). Na ekranie nie ma natywnego \`android.widget.Button\`, są piksele narysowane przez Fluttera. Natywne kontrolki wykorzystuje React Native.`,
      },
      {
        key: 'one-codebase-zero-native',
        text: `Jedna baza kodu oznacza, że do systemu i sprzętu dostaję się z Darta bez żadnej pracy po stronie platform.`,
        fix: `Dostęp do API systemu idzie przez platform channels albo FFI, zwykle opakowane w plugin. Gdy pluginu nie ma, piszesz kod w Kotlinie i Swifcie. Do tego dochodzą uprawnienia i konfiguracja per platforma.`,
      },
      {
        key: 'dart-io-platform-everywhere',
        text: `\`Platform.isAndroid\` i \`Platform.isIOS\` z \`dart:io\` działają na każdej platformie, także w przeglądarce.`,
        fix: `\`dart:io\` nie jest wspierane na web i \`Platform\` rzuca tam \`Unsupported operation\`. Najpierw sprawdź \`kIsWeb\`, a w UI korzystaj z \`Theme.of(context).platform\`.`,
      },
    ],
    quiz: [
      {
        q: `Aplikacja Flutter działa na Androidzie i ma \`ElevatedButton\`. Czym jest ten przycisk w działającej aplikacji?`,
        kind: 'choice',
        options: [
          'Natywnym android.widget.Button utworzonym przez Fluttera',
          'Pikselami narysowanymi przez silnik Fluttera na jego powierzchni; natywny android.widget.Button nie istnieje',
          'Elementem HTML w ukrytym WebView',
        ],
        answer: 1,
        explain: `Flutter sam układa i rysuje UI przez Impeller albo Skia. Dlatego wygląda tak samo na każdej platformie. Natywne kontrolki tworzy React Native.`,
        misconceptionByOption: { 0: 'flutter-uses-native-widgets' },
      },
      {
        q: `Na telefonach działa, ale po \`flutter run -d chrome\` ekran wyrzuca \`Unsupported operation: Platform._operatingSystem\`. Dlaczego?
\`\`\`dart
import 'dart:io';

Widget spinner() {
  return Platform.isIOS
      ? const CupertinoActivityIndicator()
      : const CircularProgressIndicator();
}
\`\`\``,
        kind: 'diagnose',
        options: [
          '`Platform` z `dart:io` nie działa na web; najpierw sprawdź `kIsWeb` albo użyj `Theme.of(context).platform` lub `CircularProgressIndicator.adaptive()`',
          'Widgety Cupertino nie działają w przeglądarce',
          '`Platform.isIOS` działa wszędzie, to błąd Chrome',
        ],
        answer: 0,
        explain: `\`dart:io\` nie jest dostępne na web, więc odczyt \`Platform.isIOS\` rzuca wyjątek. Widgety Cupertino same w przeglądarce działają. \`CircularProgressIndicator.adaptive()\` wybiera styl bez sięgania do \`dart:io\`.`,
        misconceptionByOption: { 2: 'dart-io-platform-everywhere' },
      },
      {
        q: `Musisz odczytać dane z czujnika, dla którego nie ma pluginu na pub.dev. Jak to zrobić we Flutterze?`,
        kind: 'choice',
        options: [
          'Zaimportować odpowiednią bibliotekę Darta, bo Dart ma bezpośredni dostęp do wszystkich API systemu',
          'Nie da się, Flutter nie ma dostępu do sprzętu',
          'Napisać kod w Kotlinie i Swifcie i wywołać go z Darta przez platform channel (MethodChannel) albo przez FFI',
        ],
        answer: 2,
        explain: `Dart nie widzi API Androida i iOS bezpośrednio. \`MethodChannel\` przesyła wiadomość do kodu natywnego, który wywołuje API systemu i odsyła wynik. Pluginy z pub.dev robią dokładnie to za Ciebie.`,
        misconceptionByOption: { 0: 'one-codebase-zero-native' },
      },
    ],
  },
]
