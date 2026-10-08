// Run: node --no-warnings --test plugins/claude-code-mentor/helper/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { executeBatch, WIPE_CONFIRM } from '../ops.mjs';
import { MIGRATIONS, SCHEMA_VERSION, defaultDataDir, migrate, openDatabase } from '../db.mjs';
import * as M from '../mastery.mjs';

const HELPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(HELPER_DIR, 'mentor-db.mjs');
const DAY = M.DAY_MS;
const T0 = new Date(2026, 0, 15, 12, 0, 0).getTime(); // local noon, avoids DST/TZ edge cases

const CONCEPTS = [
  { id: 'vars', name: 'Zmienne', area: 'basics', langs: ['js', 'py'], prereqs: [], weight: 1 },
  { id: 'loops', name: 'Pętle', area: 'control', langs: ['js'], prereqs: ['vars'], weight: 2 },
  { id: 'cond', name: 'Warunki', area: 'control', langs: ['js'], prereqs: ['vars'], weight: 2 },
];
const PROJECT = { id: 'p1', root: 'C:/proj', name: 'proj' };

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return d;
}
function run(dataDir, ops) {
  const r = executeBatch({ v: 1, dataDir, ops });
  assert.equal(r.ok, true, r.error);
  return r.results;
}
function one(dataDir, op, args) {
  const [r] = run(dataDir, [{ op, args }]);
  assert.equal(r.ok, true, `${op} failed: ${r.error}`);
  return r.value;
}
function bootstrap(dataDir, extra = {}) {
  return one(dataDir, 'bootstrap', {
    project: PROJECT,
    session: { id: 's1', surface: 'cli' },
    concepts: CONCEPTS,
    now: T0,
    ...extra,
  });
}
function rawDb(dataDir) {
  return new DatabaseSync(path.join(dataDir, 'mentor.db'));
}
function knowledgeOf(dataDir, conceptId, now = T0) {
  return one(dataDir, 'getKnowledge', { now }).knowledge.find((k) => k.concept_id === conceptId);
}
function spawnCli(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', CLI], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

// ---------------------------------------------------------------- 1
test('1. fresh init creates schema v1 in WAL mode; second init is a no-op', (t) => {
  const dir = tmpDir(t);
  const v = one(dir, 'init');
  assert.equal(v.schemaVersion, 1);
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(v.dbPath, path.join(dir, 'mentor.db'));
  assert.match(v.sqliteVersion, /^3\./);

  const db = rawDb(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const t of ['meta', 'settings', 'projects', 'sessions', 'concepts', 'concept_edges', 'knowledge', 'evidence',
    'history', 'misconceptions', 'observations', 'lessons', 'exercises', 'lesson_cache', 'usage']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  const schemaBefore = db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all();
  db.close();

  const v2 = one(dir, 'init');
  assert.deepEqual(v2, v);
  const db2 = rawDb(dir);
  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual(db2.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all(), schemaBefore);
  db2.close();
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false, 'no migration backup on no-op init');

  const d = one(dir, 'diag');
  assert.equal(d.integrity, 'ok');
  assert.equal(d.journalMode, 'wal');
});

// ---------------------------------------------------------------- 2
test('2. bootstrap is idempotent, concepts_hash guards edge rebuild, knowledge row per concept', (t) => {
  const dir = tmpDir(t);
  const b1 = bootstrap(dir);
  assert.equal(b1.conceptsUpdated, true);
  assert.equal(b1.knowledge.length, 3);
  assert.equal(b1.project.id, 'p1');
  assert.equal(b1.project.first_seen, T0);

  // Plant a marker edge: if bootstrap rebuilt edges it would disappear.
  let db = rawDb(dir);
  db.prepare("INSERT INTO concept_edges(from_id, to_id) VALUES('cond','loops')").run();
  db.close();

  const b2 = bootstrap(dir, { now: T0 + 1000 });
  assert.equal(b2.conceptsUpdated, false);
  assert.equal(b2.knowledge.length, 3);
  assert.equal(b2.project.first_seen, T0);
  assert.equal(b2.project.last_seen, T0 + 1000);
  db = rawDb(dir);
  assert.equal(db.prepare('SELECT count(*) n FROM concept_edges').get().n, 3, 'edges untouched (2 + marker)');
  assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM knowledge').get().n, 3);
  db.close();

  // Changing the catalog rebuilds edges and adds the knowledge row for the new concept.
  const b3 = one(dir, 'bootstrap', {
    project: PROJECT,
    session: { id: 's2' },
    concepts: [...CONCEPTS, { id: 'funcs', name: 'Funkcje', area: 'basics', prereqs: ['vars', 'loops'] }],
    now: T0 + 2000,
  });
  assert.equal(b3.conceptsUpdated, true);
  assert.equal(b3.knowledge.length, 4);
  const g = one(dir, 'getGraph', { now: T0 });
  assert.deepEqual(
    g.edges.map((e) => `${e.from_id}>${e.to_id}`).sort(),
    ['loops>funcs', 'vars>cond', 'vars>funcs', 'vars>loops'],
  );
  assert.deepEqual(g.concepts.find((c) => c.id === 'vars').langs, ['js', 'py']);
});

// ---------------------------------------------------------------- 3
test('3. exposure_claude x50 keeps mastery 0 and level 0', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  const r = one(dir, 'recordExposure', { conceptIds: Array(25).fill('loops').concat(['nope']), projectId: 'p1', now: T0 });
  assert.equal(r.count, 25);
  assert.deepEqual(r.skipped, ['nope']);
  const res = run(
    dir,
    Array.from({ length: 25 }, (_, i) => ({
      op: 'recordEvidence',
      args: { conceptId: 'loops', kind: 'exposure_claude', projectId: 'p1', now: T0 + i },
    })),
  );
  assert.ok(res.every((x) => x.ok));
  assert.ok(res.every((x) => x.value.levelChanged === false));
  const k = knowledgeOf(dir, 'loops');
  assert.equal(k.exposures, 50);
  assert.equal(k.mastery, 0);
  assert.equal(k.confidence, 0);
  assert.equal(k.level, 0);
  assert.equal(k.next_review_at, null);
  assert.equal(k.effectiveConfidence, 0);
});

