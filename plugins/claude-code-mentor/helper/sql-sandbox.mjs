// Piaskownica SQL: prawdziwe wykonanie zapytania na SQLite w pamięci
// (`:memory:`), na przykładowych danych. Nie dotyka żadnego pliku:
// ATTACH, VACUUM, PRAGMA i rozszerzenia są odrzucane przed wykonaniem.
//
// stdin:  { setup: "CREATE TABLE ...; INSERT ...", query: "SELECT ..." }
// stdout: jedna linia JSON { ok, stages: [{ title, explain, columns, rows, note? }], result, error? }

import { DatabaseSync } from 'node:sqlite'

const MAX_ROWS = 50
const FORBIDDEN = /\b(attach|detach|vacuum|pragma|load_extension|readfile|writefile|fts\d?|zipfile)\b/i

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

/** Dzieli SELECT na klauzule na poziomie 0 nawiasów (poza napisami). */
export function splitClauses(sql) {
  const s = sql.trim().replace(/;\s*$/, '')
  const keys = ['select', 'from', 'where', 'group by', 'having', 'order by', 'limit']
  const found = []
  let depth = 0
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    if (depth !== 0) continue
    const prev = i === 0 ? ' ' : s[i - 1]
    if (!/\s|\(|\)/.test(prev)) continue
    for (const k of keys) {
      const re = new RegExp('^' + k.replace(' ', '\\s+') + '\\b', 'i')
      const m = s.slice(i).match(re)
      if (m) {
        found.push({ key: k, start: i, bodyStart: i + m[0].length })
        i += m[0].length - 1
        break
      }
    }
  }
  if (!found.length || found[0].key !== 'select') return null
  const out = {}
  for (let j = 0; j < found.length; j++) {
    const f = found[j]
    if (out[f.key] !== undefined) return null // podzapytania/UNION na poziomie 0: nie dzielimy
    out[f.key] = s.slice(f.bodyStart, found[j + 1]?.start ?? s.length).trim()
  }
  return out
}

function run(db, sql) {
  const stmt = db.prepare(sql)
  const rows = stmt.all()
  const columns = stmt.columns().map(c => c.name)
  return { columns, rows: rows.slice(0, MAX_ROWS).map(r => columns.map(c => r[c] ?? null)), total: rows.length }
}

export function sandbox({ setup, query }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Brak zapytania')
  if (FORBIDDEN.test(setup ?? '') || FORBIDDEN.test(query)) throw new Error('Piaskownica nie wykonuje ATTACH/VACUUM/PRAGMA ani rozszerzeń (ochrona plików).')
  const db = new DatabaseSync(':memory:')
  try {
    if (setup) db.exec(setup)
    const stages = []
    const c = splitClauses(query)
    const isSelect = /^\s*select\b/i.test(query)
    if (isSelect && c && c.from) {
      const from = c.from
      const hasJoin = /\bjoin\b/i.test(from)
      const s1 = run(db, `SELECT * FROM ${from}`)
      stages.push({
        title: hasJoin ? '1. FROM + JOIN' : '1. FROM',
        explain: hasJoin
          ? /\bleft\s+(outer\s+)?join\b/i.test(from)
            ? 'LEFT JOIN łączy wiersze według warunku ON. Wiersz z lewej tabeli bez pary NIE znika: dostaje NULL w kolumnach prawej tabeli.'
            : 'INNER JOIN zostawia tylko pary wierszy, dla których warunek ON jest prawdziwy. Wiersz bez pary znika z wyniku.'
          : 'Baza bierze wszystkie wiersze tabeli. To pierwszy krok logiczny, mimo że SELECT piszemy na początku.',
        ...s1,
      })
      if (c.where) {
        const pred = run(db, `SELECT *, CASE WHEN (${c.where}) THEN 'TRUE' WHEN NOT (${c.where}) THEN 'FALSE' ELSE 'UNKNOWN (NULL)' END AS "⟨WHERE⟩" FROM ${from}`)
        const unknown = pred.rows.filter(r => r[r.length - 1] === 'UNKNOWN (NULL)').length
        stages.push({
          title: '2. WHERE (ocena każdego wiersza)',
          explain: `Warunek ${c.where} liczony dla każdego wiersza. Przechodzą tylko wiersze z TRUE. FALSE i UNKNOWN odpadają.`,
          note: unknown ? `${unknown} wiersz(e) dały UNKNOWN: porównanie z NULL (np. kol = NULL, kol > 5 gdy kol jest NULL) nie jest ani prawdą, ani fałszem. Do sprawdzania NULL służy IS NULL / IS NOT NULL.` : undefined,
          ...pred,
        })
      }
      if (c['group by']) {
        const g = run(db, `SELECT ${c['group by']}, COUNT(*) AS "COUNT(*)" FROM ${from}${c.where ? ` WHERE ${c.where}` : ''} GROUP BY ${c['group by']}`)
        stages.push({
          title: '3. GROUP BY',
          explain: `Wiersze o tej samej wartości ${c['group by']} trafiają do jednej grupy. Każda grupa da jeden wiersz wyniku. NULL tworzy własną grupę. COUNT(*) liczy wiersze w grupie, a COUNT(kolumna) pomija NULL.`,
          ...g,
        })
        if (c.having) stages.push({ title: '4. HAVING', explain: `HAVING filtruje całe grupy (po agregacji), WHERE filtruje pojedyncze wiersze (przed agregacją). Warunek: ${c.having}.`, columns: [], rows: [], total: 0 })
      }
    }
    const result = run(db, query)
    stages.push({
      title: `${stages.length + 1}. Wynik końcowy (SELECT${c?.['order by'] ? ', ORDER BY' : ''}${c?.limit ? ', LIMIT' : ''})`,
      explain: 'SELECT wybiera kolumny i liczy wyrażenia dopiero po FROM/WHERE/GROUP BY. ORDER BY sortuje gotowy wynik, LIMIT ucina go na końcu. Bez ORDER BY kolejność wierszy nie jest gwarantowana.',
      ...result,
    })
    return { ok: true, stages, engine: `SQLite ${db.prepare('select sqlite_version() v').get().v} (w pamięci)` }
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  readStdin()
    .then(text => {
      try {
        process.stdout.write(JSON.stringify(sandbox(JSON.parse(text))) + '\n')
      } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }) + '\n')
      }
    })
    .catch(e => {
      process.stdout.write(JSON.stringify({ ok: false, error: String(e) }) + '\n')
      process.exitCode = 1
    })
}
