// Laboratorium w szczegółach zmiany: wersje kodu obok siebie na tych samych,
// jawnych przypadkach. Bez przechodzenia do innej zakładki. Edycja linia po linii
// tylko na kopiach, kod z narzędzia zostaje nietknięty.

import type { RenderElement } from 'claude-code'
import type { Host } from '../host'
import type { MentorBench, MentorBenchVariant } from '../../types'
import { mentor } from '../mentor'
import { MAX_CASES, deleteLine, insertLineAfter, nextVariantId, regressionPrompt, replaceLine, runBench, validCase } from '../engine/bench'
import { codeLanguage } from '../engine/diff'
import { code, label, muted } from './kit'
import { pixelBarSvg, pixelBarText } from './visuals'
import type { Elements } from 'claude-code'
import { dialectOps, simSites } from './simcache'
import { OP_GROUPS, applyEdits } from '../sim/variants'
import type { Kit } from './kit'
import { S } from './state'

const editable = (v: MentorBenchVariant) => v.origin === 'edit' || v.origin === 'alt'
const CELL_COLOR = { ok: undefined, error: 'error', assumed: 'warning', missing: 'subtle' } as const
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Szybka edycja kopii: operatory z listy (np. < na <=) i wartości wpisywane wprost.
 * Każda zmiana od razu przelicza tabelę wyników powyżej. Najwyżej 4 operatory i 3 wartości.
 */
function quickEdits(k: Kit, src: string, dialect: 'js' | 'dart', apply: (code: string) => unknown): RenderElement | null {
  const { Box, Text, Select, Input } = k.E
  const sites = simSites(src, dialect)
  const ops = sites.ops.slice(0, 4)
  const values = sites.values.slice(0, 3)
  if (!ops.length && !values.length) return null
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
      {ops.map(site => (
        <Box key={`qe-op-${site.id}`} flexDirection="row" columnGap={1} alignItems="center">
          <Text dimColor>{`l.${site.line}`}</Text>
          <Select
            key={`qe-op-${site.id}`}
            value={site.op}
            options={dialectOps(OP_GROUPS[site.group], dialect).map(op => ({ value: op, label: op }))}
            onSelect={v => (v === site.op ? undefined : apply(applyEdits(src, [{ start: site.start, end: site.end, text: v }])))}
          />
        </Box>
      ))}
      {values.map(site => (
        <Input
          key={`qe-val-${site.id}-${site.raw}`}
          label={`l.${site.line} ${site.name} =`}
          value={site.raw}
          submitLabel="zmień"
          onSubmit={v => (v.trim() && v !== site.raw ? apply(applyEdits(src, [{ start: site.start, end: site.end, text: v.trim() }])) : undefined)}
        />
      ))}
    </Box>
  )
}