// ---------------------------------------------------------------- 4
test('4. level 4 needs strong tasks, two days and mastery >= 0.85 (exact transition)', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);

  // (a) three correct 'choice' answers on one day: never level 4
  let k;
  for (let i = 0; i < 3; i++) {
    k = one(dir, 'recordEvidence', { conceptId: 'vars', kind: 'correct', task: 'choice', now: T0 + i * 60_000 }).knowledge;
    assert.notEqual(k.level, 4);
  }
  assert.ok(Math.abs(k.mastery - (1 - 0.8 ** 3)) < 1e-12); // 0.488
  assert.equal(k.level, 2);
  assert.equal(k.strong_correct, 0);
  assert.deepEqual(k.correct_days, [M.localDay(T0)]);

  // (b) strong tasks across two days on 'loops'. mastery_n = 1 - 0.65^n
  const steps = [
    { task: 'predict', now: T0, level: 2 }, //            0.35
    { task: 'explain', now: T0 + 3600_000, level: 2 }, // 0.5775
    { task: 'predict', now: T0 + DAY, level: 3 }, //      0.725375 (3 correct, 2 days, strong, but < 0.85)
    { task: 'predict', now: T0 + DAY + 60_000, level: 3 }, // 0.82149375 < 0.85
    { task: 'predict', now: T0 + DAY + 120_000, level: null }, // 0.8839709375 >= 0.85
  ];
  const expected = [];
  let m = 0;
  for (const s of steps) {
    m = m + M.TASK_WEIGHT[s.task] * (1 - m);
    expected.push(m);
  }
  assert.ok(expected[3] < 0.85 && expected[4] >= 0.85, `5th correct crosses 0.85: ${expected}`);
  for (let n = 1; n <= 5; n++) assert.ok(Math.abs(expected[n - 1] - (1 - 0.65 ** n)) < 1e-12);
  steps[4].level = 4;

  for (const [i, s] of steps.entries()) {
    const r = one(dir, 'recordEvidence', { conceptId: 'loops', kind: 'correct', task: s.task, now: s.now });
    assert.ok(Math.abs(r.knowledge.mastery - expected[i]) < 1e-12, `step ${i}: ${r.knowledge.mastery} vs ${expected[i]}`);
    assert.equal(r.knowledge.level, s.level, `step ${i} mastery ${r.knowledge.mastery}`);
    if (i === 3) assert.ok(r.knowledge.mastery < 0.85);
    if (i === 4) {
      assert.ok(r.knowledge.mastery >= 0.85);
      assert.equal(r.levelChanged, true);
      assert.equal(r.levelBefore, 3);
    }
  }
  // closed form check of the predict-only path too
  assert.ok(Math.abs(expected[2] - (1 - 0.65 ** 3)) < 1e-12);

  const h = one(dir, 'getConceptHistory', { conceptId: 'loops' });
  assert.deepEqual(
    h.history.map((x) => [x.level_before, x.level_after]).reverse(),
    [[0, 2], [2, 3], [3, 4]],
  );
  assert.equal(h.knowledge.correct_days.length, 2);
  assert.equal(h.evidence.length, 5);

  // Pure: same-day strong answers never reach 4, whatever the mastery.
  let row = M.emptyKnowledge('x');
  for (let i = 0; i < 10; i++) row = M.applyEvidence(row, { kind: 'correct', task: 'apply' }, T0 + i).row;
  assert.ok(row.mastery > 0.99);
  assert.equal(row.level, 3);
});

