// Symulator: izolowane środowisko "what-if". Pracuje wyłącznie na tekście
// w pamięci. Nie zapisuje niczego do plików projektu.

import type { Host } from '../host'
import type { RenderElement } from 'claude-code'
import type { MentorSimState } from '../../types'
import { mentor } from '../mentor'
import { detectConcepts } from '../engine/detect'
import { BOUNDARY_NOTE, dialectOps, simSites, simulateCached } from './simcache'
import type { Dialect } from './simcache'
import { isFlutterUi, looksLikeDart, widgetTree } from '../sim/dart'
import { COND_OPS, LANG_NAMES, boundaryTable, evalCond, parseLiteral, showLit } from '../sim/conditions'
import type { CondLang } from '../sim/conditions'
import { explainStep, whyStep } from '../sim/explain'
import { OP_GROUPS, applyEdits, boundaryNote, compareRuns } from '../sim/variants'
import { card, md, muted, section } from './kit'
import type { Kit } from './kit'
import { DEFAULT_SIM, S } from './state'
import type { SqlRun } from '../store/db'

export const EXAMPLES: { id: string; label: string; source: string; dialect?: Dialect }[] = [
  { id: 'if', label: 'Warunek if (x < 10)', source: DEFAULT_SIM.source },
  { id: 'loop', label: 'Pętla for: suma', source: 'let sum = 0\nfor (let i = 0; i < 5; i++) {\n  sum += i\n}\nconsole.log(sum)' },
  { id: 'fn', label: 'Funkcja: argumenty i return', source: 'function area(width, height) {\n  const result = width * height\n  return result\n}\nconst a = area(3, 4)\nconsole.log("pole:", a)' },
  { id: 'eq', label: '== vs ===', source: 'const input = "0"\nif (input == 0) {\n  console.log("== mówi: równe")\n}\nif (input === 0) {\n  console.log("=== mówi: równe")\n} else {\n  console.log("=== mówi: różne typy")\n}' },
  { id: 'async', label: 'async/await i event loop', source: 'console.log("1: start")\nsetTimeout(() => console.log("5: setTimeout"), 0)\nasync function load() {\n  console.log("2: load start")\n  await null\n  console.log("4: po await")\n}\nload()\nconsole.log("3: koniec kodu synchronicznego")' },
  { id: 'err', label: 'Wyjątek i propagacja', source: 'function parseAge(text) {\n  const n = Number(text)\n  if (Number.isNaN(n)) {\n    throw new Error("To nie liczba: " + text)\n  }\n  return n\n}\ntry {\n  console.log(parseAge("12"))\n  console.log(parseAge("abc"))\n} catch (e) {\n  console.log("Błąd:", e.message)\n}' },
  { id: 'dart-basics', label: 'Dart: zmienne, ~/ i null safety', dialect: 'dart', source: "void main() {\n  int total = 17;\n  final people = 5;\n  print('każdy dostaje ${total ~/ people}');\n  print('reszta ${total % people}');\n  String? coupon;\n  print(coupon ?? 'brak kuponu');\n  coupon = 'RABAT10';\n  print(coupon.length);\n}" },
  { id: 'dart-class', label: 'Dart: klasa, fromJson i getter', dialect: 'dart', source: "class Product {\n  final String name;\n  final double price;\n  Product({required this.name, required this.price});\n\n  factory Product.fromJson(Map<String, dynamic> json) {\n    return Product(name: json['name'], price: json['price']);\n  }\n\n  bool get isCheap => price < 10;\n}\n\nvoid main() {\n  final items = [\n    Product.fromJson({'name': 'Kawa', 'price': 12.5}),\n    Product(name: 'Bułka', price: 1.2),\n  ];\n  for (final p in items) {\n    if (p.isCheap) {\n      print('${p.name}: tanio');\n    } else {\n      print('${p.name}: drogo');\n    }\n  }\n}" },
  { id: 'dart-future', label: 'Dart: Future, await i kolejki', dialect: 'dart', source: "Future<String> fetchUser() async {\n  print('2: pobieram');\n  await Future.delayed(Duration(milliseconds: 300));\n  return 'Ola';\n}\n\nvoid main() async {\n  print('1: start');\n  Future(() => print('4: kolejka zdarzeń'));\n  scheduleMicrotask(() => print('3: mikrozadanie'));\n  final user = await fetchUser();\n  print('5: mam $user');\n}" },
  { id: 'dart-flutter', label: 'Flutter: drzewo widgetów', dialect: 'dart', source: "class CounterPage extends StatefulWidget {\n  const CounterPage({super.key});\n  @override\n  State<CounterPage> createState() => _CounterPageState();\n}\n\nclass _CounterPageState extends State<CounterPage> {\n  int _count = 0;\n\n  @override\n  Widget build(BuildContext context) {\n    return Scaffold(\n      appBar: AppBar(title: const Text('Licznik')),\n      body: Center(\n        child: Column(\n          mainAxisAlignment: MainAxisAlignment.center,\n          children: [\n            Text('Kliknięcia: $_count'),\n            ElevatedButton(\n              onPressed: () => setState(() => _count++),\n              child: const Text('+1'),\n            ),\n          ],\n        ),\n      ),\n    );\n  }\n}" },
  { id: 'closure', label: 'Domknięcie (closure)', source: 'function makeCounter() {\n  let count = 0\n  return () => {\n    count++\n    return count\n  }\n}\nconst next = makeCounter()\nnext()\nconsole.log(next())' },
]

