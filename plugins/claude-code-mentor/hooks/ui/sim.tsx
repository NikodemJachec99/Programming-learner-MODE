// Symulator: izolowane środowisko "what-if". Pracuje wyłącznie na tekście
// w pamięci. Nie zapisuje niczego do plików projektu.

import type { Host } from '../host'
import type { RenderElement } from 'claude-code'
import type { MentorSimState } from '../../types'
import { SPEED_LABEL, mentor } from '../mentor'
import { detectConcepts } from '../engine/detect'
import { BOUNDARY_NOTE, dialectOps, program, simSites, simulateCached } from './simcache'
import type { Dialect } from './simcache'
import { isFlutterUi, looksLikeDart, widgetTree } from '../sim/dart'
import { COND_OPS, LANG_NAMES, boundaryTable, evalCond, parseLiteral, showLit } from '../sim/conditions'
import type { CondLang } from '../sim/conditions'
import { explainStep, whyStep } from '../sim/explain'
import { OP_GROUPS, applyEdits, boundaryNote, compareRuns } from '../sim/variants'
import { autoCall, looksLikeCall, pairCall } from '../sim/autocall'
import { EXAMPLES } from '../engine/examples'
import { pixelBarSvg } from './visuals'
import type { Elements } from 'claude-code'
import { card, md, muted, section } from './kit'
import type { Kit } from './kit'
import { DEFAULT_SIM, S } from './state'
import type { SqlRun } from '../store/db'

export async function loadSim(io: Host, source: string, origin: string, lang?: string): Promise<void> {
  const isSql = /^\s*(select|with|insert|update|delete)\b/i.test(source)
  const dialect: Dialect = lang === 'dart' || (lang === undefined && looksLikeDart(source)) ? 'dart' : 'js'
  await io.set(S.sim, s => (isSql ? { ...s, mode: 'sql' as const, sqlQuery: source.trim(), sqlResult: null } : { ...s, mode: 'js' as const, dialect, pair: null, source, origin, note: undefined, playing: false, edits: [], cursor: 0, variant: 'A' as const, panel: 'state' as const, callArgs: '' }))
  await io.set(S.tab, () => 'sim' as const)
}


/** Pasek postępu z bloków, np. ▰▰▰▱▱▱ 12/32. */
export function progressBar(done: number, total: number, width = 16): string {
  const n = Math.max(0, Math.min(width, Math.round((done / Math.max(1, total)) * width)))
  return `${'▰'.repeat(n)}${'▱'.repeat(width - n)}`
}

