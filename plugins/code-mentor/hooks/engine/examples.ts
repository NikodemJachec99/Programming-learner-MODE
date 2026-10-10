// Przykłady do nauki: krótki, czysty kod, który symulator wykonuje w całości.
// Zmiany pokazują Twój prawdziwy kod (przed i po), a tu widać sam mechanizm.
// Każdy przykład jest sprawdzany testem: wykonuje się bez błędu i bez założeń.

export type Example = {
  id: string
  label: string
  dialect: 'js' | 'dart'
  /** Kod do uruchomienia (dla pary: wersja B, „po”). */
  code: string
  /** Para A/B: wersja „przed” do porównania na tych samych danych. */
  before?: string
  /** Na co patrzeć w tym przykładzie, jedno lub dwa zdania. */
  note: string
  /** Pojęcia, których dotyczy (id z biblioteki). */
  concepts: string[]
  /** Przeróbka, którą pokazuje (id z rozpoznawania przeróbek w zmianach). */
  refactor?: string
  /** Kod interfejsu Fluttera: symulator nie wykonuje go, tylko rysuje drzewo widgetów. */
  widgets?: true
}

const L = (...lines: string[]) => lines.join('\n')

/** Pary A/B: ta sama przeróbka co w zmianie, na małym przykładzie. */
const REFACTOR_EXAMPLES: Example[] = [
  {
    id: 'rf-promise-all',
    refactor: 'promise-all',
    label: 'await w pętli → Promise.all',
    dialect: 'js',
    concepts: ['concurrency', 'async-await', 'promises'],
    note: 'Porównaj kolejność wypisów: w A każde pobranie czeka na poprzednie, w B oba startują od razu i kończą się razem.',
    before: L(
      'function load(id) {',
      '  console.log("start " + id)',
      '  return new Promise(done => setTimeout(() => {',
      '    console.log("koniec " + id)',
      '    done(id * 10)',
      '  }, 100))',
      '}',
      'async function main() {',
      '  const out = []',
      '  for (const id of [1, 2]) {',
      '    out.push(await load(id))',
      '  }',
      '  console.log(out)',
      '}',
      'main()',
    ),
    code: L(
      'function load(id) {',
      '  console.log("start " + id)',
      '  return new Promise(done => setTimeout(() => {',
      '    console.log("koniec " + id)',
      '    done(id * 10)',
      '  }, 100))',
      '}',
      'async function main() {',
      '  const out = await Promise.all([1, 2].map(id => load(id)))',
      '  console.log(out)',
      '}',
      'main()',
    ),
  },
  {
    id: 'rf-loop-to-map',
    refactor: 'loop-to-map',
    label: 'pętla z push → map i filter',
    dialect: 'js',
    concepts: ['arrays', 'callbacks', 'immutability'],
    note: 'Wynik jest ten sam. W B nie ma pustej tablicy, którą trzeba ręcznie zapełniać: map i filter zwracają nową.',
    before: L(
      'const prices = [5, 12, 30]',
      'const result = []',
      'for (const p of prices) {',
      '  if (p > 10) {',
      '    result.push(p * 2)',
      '  }',
      '}',
      'console.log(result)',
    ),
    code: L(
      'const prices = [5, 12, 30]',
      'const result = prices.filter(p => p > 10).map(p => p * 2)',
      'console.log(result)',
    ),
  },
  {
    id: 'rf-then-to-await',
    refactor: 'then-to-await',
    label: '.then → await',
    dialect: 'js',
    concepts: ['async-await', 'promises'],
    note: 'Obie wersje robią to samo. W B kod czyta się z góry na dół, a wynik ląduje w zwykłej zmiennej.',
    before: L(
      'function getUser() {',
      '  return Promise.resolve({ name: "Ola" })',
      '}',
      'getUser().then(user => {',
      '  console.log("cześć " + user.name)',
      '})',
    ),
    code: L(
      'function getUser() {',
      '  return Promise.resolve({ name: "Ola" })',
      '}',
      'async function main() {',
      '  const user = await getUser()',
      '  console.log("cześć " + user.name)',
      '}',
      'main()',
    ),
  },
  {
    id: 'rf-switch',
    refactor: 'switch',
    label: 'else if → switch',
    dialect: 'js',
    concepts: ['conditionals'],
    note: 'Ten sam wynik. switch porównuje jedną wartość z listą przypadków, break kończy przypadek.',
    before: L(
      'const status = "paid"',
      'if (status === "new") {',
      '  console.log("czeka na płatność")',
      '} else if (status === "paid") {',
      '  console.log("do wysyłki")',
      '} else {',
      '  console.log("nieznany")',
      '}',
    ),
    code: L(
      'const status = "paid"',
      'switch (status) {',
      '  case "new":',
      '    console.log("czeka na płatność")',
      '    break',
      '  case "paid":',
      '    console.log("do wysyłki")',
      '    break',
      '  default:',
      '    console.log("nieznany")',
      '}',
    ),
  },
  {
    id: 'rf-var-let',
    refactor: 'var-let',
    label: 'var → let',
    dialect: 'js',
    concepts: ['scope', 'variables', 'closures'],
    note: 'Z var wszystkie funkcje widzą jedną zmienną i wypiszą 3, 3, 3. let tworzy nową zmienną w każdym obrocie pętli.',
    before: L(
      'const fns = []',
      'for (var i = 0; i < 3; i++) {',
      '  fns.push(() => i)',
      '}',
      'console.log(fns.map(f => f()))',
    ),
    code: L(
      'const fns = []',
      'for (let i = 0; i < 3; i++) {',
      '  fns.push(() => i)',
      '}',
      'console.log(fns.map(f => f()))',
    ),
  },
  {
    id: 'rf-try-catch',
    refactor: 'try-catch',
    label: 'dodany try/catch',
    dialect: 'js',
    concepts: ['exceptions', 'json'],
    note: 'W A zły JSON przerywa program. W B błąd jest złapany, a program idzie dalej z wartością domyślną.',
    before: L(
      'function readConfig(text) {',
      '  return JSON.parse(text)',
      '}',
      'console.log(readConfig("{ zly json"))',
      'console.log("dalej")',
    ),
    code: L(
      'function readConfig(text) {',
      '  try {',
      '    return JSON.parse(text)',
      '  } catch (e) {',
      '    console.log("zły plik, biorę domyślne")',
      '    return {}',
      '  }',
      '}',
      'console.log(readConfig("{ zly json"))',
      'console.log("dalej")',
    ),
  },
  {
    id: 'rf-null-check',
    refactor: 'null-check',
    label: 'sprawdzenie null (?. i ??)',
    dialect: 'js',
    concepts: ['null-undefined'],
    note: 'W A brak adresu wywraca program. W B ?. zatrzymuje się na pustej wartości, a ?? podstawia domyślną.',
    before: L(
      'const user = { name: "Ola", address: null }',
      'console.log(user.address.city)',
    ),
    code: L(
      'const user = { name: "Ola", address: null }',
      'console.log(user.address?.city ?? "brak miasta")',
    ),
  },
  {
    id: 'rf-throw',
    refactor: 'throw',
    label: 'throw przy złych danych',
    dialect: 'js',
    concepts: ['exceptions', 'validation'],
    note: 'W A zła wartość cicho daje NaN i liczy dalej. W B funkcja od razu mówi, co jest nie tak.',
    before: L(
      'function price(qty) {',
      '  return qty * 10',
      '}',
      'console.log(price("dwa"))',
    ),
    code: L(
      'function price(qty) {',
      '  if (typeof qty !== "number") {',
      '    throw new Error("qty musi być liczbą, jest: " + qty)',
      '  }',
      '  return qty * 10',
      '}',
      'try {',
      '  console.log(price("dwa"))',
      '} catch (e) {',
      '  console.log(e.message)',
      '}',
    ),
  },
  {
    id: 'rf-test',
    refactor: 'test',
    label: 'dodany test',
    dialect: 'js',
    concepts: ['unit-tests'],
    note: 'Test to zwykły kod: woła funkcję ze znanymi danymi i porównuje wynik z oczekiwanym.',
    code: L(
      'function add(a, b) {',
      '  return a + b',
      '}',
      'function expectEqual(actual, expected, name) {',
      '  console.log((actual === expected ? "OK " : "BŁĄD ") + name)',
      '}',
      'expectEqual(add(2, 3), 5, "dodaje liczby")',
      'expectEqual(add("2", 3), 5, "tekst i liczba")',
    ),
  },
  {
    id: 'rf-types',
    refactor: 'types',
    label: 'dodane typy',
    dialect: 'js',
    concepts: ['static-typing'],
    note: 'Typy nie zmieniają działania: symulator wykonuje kod tak samo. TypeScript zgłosiłby add("2", 3) przed uruchomieniem.',
    before: L(
      'function add(a, b) {',
      '  return a + b',
      '}',
      'console.log(add("2", 3))',
    ),
    code: L(
      'function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      'console.log(add(2, 3))',
    ),
  },
]