export async function loadSim(io: Host, source: string, origin: string, lang?: string): Promise<void> {
  const isSql = /^\s*(select|with|insert|update|delete)\b/i.test(source)
  const dialect: Dialect = lang === 'dart' || (lang === undefined && looksLikeDart(source)) ? 'dart' : 'js'
  await io.set(S.sim, s => (isSql ? { ...s, mode: 'sql' as const, sqlQuery: source.trim(), sqlResult: null } : { ...s, mode: 'js' as const, dialect, source, origin, edits: [], cursor: 0, variant: 'A' as const, panel: 'state' as const, callArgs: '' }))
  await io.set(S.tab, () => 'sim' as const)
}

function program(s: MentorSimState, variant: 'A' | 'B'): string {
  const base = variant === 'B' && s.edits.length ? applyEdits(s.source, s.edits) : s.source
  return s.callArgs.trim() ? `${base}\n${s.callArgs.trim()}` : base
}

function controls(io: Host, k: Kit, total: number, cursor: number, hasB: boolean, variant: 'A' | 'B'): RenderElement {
  const { Box, Button } = k.E
  const set = (fn: (s: MentorSimState) => MentorSimState) => () => io.set(S.sim, fn)
  const clamp = (n: number) => Math.max(0, Math.min(total - 1, n))
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      <Button key="sim-reset" onPress={set(s => ({ ...s, cursor: 0 }))}>
        RESET
      </Button>
      <Button key="sim-back" onPress={set(s => ({ ...s, cursor: clamp(s.cursor - 1) }))}>
        ◀ BACK
      </Button>
      <Button key="sim-step" variant="primary" onPress={set(s => ({ ...s, cursor: clamp(s.cursor + 1) }))}>
        STEP ▶
      </Button>
      <Button key="sim-run" onPress={set(s => ({ ...s, cursor: total - 1 }))}>
        RUN ⏭
      </Button>
      <Button key="sim-explain" onPress={set(s => ({ ...s, panel: s.panel === 'explain' ? 'state' : 'explain' }))}>
        EXPLAIN
      </Button>
      <Button key="sim-why" onPress={set(s => ({ ...s, panel: s.panel === 'why' ? 'state' : 'why' }))}>
        WHY
      </Button>
      {hasB && (
        <Button key="sim-compare" onPress={set(s => ({ ...s, panel: s.panel === 'compare' ? 'state' : 'compare' }))}>
          COMPARE
        </Button>
      )}
      {hasB && (
        <Button key="sim-variant" onPress={set(s => ({ ...s, variant: s.variant === 'A' ? 'B' : 'A', cursor: 0 }))}>
          {variant === 'A' ? 'Pokaż wariant B' : 'Pokaż oryginał A'}
        </Button>
      )}
      <Button key="sim-pos" plain dimColor onPress={() => undefined}>
        {`krok ${cursor + 1}/${total}`}
      </Button>
    </Box>
  )
}