test('4b. pure model: self report, SRS, confidence, effectiveConfidence', () => {
  let r = M.applyEvidence(M.emptyKnowledge('c'), { kind: 'self_report_known' }, T0);
  assert.equal(r.row.mastery, 0.3);
  assert.equal(r.row.confidence, 0.1);
  assert.equal(r.row.level, 1);
  assert.equal(M.effectiveConfidence(r.row, T0), 0, 'never verified');
  r = M.applyEvidence(r.row, { kind: 'correct', task: 'choice' }, T0);
  assert.ok(Math.abs(r.row.mastery - 0.44) < 1e-12);
  assert.ok(Math.abs(r.row.confidence - 0.3) < 1e-12);
  assert.equal(r.row.interval_days, 1);
  assert.ok(Math.abs(r.row.ease - 2.55) < 1e-12);
  assert.equal(r.row.next_review_at, T0 + DAY);
  const ignored = M.applyEvidence(r.row, { kind: 'self_report_unknown' }, T0 + 5);
  assert.equal(ignored.ignored, true);
  assert.equal(ignored.row.mastery, r.row.mastery);
  r = M.applyEvidence(r.row, { kind: 'correct', task: 'predict' }, T0 + DAY);
  assert.ok(Math.abs(r.row.interval_days - 2.55) < 1e-12);
  r = M.applyEvidence(r.row, { kind: 'partial', task: 'explain' }, T0 + 2 * DAY);
  assert.ok(Math.abs(r.row.interval_days - 1.53) < 1e-12);
  assert.ok(Math.abs(r.row.ease - 2.45) < 1e-12);
  r = M.applyEvidence(r.row, { kind: 'incorrect', task: 'apply' }, T0 + 3 * DAY);
  assert.equal(r.row.interval_days, 0.5);
  assert.ok(Math.abs(r.row.ease - 2.25) < 1e-12);
  assert.ok(Math.abs(r.row.confidence - (1 - 0.7 ** 4)) < 1e-12);
  assert.equal(M.isDue(r.row, T0 + 3 * DAY + DAY / 2), true);
  assert.equal(M.isDue(r.row, T0 + 3 * DAY + DAY / 2 - 1), false);
  const ec = M.effectiveConfidence(r.row, T0 + 63 * DAY);
  assert.ok(Math.abs(ec - r.row.confidence * Math.exp(-1)) < 1e-12);
  assert.throws(() => M.applyEvidence(r.row, { kind: 'correct' }, T0), /task/);
  assert.throws(() => M.applyEvidence(r.row, { kind: 'bogus' }, T0), /unknown evidence kind/);
  // confidence cap
  let c = M.emptyKnowledge('c');
  for (let i = 0; i < 30; i++) c = M.applyEvidence(c, { kind: 'partial', task: 'choice' }, T0).row;
  assert.equal(c.confidence, 0.97);
});

// ---------------------------------------------------------------- 5
test('5. misconception lifecycle: create, count, resolve after 2 corrects, recurrence', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  const mis = (example) => [{ key: 'assign-vs-compare', description: '= zamiast ==', example }];
  const getM = () => one(dir, 'getKnowledge', { now: T0 }).misconceptions.find((m) => m.key === 'assign-vs-compare');

  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'incorrect', task: 'predict', projectId: 'p1', misconceptions: mis('if (a = 1)'), now: T0 });
  let m = getM();
  assert.equal(m.count, 1);
  assert.equal(m.resolved_at, null);
  assert.equal(m.first_seen, T0);
  assert.deepEqual(m.examples, ['if (a = 1)']);
  assert.deepEqual(m.project_ids, ['p1']);

  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'incorrect', task: 'diagnose', projectId: 'p2', misconceptions: mis('while (x = y)'), now: T0 + 1 });
  m = getM();
  assert.equal(m.count, 2);
  assert.deepEqual(m.project_ids, ['p1', 'p2']);
  assert.equal(m.examples.length, 2);

  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'correct', task: 'predict', now: T0 + 2 });
  m = getM();
  assert.equal(m.correct_since, 1);
  assert.equal(m.resolved_at, null);
  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'correct', task: 'explain', now: T0 + 3 });
  m = getM();
  assert.equal(m.correct_since, 2);
  assert.equal(m.resolved_at, T0 + 3);
  // unresolved list in bootstrap no longer has it
  assert.equal(bootstrap(dir).misconceptions.length, 0);

  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'partial', task: 'apply', misconceptions: mis('x = = y'), now: T0 + 4 });
  m = getM();
  assert.equal(m.count, 3);
  assert.equal(m.resolved_at, null);
  assert.equal(m.correct_since, 0);
  assert.equal(m.first_seen, T0);
  assert.equal(m.last_seen, T0 + 4);
  assert.equal(bootstrap(dir).misconceptions.length, 1);

  // examples keep the last 5
  for (let i = 0; i < 6; i++) {
    one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'incorrect', task: 'choice', misconceptions: mis(`ex${i}`), now: T0 + 10 + i });
  }
  assert.deepEqual(getM().examples, ['ex1', 'ex2', 'ex3', 'ex4', 'ex5']);
});