export function renderBench(io: Host, k: Kit, b: MentorBench, file: string, lang: string, dialect: 'js' | 'dart'): RenderElement {
  const { Box, Text, Button, Input, Select } = k.E
  const set = (fn: (b: MentorBench) => MentorBench) => io.set(S.lab, l => (l.bench ? { ...l, bench: fn(l.bench) } : l))
  const sel = b.variants.find(v => v.id === b.sel) ?? b.variants[b.variants.length - 1]!
  const { cells, differs } = runBench(b.variants, b.cases, dialect)
  const nameW = Math.max(...b.variants.map(v => `${v.id} ${v.label}`.length), 4) + 2
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const lines = sel.code.split('\n')
  // animacja uruchomienia: komórki do `reveal` są gotowe, `reveal` właśnie się liczy
  const running = b.reveal !== undefined
  const V = b.variants.length
  const total = b.cases.length * V
  const done = running ? b.reveal! : total
  const state = (i: number, j: number): 'done' | 'run' | 'wait' => (!running ? 'done' : i * V + j < b.reveal! ? 'done' : i * V + j === b.reveal ? 'run' : 'wait')
  const line = Math.min(Math.max(1, b.line), lines.length)

  const copy = () =>
    set(x => {
      const id = nextVariantId(x.variants)
      if (!id) return { ...x, error: 'Najwyżej 4 wersje. Usuń jedną, żeby dodać kolejną.' }
      return { ...x, variants: [...x.variants, { id, label: `kopia ${sel.id}`, code: sel.code, origin: 'edit' as const }], sel: id, line: 1, error: null }
    })
  const editCode = (fn: (code: string) => string) => set(x => ({ ...x, variants: x.variants.map(v => (v.id === sel.id ? { ...v, code: fn(v.code) } : v)) }))

  return (
    <Box flexDirection="column">
      {label(k, 'Laboratorium', running ? `${SPIN[(b.frame ?? 0) % SPIN.length]} uruchamiam ${done + 1}/${total}` : 'symulator, pliki bez zmian')}
      {running &&
        (k.surface === 'desktop' || k.surface === 'vscode' ? (
          (() => {
            const { Svg } = k.E as Elements['desktop']
            const W = Math.max(160, Math.min(520, k.cols * 8 - 40))
            return <Svg key="bench-bar" source={pixelBarSvg(done / Math.max(1, total), W, '#d97757', `${done}/${total}`, true)} alt={`uruchamiam ${done + 1} z ${total}`} width={W} height={16} />
          })()
        ) : (
          <Text color="claude">{pixelBarText(done / Math.max(1, total), 20)}</Text>
        ))}

      {/* wersje */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {b.variants.map(v => (
          <Button key={`bv-${v.id}`} variant={v.id === sel.id ? 'primary' : undefined} plain={v.id === sel.id ? undefined : true} dimColor={v.id !== sel.id} onPress={() => set(x => ({ ...x, sel: v.id, line: 1 }))}>
            {`${v.id} ${short(v.label, 22)}`}
          </Button>
        ))}
        {b.variants.length < 4 && (
          <Button key="bv-copy" plain dimColor onPress={copy}>
            {`＋ kopia ${sel.id}`}
          </Button>
        )}
      </Box>

      {/* przypadki i wyniki */}
      {b.cases.length === 0 && muted(k, 'Dodaj przypadek, np. label(10), żeby uruchomić wszystkie wersje na tych samych danych.')}
      {b.cases.map((c, i) => (
        <Box key={`bc-${i}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text bold wrap="truncate-end">{c}</Text>
            {differs[i] && state(i, V - 1) === 'done' && <Text color="warning">● różne wyniki</Text>}
            <Button key={`bc-x-${i}`} plain dimColor onPress={() => set(x => ({ ...x, cases: x.cases.filter((_, j) => j !== i) }))}>
              ✕
            </Button>
          </Box>
          {b.variants.map((v, j) => {
            const cell = cells[i]![j]!
            const st = state(i, j)
            // liczona komórka pokazuje linię, którą symulator właśnie wykonuje
            const f = b.frame ?? 0
            const at = cell.trace.length ? cell.trace[Math.min(cell.trace.length - 1, Math.floor(((f + 1) / 5) * cell.trace.length))]! : 0
            return (
              <Text key={`bc-${i}-${v.id}`} wrap="truncate-end">
                <Text dimColor>{`  ${`${v.id} ${short(v.label, 18)}`.padEnd(nameW)}`}</Text>
                {st === 'done' && <Text color={CELL_COLOR[cell.kind]}>{`${cell.kind === 'assumed' ? '≈ ' : ''}${cell.text}`}</Text>}
                {st === 'run' && <Text color="claude">{`${SPIN[f % SPIN.length]} wykonuję${at ? ` linię ${at}` : ''}${cell.trace.length ? ` · krok ${Math.min(cell.trace.length, Math.ceil(((f + 1) / 5) * cell.trace.length))}/${cell.trace.length}` : ''}`}</Text>}
                {st === 'wait' && <Text dimColor>·</Text>}
              </Text>
            )
          })}
        </Box>
      ))}
      {cells.some(r => r.some(x => x.kind === 'assumed')) && <Text color="warning" wrap="wrap">≈ wynik stoi na założeniu symulatora (zaślepka, sieć, losowość albo zegar). Prawdziwy program może dać coś innego.</Text>}
      {b.cases.length < MAX_CASES && (
        <Box marginTop={1}>
          <Input
            key="bench-case"
            label="Przypadek:"
            placeholder="np. label(10)"
            value=""
            submitLabel="dodaj"
            onSubmit={v => {
              const err = validCase(v)
              return set(x => (err ? { ...x, error: err } : { ...x, cases: [...new Set([...x.cases, v.trim()])], error: null }))
            }}
          />
        </Box>
      )}
      {b.error && <Text color="warning" wrap="wrap">{b.error}</Text>}

      {/* edycja wybranej wersji */}
      {editable(sel) ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{`Wersja ${sel.id}: zmień operator albo wartość, albo całą linię`}</Text>
          {code(k, sel.code, codeLanguage(lang))}
          {quickEdits(k, sel.code, dialect, cd => editCode(() => cd))}
          <Select
            key="bench-line"
            value={String(line)}
            options={lines.map((t, i) => ({ value: String(i + 1), label: short(`${i + 1}: ${t.trim() || '(pusta)'}`, 60) }))}
            onSelect={v => set(x => ({ ...x, line: Number(v) }))}
          />
          <Input key={`bench-edit-${sel.id}-${line}`} label={`Linia ${line}:`} value={lines[line - 1] ?? ''} submitLabel="zmień" onSubmit={v => editCode(cd => replaceLine(cd, line, v))} />
          <Box flexDirection="row" columnGap={1}>
            <Button key="bench-ins" plain dimColor onPress={async () => (await editCode(cd => insertLineAfter(cd, line)), set(x => ({ ...x, line: line + 1 })))}>
              wstaw linię pod
            </Button>
            <Button key="bench-del" plain dimColor onPress={() => editCode(cd => deleteLine(cd, line))}>
              usuń linię
            </Button>
            <Button key="bench-drop" plain dimColor onPress={() => set(x => ({ ...x, variants: x.variants.filter(v => v.id !== sel.id), sel: x.variants[0]!.id, line: 1 }))}>
              {`usuń wersję ${sel.id}`}
            </Button>
          </Box>
        </Box>
      ) : (
        muted(k, `${sel.id} to kod z narzędzia Claude. Żeby coś w nim zmienić, zrób kopię.`)
      )}

      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {b.cases.length > 0 && (
          <Button key="bench-replay" plain dimColor onPress={() => (running ? mentor.skipBench(io) : mentor.animateBench(io))}>
            {running ? '⏭ pokaż od razu' : '▶ jeszcze raz'}
          </Button>
        )}
        <Button key="bench-step" onPress={() => mentor.benchStep(io, 0)}>
          {`Krok po kroku (${sel.id})`}
        </Button>
        {b.cases.length > 0 && (
          <Button
            key="bench-real"
            onPress={async () => {
              const text = regressionPrompt(file, lang, b.variants, b.cases, cells)
              const ok = await io.fillPrompt(text).catch(() => false)
              await set(x => ({ ...x, handed: ok ? 'Prośba czeka w polu wiadomości. Claude uruchomi testy dopiero, gdy wyślesz ją Enterem.' : `Nie mogę wpisać do pola wiadomości. Skopiuj i wyślij sam:\n${text}` }))
            }}
          >
            Sprawdź w projekcie
          </Button>
        )}
      </Box>
      {b.handed && <Text color="success" wrap="wrap">{b.handed}</Text>}
    </Box>
  )
}