function renderFlutter(k: Kit, s: MentorSimState): RenderElement {
  const { Box, Text } = k.E
  const tree = widgetTree(s.source)
  const width = Math.max(20, k.cols - 8)
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">{`Źródło: ${s.origin}. Kod interfejsu Fluttera potrzebuje silnika Fluttera, więc symulator go nie wykonuje. Pokazuje drzewo widgetów, które zbuduje build().`}</Text>
      {card(
        k,
        'autoAccept',
        <Text bold>Drzewo widgetów</Text>,
        tree.length === 0 ? muted(k, 'Nie znalazłem wywołań widgetów (np. return Scaffold(...)).') : null,
        ...tree.map((n, i) => {
          const label = `${'  '.repeat(n.depth)}${n.depth ? '└ ' : ''}${n.slot ? `${n.slot}: ` : ''}${n.name}`
          return (
            <Text key={`wt-${i}`} wrap="truncate-end">
              <Text color={n.depth === 0 ? 'claude' : undefined} bold={n.depth === 0}>
                {label.length > width - 8 ? label.slice(0, width - 9) + '…' : label}
              </Text>
              <Text dimColor>{`  L${n.line}`}</Text>
            </Text>
          )
        }),
      )}
      {muted(k, 'Każde wcięcie to rodzic i dziecko. child: ma jedno dziecko, children: listę. Constraints idą w dół drzewa, rozmiary w górę, a rodzic ustawia pozycję dziecka.')}
      {muted(k, 'Logikę w Darcie (funkcje, klasy modeli, Future) wklej osobno, wtedy symulator wykona ją krok po kroku.')}
    </Box>
  )
}