// ---------------------------------------------------------------- 6
test('6. concurrency: 8 processes x 25 evidence + budget race', async (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  const day = '2026-01-15';
  const mk = (p) => ({
    v: 1,
    dataDir: dir,
    ops: [
      ...Array.from({ length: 12 }, (_, i) => ({
        op: 'recordEvidence',
        args: { conceptId: 'loops', kind: 'correct', task: 'predict', source: `proc${p}`, now: T0 + p * 1000 + i },
      })),
      { op: 'reserveBudget', args: { day, kind: 'lesson', maxCalls: 5, maxTokens: 1_000_000, estTokens: 100 } },
      ...Array.from({ length: 13 }, (_, i) => ({
        op: 'recordEvidence',
        args: { conceptId: 'loops', kind: 'correct', task: 'predict', source: `proc${p}`, now: T0 + p * 1000 + 12 + i },
      })),
    ],
  });
  const outs = await Promise.all(Array.from({ length: 8 }, (_, p) => spawnCli(mk(p))));
  let granted = 0;
  for (const o of outs) {
    assert.equal(o.code, 0, o.stderr || o.stdout);
    const lines = o.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const res = JSON.parse(lines[0]);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.results.length, 26);
    for (const r of res.results) assert.equal(r.ok, true, r.error);
    if (res.results[12].value.granted) granted++;
  }
  assert.equal(granted, 5);
  const k = knowledgeOf(dir, 'loops');
  assert.equal(k.correct, 200);
  assert.equal(k.strong_correct, 200);
  const db = rawDb(dir);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare("SELECT count(*) n FROM evidence WHERE concept_id='loops'").get().n, 200);
  assert.equal(db.prepare("SELECT calls FROM usage WHERE day=? AND kind='lesson'").get(day).calls, 5);
  db.close();
});