/** Jeden przykład na pojęcie. */
const CONCEPT_EXAMPLES: Example[] = [
  { id: 'if', label: 'Warunek if (x < 10)', dialect: 'js', concepts: ['conditionals', 'boolean-logic'], note: 'Zmień 7 na 10 i zobacz, która gałąź się wykona.', code: L('let x = 7', 'if (x < 10) {', '  console.log("x jest mniejsze od 10")', '} else {', '  console.log("x jest co najmniej 10")', '}') },
  { id: 'loop', label: 'Pętla for: suma', dialect: 'js', concepts: ['loops', 'operators'], note: 'Patrz, jak rośnie sum w każdym obrocie pętli.', code: L('let sum = 0', 'for (let i = 0; i < 5; i++) {', '  sum += i', '}', 'console.log(sum)') },
  { id: 'fn', label: 'Funkcja: argumenty i return', dialect: 'js', concepts: ['functions', 'variables'], note: 'Argumenty trafiają do parametrów, return oddaje wynik do miejsca wywołania.', code: L('function area(width, height) {', '  const result = width * height', '  return result', '}', 'const a = area(3, 4)', 'console.log("pole:", a)') },
  { id: 'eq', label: '== vs ===', dialect: 'js', concepts: ['equality', 'type-coercion'], note: '== zamienia typy przed porównaniem, === nie.', code: L('const input = "0"', 'if (input == 0) {', '  console.log("== mówi: równe")', '}', 'if (input === 0) {', '  console.log("=== mówi: równe")', '} else {', '  console.log("=== mówi: różne typy")', '}') },
  { id: 'coercion', label: 'Konwersja typów: "5" + 1 i "5" - 1', dialect: 'js', concepts: ['type-coercion', 'operators'], note: '+ z tekstem skleja, - zawsze liczy.', code: L('console.log("5" + 1)', 'console.log("5" - 1)', 'console.log(Number("12") + 1)') },
  { id: 'async', label: 'async/await i kolejność', dialect: 'js', concepts: ['event-loop', 'async-await'], note: 'Liczby w wypisach to kolejność, w jakiej naprawdę się wykonają.', code: L('console.log("1: start")', 'setTimeout(() => console.log("5: setTimeout"), 0)', 'async function load() {', '  console.log("2: load start")', '  await null', '  console.log("4: po await")', '}', 'load()', 'console.log("3: koniec kodu synchronicznego")') },
  { id: 'promise', label: 'Promise: then i catch', dialect: 'js', concepts: ['promises', 'async-errors'], note: 'then dostaje wynik, catch błąd. Nic nie dzieje się, zanim kod synchroniczny się skończy.', code: L('function check(n) {', '  return new Promise((ok, fail) => (n > 0 ? ok(n * 2) : fail(new Error("ujemne"))))', '}', 'check(5).then(v => console.log("wynik", v))', 'check(-1).catch(e => console.log("błąd", e.message))', 'console.log("najpierw to")') },
  { id: 'async-err', label: 'Błąd w async i try/await', dialect: 'js', concepts: ['async-errors', 'async-await', 'exceptions'], note: 'Odrzucona obietnica po await zachowuje się jak throw, więc łapie ją zwykły try/catch.', code: L('async function save(ok) {', '  if (!ok) throw new Error("brak sieci")', '  return "zapisane"', '}', 'async function main() {', '  try {', '    console.log(await save(true))', '    console.log(await save(false))', '  } catch (e) {', '    console.log("złapany:", e.message)', '  }', '}', 'main()') },
  { id: 'err', label: 'Wyjątek i propagacja', dialect: 'js', concepts: ['exceptions'], note: 'throw przerywa funkcję i leci w górę, aż ktoś go złapie.', code: L('function parseAge(text) {', '  const n = Number(text)', '  if (Number.isNaN(n)) {', '    throw new Error("To nie liczba: " + text)', '  }', '  return n', '}', 'try {', '  console.log(parseAge("12"))', '  console.log(parseAge("abc"))', '} catch (e) {', '  console.log("Błąd:", e.message)', '}') },
  { id: 'closure', label: 'Domknięcie (closure)', dialect: 'js', concepts: ['closures', 'scope'], note: 'Funkcja zwrócona z makeCounter pamięta swoje count między wywołaniami.', code: L('function makeCounter() {', '  let count = 0', '  return () => {', '    count++', '    return count', '  }', '}', 'const next = makeCounter()', 'next()', 'console.log(next())') },
  { id: 'arrays', label: 'Tablice: map, filter, reduce', dialect: 'js', concepts: ['arrays', 'callbacks'], note: 'Każda metoda zwraca nową wartość, tablica wejściowa się nie zmienia.', code: L('const items = [3, 8, 12]', 'const doubled = items.map(x => x * 2)', 'const big = items.filter(x => x > 5)', 'const sum = items.reduce((s, x) => s + x, 0)', 'console.log(doubled, big, sum, items)') },
  { id: 'objects', label: 'Obiekt i Map', dialect: 'js', concepts: ['objects-maps'], note: 'Obiekt ma stałe pola, Map dobrze nadaje się do słownika z dowolnymi kluczami.', code: L('const user = { name: "Ola", age: 30 }', 'user.age += 1', 'console.log(user.name, user.age)', 'const stock = new Map()', 'stock.set("kawa", 3)', 'stock.set("herbata", 0)', 'console.log(stock.get("kawa"), stock.has("cukier"), stock.size)') },
  { id: 'destructuring', label: 'Destrukturyzacja i spread', dialect: 'js', concepts: ['destructuring-spread'], note: 'Destrukturyzacja wyciąga pola do zmiennych, spread kopiuje i nadpisuje.', code: L('const order = { id: 7, total: 50, status: "new" }', 'const { id, total } = order', 'const paid = { ...order, status: "paid" }', 'console.log(id, total, paid.status, order.status)') },
  { id: 'refs', label: 'Referencje: dwie zmienne, jedna tablica', dialect: 'js', concepts: ['references-memory', 'immutability'], note: 'b to ta sama tablica co a, nie kopia. Kopię robi [...a].', code: L('const a = [1, 2]', 'const b = a', 'const c = [...a]', 'b.push(3)', 'console.log(a, b, c)') },
  { id: 'null', label: 'null, undefined, ?. i ??', dialect: 'js', concepts: ['null-undefined'], note: '?. przerywa na pustej wartości, ?? podstawia domyślną tylko dla null i undefined (nie dla 0).', code: L('const settings = { theme: null, size: 0 }', 'console.log(settings.theme ?? "jasny")', 'console.log(settings.size ?? 12, settings.size || 12)', 'console.log(settings.font?.name)') },
  { id: 'json', label: 'JSON: zapis i odczyt', dialect: 'js', concepts: ['json'], note: 'stringify robi tekst z obiektu, parse odwrotnie.', code: L('const data = { id: 1, tags: ["a", "b"] }', 'const text = JSON.stringify(data)', 'console.log(text)', 'const back = JSON.parse(text)', 'console.log(back.tags[1])') },
  { id: 'sets', label: 'Set: bez powtórzeń', dialect: 'js', concepts: ['sets'], note: 'Set trzyma każdą wartość raz.', code: L('const visits = ["ola", "jan", "ola"]', 'const unique = new Set(visits)', 'console.log(unique.size, unique.has("jan"), [...unique])') },
  { id: 'recursion', label: 'Rekurencja: silnia', dialect: 'js', concepts: ['recursion', 'functions'], note: 'Patrz na stos wywołań: rośnie do n = 1, potem wyniki wracają.', code: L('function fact(n) {', '  if (n <= 1) return 1', '  return n * fact(n - 1)', '}', 'console.log(fact(4))') },
  { id: 'classes', label: 'Klasa i metoda', dialect: 'js', concepts: ['classes', 'this-binding'], note: 'constructor ustawia pola nowego obiektu, metoda widzi je przez this.', code: L('class Cart {', '  constructor() {', '    this.items = []', '  }', '  add(name, price) {', '    this.items.push({ name, price })', '  }', '  total() {', '    return this.items.reduce((s, i) => s + i.price, 0)', '  }', '}', 'const cart = new Cart()', 'cart.add("kawa", 12)', 'cart.add("bułka", 2)', 'console.log(cart.total())') },
  { id: 'inheritance', label: 'Dziedziczenie: extends i super', dialect: 'js', concepts: ['inheritance', 'classes'], note: 'Podklasa dostaje metody rodzica, a super woła jego wersję.', code: L('class Animal {', '  constructor(name) {', '    this.name = name', '  }', '  describe() {', '    return this.name', '  }', '}', 'class Dog extends Animal {', '  describe() {', '    return super.describe() + " (pies)"', '  }', '}', 'console.log(new Dog("Burek").describe())') },
  { id: 'strings', label: 'Napisy: szablon, slice, wielkie litery', dialect: 'js', concepts: ['strings'], note: 'Metody napisów zwracają nowy tekst, oryginał się nie zmienia.', code: L('const name = "ola kowalska"', 'const first = name.slice(0, 3)', 'console.log(first.toUpperCase(), name.length, name.includes("kow"))', 'console.log(`Witaj, ${first}!`)') },
  { id: 'sort', label: 'Sortowanie z porównaniem', dialect: 'js', concepts: ['searching-sorting'], note: 'Bez funkcji porównującej sort układa jak tekst, więc 10 trafia przed 9.', code: L('const nums = [10, 9, 100]', 'console.log([...nums].sort())', 'console.log([...nums].sort((a, b) => a - b))') },
  { id: 'validation', label: 'Walidacja danych', dialect: 'js', concepts: ['validation'], note: 'Funkcja zbiera wszystkie problemy, zamiast przerywać na pierwszym.', code: L('function validate(form) {', '  const errors = []', '  if (!form.email.includes("@")) errors.push("zły email")', '  if (form.age < 18) errors.push("za młody")', '  return errors', '}', 'console.log(validate({ email: "ola", age: 16 }))', 'console.log(validate({ email: "ola@x.pl", age: 30 }))') },
  { id: 'complexity', label: 'Złożoność: ile razy wykona się pętla', dialect: 'js', concepts: ['complexity'], note: 'Pętla w pętli dla n elementów to n * n obrotów.', code: L('let steps = 0', 'const n = 4', 'for (let i = 0; i < n; i++) {', '  for (let j = 0; j < n; j++) {', '    steps++', '  }', '}', 'console.log(steps)') },
  { id: 'dart-basics', label: 'Dart: zmienne, ~/ i null safety', dialect: 'dart', concepts: ['dart-basics', 'dart-null-safety'], note: 'String? może być null, ?? podstawia wartość, ~/ to dzielenie całkowite.', code: L('void main() {', '  int total = 17;', '  final people = 5;', "  print('każdy dostaje ${total ~/ people}');", "  print('reszta ${total % people}');", '  String? coupon;', "  print(coupon ?? 'brak kuponu');", "  coupon = 'RABAT10';", '  print(coupon.length);', '}') },
  { id: 'dart-class', label: 'Dart: klasa, fromJson i getter', dialect: 'dart', concepts: ['dart-basics', 'classes'], note: 'factory buduje obiekt z mapy, getter liczy wartość przy każdym odczycie.', code: L('class Product {', '  final String name;', '  final double price;', '  Product({required this.name, required this.price});', '', '  factory Product.fromJson(Map<String, dynamic> json) {', "    return Product(name: json['name'], price: json['price']);", '  }', '', '  bool get isCheap => price < 10;', '}', '', 'void main() {', '  final items = [', "    Product.fromJson({'name': 'Kawa', 'price': 12.5}),", "    Product(name: 'Bułka', price: 1.2),", '  ];', '  for (final p in items) {', "    print('${p.name}: ${p.isCheap ? 'tanio' : 'drogo'}');", '  }', '}') },
  { id: 'dart-future', label: 'Dart: Future, await i kolejki', dialect: 'dart', concepts: ['dart-futures-streams', 'flutter-async-ui'], note: 'Liczby w wypisach to kolejność: mikrozadania przed kolejką zdarzeń.', code: L('Future<String> fetchUser() async {', "  print('2: pobieram');", '  await Future.delayed(Duration(milliseconds: 300));', "  return 'Ola';", '}', '', 'void main() async {', "  print('1: start');", "  Future(() => print('4: kolejka zdarzeń'));", "  scheduleMicrotask(() => print('3: mikrozadanie'));", '  final user = await fetchUser();', "  print('5: mam $user');", '}') },
  {
    id: 'dart-flutter',
    label: 'Flutter: drzewo widgetów',
    dialect: 'dart',
    widgets: true,
    concepts: ['flutter-widgets', 'flutter-state', 'flutter-layout'],
    note: 'build() zwraca drzewo widgetów. setState każe zbudować je jeszcze raz z nową wartością _count.',
    code: L(
      'class CounterPage extends StatefulWidget {',
      '  const CounterPage({super.key});',
      '  @override',
      '  State<CounterPage> createState() => _CounterPageState();',
      '}',
      '',
      'class _CounterPageState extends State<CounterPage> {',
      '  int _count = 0;',
      '',
      '  @override',
      '  Widget build(BuildContext context) {',
      '    return Scaffold(',
      "      appBar: AppBar(title: const Text('Licznik')),",
      '      body: Center(',
      '        child: Column(',
      '          mainAxisAlignment: MainAxisAlignment.center,',
      '          children: [',
      "            Text('Kliknięcia: $_count'),",
      '            ElevatedButton(',
      '              onPressed: () => setState(() => _count++),',
      "              child: const Text('+1'),",
      '            ),',
      '          ],',
      '        ),',
      '      ),',
      '    );',
      '  }',
      '}',
    ),
  },
]

/** Przykłady do listy w Symulatorze. */
export const EXAMPLES: Example[] = [...CONCEPT_EXAMPLES, ...REFACTOR_EXAMPLES]

/**
 * Przykład do zmiany: najpierw ta sama przeróbka (para A/B), potem pierwsze pojęcie,
 * dla którego jest przykład. Dla Darta najpierw przykłady w Darcie.
 */
export function exampleFor(refactors: readonly string[], concepts: readonly string[], dialect: 'js' | 'dart' | null): Example | null {
  for (const r of refactors) {
    const ex = REFACTOR_EXAMPLES.find(e => e.refactor === r)
    if (ex) return ex
  }
  const ordered = dialect === 'dart' ? [...CONCEPT_EXAMPLES.filter(e => e.dialect === 'dart'), ...CONCEPT_EXAMPLES.filter(e => e.dialect !== 'dart')] : CONCEPT_EXAMPLES.filter(e => e.dialect === 'js')
  for (const c of concepts) {
    const ex = ordered.find(e => e.concepts.includes(c))
    if (ex) return ex
  }
  return null
}