async function renderJs(io: Host, k: Kit, s: MentorSimState): Promise<RenderElement> {
  const { Box, Text, Button, Input, Select } = k.E
  const dialect: Dialect = s.dialect ?? 'js'
  if (dialect === 'dart' && isFlutterUi(s.source)) return renderFlutter(k, s)
  const variant = s.edits.length ? s.variant : 'A'
  const src = program(s, variant)
  const r = simulateCached(src, dialect)
  const sites = simSites(s.source, dialect)
  const cursor = Math.max(0, Math.min(s.cursor, Math.max(0, r.steps.length - 1)))
  const step = r.steps[cursor]
  const seen = new Set(r.steps.slice(0, cursor + 1).map(x => x.line))
  const width = Math.max(20, k.cols - 8)
  const lines = r.lines
  const onlyFunctions = dialect === 'js' && sites.error === undefined && /^\s*(export\s+)?(async\s+)?function\b/.test(s.source) && !/\n\S.*\(.*\)\s*;?\s*$/.test(s.source.split('\n').slice(-1).join('')) && !s.callArgs

  const codeView = (
    <Box flexDirection="column" borderStyle="round" borderColor={variant === 'B' ? 'warning' : 'subtle'} paddingX={1}>
      <Text dimColor>{`${variant === 'B' ? 'Wariant B (zmieniony, tylko w pamięci)' : 'Wariant A (oryginał)'}${dialect === 'dart' ? ' · Dart' : ''}`}</Text>
      {lines.map((text, i) => {
        const n = i + 1
        const current = step?.line === n && step.kind !== 'end'
        const label = `${current ? '▶' : ' '}${String(n).padStart(3)} │ ${text}`
        return (
          <Text key={`ln-${n}`} wrap="truncate-end" bold={current} color={current ? 'claude' : undefined} dimColor={!current && !seen.has(n)}>
            {label.length > width ? label.slice(0, width - 1) + '…' : label}
          </Text>
        )
      })}
    </Box>
  )

  const opSelects = sites.ops.slice(0, 6).map(site => {
    const edit = s.edits.find(e => e.siteId === site.id)
    const current = edit?.text ?? site.op
    return (
      <Select
        key={`op-${site.id}`}
        label={`L${site.line} ${site.expr.length > 22 ? site.expr.slice(0, 21) + '…' : site.expr}:`}
        value={current}
        options={dialectOps(OP_GROUPS[site.group], dialect).map(op => ({ value: op, label: op === site.op ? `${op} (oryginał)` : op }))}
        onSelect={value =>
          io.set(S.sim, x => {
            const others = x.edits.filter(e => e.siteId !== site.id)
            const edits = value === site.op ? others : [...others, { siteId: site.id, start: site.start, end: site.end, text: value, before: site.op, line: site.line }]
            return { ...x, edits, variant: (edits.length ? 'B' : 'A') as 'A' | 'B', cursor: 0 }
          })
        }
      />
    )
  })
  const valueInputs = sites.values.slice(0, 5).map(site => {
    const edit = s.edits.find(e => e.siteId === site.id)
    return (
      <Input
        key={`val-${site.id}`}
        label={`L${site.line} ${site.name} =`}
        value={edit?.text ?? site.raw}
        submitLabel="ustaw"
        onSubmit={value =>
          io.set(S.sim, x => {
            const others = x.edits.filter(e => e.siteId !== site.id)
            const v = value.trim()
            const edits = !v || v === site.raw ? others : [...others, { siteId: site.id, start: site.start, end: site.end, text: v, before: site.raw, line: site.line }]
            return { ...x, edits, variant: (edits.length ? 'B' : 'A') as 'A' | 'B', cursor: 0 }
          })
        }
      />
    )
  })

  let panel: RenderElement | null = null
  if (r.error?.kind === 'syntax') {
    panel = card(k, 'error', <Text color="error">{`Nie umiem wykonać tego kodu: ${r.error.message}${r.error.line ? ` (linia ${r.error.line})` : ''}`}</Text>, muted(k, dialect === 'dart' ? 'Symulator obsługuje podzbiór Darta: zmienne, null safety, if/switch, pętle, funkcje z parametrami nazwanymi, klasy, factory, gettery, enumy, wyjątki, List/Map/Set, Future, async/await. Bez Fluttera, Streamów i kaskad (..).' : 'Symulator obsługuje podzbiór JS/TS: zmienne, operatory, if/switch, pętle, funkcje, klasy, wyjątki, tablice, obiekty, Map/Set, Promise, async/await, setTimeout. Zaznacz mniejszy fragment albo dopisz wywołanie funkcji.'))
  } else if (step) {
    if (s.panel === 'explain') panel = card(k, 'suggestion', <Text bold>EXPLAIN · krok {cursor + 1}</Text>, ...explainStep(step, r).map(t => md(k, t)))
    else if (s.panel === 'why') panel = card(k, 'permission', <Text bold>WHY · krok {cursor + 1}</Text>, md(k, whyStep(step, r)), step.cond ? md(k, `Warunek \`${step.cond.expr}\` → **${step.cond.result}**`) : null)
    else if (s.panel === 'compare' && s.edits.length) {
      const a = simulateCached(program(s, 'A'), dialect)
      const b = simulateCached(program(s, 'B'), dialect)
      const cmp = compareRuns(a, b, s.edits.map(e => ({ before: e.before, after: e.text, line: e.line })))
      panel = card(k, 'warning', <Text bold>COMPARE · A (oryginał) vs B (zmieniony)</Text>, ...cmp.lines.map(t => md(k, t)))
    } else {
      const vars = Object.entries(step.vars).filter(([, v]) => !v.startsWith('[Function') && !v.startsWith('[class'))
      panel = card(
        k,
        step.hypothetical ? 'warning' : 'subtle',
        <Text bold wrap="wrap">{`Krok ${cursor + 1}/${r.steps.length} · linia ${step.line}`}</Text>,
        <Text wrap="wrap">{step.text}</Text>,
        step.cond && step.cond.detail.length > 0 && <Text color="suggestion" wrap="wrap">{`↳ ${step.cond.detail.join(' · ')}`}</Text>,
        step.hypothetical && <Text color="warning">Ten krok opiera się na założeniu symulatora, nie na zweryfikowanym wykonaniu.</Text>,
        <Text bold>Zmienne</Text>,
        vars.length === 0 ? muted(k, '(brak)') : null,
        ...vars.slice(0, 14).map(([name, v]) => (
          <Text key={`var-${name}`} wrap="truncate-end" color={step.changed.includes(name) ? 'warning' : undefined}>
            {`${step.changed.includes(name) ? '● ' : '  '}${name} = ${v}`}
          </Text>
        )),
        <Text bold>Stos wywołań</Text>,
        <Text dimColor wrap="wrap">{step.stack.length ? [...step.stack].reverse().join('  ←  ') : '(pusty: działa pętla zdarzeń)'}</Text>,
        (step.queues.micro.length > 0 || step.queues.macro.length > 0) && <Text bold>Kolejki</Text>,
        step.queues.micro.length > 0 && <Text color="permission" wrap="wrap">{`mikro: ${step.queues.micro.join(' → ')}`}</Text>,
        step.queues.macro.length > 0 && <Text color="ide" wrap="wrap">{`makro: ${step.queues.macro.join(' → ')}`}</Text>,
        <Text bold>Wyjście</Text>,
        r.output.slice(0, step.out).length === 0 ? muted(k, '(nic jeszcze nie wypisano)') : null,
        ...r.output.slice(0, step.out).slice(-8).map((o, i) => <Text key={`out-${i}`} wrap="wrap">{`> ${o}`}</Text>),
      )
    }
  }

  const finished = step?.kind === 'end'
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">{`Źródło: ${s.origin}. Symulacja działa w pamięci i nie zmienia plików projektu.`}</Text>
      {codeView}
      {onlyFunctions && card(k, 'warning', <Text>Ten fragment tylko definiuje funkcję. Dopisz wywołanie, np. nazwa(1, 2):</Text>)}
      <Input key="sim-call" label="Wywołanie (opcjonalne):" placeholder="np. fetchData(1) albo add(2, 3)" value={s.callArgs} submitLabel="uruchom" onSubmit={value => io.set(S.sim, x => ({ ...x, callArgs: value, cursor: 0 }))} />
      {controls(io, k, Math.max(1, r.steps.length), cursor, s.edits.length > 0, variant)}
      {panel}
      {finished && r.skipped.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Pominięte fragmenty</Text>
          {r.skipped.slice(0, 6).map((x, i) => (
            <Text key={`sk-${i}`} dimColor wrap="wrap">{`linie ${x.from}-${x.to}: ${x.reason}`}</Text>
          ))}
        </Box>
      )}
      {finished && r.loops.length > 0 && <Text dimColor>{`Pętle: ${r.loops.map(l => `linia ${l.line}: ${l.iterations} iteracji`).join(', ')}`}</Text>}
      {r.error && r.error.kind !== 'syntax' && <Text color="error" wrap="wrap">{r.error.message}</Text>}
      {r.hypotheses.length > 0 && card(k, 'warning', <Text color="warning">Założenia symulatora (nie są zweryfikowanym wykonaniem)</Text>, ...r.hypotheses.map(x => muted(k, `• ${x}`)))}
      {(sites.ops.length > 0 || sites.values.length > 0) &&
        section(
          k,
          'What-if: zmień operator albo wartość (wariant B)',
          ...opSelects,
          ...valueInputs,
          s.edits.length > 0 && (
            <Box flexDirection="row" columnGap={1}>
              <Button key="sim-clear" onPress={() => io.set(S.sim, x => ({ ...x, edits: [], variant: 'A' as const, cursor: 0, panel: 'state' as const }))}>
                Wyczyść zmiany
              </Button>
              <Button key="sim-log" onPress={() => mentor.simExperiment(io, detectConcepts(dialect, s.source.split('\n').map((t, i) => ({ line: i + 1, text: t }))).map(x => x.id))}>
                Zapisz eksperyment w historii nauki
              </Button>
            </Box>
          ),
          ...s.edits.map(e => boundaryNote(e.before, e.text)).filter((x): x is string => !!x).map(t => muted(k, t)),
        )}
    </Box>
  )
}

