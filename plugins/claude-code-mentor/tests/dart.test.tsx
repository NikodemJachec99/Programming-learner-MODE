// Dart i Flutter: symulator w dialekcie Dart, eksplorator warunków,
// wykrywanie pojęć Fluttera, komendy flutter/dart i treść biblioteki.
import { expect, mock, test } from 'claude-code/testing'
import { simulate } from '../hooks/sim/interp'
import { dartToJs, isFlutterUi, looksLikeDart, widgetTree } from '../hooks/sim/dart'
import { evalCond, parseLiteral } from '../hooks/sim/conditions'
import type { Lit } from '../hooks/sim/conditions'
import { applyEdits } from '../hooks/sim/variants'
import { simSites } from '../hooks/ui/simcache'
import { classifyCommand, detectConcepts } from '../hooks/engine/detect'
import { CONCEPTS } from '../hooks/content/concepts'

const run = (src: string) => simulate(src, { dialect: 'dart' })

test('Dart: zmienne, ~/, % i null safety dają wyniki jak w Darcie', async () => {
  const r = run(`void main() {
  int a = 7;
  final b = 2;
  print('\${a ~/ b} \${a / b} \${-7 % 3}');
  String? s;
  print(s ?? 'brak');
  s ??= 'Ola';
  print(s.length);
}`)
  expect(r.ok).toBe(true)
  expect(r.output).toEqual(['3 3.5 2', 'brak', '3'])
  expect(r.lines[3]).toMatch(/~\//)
})

test('Dart: parametry nazwane, klasa z getterem, factory i toString', async () => {
  const r = run(`class User {
  final String name;
  final int age;
  User({required this.name, this.age = 18});
  factory User.fromJson(Map<String, dynamic> json) {
    return User(name: json['name'], age: json['age'] ?? 0);
  }
  bool get isAdult => age >= 18;
  @override
  String toString() => 'User(\$name, \$age)';
}
void main() {
  final u = User.fromJson({'name': 'Ola', 'age': 17});
  print(u);
  print(u.isAdult);
  print(User(name: 'Jan').age);
}`)
  expect(r.ok).toBe(true)
  expect(r.output).toEqual(['User(Ola, 17)', 'false', '18'])
})

test('Dart: Future, mikrozadania i kolejka zdarzeń w kolejności Darta', async () => {
  const r = run(`Future<int> load() async {
  print('2');
  await Future.delayed(Duration(milliseconds: 100));
  return 42;
}
void main() async {
  print('1');
  Future(() => print('4'));
  scheduleMicrotask(() => print('3'));
  final v = await load();
  print('5: \$v');
}`)
  expect(r.ok).toBe(true)
  expect(r.output).toEqual(['1', '2', '3', '4', '5: 42'])
})

test('Dart: x! na null, int.parse i on FormatException catch', async () => {
  const r = run(`void main() {
  int? n;
  try {
    print(n! + 1);
  } catch (e) {
    print(e);
  }
  try {
    int.parse('abc');
  } on FormatException catch (e) {
    print('zły format');
  }
}`)
  expect(r.ok).toBe(true)
  expect(r.output).toEqual(['TypeError: Null check operator used on a null value', 'zły format'])
})

test('Dart: warunek musi być bool, a String + int to błąd', async () => {
  const a = run('void main() {\n  var n = 5;\n  if (n) print("x");\n}')
  expect(a.ok).toBe(false)
  expect(a.error?.message).toMatch(/bool/)
  const b = run("void main() {\n  print('n = ' + 5);\n}")
  expect(b.ok).toBe(false)
  expect(b.error?.line).toBe(2)
})

test('Dart: konstrukcje spoza podzbioru są zgłaszane z numerem linii, a nie zgadywane', async () => {
  const r = dartToJs('void main() {\n  final l = []..add(1);\n}')
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.line).toBe(2)
    expect(r.error).toMatch(/Kaskady/)
  }
})

test('Dart what-if: podmiana < na >= w oryginalnym kodzie Darta', async () => {
  const src = "void main() {\n  var x = 7;\n  if (x < 10) {\n    print('mniej');\n  } else {\n    print('co najmniej');\n  }\n}"
  const sites = simSites(src, 'dart')
  const site = sites.ops.find(o => o.op === '<')!
  expect(site.line).toBe(3)
  expect(src.slice(site.start, site.end)).toBe('<')
  const b = applyEdits(src, [{ start: site.start, end: site.end, text: '>=' }])
  expect(run(src).output).toEqual(['mniej'])
  expect(run(b).output).toEqual(['co najmniej'])
  const eq = simSites("void main() {\n  if (1 == 1) print('t');\n}", 'dart').ops.find(o => o.group === 'compare')!
  expect(eq.op).toBe('==')
})

