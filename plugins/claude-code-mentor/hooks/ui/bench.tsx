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
import type { Kit } from './kit'
import { S } from './state'

const editable = (v: MentorBenchVariant) => v.origin === 'edit' || v.origin === 'alt'
const CELL_COLOR = { ok: undefined, error: 'error', assumed: 'warning', missing: 'subtle' } as const

export function renderBench(io: Host, k: Kit, b: MentorBench, file: string, lang: string, dialect: 'js' | 'dart'): RenderElement {
  const { Box, Text, Button, Input, Select } = k.E
  const set = (fn: (b: MentorBench) => MentorBench) => io.set(S.lab, l => (l.bench ? { ...l, bench: fn(l.bench) } : l))
  const sel = b.variants.find(v => v.id === b.sel) ?? b.variants[b.variants.length - 1]!
  const { cells, differs } = runBench(b.variants, b.cases, dialect)
  const nameW = Math.max(...b.variants.map(v => `${v.id} ${v.label}`.length), 4) + 2
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const lines = sel.code.split('\n')
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
      {label(k, 'Laboratorium', 'symulator, pliki bez zmian')}

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
            {differs[i] && <Text color="warning">● różne wyniki</Text>}
            <Button key={`bc-x-${i}`} plain dimColor onPress={() => set(x => ({ ...x, cases: x.cases.filter((_, j) => j !== i) }))}>
              ✕
            </Button>
          </Box>
          {b.variants.map((v, j) => {
            const cell = cells[i]![j]!
            return (
              <Text key={`bc-${i}-${v.id}`} wrap="truncate-end">
                <Text dimColor>{`  ${`${v.id} ${short(v.label, 18)}`.padEnd(nameW)}`}</Text>
                <Text color={CELL_COLOR[cell.kind]}>{`${cell.kind === 'assumed' ? '≈ ' : ''}${cell.text}`}</Text>
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
          <Text dimColor>{`Wersja ${sel.id}: wybierz linię i wpisz nową treść`}</Text>
          {code(k, sel.code, codeLanguage(lang))}
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