function renderCond(io: Host, k: Kit, s: MentorSimState): RenderElement {
  const { Box, Text, Input, Select } = k.E
  const lang = s.condLang as CondLang
  const left = parseLiteral(s.condLeft, lang)
  const right = parseLiteral(s.condRight, lang)
  const ops = COND_OPS[lang]
  const op = ops.includes(s.condOp) ? s.condOp : '<'
  const res = !('error' in left) && !('error' in right) ? evalCond(lang, op, left, right) : null
  const table = !('error' in right) ? boundaryTable(lang, right, 'error' in left ? undefined : left) : []
  const cell = (v: boolean | null) => (v === null ? 'Err' : v ? 'true' : 'false')
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">Eksplorator warunków: jeden operator, dwie wartości, semantyka wybranego języka. Wpisz liczbę (7), napis w cudzysłowie ("7"), true/false/null (Python: True/False/None).</Text>
      <Select key="cond-lang" label="Język:" value={lang} options={(['js', 'py', 'php', 'dart'] as const).map(l => ({ value: l, label: LANG_NAMES[l] }))} onSelect={v => io.set(S.sim, x => ({ ...x, condLang: v as CondLang }))} />
      <Input key="cond-left" label="Lewa strona (x):" value={s.condLeft} submitLabel="ustaw" onSubmit={v => io.set(S.sim, x => ({ ...x, condLeft: v }))} />
      <Select key="cond-op" label="Operator:" value={op} options={ops.map(o => ({ value: o, label: o }))} onSelect={v => io.set(S.sim, x => ({ ...x, condOp: v }))} />
      <Input key="cond-right" label="Prawa strona:" value={s.condRight} submitLabel="ustaw" onSubmit={v => io.set(S.sim, x => ({ ...x, condRight: v }))} />
      {'error' in left && <Text color="error">{left.error}</Text>}
      {'error' in right && <Text color="error">{right.error}</Text>}
      {res &&
        card(
          k,
          res.value === true ? 'success' : res.value === false ? 'error' : 'warning',
          <Text bold>{`${showLit(left as never, lang)} ${op} ${showLit(right as never, lang)}  →  ${res.error ?? cell(res.value)}`}</Text>,
          <Text>{res.value === true ? 'Warunek prawdziwy: program wejdzie w blok if.' : res.value === false ? 'Warunek fałszywy: blok if zostanie pominięty (wykona się else, jeśli jest).' : 'Błąd: program przerwie się w tym miejscu.'}</Text>,
          ...res.notes.map(n => muted(k, `↳ ${n}`)),
        )}
      {table.length > 0 &&
        section(
          k,
          'Przypadki brzegowe (wszystkie operatory)',
          <Text dimColor>{`x \\ op   ${ops.map(o => o.padEnd(5)).join('')}`}</Text>,
          ...table.map(row => (
            <Text key={`row-${showLit(row.a, lang)}`}>{`${showLit(row.a, lang).padEnd(8)} ${row.results.map(r => cell(r.r.value).slice(0, 4).padEnd(5)).join('')}`}</Text>
          )),
          muted(k, BOUNDARY_NOTE),
        )}
    </Box>
  )
}