test('6b. concurrency: 8 processes cold-start the same empty dataDir', async (t) => {
  const dir = path.join(tmpDir(t), 'fresh', 'nested');
  const outs = await Promise.all(
    Array.from({ length: 8 }, () => spawnCli({ v: 1, dataDir: dir, ops: [{ op: 'init' }, { op: 'setSettings', args: { patch: { x: 1 } } }] })),
  );
  for (const o of outs) {
    assert.equal(o.code, 0, o.stdout + o.stderr);
    const res = JSON.parse(o.stdout);
    assert.ok(res.results.every((r) => r.ok), JSON.stringify(res));
  }
  const db = rawDb(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  assert.equal(fs.existsSync(path.join(dir, 'backups')) && fs.readdirSync(path.join(dir, 'backups')).length > 0, false);
});

// ---------------------------------------------------------------- 7
function seedRichData(dir) {
  bootstrap(dir);
  one(dir, 'setSettings', { patch: { lang: 'pl', budget: { daily: 20 } }, now: T0 });
  one(dir, 'addObservations', {
    items: [
      { sessionId: 's1', projectId: 'p1', ts: T0, kind: 'edit', tool: 'Edit', filePath: 'a.js', line: 3, added: 2, removed: 1, concepts: ['loops'], meta: { a: 1 } },
      { session_id: 's1', project_id: 'p1', ts: T0 + 1, kind: 'bash', summary: 'npm test' },
    ],
  });
  one(dir, 'recordEvidence', { conceptId: 'cond', kind: 'incorrect', task: 'predict', projectId: 'p1', misconceptions: [{ key: 'assign-vs-compare', description: 'x', example: { code: 'a=1' } }], now: T0 });
  one(dir, 'recordEvidence', { conceptId: 'loops', kind: 'correct', task: 'explain', now: T0 + 5 });
  one(dir, 'recordEvidence', { conceptId: 'vars', kind: 'lesson_read', now: T0 + 6 });
  one(dir, 'saveLesson', { lesson: { id: 'L1', projectId: 'p1', sessionId: 's1', ts: T0, title: 'Pętle for', conceptIds: ['loops'], filePath: 'a.js', line: 3, body: { sections: [{ h: 'Co', t: 'ąę' }] }, source: 'model', model: 'm', tokensIn: 10, tokensOut: 20, cacheKey: 'ck1' } });
  one(dir, 'saveLesson', { lesson: { id: 'L2', projectId: 'p1', ts: T0 + 10, title: 'Warunki', body: { x: 1 }, source: 'builtin' } });
  one(dir, 'markLesson', { id: 'L2', status: 'read' });
  one(dir, 'saveExercise', { exercise: { id: 'E1', lessonId: 'L1', conceptId: 'loops', projectId: 'p1', ts: T0, kind: 'predict', question: { q: 'ile?' } } });
  one(dir, 'gradeExercise', { id: 'E1', verdict: 'correct', grade: { answer: '3', why: 'ok' }, evidence: [{ conceptId: 'loops', kind: 'correct', task: 'predict' }], now: T0 + DAY });
  one(dir, 'cachePut', { key: 'ck1', body: { cached: true }, now: T0 });
  one(dir, 'reserveBudget', { day: '2026-01-15', kind: 'lesson', maxCalls: 10, maxTokens: 1000, estTokens: 10 });
  one(dir, 'commitUsage', { day: '2026-01-15', kind: 'lesson', tokensIn: 10, tokensOut: 20 });
  one(dir, 'setNotes', { conceptId: 'loops', notes: 'notatka' });
}

test('7. export -> wipe -> import(replace) round-trips exactly', (t) => {
  const dir = tmpDir(t);
  seedRichData(dir);
  const before = one(dir, 'getKnowledge', { now: T0 + 2 * DAY });
  const lessonsBefore = one(dir, 'getLessons', { includeBody: true });
  const exp = one(dir, 'export', {});
  assert.ok(exp.path.startsWith(path.join(dir, 'exports')));
  assert.match(path.basename(exp.path), /^mentor-export-\d{8}-\d{6}\.json$/);
  const file1 = JSON.parse(fs.readFileSync(exp.path, 'utf8'));
  assert.equal(file1.format, 'claude-code-mentor-export');
  assert.equal(file1.schemaVersion, 1);
  assert.equal(file1.tables.lessons.length, 2);

  // wipe guard
  const [bad] = run(dir, [{ op: 'wipe', args: { confirm: 'yes' } }]);
  assert.equal(bad.ok, false);
  const w = one(dir, 'wipe', { confirm: WIPE_CONFIRM, keepBackup: true });
  assert.equal(w.wiped, true);
  assert.ok(fs.existsSync(w.backup));
  const st = one(dir, 'stats');
  for (const tname of ['settings', 'projects', 'sessions', 'knowledge', 'evidence', 'history', 'misconceptions', 'observations', 'lessons', 'exercises', 'lesson_cache', 'usage']) {
    assert.equal(st.counts[tname], 0, `${tname} wiped`);
  }
  assert.equal(st.counts.concepts, 3, 'catalog kept');
  assert.deepEqual(one(dir, 'getSettings'), {});

  const imp = one(dir, 'import', { path: exp.path, mode: 'replace' });
  assert.ok(fs.existsSync(imp.backup));
  assert.equal(imp.counts.knowledge.inserted, 3);

  assert.deepEqual(one(dir, 'getKnowledge', { now: T0 + 2 * DAY }), before);
  assert.deepEqual(one(dir, 'getLessons', { includeBody: true }), lessonsBefore);
  const exp2 = one(dir, 'export', { path: path.join(dir, 'second.json') });
  const file2 = JSON.parse(fs.readFileSync(exp2.path, 'utf8'));
  assert.deepEqual(file2.tables, file1.tables, 'every exported table identical after round-trip');

  // merge on top of identical data: AUTOINCREMENT tables skip exact duplicates
  const merged = one(dir, 'import', { path: exp.path, mode: 'merge' });
  assert.equal(merged.counts.evidence.inserted, 0);
  assert.equal(merged.counts.evidence.skipped, file1.tables.evidence.length);
  assert.equal(merged.counts.observations.inserted, 0);
  const file3 = JSON.parse(fs.readFileSync(one(dir, 'export', { path: path.join(dir, 'third.json') }).path, 'utf8'));
  assert.deepEqual(file3.tables, file1.tables);

  // bad files are refused without touching data
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ format: 'x', schemaVersion: 1, tables: {} }));
  const [r1] = run(dir, [{ op: 'import', args: { path: path.join(dir, 'bad.json'), mode: 'replace' } }]);
  assert.equal(r1.ok, false);
  fs.writeFileSync(path.join(dir, 'future.json'), JSON.stringify({ ...file1, schemaVersion: 99 }));
  const [r2] = run(dir, [{ op: 'import', args: { path: path.join(dir, 'future.json'), mode: 'replace' } }]);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /schemaVersion/);
});