function controls(io: Host, k: Kit, total: number, cursor: number, hasB: boolean, variant: 'A' | 'B', paired: boolean, playing: boolean, speed: 'slow' | 'normal' | 'fast'): RenderElement {
  const { Box, Button, Text } = k.E
  // każdy ręczny ruch zatrzymuje odtwarzanie
  const set = (fn: (s: MentorSimState) => MentorSimState) => () => io.set(S.sim, s => ({ ...fn(s), playing: false }))
  const clamp = (n: number) => Math.max(0, Math.min(total - 1, n))
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1} alignItems="center">
      <Button key="sim-reset" plain dimColor onPress={set(s => ({ ...s, cursor: 0 }))}>
        ↺
      </Button>
      <Button key="sim-back" onPress={set(s => ({ ...s, cursor: clamp(s.cursor - 1) }))}>
        ◀
      </Button>
      <Button key="sim-play" variant="primary" onPress={() => mentor.playSim(io)}>
        {playing ? '⏸ Pauza' : cursor >= total - 1 && total > 1 ? '↻ Odtwórz jeszcze raz' : '▶ Odtwórz'}
      </Button>
      <Button key="sim-step" onPress={set(s => ({ ...s, cursor: clamp(s.cursor + 1) }))}>
        Krok ▶
      </Button>
      <Button key="sim-run" plain dimColor onPress={set(s => ({ ...s, cursor: total - 1 }))}>
        ⏭
      </Button>
      <Button key="sim-speed" plain dimColor onPress={() => mentor.cycleSpeed(io)}>
        {`tempo: ${SPEED_LABEL[speed]}`}
      </Button>
      {hasB && (
        <Button key="sim-compare" onPress={set(s => ({ ...s, panel: s.panel === 'compare' ? 'state' : 'compare' }))}>
          Porównaj A i B
        </Button>
      )}
      {hasB && !paired && (
        <Button key="sim-variant" plain dimColor onPress={set(s => ({ ...s, variant: s.variant === 'A' ? 'B' : 'A', cursor: 0 }))}>
          {variant === 'A' ? 'pokaż B' : 'pokaż A'}
        </Button>
      )}
      <Text color={playing ? 'claude' : undefined} dimColor={!playing}>{`${progressBar(cursor + 1, total, 12)} ${cursor + 1}/${total}`}</Text>
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
  const pair = s.pair ?? null
  const variant = pair || s.edits.length ? s.variant : 'A'
  const src = program(s, variant)
  const r = simulateCached(src, dialect)
  const sites = pair ? { ops: [], values: [] } : simSites(s.source, dialect)
  const lineBase = pair ? (variant === 'A' ? pair.aStart : pair.bStart) - 1 : 0
  const cursor = Math.max(0, Math.min(s.cursor, Math.max(0, r.steps.length - 1)))
  const step = r.steps[cursor]
  const seen = new Set(r.steps.slice(0, cursor + 1).map(x => x.line))
  const width = Math.max(20, k.cols - 8)
  const typed = s.callArgs.trim()
  const pc = pair ? pairCall(pair.a, pair.b, dialect, typed) : null
  const auto = pair ? (pc?.call && !typed ? { label: pc.label! } : null) : autoCall(s.source, dialect)
  const badCall = !!typed && !looksLikeCall(typed)
  const codeLines = (pair ? (variant === 'A' ? pair.a : pair.b) : variant === 'B' && s.edits.length ? applyEdits(s.source, s.edits) : s.source).split('\n').length

  const codeView = (
    <Box flexDirection="column" borderStyle="round" borderColor={variant === 'B' ? 'warning' : 'subtle'} paddingX={1}>
      {(pair || s.edits.length > 0) && <Text dimColor>{pair ? (variant === 'A' ? `A: ${pair.aLabel}` : `B: ${pair.bLabel}`) : variant === 'B' ? 'B: zmieniony (tylko w pamięci)' : 'A: oryginał'}</Text>}
      {r.lines.map((text, i) => {
        const n = i + 1
        const current = step?.line === n && step.kind !== 'end'
        const extra = n > codeLines
        const label = `${current ? '▶' : ' '}${extra ? '    ' : String(n + lineBase).padStart(4)} │ ${text}`
        return (
          <Text key={`ln-${n}`} wrap="truncate-end" bold={current} color={current ? 'claude' : extra ? 'suggestion' : undefined} dimColor={!current && !extra && !seen.has(n)}>
            {label.length > width ? label.slice(0, width - 1) + '…' : label}
          </Text>
        )
      })}
    </Box>
  )

  let panel: RenderElement | null = null
  if (r.error?.kind === 'syntax') {
    panel = card(k, 'error', <Text color="error" wrap="wrap">{`Nie umiem wykonać tego kodu: ${r.error.message}${r.error.line ? ` (linia ${r.error.line})` : ''}`}</Text>, muted(k, dialect === 'dart' ? 'Obsługiwany podzbiór Darta: zmienne, null safety, if/switch, pętle, funkcje, klasy, wyjątki, kolekcje, Future, async/await. Bez Fluttera, Streamów i kaskad (..).' : 'Obsługiwany podzbiór JS/TS: zmienne, operatory, if/switch, pętle, funkcje, klasy, wyjątki, tablice, obiekty, Map/Set, Promise, async/await, setTimeout.'))
  } else if (step) {
    if (s.panel === 'compare' && pc?.problem) {
      panel = card(k, 'warning', <Text bold>Tego porównania nie da się zrobić uczciwie</Text>, <Text wrap="wrap">{pc.problem}</Text>)
    } else if (s.panel === 'compare' && (pair || s.edits.length)) {
      const a = simulateCached(program(s, 'A'), dialect)
      const b = simulateCached(program(s, 'B'), dialect)
      const cmp = compareRuns(a, b, pair ? [] : s.edits.map(e => ({ before: e.before, after: e.text, line: e.line })))
      panel = card(
        k,
        'warning',
        <Text bold>{pair ? `A (${pair.aLabel}) i B (${pair.bLabel}) na tych samych danych` : 'A (oryginał) i B (zmieniony)'}</Text>,
        ...cmp.lines.map(t => md(k, t)),
        (a.assumed || b.assumed) && <Text color="warning" wrap="wrap">Część wyniku opiera się na założeniach symulatora (zaślepki, sieć, losowość albo zegar). Różnica może nie wystąpić w prawdziwym programie.</Text>,
      )
    } else {
      const vars = Object.entries(step.vars).filter(([, v]) => !v.startsWith('[Function') && !v.startsWith('[class') && !v.startsWith('‹'))
      const why = whyStep(step, r).replace(/^Dlaczego ten krok: /, '')
      const more = s.panel === 'explain'
      const out = r.output.slice(0, step.out)
      panel = card(
        k,
        step.hypothetical ? 'warning' : 'subtle',
        <Text bold wrap="wrap">{`Linia ${step.line + lineBase}: ${step.text}`}</Text>,
        step.cond && step.cond.detail.length > 0 && <Text color="suggestion" wrap="wrap">{`↳ ${step.cond.detail.join(' · ')}`}</Text>,
        <Text dimColor wrap="wrap">{`Dlaczego teraz: ${why}`}</Text>,
        step.hypothetical && <Text color="warning" wrap="wrap">Ten krok opiera się na założeniu symulatora.</Text>,
        vars.length > 0 && <Text bold>Zmienne</Text>,
        ...vars.slice(0, 10).map(([name, v]) => (
          <Text key={`var-${name}`} wrap="truncate-end" color={step.changed.includes(name) ? 'warning' : undefined}>
            {`${step.changed.includes(name) ? '● ' : '  '}${name} = ${v}`}
          </Text>
        )),
        step.stack.length > 1 && <Text dimColor wrap="wrap">{`Stos: ${[...step.stack].reverse().join('  ←  ')}`}</Text>,
        step.queues.micro.length > 0 && <Text color="permission" wrap="wrap">{`Mikrozadania: ${step.queues.micro.join(' → ')}`}</Text>,
        step.queues.macro.length > 0 && <Text color="ide" wrap="wrap">{`Makrozadania: ${step.queues.macro.join(' → ')}`}</Text>,
        out.length > 0 && <Text bold>Wyjście</Text>,
        ...out.slice(-6).map((o, i) => <Text key={`out-${i}`} wrap="wrap">{`> ${o}`}</Text>),
        more && <Box flexDirection="column" marginTop={1}>{explainStep(step, r).slice(1).map((t, i) => md(k, t, `ex-${i}`))}</Box>,
        <Button key="sim-explain" plain dimColor onPress={() => io.set(S.sim, x => ({ ...x, panel: x.panel === 'explain' ? 'state' : 'explain' }))}>
          {more ? 'mniej' : 'więcej o tym kroku'}
        </Button>,
      )
    }
  }

  const whatIf = s.panel === 'whatif' && sites.ops.length + sites.values.length > 0
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{`${s.origin} · tylko w pamięci, pliki bez zmian`}</Text>
      {s.note && <Text color="suggestion" wrap="wrap">{s.note}</Text>}
      {pair && (
        <Box flexDirection="row" columnGap={1}>
          <Button key="pair-a" variant={variant === 'A' ? 'primary' : undefined} plain={variant === 'A' ? undefined : true} dimColor={variant !== 'A'} onPress={() => io.set(S.sim, x => ({ ...x, variant: 'A' as const, cursor: 0 }))}>
            {`A: ${pair.aLabel}`}
          </Button>
          <Button key="pair-b" variant={variant === 'B' ? 'primary' : undefined} plain={variant === 'B' ? undefined : true} dimColor={variant !== 'B'} onPress={() => io.set(S.sim, x => ({ ...x, variant: 'B' as const, cursor: 0 }))}>
            {`B: ${pair.bLabel}`}
          </Button>
          <Button key="pair-close" plain dimColor onPress={() => io.set(S.sim, x => ({ ...x, pair: null, source: pair.b, variant: 'A' as const, cursor: 0 }))}>
            ✕
          </Button>
        </Box>
      )}
      {codeView}
      {!typed && auto && <Text dimColor wrap="wrap">{`Uruchamiam ${auto.label} z przykładowymi danymi. Wpisz własne wywołanie, żeby sprawdzić inne.`}</Text>}
      {pc?.problem && <Text color="warning" wrap="wrap">{pc.problem}</Text>}
      {badCall && <Text color="warning" wrap="wrap">{`„${typed}” to nie jest wywołanie funkcji${auto ? `, więc uruchamiam ${auto.label}. Wpisz np. ${auto.label}` : '. Wpisz np. nazwa(1, 2)'}.`}</Text>}
      <Input key="sim-call" label={pair ? 'Wywołanie (A i B):' : 'Wywołanie:'} placeholder={auto ? auto.label : pair?.hint ? pair.hint : 'np. add(2, 3)'} value={s.callArgs} submitLabel="uruchom" onSubmit={value => io.set(S.sim, x => ({ ...x, callArgs: value, cursor: 0 }))} />
      {(k.surface === 'desktop' || k.surface === 'vscode') && r.steps.length > 1 && (() => {
        const { Svg } = k.E as Elements['desktop']
        const W = Math.max(160, Math.min(560, k.cols * 8 - 40))
        const done = (cursor + 1) / Math.max(1, r.steps.length)
        return <Box marginTop={1}><Svg key="sim-bar" source={pixelBarSvg(done, W, s.playing ? '#d97757' : '#8b7cf6', `krok ${cursor + 1}/${r.steps.length}`, !!s.playing)} alt={`krok ${cursor + 1} z ${r.steps.length}`} width={W} height={16} /></Box>
      })()}
      {controls(io, k, Math.max(1, r.steps.length), cursor, !!pair || s.edits.length > 0, variant, !!pair, !!s.playing, s.speed ?? 'slow')}
      {panel}
      {r.error && r.error.kind !== 'syntax' && <Text color="error" wrap="wrap">{r.error.message}</Text>}
      {r.hypotheses.length > 0 && card(k, 'warning', <Text color="warning">Założenia symulatora</Text>, ...r.hypotheses.map((x, i) => <Text key={`hy-${i}`} dimColor wrap="wrap">{`• ${x}`}</Text>))}
      {sites.ops.length + sites.values.length > 0 && (
        <Box marginTop={1}>
          <Button key="sim-whatif" plain dimColor onPress={() => io.set(S.sim, x => ({ ...x, panel: x.panel === 'whatif' ? 'state' : 'whatif' }))}>
            {whatIf ? '▾ Zmień operator albo wartość' : `▸ Zmień operator albo wartość${s.edits.length ? ` (${s.edits.length})` : ''}`}
          </Button>
        </Box>
      )}
      {whatIf && (
        <Box flexDirection="column">
          {sites.ops.slice(0, 6).map(site => {
            const edit = s.edits.find(e => e.siteId === site.id)
            return (
              <Select
                key={`op-${site.id}`}
                label={`L${site.line} ${site.expr.length > 22 ? site.expr.slice(0, 21) + '…' : site.expr}:`}
                value={edit?.text ?? site.op}
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
          })}
          {sites.values.slice(0, 5).map(site => {
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
          })}
          {s.edits.length > 0 && (
            <Button key="sim-clear" plain dimColor onPress={() => io.set(S.sim, x => ({ ...x, edits: [], variant: 'A' as const, cursor: 0, panel: 'state' as const }))}>
              Wyczyść zmiany
            </Button>
          )}
          {s.edits.map(e => boundaryNote(e.before, e.text)).filter((x): x is string => !!x).map((t, i) => <Text key={`bn-${i}`} dimColor wrap="wrap">{t}</Text>)}
        </Box>
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
            if (ex) return mentor.showExample(io, ex)
          }}
        />
      )}
      {s.mode === 'js' ? await renderJs(io, k, s) : s.mode === 'cond' ? renderCond(io, k, s) : renderSql(io, k, s)}
    </Box>
  )
}