test('Dart w eksploratorze warunków: brak konwersji typów, napisy bez <', async () => {
  const lit = (s: string): Lit => {
    const l = parseLiteral(s, 'dart')
    if ('error' in l) throw new Error(l.error)
    return l
  }
  expect(evalCond('dart', '==', lit('"7"'), lit('7')).value).toBe(false)
  expect(evalCond('dart', '==', lit('1'), lit('1.0')).value).toBe(true)
  expect(evalCond('dart', '<', lit('"a"'), lit('"b"')).error).toMatch(/String/)
  expect(evalCond('dart', '<=', lit('10'), lit('10')).value).toBe(true)
})

test('Flutter: rozpoznanie kodu UI i drzewo widgetów', async () => {
  const src = `class Home extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Start')),
      body: Column(children: [Text('a'), ElevatedButton(onPressed: () {}, child: Text('b'))]),
    );
  }
}`
  expect(isFlutterUi(src)).toBe(true)
  expect(looksLikeDart(src)).toBe(true)
  expect(looksLikeDart('const x = 5\nconsole.log(x)')).toBe(false)
  const tree = widgetTree(src).map(n => `${n.depth}:${n.slot ?? '-'}:${n.name}`)
  expect(tree).toEqual(['0:-:Scaffold', '1:appBar:AppBar', '2:title:Text', '1:body:Column', '2:children:Text', '2:children:ElevatedButton', '3:child:Text'])
})

test('Flutter: pojęcia w kodzie ekranu i komendy flutter/dart', async () => {
  const code = `class _PageState extends State<Page> {
  late Future<List<String>> _items;
  @override
  void initState() {
    super.initState();
    _items = load();
  }
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<String>>(
      future: _items,
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const CircularProgressIndicator();
        return ListView.builder(itemCount: snapshot.data!.length, itemBuilder: (c, i) => Text(snapshot.data![i]));
      },
    );
  }
}`
  const ids = detectConcepts('dart', code.split('\n').map((text, i) => ({ line: i + 1, text })), 'lib/page.dart').map(h => h.id)
  for (const id of ['flutter-state', 'flutter-widgets', 'flutter-async-ui', 'flutter-layout', 'dart-null-safety', 'dart-futures-streams']) expect(ids).toContain(id)
  expect(ids).not.toContain('react-components')
  expect(classifyCommand('flutter pub add provider').packages).toEqual(['provider'])
  expect(classifyCommand('flutter test').kind).toBe('test')
  expect(classifyCommand('flutter run -d chrome').concepts).toEqual(['cross-platform-basics'])
  expect(detectConcepts('yaml', [{ line: 3, text: '  provider: ^6.1.0' }], 'pubspec.yaml').map(h => h.id)).toEqual(['packages-dependencies'])
})

test('biblioteka: pojęcia Fluttera są w grafie, bez cykli, z poprawnymi quizami', async () => {
  const ids = new Set(CONCEPTS.map(c => c.id))
  expect(ids.size).toBe(CONCEPTS.length)
  const mobile = CONCEPTS.filter(c => c.area === 'mobile')
  expect(mobile.length).toBe(10)
  for (const c of CONCEPTS) for (const p of c.prereqs) expect(ids.has(p)).toBe(true)
  const state = new Map<string, number>()
  const visit = (id: string): void => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) throw new Error(`cykl przy ${id}`)
    state.set(id, 1)
    for (const p of CONCEPTS.find(c => c.id === id)!.prereqs) visit(p)
    state.set(id, 2)
  }
  for (const c of CONCEPTS) visit(c.id)
  for (const c of mobile) {
    expect(c.quiz.length).toBeGreaterThan(0)
    for (const q of c.quiz) {
      expect(q.answer).toBeLessThan(q.options.length)
      for (const [i, key] of Object.entries(q.misconceptionByOption ?? {})) {
        expect(Number(i)).not.toBe(q.answer)
        expect(c.misconceptions.some(m => m.key === key)).toBe(true)
      }
    }
  }
})

const PANE = {
  plugin: 'claude-code-mentor',
  component: 'Pane' as const,
  requestId: 'mentor',
  props: { title: 'Mentor', isFocused: false, bodyColumns: 72, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 160, rows: 50 },
  surface: 'desktop' as const,
}

test('panel: przykład w Darcie wykonuje się krok po kroku, a kod Fluttera pokazuje drzewo widgetów', async ($, on) => {
  mock.clock(on, { now: 1_760_000_000_000 })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-sim' })
  await ui.select({ key: 'sim-example', value: 'dart-future' })
  expect(await ui.find({ type: 'Text', text: /Dart/ })).toBeDefined()
  await ui.press({ key: 'sim-run' })
  expect(await ui.find({ type: 'Text', text: /> 5: mam Ola/ })).toBeDefined()
  await ui.select({ key: 'sim-example', value: 'dart-flutter' })
  expect(await ui.find({ type: 'Text', text: /Drzewo widgetów/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /body: Center/ })).toBeDefined()
  await ui.unmount()
})