test('7b. import into a DB that never saw the catalog creates placeholder concepts', (t) => {
  const dir = tmpDir(t);
  seedRichData(dir);
  const exp = one(dir, 'export', {});
  const file = JSON.parse(fs.readFileSync(exp.path, 'utf8'));
  delete file.tables.concepts; // simulate an export without catalog
  delete file.tables.concept_edges;
  fs.writeFileSync(path.join(dir, 'nocat.json'), JSON.stringify(file));
  const dir2 = tmpDir(t);
  one(dir2, 'init');
  const imp = one(dir2, 'import', { path: path.join(dir, 'nocat.json'), mode: 'replace' });
  assert.equal(imp.counts.placeholderConcepts, 3);
  assert.equal(one(dir2, 'getKnowledge', { now: T0 }).knowledge.length, 3);
  // next bootstrap restores real names because concepts_hash was cleared
  const b = one(dir2, 'bootstrap', { project: PROJECT, concepts: CONCEPTS, now: T0 });
  assert.equal(b.conceptsUpdated, true);
  assert.equal(b.knowledge.find((k) => k.concept_id === 'loops').name, 'Pętle');
  assert.equal(b.knowledge.find((k) => k.concept_id === 'loops').notes, 'notatka');
});

// ---------------------------------------------------------------- 8
test('8. gradeExercise is idempotent unless forced', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  one(dir, 'saveExercise', { exercise: { id: 'E1', conceptId: 'loops', kind: 'predict', question: { q: '?' } } });
  const g = one(dir, 'gradeExercise', {
    id: 'E1',
    verdict: 'incorrect',
    grade: { answer: '4', feedback: 'nie' },
    evidence: [{ conceptId: 'loops', kind: 'incorrect', task: 'predict', misconceptions: [{ key: 'off-by-one' }] }],
    now: T0,
  });
  assert.equal(g.knowledge.length, 1);
  assert.equal(g.knowledge[0].incorrect, 1);
  assert.deepEqual(g.levelChanges, [{ conceptId: 'loops', from: 0, to: 1 }]);

  const [again] = run(dir, [{ op: 'gradeExercise', args: { id: 'E1', verdict: 'correct', grade: {}, evidence: [{ conceptId: 'loops', kind: 'correct', task: 'predict' }], now: T0 + 1 } }]);
  assert.equal(again.ok, false);
  assert.match(again.error, /already graded/);
  assert.equal(knowledgeOf(dir, 'loops').correct, 0, 'refused grading wrote nothing');

  // A failing evidence rolls back the whole grading transaction.
  one(dir, 'saveExercise', { exercise: { id: 'E2', conceptId: 'loops', question: { q: '?' } } });
  const [badEv] = run(dir, [{ op: 'gradeExercise', args: { id: 'E2', verdict: 'correct', grade: {}, evidence: [{ conceptId: 'loops', kind: 'correct', task: 'predict' }, { conceptId: 'ghost', kind: 'correct', task: 'predict' }], now: T0 + 2 } }]);
  assert.equal(badEv.ok, false);
  assert.match(badEv.error, /unknown concept: ghost/);
  assert.equal(knowledgeOf(dir, 'loops').correct, 0, 'rolled back');
  const hist = one(dir, 'getConceptHistory', { conceptId: 'loops' });
  assert.equal(hist.exercises.find((e) => e.id === 'E2').verdict, 'pending');

  const forced = one(dir, 'gradeExercise', { id: 'E1', verdict: 'correct', grade: { answer: '3' }, evidence: [{ conceptId: 'loops', kind: 'correct', task: 'predict' }], now: T0 + 3, force: true });
  assert.equal(forced.knowledge[0].correct, 1);
  const e1 = one(dir, 'getConceptHistory', { conceptId: 'loops' }).exercises.find((e) => e.id === 'E1');
  assert.equal(e1.verdict, 'correct');
  assert.equal(e1.answer_text, '3');
  // re-saving an exercise keeps its grading
  one(dir, 'saveExercise', { exercise: { id: 'E1', conceptId: 'loops', question: { q: 'edited' } } });
  const e1b = one(dir, 'getConceptHistory', { conceptId: 'loops' }).exercises.find((e) => e.id === 'E1');
  assert.equal(e1b.verdict, 'correct');
  assert.deepEqual(e1b.question, { q: 'edited' });
});