function renderSql(io: Host, k: Kit, s: MentorSimState): RenderElement {
  const { Box, Text, Button, Input, Code } = k.E
  const query = s.sqlQuery
  let result: SqlRun | null = null
  try {
    result = s.sqlResult ? (JSON.parse(s.sqlResult) as SqlRun) : null
  } catch {
    result = null
  }
  const fmt = (v: unknown) => (v === null || v === undefined ? 'NULL' : String(v))
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">Zapytanie wykonuje się naprawdę, w SQLite w pamięci, na przykładowych danych poniżej. Pliki i baza projektu nie są dotykane. Wynik pokazuje logiczne etapy: FROM/JOIN, WHERE, GROUP BY, wynik.</Text>
      <Text bold>Dane przykładowe</Text>
      <Code source={s.sqlSetup} language="sql" wrap="wrap" />
      <Input key="sql-setup" label="Zastąp dane (CREATE/INSERT, ; między poleceniami):" placeholder="CREATE TABLE t(a INT); INSERT INTO t VALUES (1),(NULL);" submitLabel="ustaw" onSubmit={v => io.set(S.sim, x => ({ ...x, sqlSetup: v.trim() ? v : x.sqlSetup, sqlResult: null }))} />
      <Text bold>Zapytanie</Text>
      <Code source={query} language="sql" wrap="wrap" />
      <Input key="sql-query" label="Nowe zapytanie:" placeholder="SELECT …" submitLabel="ustaw" onSubmit={v => io.set(S.sim, x => ({ ...x, sqlQuery: v.trim() || query, sqlResult: null }))} />
      <Button key="sql-run" variant="primary" onPress={async () => {
        const out = await mentor.runSql(io, s.sqlSetup, query)
        await io.set(S.sim, x => ({ ...x, sqlResult: out }))
      }}>
        Wykonaj w piaskownicy
      </Button>
      {result && !result.ok && <Text color="error" wrap="wrap">{result.error ?? 'Błąd'}</Text>}
      {result?.ok &&
        (result.stages ?? []).map((st, i) => (
          <Box key={`st-${i}`} flexDirection="column" marginTop={1}>
            <Text bold color="warning">{st.title}</Text>
            <Text dimColor wrap="wrap">{st.explain}</Text>
            {st.note && <Text color="warning" wrap="wrap">{st.note}</Text>}
            {st.columns.length > 0 && <Text bold>{st.columns.map(c => c.slice(0, 14).padEnd(15)).join('')}</Text>}
            {st.rows.slice(0, 15).map((row, j) => (
              <Text key={`r-${i}-${j}`} color={row.includes('UNKNOWN (NULL)') ? 'warning' : row.includes('FALSE') ? 'inactive' : undefined}>
                {row.map(v => fmt(v).slice(0, 14).padEnd(15)).join('')}
              </Text>
            ))}
            {st.total > 15 && muted(k, `… i ${st.total - 15} więcej`)}
          </Box>
        ))}
      {result?.engine && muted(k, `Silnik: ${result.engine}. Inne bazy (MySQL, PostgreSQL) mogą różnić się szczegółami składni i typów.`)}
    </Box>
  )
}

