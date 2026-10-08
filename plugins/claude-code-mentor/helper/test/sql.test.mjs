import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sandbox, splitClauses } from '../sql-sandbox.mjs'

const SETUP = `CREATE TABLE users(id INTEGER, name TEXT, city TEXT);
INSERT INTO users VALUES (1,'Ala','Opole'),(2,'Ola',NULL),(3,'Jan','Brzeg');
CREATE TABLE orders(id INTEGER, user_id INTEGER, total REAL);
INSERT INTO orders VALUES (10,1,50),(11,1,20),(12,3,NULL);`

test('splitClauses na poziomie 0', () => {
  const c = splitClauses("SELECT a, (SELECT 1 FROM x WHERE y) FROM t WHERE a = 'from where' GROUP BY a ORDER BY a LIMIT 3")
  assert.equal(c.from, 't')
  assert.equal(c.where, "a = 'from where'")
  assert.equal(c['group by'], 'a')
  assert.equal(c.limit, '3')
})

test('NULL w WHERE daje UNKNOWN i wiersz odpada', () => {
  const r = sandbox({ setup: SETUP, query: "SELECT name FROM users WHERE city = NULL" })
  assert.equal(r.stages.at(-1).total, 0)
  assert.match(r.stages[1].note, /UNKNOWN/)
})

test('LEFT JOIN zachowuje użytkownika bez zamówień, COUNT(col) pomija NULL', () => {
  const r = sandbox({ setup: SETUP, query: 'SELECT u.name, COUNT(o.id) AS n, COUNT(o.total) AS t FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.name ORDER BY u.name' })
  const rows = r.stages.at(-1).rows
  assert.deepEqual(rows, [['Ala', 2, 2], ['Jan', 1, 0], ['Ola', 0, 0]])
})

test('ATTACH jest odrzucany', () => {
  assert.throws(() => sandbox({ setup: '', query: "ATTACH 'C:/x.db' AS x" }), /ATTACH/)
})

test('CLI zwraca jedną linię JSON', () => {
  const p = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('../sql-sandbox.mjs', import.meta.url))], { input: JSON.stringify({ setup: SETUP, query: 'SELECT COUNT(*) AS c FROM users' }) })
  const out = JSON.parse(p.stdout.toString().trim())
  assert.equal(out.ok, true)
  assert.deepEqual(out.stages.at(-1).rows, [[3]])
})