// ---------------------------------------------------------------- 9
test('9. migration takes a VACUUM INTO backup before upgrading a non-empty DB', (t) => {
  const dir = tmpDir(t);
  seedRichData(dir);
  const ctx = openDatabase(dir);
  let res;
  try {
    const v2 = [...MIGRATIONS, { version: 2, up: (db) => db.exec('CREATE TABLE extra (x INTEGER) STRICT') }];
    res = migrate(ctx.db, v2, dir);
    assert.equal(res.from, 1);
    assert.equal(res.to, 2);
    assert.equal(ctx.db.prepare('PRAGMA user_version').get().user_version, 2);
    // running again is a no-op without a new backup
    assert.deepEqual(migrate(ctx.db, v2, dir), { from: 2, to: 2, backup: null });
  } finally {
    ctx.db.close();
  }
  assert.ok(res.backup);
  assert.match(path.basename(res.backup), /^pre-migration-v1-\d{8}-\d{6}(-\d+)?\.db$/);
  assert.equal(path.dirname(res.backup), path.join(dir, 'backups'));
  assert.ok(fs.existsSync(res.backup));
  const b = new DatabaseSync(res.backup, { readOnly: true });
  assert.equal(b.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(b.prepare('SELECT count(*) n FROM lessons').get().n, 2);
  assert.equal(b.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='extra'").get().n, 0);
  b.close();

  // The stock helper (v1) must refuse a newer DB instead of touching it.
  const r = executeBatch({ v: 1, dataDir: dir, ops: [{ op: 'init' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /newer than this helper/);

  // A failing migration rolls back completely.
  const dir2 = tmpDir(t);
  one(dir2, 'init');
  const ctx2 = openDatabase(dir2);
  try {
    const broken = [...MIGRATIONS, { version: 2, up: (db) => { db.exec('CREATE TABLE half (x)'); throw new Error('boom'); } }];
    assert.throws(() => migrate(ctx2.db, broken, dir2), /boom/);
    assert.equal(ctx2.db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(ctx2.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='half'").get().n, 0);
  } finally {
    ctx2.db.close();
  }
});

// ---------------------------------------------------------------- 10
test('10. CLI contract: malformed stdin, unknown op, bad request', async (t) => {
  const dir = tmpDir(t);
  const bad = await spawnCli('{ not json');
  assert.equal(bad.code, 1);
  const lines = bad.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.ok(bad.stdout.endsWith('\n'));
  const obj = JSON.parse(lines[0]);
  assert.equal(obj.ok, false);
  assert.match(obj.error, /bad JSON/);

  const wrongV = await spawnCli({ v: 2, ops: [] });
  assert.equal(wrongV.code, 1);
  assert.equal(JSON.parse(wrongV.stdout).ok, false);

  const unk = await spawnCli({ v: 1, dataDir: dir, ops: [{ op: 'frobnicate' }, { op: 'init' }, { op: 'recordEvidence', args: { conceptId: 'x' } }] });
  assert.equal(unk.code, 0, unk.stderr);
  assert.equal(unk.stdout.split('\n').filter(Boolean).length, 1);
  const res = JSON.parse(unk.stdout);
  assert.equal(res.ok, true);
  assert.equal(res.schemaVersion, 1);
  assert.deepEqual(res.results[0], { ok: false, error: 'unknown op: frobnicate' });
  assert.equal(res.results[1].ok, true);
  assert.equal(res.results[2].ok, false);
  assert.match(res.results[2].error, /kind/);
  assert.equal(unk.stderr, '', 'no warnings with --no-warnings');

  // cannot open DB: dataDir is a file
  const f = path.join(dir, 'afile');
  fs.writeFileSync(f, 'x');
  const cant = await spawnCli({ v: 1, dataDir: f, ops: [{ op: 'init' }] });
  assert.equal(cant.code, 1);
  assert.equal(JSON.parse(cant.stdout).ok, false);
});

// ---------------------------------------------------------------- extras
test('11. budget, settings, cache, lessons, observations, due reviews', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  const day = '2026-01-15';
  const res = (estTokens) => one(dir, 'reserveBudget', { day, kind: 'grade', maxCalls: 3, maxTokens: 100, estTokens });
  assert.deepEqual(res(40), { granted: true, calls: 1, tokens: 0 });
  one(dir, 'commitUsage', { day, kind: 'grade', tokensIn: 30, tokensOut: 30 });
  assert.equal(res(50).granted, false, 'token cap');
  assert.equal(res(40).granted, true);
  assert.equal(one(dir, 'releaseBudget', { day, kind: 'grade' }).calls, 1);
  assert.equal(one(dir, 'releaseBudget', { day, kind: 'grade' }).calls, 0);
  assert.equal(one(dir, 'releaseBudget', { day, kind: 'grade' }).calls, 0, 'never below 0');
  assert.deepEqual(bootstrap(dir, { day }).usageToday, [{ kind: 'grade', calls: 0, tokens_in: 30, tokens_out: 30 }]);

  assert.deepEqual(one(dir, 'setSettings', { patch: { a: 1, b: { c: [1, 2] } } }), { a: 1, b: { c: [1, 2] } });
  assert.deepEqual(one(dir, 'setSettings', { patch: { a: null, d: 'x' } }), { b: { c: [1, 2] }, d: 'x' });
  assert.deepEqual(one(dir, 'getSettings'), { b: { c: [1, 2] }, d: 'x' });

  assert.equal(one(dir, 'cacheGet', { key: 'k' }), null);
  one(dir, 'cachePut', { key: 'k', body: { a: 1 }, now: T0 });
  assert.deepEqual(one(dir, 'cacheGet', { key: 'k' }), { a: 1 });
  one(dir, 'cacheGet', { key: 'k' });
  const db = rawDb(dir);
  assert.equal(db.prepare("SELECT hits FROM lesson_cache WHERE cache_key='k'").get().hits, 2);
  db.close();

  one(dir, 'saveLesson', { lesson: { id: 'L1', project_id: 'p1', ts: T0, title: 'a', body: { x: 1 }, source: 'model' } });
  one(dir, 'markLesson', { id: 'L1', status: 'read' });
  one(dir, 'saveLesson', { lesson: { id: 'L1', project_id: 'p1', ts: T0, title: 'b', body: { x: 2 }, source: 'model' } });
  const l = one(dir, 'getLesson', { id: 'L1' });
  assert.equal(l.title, 'b');
  assert.deepEqual(l.body, { x: 2 });
  assert.equal(l.status, 'read', 'replace keeps status unless given');
  assert.equal(one(dir, 'getLessons', { projectId: 'p1' })[0].body, undefined);
  assert.equal(one(dir, 'getLesson', { id: 'nope' }), null);
  const [badLesson] = run(dir, [{ op: 'saveLesson', args: { lesson: { id: 'L2', body: {}, source: 'gpt' } } }]);
  assert.equal(badLesson.ok, false);

  const ids = one(dir, 'addObservations', { items: [{ projectId: 'p1', ts: T0, kind: 'a' }, { projectId: 'p1', ts: T0 + 5, kind: 'b', snippet: 'x'.repeat(20000) }] }).ids;
  assert.equal(ids.length, 2);
  const h = one(dir, 'getProjectHistory', { projectId: 'p1' });
  assert.deepEqual(h.map((o) => o.kind), ['b', 'a']);
  assert.equal(h[0].snippet.length, 8000);

  one(dir, 'recordEvidence', { conceptId: 'vars', kind: 'incorrect', task: 'choice', now: T0 });
  one(dir, 'recordEvidence', { conceptId: 'loops', kind: 'correct', task: 'choice', now: T0 });
  assert.deepEqual(one(dir, 'dueReviews', { now: T0 + DAY / 2 }).map((k) => k.concept_id), ['vars']);
  assert.deepEqual(one(dir, 'dueReviews', { now: T0 + DAY }).map((k) => k.concept_id), ['vars', 'loops']);
  assert.equal(bootstrap(dir, { now: T0 + DAY }).dueCount, 2);

  const [unknownConcept] = run(dir, [{ op: 'recordEvidence', args: { conceptId: 'ghost', kind: 'lesson_read' } }]);
  assert.match(unknownConcept.error, /unknown concept/);
});

test('12. backups: keep-N pruning and once-per-day claim', (t) => {
  const dir = tmpDir(t);
  bootstrap(dir);
  const paths = [];
  for (let i = 0; i < 4; i++) paths.push(one(dir, 'backup', { keep: 2 }).path);
  const files = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('mentor-'));
  assert.equal(files.length, 2);
  assert.deepEqual(files.sort(), paths.slice(-2).map((p) => path.basename(p)).sort());
  const b = new DatabaseSync(paths[3], { readOnly: true });
  assert.equal(b.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(b.prepare('SELECT count(*) n FROM concepts').get().n, 3);
  b.close();

  const d1 = one(dir, 'maybeDailyBackup', { now: T0 });
  assert.ok(d1.path && fs.existsSync(d1.path));
  assert.equal(one(dir, 'maybeDailyBackup', { now: T0 + 3600_000 }).path, null);
  assert.ok(one(dir, 'maybeDailyBackup', { now: T0 + DAY }).path);
});

test('13. default data dir follows the platform and CLAUDE_CODE_MENTOR_DATA overrides it', () => {
  const saved = process.env.CLAUDE_CODE_MENTOR_DATA;
  try {
    delete process.env.CLAUDE_CODE_MENTOR_DATA;
    const dir = defaultDataDir();
    assert.equal(path.basename(dir), 'ClaudeCodeMentor');
    if (process.platform === 'darwin') assert.equal(dir, path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeMentor'));
    else if (process.platform === 'win32') assert.match(dir, /AppData[\\/]Local[\\/]ClaudeCodeMentor$/i);
    else assert.equal(dir, path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ClaudeCodeMentor'));
    process.env.CLAUDE_CODE_MENTOR_DATA = path.join(os.tmpdir(), 'mentor-custom');
    assert.equal(defaultDataDir(), path.join(os.tmpdir(), 'mentor-custom'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_MENTOR_DATA;
    else process.env.CLAUDE_CODE_MENTOR_DATA = saved;
  }
});