export async function renderSim(io: Host, k: Kit): Promise<RenderElement> {
  const { Box, Button, Select } = k.E
  const s = await io.get(S.sim)
  const mode = (m: MentorSimState['mode']) => () => io.set(S.sim, x => ({ ...x, mode: m }))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="m-js" variant={s.mode === 'js' ? 'primary' : undefined} onPress={mode('js')}>
          Kod JS/TS/Dart
        </Button>
        <Button key="m-cond" variant={s.mode === 'cond' ? 'primary' : undefined} onPress={mode('cond')}>
          Warunek
        </Button>
        <Button key="m-sql" variant={s.mode === 'sql' ? 'primary' : undefined} onPress={mode('sql')}>
          SQL
        </Button>
      </Box>
      {s.mode === 'js' && (
        <Select
          key="sim-example"
          label="Przykład:"
          value=""
          options={[{ value: '', label: '(wybierz albo użyj /mentor sim)' }, ...EXAMPLES.map(e => ({ value: e.id, label: e.label }))]}
          onSelect={v => {
            const ex = EXAMPLES.find(e => e.id === v)
            if (ex) return loadSim(io, ex.source, `przykład: ${ex.label}`, ex.dialect ?? 'js')
          }}
        />
      )}
      {s.mode === 'js' ? await renderJs(io, k, s) : s.mode === 'cond' ? renderCond(io, k, s) : renderSql(io, k, s)}
    </Box>
  )
}
