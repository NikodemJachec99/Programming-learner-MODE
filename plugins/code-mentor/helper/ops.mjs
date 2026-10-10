// Operations of the mentor helper. Every write op runs in its own BEGIN IMMEDIATE … COMMIT
// (see withTx in db.mjs: ROLLBACK on error, SQLITE_BUSY retried on top of busy_timeout).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SCHEMA_VERSION,
  defaultDataDir,
  openDatabase,
  retryBusy,
  timestamp,
  uniquePath,
  vacuumInto,
  withTx,
} from './db.mjs';
import {
  EVIDENCE_KINDS,
  GRADED_KINDS,
  LEVELS,
  TASKS,
  applyEvidence,
  correctAgainstMisconception,
  effectiveConfidence,
  hitMisconception,
  isDue,
  localDay,
} from './mastery.mjs';

export const EXPORT_FORMAT = 'claude-code-mentor-export';
export const WIPE_CONFIRM = 'USUN-WSZYSTKO';
/** Częściowe czyszczenie: historia pracy Claude albo postęp nauki, każde z własnym potwierdzeniem. */
export const CLEAR_PARTS = Object.freeze({
  // zmiany, obserwacje i lekcje: to, co powstało z pracy Claude; wiedza i odpowiedzi zostają
  history: { confirm: 'WYCZYSC-HISTORIE', tables: ['changes', 'observations', 'lessons', 'lesson_cache'] },
  // wiedza, dowody, historia poziomów, błędy w rozumowaniu i odpowiedzi; zmiany i lekcje zostają
  progress: { confirm: 'RESETUJ-POSTEP', tables: ['evidence', 'history', 'misconceptions', 'exercises', 'knowledge'] },
});

/** Tables holding the user's data (export/import/wipe). Catalog tables (concepts, edges) and meta are not. */
export const USER_TABLES = Object.freeze([
  'settings',
  'projects',
  'sessions',
  'knowledge',
  'evidence',
  'history',
  'misconceptions',
  'observations',
  'lessons',
  'exercises',
  'lesson_cache',
  'usage',
]);
const CATALOG_TABLES = Object.freeze(['concepts', 'concept_edges']);
/** Kod z historii zmian (Change Lab): kasowany razem z danymi, ale nigdy nie trafia do eksportu. */
export const SNAPSHOT_TABLES = Object.freeze(['changes']);
const ALL_TABLES = Object.freeze(['meta', ...CATALOG_TABLES, ...USER_TABLES, ...SNAPSHOT_TABLES]);
/** Ile zmian z kodem trzymamy: na projekt i maksymalny wiek. */
export const CHANGE_KEEP = Object.freeze({ perProject: 400, maxAgeDays: 60, textMax: 60_000 });
const CHANGE_LIST_COLS =
  'id, session_id, project_id, turn_key, turn_label, ts, tool, kind, status, file_path, lang, line, added, removed, summary, concepts_json, facts_json, (before_text IS NOT NULL) AS has_before, (after_text IS NOT NULL) AS has_after';

function changeRow(r, full) {
  const out = {
    id: r.id,
    sessionId: r.session_id,
    projectId: r.project_id,
    turnKey: r.turn_key,
    turnLabel: r.turn_label,
    ts: r.ts,
    tool: r.tool,
    kind: r.kind,
    status: r.status,
    file: r.file_path,
    lang: r.lang,
    line: r.line,
    added: r.added,
    removed: r.removed,
    summary: r.summary,
    concepts: r.concepts_json ? JSON.parse(r.concepts_json) : [],
    facts: r.facts_json ? JSON.parse(r.facts_json) : [],
    hasBefore: full ? r.before_text !== null : !!r.has_before,
    hasAfter: full ? r.after_text !== null : !!r.has_after,
  };
  if (full) {
    out.unified = r.unified;
    out.before = r.before_text;
    out.beforeStart = r.before_start;
    out.after = r.after_text;
    out.afterStart = r.after_start;
  }
  return out;
}

const KEYED = Object.freeze({
  settings: ['key'],
  projects: ['id'],
  sessions: ['id'],
  knowledge: ['concept_id'],
  lessons: ['id'],
  exercises: ['id'],
  lesson_cache: ['cache_key'],
  usage: ['day', 'kind'],
  concepts: ['id'],
  concept_edges: ['from_id', 'to_id'],
});
const DEDUP = Object.freeze({
  evidence: ['concept_id', 'ts', 'kind'],
  history: ['concept_id', 'ts', 'reason'],
  observations: ['session_id', 'ts', 'kind'],
});
const IMPORT_ORDER = Object.freeze([
  'projects',
  'sessions',
  'concepts',
  'concept_edges',
  'knowledge',
  'evidence',
  'history',
  'misconceptions',
  'observations',
  'lessons',
  'exercises',
  'lesson_cache',
  'usage',
  'settings',
]);

const SNIPPET_MAX = 8000;
const SUMMARY_MAX = 2000;

// ---------------------------------------------------------------- validation helpers

class ArgError extends Error {}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function fail(msg) {
  throw new ArgError(msg);
}
function str(o, key, { optional = false, max = 4096, allowEmpty = false } = {}) {
  const v = o?.[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    fail(`'${key}' is required (string)`);
  }
  if (typeof v !== 'string') fail(`'${key}' must be a string`);
  if (!allowEmpty && v.length === 0) fail(`'${key}' must not be empty`);
  if (v.length > max) fail(`'${key}' is too long (max ${max})`);
  return v;
}
function num(o, key, { optional = false, def, min = -Infinity, max = Infinity, integer = false } = {}) {
  const v = o?.[key];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    if (optional) return null;
    fail(`'${key}' is required (number)`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`'${key}' must be a finite number`);
  if (integer && !Number.isInteger(v)) fail(`'${key}' must be an integer`);
  if (v < min || v > max) fail(`'${key}' must be in [${min}, ${max}]`);
  return v;
}
function arr(o, key, { optional = false, max = 100_000 } = {}) {
  const v = o?.[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    fail(`'${key}' is required (array)`);
  }
  if (!Array.isArray(v)) fail(`'${key}' must be an array`);
  if (v.length > max) fail(`'${key}' has too many items (max ${max})`);
  return v;
}
function obj(o, key, { optional = false } = {}) {
  const v = o?.[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    fail(`'${key}' is required (object)`);
  }
  if (!isObj(v)) fail(`'${key}' must be an object`);
  return v;
}
function nowOf(args) {
  return Math.round(num(args, 'now', { def: Date.now(), min: 0 }));
}
function limitOf(args, key, def, max = 1000) {
  return num(args, key, { def, min: key === 'offset' ? 0 : 1, max, integer: true });
}
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** Field from a caller object, accepting snake_case or camelCase. */
function pick(o, snake) {
  if (o[snake] !== undefined) return o[snake];
  return o[camel(snake)];
}
/** Make a value bindable: undefined → null, booleans → 0/1; reject objects. */
function bv(v, name = 'value') {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail(`${name} must be finite`);
    return v;
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v;
  fail(`${name} must be a string, number or null`);
}
function optStr(v, name, max = 100_000) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') fail(`'${name}' must be a string`);
  return v.length > max ? v.slice(0, max) : v;
}
function optInt(v, name) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`'${name}' must be a number`);
  return Math.round(v);
}
/** JS value → JSON text (or null). Strings that already are the *_json column are not accepted on purpose. */
function toJson(v, name) {
  if (v === undefined || v === null) return null;
  let s;
  try {
    s = JSON.stringify(v);
  } catch (e) {
    fail(`'${name}' is not JSON-serialisable: ${e.message}`);
  }
  if (s === undefined) fail(`'${name}' is not JSON-serialisable`);
  return s;
}
function safeParse(s) {
  if (s === null || s === undefined) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- presentation

/** Copy a row, turning every `<x>_json` column into a parsed `<x>` field. */
function present(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json')) out[k.slice(0, -5)] = safeParse(v);
    else out[k] = v;
  }
  return out;
}
function presentKnowledge(row, now) {
  if (!row) return null;
  const out = present(row);
  out.level_name = LEVELS[row.level] ?? null;
  out.effectiveConfidence = effectiveConfidence(row, now);
  out.isDue = isDue(row, now);
  return out;
}

const KNOWLEDGE_SELECT = `SELECT k.*, c.name AS name, c.area AS area
  FROM knowledge k JOIN concepts c ON c.id = k.concept_id`;

function knowledgeAll(db, now) {
  return db
    .prepare(`${KNOWLEDGE_SELECT} ORDER BY c.area, c.id`)
    .all()
    .map((r) => presentKnowledge(r, now));
}
function knowledgeOne(db, conceptId, now) {
  return presentKnowledge(db.prepare(`${KNOWLEDGE_SELECT} WHERE k.concept_id = ?`).get(conceptId), now);
}
function getSettingsObj(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value_json FROM settings ORDER BY key').all()) {
    out[r.key] = safeParse(r.value_json);
  }
  return out;
}
function tableCounts(db, tables = ALL_TABLES) {
  const out = {};
  for (const t of tables) out[t] = db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
  return out;
}
function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}
function metaGet(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

// ---------------------------------------------------------------- evidence core

function validateMisconceptions(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) fail("'misconceptions' must be an array");
  return list.map((m, i) => {
    if (!isObj(m)) fail(`misconceptions[${i}] must be an object`);
    const key = str(m, 'key', { max: 200 });
    const description = str(m, 'description', { optional: true, max: 2000, allowEmpty: true });
    const example = m.example;
    if (example !== undefined) toJson(example, `misconceptions[${i}].example`);
    return { key, description, example };
  });
}

function validateEvidence(e, where = 'evidence') {
  if (!isObj(e)) fail(`${where} must be an object`);
  const conceptId = str(e, 'conceptId', { max: 200 });
  const kind = str(e, 'kind', { max: 64 });
  if (!EVIDENCE_KINDS.includes(kind)) fail(`${where}.kind must be one of ${EVIDENCE_KINDS.join('|')}`);
  const task = str(e, 'task', { optional: true, max: 32 });
  if (GRADED_KINDS.includes(kind) && !TASKS.includes(task)) {
    fail(`${where}.task must be one of ${TASKS.join('|')} for graded kind '${kind}'`);
  }
  if (task !== null && !TASKS.includes(task)) fail(`${where}.task must be one of ${TASKS.join('|')}`);
  return {
    conceptId,
    kind,
    task,
    source: str(e, 'source', { optional: true, max: 200 }),
    projectId: str(e, 'projectId', { optional: true, max: 500 }),
    lessonId: str(e, 'lessonId', { optional: true, max: 500 }),
    exerciseId: str(e, 'exerciseId', { optional: true, max: 500 }),
    misconceptions: validateMisconceptions(e.misconceptions),
    detail: e.detail,
  };
}

const K_UPDATE_COLS = [
  'mastery',
  'confidence',
  'level',
  'exposures',
  'engagements',
  'correct',
  'partial',
  'incorrect',
  'strong_correct',
  'correct_days_json',
  'last_evidence_at',
  'last_verified_at',
  'next_review_at',
  'interval_days',
  'ease',
  'updated_at',
];

/** Apply one validated evidence inside the caller's transaction. */
function applyEvidenceTx(db, ev, now) {
  let row = db.prepare('SELECT * FROM knowledge WHERE concept_id = ?').get(ev.conceptId);
  if (!row) {
    if (!db.prepare('SELECT 1 AS x FROM concepts WHERE id = ?').get(ev.conceptId)) {
      fail(`unknown concept: ${ev.conceptId}`);
    }
    db.prepare('INSERT INTO knowledge(concept_id, updated_at) VALUES(?, ?)').run(ev.conceptId, now);
    row = db.prepare('SELECT * FROM knowledge WHERE concept_id = ?').get(ev.conceptId);
  }
  const res = applyEvidence(row, { kind: ev.kind, task: ev.task }, now);
  if (res.changed) {
    const set = K_UPDATE_COLS.map((c) => `${c} = $${c}`).join(', ');
    const params = { concept_id: ev.conceptId };
    for (const c of K_UPDATE_COLS) params[c] = bv(res.row[c], c);
    db.prepare(`UPDATE knowledge SET ${set} WHERE concept_id = $concept_id`).run(params);
  }

  const detail = {};
  if (ev.task) detail.task = ev.task;
  if (ev.misconceptions.length) detail.misconceptions = ev.misconceptions;
  if (ev.detail !== undefined && ev.detail !== null) detail.detail = ev.detail;
  if (res.ignored) detail.ignored = true;
  db.prepare(
    `INSERT INTO evidence(concept_id, ts, kind, source, project_id, lesson_id, exercise_id,
       mastery_before, mastery_after, detail_json)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    ev.conceptId,
    Math.round(now),
    ev.kind,
    ev.source,
    ev.projectId,
    ev.lessonId,
    ev.exerciseId,
    res.masteryBefore,
    res.masteryAfter,
    Object.keys(detail).length ? toJson(detail, 'detail') : null,
  );

  const levelChanged = res.levelAfter !== res.levelBefore;
  if (levelChanged) {
    db.prepare(
      `INSERT INTO history(concept_id, ts, level_before, level_after, mastery_before, mastery_after, reason)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(
      ev.conceptId,
      Math.round(now),
      res.levelBefore,
      res.levelAfter,
      res.masteryBefore,
      res.masteryAfter,
      ev.task ? `${ev.kind}:${ev.task}` : ev.kind,
    );
  }

  if ((ev.kind === 'incorrect' || ev.kind === 'partial') && ev.misconceptions.length) {
    const sel = db.prepare('SELECT * FROM misconceptions WHERE concept_id = ? AND key = ?');
    const ins = db.prepare(
      `INSERT INTO misconceptions(concept_id, key, description, count, correct_since, first_seen, last_seen,
         resolved_at, examples_json, project_ids_json)
       VALUES($concept_id,$key,$description,$count,$correct_since,$first_seen,$last_seen,$resolved_at,
         $examples_json,$project_ids_json)`,
    );
    const upd = db.prepare(
      `UPDATE misconceptions SET description=$description, count=$count, correct_since=$correct_since,
         last_seen=$last_seen, resolved_at=$resolved_at, examples_json=$examples_json,
         project_ids_json=$project_ids_json
       WHERE id = $id`,
    );
    for (const m of ev.misconceptions) {
      const existing = sel.get(ev.conceptId, m.key);
      const next = hitMisconception(existing, m, ev.projectId, Math.round(now));
      if (existing) {
        upd.run({
          id: existing.id,
          description: next.description,
          count: next.count,
          correct_since: next.correct_since,
          last_seen: next.last_seen,
          resolved_at: next.resolved_at,
          examples_json: next.examples_json,
          project_ids_json: next.project_ids_json,
        });
      } else {
        ins.run({ ...next, concept_id: ev.conceptId });
      }
    }
  } else if (ev.kind === 'correct') {
    const open = db
      .prepare('SELECT * FROM misconceptions WHERE concept_id = ? AND resolved_at IS NULL')
      .all(ev.conceptId);
    const upd = db.prepare('UPDATE misconceptions SET correct_since = ?, resolved_at = ? WHERE id = ?');
    for (const m of open) {
      const n = correctAgainstMisconception(m, Math.round(now));
      upd.run(n.correct_since, n.resolved_at, m.id);
    }
  }

  return {
    conceptId: ev.conceptId,
    levelChanged,
    levelBefore: res.levelBefore,
    levelAfter: res.levelAfter,
  };
}

// ---------------------------------------------------------------- backup helpers

const BACKUP_RE = /^mentor-\d{8}-\d{6}(-\d+)?\.db$/;

function doBackup(ctx, keep) {
  const dir = path.join(ctx.dataDir, 'backups');
  const p = vacuumInto(ctx.db, uniquePath(dir, `mentor-${timestamp()}`, '.db'));
  const files = fs
    .readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t || a.f.localeCompare(b.f));
  const removed = [];
  while (files.length > keep) {
    const { f } = files.shift();
    if (path.join(dir, f) === p) continue;
    fs.rmSync(path.join(dir, f), { force: true });
    removed.push(f);
  }
  return { path: p, removed };
}

function writeFileAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
}

// ---------------------------------------------------------------- operations

const OPS = {
  init(ctx) {
    return {
      schemaVersion: SCHEMA_VERSION,
      dbPath: ctx.dbPath,
      sqliteVersion: ctx.db.prepare('SELECT sqlite_version() AS v').get().v,
    };
  },

  bootstrap(ctx, args) {
    const now = nowOf(args);
    const day = str(args, 'day', { optional: true, max: 32 }) ?? localDay(now);
    const project = obj(args, 'project');
    const pid = str(project, 'id', { max: 500 });
    const root = str(project, 'root', { max: 4096 });
    const pname = str(project, 'name', { optional: true, max: 500, allowEmpty: true });
    const premote = str(project, 'remote', { optional: true, max: 4096, allowEmpty: true });
    const session = obj(args, 'session', { optional: true });
    const sid = session ? str(session, 'id', { max: 500 }) : null;
    const surface = session ? str(session, 'surface', { optional: true, max: 100 }) : null;
    const conceptsIn = arr(args, 'concepts', { optional: true, max: 10_000 });
    const concepts = conceptsIn?.map((c, i) => {
      if (!isObj(c)) fail(`concepts[${i}] must be an object`);
      const langs = c.langs ?? null;
      const prereqs = c.prereqs ?? [];
      if (langs !== null && !Array.isArray(langs)) fail(`concepts[${i}].langs must be an array`);
      if (!Array.isArray(prereqs) || prereqs.some((p) => typeof p !== 'string')) {
        fail(`concepts[${i}].prereqs must be an array of concept ids`);
      }
      return {
        id: str(c, 'id', { max: 200 }),
        name: str(c, 'name', { max: 500 }),
        area: str(c, 'area', { max: 200 }),
        langs,
        prereqs,
        weight: num(c, 'weight', { optional: true, integer: true }),
      };
    });
    if (concepts) {
      const seen = new Set();
      for (const c of concepts) {
        if (seen.has(c.id)) fail(`duplicate concept id: ${c.id}`);
        seen.add(c.id);
      }
    }

    const db = ctx.db;
    return withTx(db, 'IMMEDIATE', () => {
      const clash = db.prepare('SELECT id FROM projects WHERE root = ? AND id <> ?').get(root, pid);
      if (clash) fail(`project root '${root}' is already registered under id '${clash.id}'`);
      db.prepare(
        `INSERT INTO projects(id, root, name, remote, first_seen, last_seen) VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET root = excluded.root, name = COALESCE(excluded.name, name),
           remote = COALESCE(excluded.remote, remote), last_seen = excluded.last_seen`,
      ).run(pid, root, pname, premote, Math.round(now), Math.round(now));
      if (sid) {
        db.prepare(
          `INSERT INTO sessions(id, project_id, started_at, surface) VALUES(?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id,
             surface = COALESCE(excluded.surface, surface)`,
        ).run(sid, pid, Math.round(now), surface);
      }

      let conceptsUpdated = false;
      if (concepts) {
        const canon = [...concepts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const hash = createHash('sha256').update(JSON.stringify(canon)).digest('hex');
        if (metaGet(db, 'concepts_hash') !== hash) {
          const up = db.prepare(
            `INSERT INTO concepts(id, name, area, langs_json, prereqs_json, weight) VALUES(?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, area = excluded.area,
               langs_json = excluded.langs_json, prereqs_json = excluded.prereqs_json, weight = excluded.weight`,
          );
          for (const c of canon) {
            up.run(c.id, c.name, c.area, toJson(c.langs, 'langs'), toJson(c.prereqs, 'prereqs'), c.weight);
          }
          db.exec('DELETE FROM concept_edges');
          const edge = db.prepare(
            `INSERT OR IGNORE INTO concept_edges(from_id, to_id)
             SELECT ?, ? WHERE EXISTS (SELECT 1 FROM concepts WHERE id = ?)`,
          );
          for (const c of canon) for (const p of c.prereqs) if (p !== c.id) edge.run(p, c.id, p);
          metaSet(db, 'concepts_hash', hash);
          conceptsUpdated = true;
        }
      }
      db.prepare(
        `INSERT OR IGNORE INTO knowledge(concept_id, updated_at) SELECT id, ? FROM concepts`,
      ).run(Math.round(now));

      const knowledge = knowledgeAll(db, now);
      return {
        settings: getSettingsObj(db),
        project: present(db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)),
        conceptsUpdated,
        knowledge,
        misconceptions: db
          .prepare(
            `SELECT * FROM misconceptions WHERE resolved_at IS NULL
             ORDER BY count DESC, last_seen DESC LIMIT 30`,
          )
          .all()
          .map(present),
        recentLessons: db
          .prepare(
            `SELECT id, title, ts, concept_ids_json, file_path, line, source, status FROM lessons
             WHERE project_id = ? ORDER BY ts DESC LIMIT 20`,
          )
          .all(pid)
          .map(present),
        dueCount: knowledge.filter((k) => k.isDue).length,
        usageToday: db
          .prepare('SELECT kind, calls, tokens_in, tokens_out FROM usage WHERE day = ? ORDER BY kind')
          .all(day)
          .map((r) => ({ ...r })),
        stats: db
          .prepare(
            `SELECT (SELECT count(*) FROM lessons) AS lessons,
                    (SELECT count(*) FROM exercises) AS exercises,
                    (SELECT count(*) FROM exercises WHERE verdict IN ('correct','partial','incorrect')) AS graded,
                    (SELECT count(*) FROM observations) AS observations,
                    (SELECT count(*) FROM projects) AS projects`,
          )
          .get(),
      };
    });
  },

  getSettings(ctx) {
    return getSettingsObj(ctx.db);
  },

  setSettings(ctx, args) {
    const patch = obj(args, 'patch');
    const now = nowOf(args);
    const entries = Object.entries(patch).map(([k, v]) => {
      if (k.length === 0 || k.length > 200) fail(`bad settings key: '${k}'`);
      return [k, v === null ? null : toJson(v, `patch.${k}`)];
    });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const up = ctx.db.prepare(
        `INSERT INTO settings(key, value_json, updated_at) VALUES(?,?,?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      );
      const del = ctx.db.prepare('DELETE FROM settings WHERE key = ?');
      for (const [k, j] of entries) {
        if (j === null) del.run(k);
        else up.run(k, j, Math.round(now));
      }
      return getSettingsObj(ctx.db);
    });
  },

  addObservations(ctx, args) {
    const items = arr(args, 'items', { max: 5000 });
    const now = Date.now();
    const rows = items.map((it, i) => {
      if (!isObj(it)) fail(`items[${i}] must be an object`);
      const concepts = pick(it, 'concepts') ?? null;
      const meta = pick(it, 'meta') ?? null;
      return {
        session_id: optStr(pick(it, 'session_id'), 'session_id', 500),
        project_id: optStr(pick(it, 'project_id'), 'project_id', 500),
        turn_id: optStr(pick(it, 'turn_id'), 'turn_id', 500),
        ts: optInt(pick(it, 'ts'), 'ts') ?? now,
        kind: optStr(pick(it, 'kind'), 'kind', 100),
        tool: optStr(pick(it, 'tool'), 'tool', 200),
        file_path: optStr(pick(it, 'file_path'), 'file_path', 4096),
        line: optInt(pick(it, 'line'), 'line'),
        summary: optStr(pick(it, 'summary'), 'summary', SUMMARY_MAX),
        added: optInt(pick(it, 'added'), 'added'),
        removed: optInt(pick(it, 'removed'), 'removed'),
        snippet: optStr(pick(it, 'snippet'), 'snippet', SNIPPET_MAX),
        concepts_json: toJson(concepts, `items[${i}].concepts`),
        meta_json: toJson(meta, `items[${i}].meta`),
      };
    });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const ins = ctx.db.prepare(
        `INSERT INTO observations(session_id, project_id, turn_id, ts, kind, tool, file_path, line, summary,
           added, removed, snippet, concepts_json, meta_json)
         VALUES($session_id,$project_id,$turn_id,$ts,$kind,$tool,$file_path,$line,$summary,
           $added,$removed,$snippet,$concepts_json,$meta_json)`,
      );
      return { ids: rows.map((r) => Number(ins.run(r).lastInsertRowid)) };
    });
  },

  saveChange(ctx, args) {
    const c = args?.change;
    if (!isObj(c)) fail('change must be an object');
    const id = str(c, 'id', { max: 200 });
    const row = {
      id,
      session_id: optStr(pick(c, 'sessionId'), 'sessionId', 500),
      project_id: optStr(pick(c, 'projectId'), 'projectId', 500),
      turn_key: optStr(pick(c, 'turnKey'), 'turnKey', 500),
      turn_label: optStr(pick(c, 'turnLabel'), 'turnLabel', 300),
      ts: optInt(pick(c, 'ts'), 'ts') ?? Date.now(),
      tool: optStr(pick(c, 'tool'), 'tool', 100),
      kind: optStr(pick(c, 'kind'), 'kind', 100),
      status: optStr(pick(c, 'status'), 'status', 50) ?? 'ok',
      file_path: optStr(pick(c, 'file'), 'file', 4096),
      lang: optStr(pick(c, 'lang'), 'lang', 50),
      line: optInt(pick(c, 'line'), 'line'),
      added: optInt(pick(c, 'added'), 'added'),
      removed: optInt(pick(c, 'removed'), 'removed'),
      summary: optStr(pick(c, 'summary'), 'summary', SUMMARY_MAX),
      concepts_json: toJson(pick(c, 'concepts') ?? null, 'concepts'),
      facts_json: toJson(pick(c, 'facts') ?? null, 'facts'),
      unified: optStr(pick(c, 'unified'), 'unified', CHANGE_KEEP.textMax),
      before_text: optStr(pick(c, 'before'), 'before', CHANGE_KEEP.textMax),
      before_start: optInt(pick(c, 'beforeStart'), 'beforeStart'),
      after_text: optStr(pick(c, 'after'), 'after', CHANGE_KEEP.textMax),
      after_start: optInt(pick(c, 'afterStart'), 'afterStart'),
    };
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db
        .prepare(
          `INSERT OR REPLACE INTO changes(id, session_id, project_id, turn_key, turn_label, ts, tool, kind, status, file_path, lang, line,
             added, removed, summary, concepts_json, facts_json, unified, before_text, before_start, after_text, after_start)
           VALUES($id,$session_id,$project_id,$turn_key,$turn_label,$ts,$tool,$kind,$status,$file_path,$lang,$line,
             $added,$removed,$summary,$concepts_json,$facts_json,$unified,$before_text,$before_start,$after_text,$after_start)`,
        )
        .run(row);
      // retencja: najstarsze ponad limit w projekcie i wszystko starsze niż maxAgeDays
      const cutoff = row.ts - CHANGE_KEEP.maxAgeDays * 86_400_000;
      const aged = ctx.db.prepare('DELETE FROM changes WHERE ts < ?').run(cutoff).changes;
      const over = ctx.db
        .prepare(
          `DELETE FROM changes WHERE project_id IS ? AND id NOT IN
             (SELECT id FROM changes WHERE project_id IS ? ORDER BY ts DESC LIMIT ?)`,
        )
        .run(row.project_id, row.project_id, CHANGE_KEEP.perProject).changes;
      return { id, pruned: Number(aged) + Number(over) };
    });
  },

  /** Usuwa zmiany (pliki jednorazowe Claude: utworzone i usunięte w tej samej turze). */
  deleteChanges(ctx, args) {
    const ids = arr(args, 'ids', { max: 500 }).map((x, i) => {
      if (typeof x !== 'string' || !x || x.length > 200) fail(`ids[${i}] must be a non-empty string`);
      return x;
    });
    if (!ids.length) return { deleted: 0 };
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const del = ctx.db.prepare('DELETE FROM changes WHERE id = ?');
      let n = 0;
      for (const id of ids) n += Number(del.run(id).changes);
      return { deleted: n };
    });
  },

  getChanges(ctx, args) {
    const limit = Math.min(optInt(args?.limit, 'limit') ?? 60, 400);
    const projectId = optStr(args?.projectId, 'projectId', 500);
    const rows = projectId
      ? ctx.db.prepare(`SELECT ${CHANGE_LIST_COLS} FROM changes WHERE project_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?`).all(projectId, limit)
      : ctx.db.prepare(`SELECT ${CHANGE_LIST_COLS} FROM changes ORDER BY ts DESC, rowid DESC LIMIT ?`).all(limit);
    return rows.map((r) => changeRow(r, false));
  },

  getChange(ctx, args) {
    const id = str(args, 'id', { max: 200 });
    const r = ctx.db.prepare('SELECT * FROM changes WHERE id = ?').get(id);
    return r ? changeRow(r, true) : null;
  },

  recordEvidence(ctx, args) {
    const ev = validateEvidence(args, 'args');
    const now = nowOf(args);
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const r = applyEvidenceTx(ctx.db, ev, now);
      return {
        knowledge: knowledgeOne(ctx.db, ev.conceptId, now),
        levelChanged: r.levelChanged,
        levelBefore: r.levelBefore,
        levelAfter: r.levelAfter,
      };
    });
  },

  recordExposure(ctx, args) {
    const ids = arr(args, 'conceptIds', { max: 10_000 });
    ids.forEach((id, i) => {
      if (typeof id !== 'string' || !id) fail(`conceptIds[${i}] must be a non-empty string`);
    });
    const projectId = str(args, 'projectId', { optional: true, max: 500 });
    const now = nowOf(args);
    // Ekspozycja to tylko sygnał, że pojęcie pojawiło się w pracy: najwyżej raz na pojęcie i projekt
    // dziennie, żeby jedna długa sesja nie nabijała setek „widziałeś to” bez żadnej nauki.
    const d = new Date(now);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const known = new Set(ctx.db.prepare('SELECT id FROM concepts').all().map((r) => r.id));
      const seenToday = ctx.db.prepare(
        "SELECT 1 FROM evidence WHERE concept_id = ? AND kind = 'exposure_claude' AND project_id IS ? AND ts >= ? LIMIT 1",
      );
      let count = 0;
      const skipped = [];
      const already = [];
      for (const id of new Set(ids)) {
        if (!known.has(id)) {
          skipped.push(id);
          continue;
        }
        if (seenToday.get(id, projectId ?? null, dayStart)) {
          already.push(id);
          continue;
        }
        applyEvidenceTx(
          ctx.db,
          { conceptId: id, kind: 'exposure_claude', task: null, source: 'claude', projectId,
            lessonId: null, exerciseId: null, misconceptions: [], detail: undefined },
          now,
        );
        count++;
      }
      return { count, skipped, already };
    });
  },

  saveLesson(ctx, args) {
    const l = obj(args, 'lesson');
    const id = str(l, 'id', { max: 500 });
    const body = pick(l, 'body');
    if (body === undefined || body === null) fail("'lesson.body' is required");
    const source = optStr(pick(l, 'source'), 'source', 20);
    if (source !== null && source !== 'model' && source !== 'builtin') fail("'lesson.source' must be model|builtin");
    const conceptIds = pick(l, 'concept_ids') ?? null;
    if (conceptIds !== null && !Array.isArray(conceptIds)) fail("'lesson.concept_ids' must be an array");
    const row = {
      id,
      project_id: optStr(pick(l, 'project_id'), 'project_id', 500),
      session_id: optStr(pick(l, 'session_id'), 'session_id', 500),
      ts: optInt(pick(l, 'ts'), 'ts') ?? Date.now(),
      title: optStr(pick(l, 'title'), 'title', 1000),
      concept_ids_json: toJson(conceptIds, 'concept_ids'),
      file_path: optStr(pick(l, 'file_path'), 'file_path', 4096),
      line: optInt(pick(l, 'line'), 'line'),
      body_json: toJson(body, 'body'),
      source,
      model: optStr(pick(l, 'model'), 'model', 200),
      tokens_in: optInt(pick(l, 'tokens_in'), 'tokens_in'),
      tokens_out: optInt(pick(l, 'tokens_out'), 'tokens_out'),
      cache_key: optStr(pick(l, 'cache_key'), 'cache_key', 1000),
      status: optStr(pick(l, 'status'), 'status', 50),
    };
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db
        .prepare(
          `INSERT INTO lessons(id, project_id, session_id, ts, title, concept_ids_json, file_path, line, body_json,
             source, model, tokens_in, tokens_out, cache_key, status)
           VALUES($id,$project_id,$session_id,$ts,$title,$concept_ids_json,$file_path,$line,$body_json,
             $source,$model,$tokens_in,$tokens_out,$cache_key,COALESCE($status,'new'))
           ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, session_id=excluded.session_id,
             ts=excluded.ts, title=excluded.title, concept_ids_json=excluded.concept_ids_json,
             file_path=excluded.file_path, line=excluded.line, body_json=excluded.body_json,
             source=excluded.source, model=excluded.model, tokens_in=excluded.tokens_in,
             tokens_out=excluded.tokens_out, cache_key=excluded.cache_key,
             status=COALESCE($status, lessons.status)`,
        )
        .run(row);
      return { id };
    });
  },

  getLessons(ctx, args) {
    const projectId = str(args, 'projectId', { optional: true, max: 500 });
    const limit = limitOf(args, 'limit', 30);
    const offset = limitOf(args, 'offset', 0, 1e9);
    const cols = args?.includeBody
      ? '*'
      : 'id, project_id, session_id, ts, title, concept_ids_json, file_path, line, source, model, tokens_in, tokens_out, cache_key, status';
    const where = projectId ? 'WHERE project_id = ?' : '';
    const params = projectId ? [projectId, limit, offset] : [limit, offset];
    return ctx.db
      .prepare(`SELECT ${cols} FROM lessons ${where} ORDER BY ts DESC, id LIMIT ? OFFSET ?`)
      .all(...params)
      .map(present);
  },

  getLesson(ctx, args) {
    const id = str(args, 'id', { max: 500 });
    return present(ctx.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id));
  },

  markLesson(ctx, args) {
    const id = str(args, 'id', { max: 500 });
    const status = str(args, 'status', { max: 50 });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const r = ctx.db.prepare('UPDATE lessons SET status = ? WHERE id = ?').run(status, id);
      if (r.changes === 0) fail(`lesson not found: ${id}`);
      return { id, status };
    });
  },

  cacheGet(ctx, args) {
    const key = str(args, 'key', { max: 1000 });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const row = ctx.db.prepare('SELECT body_json FROM lesson_cache WHERE cache_key = ?').get(key);
      if (!row) return null;
      ctx.db.prepare('UPDATE lesson_cache SET hits = hits + 1 WHERE cache_key = ?').run(key);
      return safeParse(row.body_json);
    });
  },

  cachePut(ctx, args) {
    const key = str(args, 'key', { max: 1000 });
    if (args.body === undefined || args.body === null) fail("'body' is required");
    const body = toJson(args.body, 'body');
    const now = nowOf(args);
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db
        .prepare(
          `INSERT INTO lesson_cache(cache_key, body_json, created_at, hits) VALUES(?,?,?,0)
           ON CONFLICT(cache_key) DO UPDATE SET body_json = excluded.body_json, created_at = excluded.created_at`,
        )
        .run(key, body, Math.round(now));
      return { key };
    });
  },

  reserveBudget(ctx, args) {
    const day = str(args, 'day', { max: 32 });
    const kind = str(args, 'kind', { max: 100 });
    const maxCalls = num(args, 'maxCalls', { min: 0, integer: true });
    const maxTokens = num(args, 'maxTokens', { optional: true, min: 0 }) ?? Infinity;
    const estTokens = num(args, 'estTokens', { def: 0, min: 0 });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db.prepare('INSERT OR IGNORE INTO usage(day, kind) VALUES(?, ?)').run(day, kind);
      const u = ctx.db.prepare('SELECT calls, tokens_in, tokens_out FROM usage WHERE day = ? AND kind = ?').get(day, kind);
      const tokens = u.tokens_in + u.tokens_out;
      if (u.calls < maxCalls && tokens + estTokens <= maxTokens) {
        ctx.db.prepare('UPDATE usage SET calls = calls + 1 WHERE day = ? AND kind = ?').run(day, kind);
        return { granted: true, calls: u.calls + 1, tokens };
      }
      return { granted: false, calls: u.calls, tokens };
    });
  },

  commitUsage(ctx, args) {
    const day = str(args, 'day', { max: 32 });
    const kind = str(args, 'kind', { max: 100 });
    const tin = num(args, 'tokensIn', { def: 0, min: 0, integer: true });
    const tout = num(args, 'tokensOut', { def: 0, min: 0, integer: true });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db
        .prepare(
          `INSERT INTO usage(day, kind, calls, tokens_in, tokens_out) VALUES(?,?,0,?,?)
           ON CONFLICT(day, kind) DO UPDATE SET tokens_in = tokens_in + excluded.tokens_in,
             tokens_out = tokens_out + excluded.tokens_out`,
        )
        .run(day, kind, tin, tout);
      return { ...ctx.db.prepare('SELECT calls, tokens_in, tokens_out FROM usage WHERE day = ? AND kind = ?').get(day, kind) };
    });
  },

  releaseBudget(ctx, args) {
    const day = str(args, 'day', { max: 32 });
    const kind = str(args, 'kind', { max: 100 });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      ctx.db.prepare('UPDATE usage SET calls = max(0, calls - 1) WHERE day = ? AND kind = ?').run(day, kind);
      const u = ctx.db.prepare('SELECT calls FROM usage WHERE day = ? AND kind = ?').get(day, kind);
      return { calls: u ? u.calls : 0 };
    });
  },

  saveExercise(ctx, args) {
    const x = obj(args, 'exercise');
    const id = str(x, 'id', { max: 500 });
    const question = pick(x, 'question');
    if (question === undefined || question === null) fail("'exercise.question' is required");
    const row = {
      id,
      lesson_id: optStr(pick(x, 'lesson_id'), 'lesson_id', 500),
      concept_id: optStr(pick(x, 'concept_id'), 'concept_id', 200),
      project_id: optStr(pick(x, 'project_id'), 'project_id', 500),
      ts: optInt(pick(x, 'ts'), 'ts') ?? Date.now(),
      kind: optStr(pick(x, 'kind'), 'kind', 50),
      question_json: toJson(question, 'question'),
    };
    return withTx(ctx.db, 'IMMEDIATE', () => {
      // Re-saving never touches grading columns (answer/grade/verdict).
      ctx.db
        .prepare(
          `INSERT INTO exercises(id, lesson_id, concept_id, project_id, ts, kind, question_json)
           VALUES($id,$lesson_id,$concept_id,$project_id,$ts,$kind,$question_json)
           ON CONFLICT(id) DO UPDATE SET lesson_id=excluded.lesson_id, concept_id=excluded.concept_id,
             project_id=excluded.project_id, ts=excluded.ts, kind=excluded.kind,
             question_json=excluded.question_json`,
        )
        .run(row);
      return { id };
    });
  },

  gradeExercise(ctx, args) {
    const id = str(args, 'id', { max: 500 });
    const verdict = str(args, 'verdict', { max: 20 });
    if (!['correct', 'partial', 'incorrect', 'skipped'].includes(verdict)) {
      fail("'verdict' must be correct|partial|incorrect|skipped");
    }
    const grade = args.grade ?? null;
    if (grade !== null && !isObj(grade)) fail("'grade' must be an object");
    const answer = grade && grade.answer !== undefined ? optStr(grade.answer, 'grade.answer', 100_000) : undefined;
    const evs = (arr(args, 'evidence', { optional: true, max: 100 }) ?? []).map((e, i) =>
      validateEvidence(e, `evidence[${i}]`),
    );
    const force = args.force === true;
    const now = nowOf(args);
    const db = ctx.db;
    return withTx(db, 'IMMEDIATE', () => {
      const ex = db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
      if (!ex) fail(`exercise not found: ${id}`);
      if (ex.verdict !== 'pending' && !force) {
        fail(`exercise ${id} is already graded (${ex.verdict}); pass force: true to re-grade`);
      }
      db.prepare(
        `UPDATE exercises SET answer_text = COALESCE(?, answer_text), grade_json = ?, verdict = ?, graded_at = ?
         WHERE id = ?`,
      ).run(answer ?? null, toJson(grade, 'grade'), verdict, Math.round(now), id);
      const levelChanges = [];
      const touched = [];
      for (const ev of evs) {
        const r = applyEvidenceTx(
          db,
          {
            ...ev,
            source: ev.source ?? 'exercise',
            projectId: ev.projectId ?? ex.project_id,
            lessonId: ev.lessonId ?? ex.lesson_id,
            exerciseId: id,
          },
          now,
        );
        if (!touched.includes(ev.conceptId)) touched.push(ev.conceptId);
        if (r.levelChanged) levelChanges.push({ conceptId: ev.conceptId, from: r.levelBefore, to: r.levelAfter });
      }
      return { knowledge: touched.map((c) => knowledgeOne(db, c, now)), levelChanges };
    });
  },

  getKnowledge(ctx, args) {
    const now = nowOf(args);
    return withTx(ctx.db, 'DEFERRED', () => ({
      knowledge: knowledgeAll(ctx.db, now),
      misconceptions: ctx.db.prepare('SELECT * FROM misconceptions ORDER BY concept_id, key').all().map(present),
    }));
  },

  getGraph(ctx, args) {
    const now = nowOf(args);
    return withTx(ctx.db, 'DEFERRED', () => ({
      concepts: ctx.db.prepare('SELECT * FROM concepts ORDER BY area, id').all().map(present),
      edges: ctx.db.prepare('SELECT from_id, to_id FROM concept_edges ORDER BY from_id, to_id').all().map((r) => ({ ...r })),
      knowledge: knowledgeAll(ctx.db, now),
    }));
  },

  getConceptHistory(ctx, args) {
    const conceptId = str(args, 'conceptId', { max: 200 });
    const now = nowOf(args);
    const db = ctx.db;
    return withTx(db, 'DEFERRED', () => ({
      knowledge: knowledgeOne(db, conceptId, now),
      evidence: db
        .prepare('SELECT * FROM evidence WHERE concept_id = ? ORDER BY ts DESC, id DESC LIMIT 100')
        .all(conceptId)
        .map(present),
      history: db.prepare('SELECT * FROM history WHERE concept_id = ? ORDER BY ts DESC, id DESC').all(conceptId).map(present),
      exercises: db
        .prepare('SELECT * FROM exercises WHERE concept_id = ? ORDER BY ts DESC LIMIT 30')
        .all(conceptId)
        .map(present),
      misconceptions: db
        .prepare('SELECT * FROM misconceptions WHERE concept_id = ? ORDER BY count DESC, key')
        .all(conceptId)
        .map(present),
    }));
  },

  getProjectHistory(ctx, args) {
    const projectId = str(args, 'projectId', { max: 500 });
    const limit = limitOf(args, 'limit', 100, 5000);
    return ctx.db
      .prepare('SELECT * FROM observations WHERE project_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
      .all(projectId, limit)
      .map(present);
  },

  /** Podsumowanie nauki od `since`: awanse poziomów, odpowiedzi, lekcje, zadania, powtórki i błędy w rozumowaniu. */
  getRecap(ctx, args) {
    const now = nowOf(args);
    const since = num(args, 'since', { min: 0, integer: true });
    return withTx(ctx.db, 'DEFERRED', () => {
      const up = ctx.db
        .prepare(`SELECT concept_id AS id, MIN(level_before) AS fromLevel, MAX(level_after) AS toLevel FROM history
                  WHERE ts >= ? GROUP BY concept_id HAVING MAX(level_after) > MIN(level_before) ORDER BY MAX(level_after) DESC LIMIT 8`)
        .all(since)
        .map((r) => ({ id: r.id, from: Number(r.fromLevel ?? 0), to: Number(r.toLevel ?? 0) }));
      const answers = { correct: 0, partial: 0, incorrect: 0 };
      for (const r of ctx.db
        .prepare("SELECT kind, COUNT(*) AS c FROM evidence WHERE ts >= ? AND kind IN ('correct','partial','incorrect') GROUP BY kind")
        .all(since)) answers[r.kind] = Number(r.c);
      const lessons = ctx.db.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS r FROM lessons WHERE ts >= ?").get(since);
      const tasks = ctx.db.prepare("SELECT COUNT(DISTINCT turn_key) AS t, COUNT(*) AS c FROM changes WHERE ts >= ? AND status = 'ok'").get(since);
      const due = ctx.db
        .prepare('SELECT concept_id AS id FROM knowledge WHERE next_review_at IS NOT NULL AND next_review_at <= ? ORDER BY next_review_at LIMIT 6')
        .all(Math.round(now))
        .map((r) => r.id);
      const open = ctx.db.prepare('SELECT COUNT(*) AS c FROM misconceptions WHERE resolved_at IS NULL').get();
      return {
        since,
        up,
        answers,
        lessons: { total: Number(lessons?.c ?? 0), read: Number(lessons?.r ?? 0) },
        tasks: { tasks: Number(tasks?.t ?? 0), changes: Number(tasks?.c ?? 0) },
        due,
        openMisconceptions: Number(open?.c ?? 0),
      };
    });
  },

  dueReviews(ctx, args) {
    const now = nowOf(args);
    const limit = limitOf(args, 'limit', 10);
    return ctx.db
      .prepare(`${KNOWLEDGE_SELECT} WHERE k.next_review_at IS NOT NULL AND k.next_review_at <= ?
                ORDER BY k.next_review_at LIMIT ?`)
      .all(Math.round(now), limit)
      .map((r) => presentKnowledge(r, now));
  },

  setNotes(ctx, args) {
    const conceptId = str(args, 'conceptId', { max: 200 });
    const notes = str(args, 'notes', { optional: true, max: 100_000, allowEmpty: true });
    const now = nowOf(args);
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const r = ctx.db
        .prepare('UPDATE knowledge SET notes = ?, updated_at = ? WHERE concept_id = ?')
        .run(notes, Math.round(now), conceptId);
      if (r.changes === 0) fail(`no knowledge row for concept: ${conceptId}`);
      return { conceptId, notes };
    });
  },

  stats(ctx) {
    const counts = withTx(ctx.db, 'DEFERRED', () => tableCounts(ctx.db));
    return { counts, dbBytes: fileSize(ctx.dbPath), walBytes: fileSize(ctx.dbPath + '-wal') };
  },

  export(ctx, args) {
    const p = args?.path
      ? path.resolve(str(args, 'path', { max: 4096 }))
      : uniquePath(path.join(ctx.dataDir, 'exports'), `mentor-export-${timestamp()}`, '.json');
    const tables = withTx(ctx.db, 'DEFERRED', () => {
      const out = {};
      for (const t of [...USER_TABLES, ...CATALOG_TABLES]) {
        out[t] = ctx.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }));
      }
      return out;
    });
    const doc = {
      format: EXPORT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tables,
    };
    writeFileAtomic(p, JSON.stringify(doc, null, 2));
    const counts = {};
    for (const [t, rows] of Object.entries(tables)) counts[t] = rows.length;
    return { path: p, counts };
  },

  import(ctx, args) {
    const p = path.resolve(str(args, 'path', { max: 4096 }));
    const mode = str(args, 'mode', { max: 10 });
    if (mode !== 'merge' && mode !== 'replace') fail("'mode' must be merge|replace");
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      fail(`cannot read export file: ${e.message}`);
    }
    if (!isObj(doc) || doc.format !== EXPORT_FORMAT) fail(`not a ${EXPORT_FORMAT} file`);
    if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1 || doc.schemaVersion > SCHEMA_VERSION) {
      fail(`unsupported export schemaVersion ${doc.schemaVersion} (helper supports <= ${SCHEMA_VERSION})`);
    }
    if (!isObj(doc.tables)) fail("export file has no 'tables' object");
    for (const [t, rows] of Object.entries(doc.tables)) {
      if (!IMPORT_ORDER.includes(t)) continue;
      if (!Array.isArray(rows)) fail(`tables.${t} must be an array`);
      rows.forEach((r, i) => {
        if (!isObj(r)) fail(`tables.${t}[${i}] must be an object`);
      });
    }

    const db = ctx.db;
    const backup = vacuumInto(db, uniquePath(path.join(ctx.dataDir, 'backups'), `pre-import-${timestamp()}`, '.db'));

    const counts = withTx(db, 'IMMEDIATE', () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      if (mode === 'replace') for (const t of [...USER_TABLES].reverse()) db.exec(`DELETE FROM "${t}"`);
      const counts = {};
      for (const t of IMPORT_ORDER) {
        const rows = doc.tables[t];
        if (!rows || rows.length === 0) continue;
        const allCols = new Set(tableColumns(db, t));
        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        for (const [i, r] of rows.entries()) {
          let cols = Object.keys(r).filter((c) => allCols.has(c));
          const catalog = CATALOG_TABLES.includes(t);
          const dropId = mode === 'merge' && (t === 'misconceptions' || DEDUP[t]);
          if (dropId) cols = cols.filter((c) => c !== 'id');
          if (cols.length === 0) {
            skipped++;
            continue;
          }
          const vals = cols.map((c) => bv(r[c], `tables.${t}[${i}].${c}`));
          const colSql = cols.map((c) => `"${c}"`).join(', ');
          const ph = cols.map(() => '?').join(', ');
          if (catalog) {
            // never clobber the live catalog; only fill gaps
            const res = db.prepare(`INSERT OR IGNORE INTO "${t}"(${colSql}) VALUES(${ph})`).run(...vals);
            res.changes ? inserted++ : skipped++;
            continue;
          }
          if (mode === 'replace') {
            db.prepare(`INSERT INTO "${t}"(${colSql}) VALUES(${ph})`).run(...vals);
            inserted++;
            continue;
          }
          // merge
          if (DEDUP[t]) {
            const keys = DEDUP[t];
            const dup = db
              .prepare(`SELECT 1 AS x FROM "${t}" WHERE ${keys.map((k) => `"${k}" IS ?`).join(' AND ')} LIMIT 1`)
              .get(...keys.map((k) => bv(r[k], k)));
            if (dup) {
              skipped++;
              continue;
            }
            db.prepare(`INSERT INTO "${t}"(${colSql}) VALUES(${ph})`).run(...vals);
            inserted++;
            continue;
          }
          const conflict = t === 'misconceptions' ? ['concept_id', 'key'] : KEYED[t];
          if (!conflict.every((k) => cols.includes(k))) {
            skipped++;
            continue;
          }
          if (t === 'projects' && r.root != null) {
            const clash = db.prepare('SELECT id FROM projects WHERE root = ? AND id <> ?').get(r.root, r.id);
            if (clash) {
              skipped++;
              continue;
            }
          }
          const exists = db
            .prepare(`SELECT 1 AS x FROM "${t}" WHERE ${conflict.map((k) => `"${k}" = ?`).join(' AND ')}`)
            .get(...conflict.map((k) => bv(r[k], k)));
          const setCols = cols.filter((c) => !conflict.includes(c));
          const upsert =
            setCols.length > 0
              ? `ON CONFLICT(${conflict.map((k) => `"${k}"`).join(', ')}) DO UPDATE SET ${setCols
                  .map((c) => `"${c}" = excluded."${c}"`)
                  .join(', ')}`
              : `ON CONFLICT DO NOTHING`;
          db.prepare(`INSERT INTO "${t}"(${colSql}) VALUES(${ph}) ${upsert}`).run(...vals);
          exists ? updated++ : inserted++;
        }
        counts[t] = { inserted, updated, skipped };
      }

      // Keep referential integrity even for partial / older exports.
      db.exec(
        `UPDATE sessions SET project_id = NULL
         WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)`,
      );
      const placeholders = db
        .prepare(
          `INSERT OR IGNORE INTO concepts(id, name, area)
           SELECT DISTINCT cid, cid, 'unknown' FROM (
             SELECT concept_id AS cid FROM knowledge UNION SELECT concept_id FROM evidence
             UNION SELECT concept_id FROM misconceptions UNION SELECT concept_id FROM history
           ) WHERE cid IS NOT NULL AND cid NOT IN (SELECT id FROM concepts)`,
        )
        .run().changes;
      if (placeholders > 0) db.prepare("DELETE FROM meta WHERE key = 'concepts_hash'").run(); // let next bootstrap refresh names
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) fail(`import would break foreign keys (${fk.length} rows, e.g. ${fk[0].table})`);
      counts.placeholderConcepts = placeholders;
      return counts;
    });
    return { counts, backup, mode };
  },

  /**
   * Jednorazowe czyszczenie starych rekordów: zwraca pola tekstowe, które mogły trafić do bazy
   * przed poprawką redakcji. Reguły redakcji są po stronie pluginu (jedna implementacja).
   */
  scrubScan(ctx, args) {
    const limit = Math.min(optInt(args?.limit, 'limit') ?? 5000, 20000);
    return {
      changes: ctx.db.prepare('SELECT id, summary, turn_label, facts_json FROM changes ORDER BY ts DESC LIMIT ?').all(limit)
        .map((r) => ({ id: r.id, summary: r.summary, turnLabel: r.turn_label, facts: r.facts_json ? JSON.parse(r.facts_json) : null })),
      observations: ctx.db.prepare('SELECT id, summary FROM observations ORDER BY id DESC LIMIT ?').all(limit)
        .map((r) => ({ id: Number(r.id), summary: r.summary })),
    };
  },

  /** Zapisuje tylko przekazane, już wyczyszczone pola; jedna transakcja. */
  scrubApply(ctx, args) {
    const changes = arr(args, 'changes', { max: 20000 });
    const observations = arr(args, 'observations', { max: 20000 });
    return withTx(ctx.db, 'IMMEDIATE', () => {
      const upC = ctx.db.prepare('UPDATE changes SET summary = $summary, turn_label = $turn_label, facts_json = $facts_json WHERE id = $id');
      const upO = ctx.db.prepare('UPDATE observations SET summary = $summary WHERE id = $id');
      let n = 0;
      for (const [i, c] of changes.entries()) {
        if (!isObj(c)) fail(`changes[${i}] must be an object`);
        n += Number(upC.run({
          id: str(c, 'id', { max: 200 }),
          summary: optStr(pick(c, 'summary'), 'summary', SUMMARY_MAX),
          turn_label: optStr(pick(c, 'turnLabel'), 'turnLabel', 300),
          facts_json: toJson(pick(c, 'facts') ?? null, `changes[${i}].facts`),
        }).changes);
      }
      for (const [i, o] of observations.entries()) {
        if (!isObj(o)) fail(`observations[${i}] must be an object`);
        n += Number(upO.run({ id: optInt(pick(o, 'id'), 'id'), summary: optStr(pick(o, 'summary'), 'summary', SUMMARY_MAX) }).changes);
      }
      return { updated: n };
    });
  },

  backup(ctx, args) {
    const keep = num(args, 'keep', { def: 10, min: 1, max: 1000, integer: true });
    return doBackup(ctx, keep);
  },

  maybeDailyBackup(ctx, args) {
    const now = nowOf(args);
    const keep = num(args, 'keep', { def: 10, min: 1, max: 1000, integer: true });
    const today = localDay(now);
    // Claim the day atomically so concurrent processes do not all back up.
    const prev = withTx(ctx.db, 'IMMEDIATE', () => {
      const last = metaGet(ctx.db, 'last_backup_day');
      if (last === today) return { claimed: false };
      metaSet(ctx.db, 'last_backup_day', today);
      return { claimed: true, last };
    });
    if (!prev.claimed) return { path: null };
    try {
      return doBackup(ctx, keep);
    } catch (e) {
      withTx(ctx.db, 'IMMEDIATE', () => {
        if (prev.last === null) ctx.db.prepare("DELETE FROM meta WHERE key = 'last_backup_day'").run();
        else metaSet(ctx.db, 'last_backup_day', prev.last);
      });
      throw e;
    }
  },

  /** Usuwa jedną część danych (historia albo postęp) z kopią bezpieczeństwa przed usunięciem. */
  clearData(ctx, args) {
    const part = str(args, 'part', { max: 20 });
    const def = CLEAR_PARTS[part];
    if (!def) fail(`part must be one of: ${Object.keys(CLEAR_PARTS).join(', ')}`);
    if (args?.confirm !== def.confirm) fail(`clearData(${part}) requires confirm: '${def.confirm}'`);
    let backup;
    if (args.keepBackup) backup = vacuumInto(ctx.db, uniquePath(path.join(ctx.dataDir, 'backups'), `pre-clear-${part}-${timestamp()}`, '.db'));
    const counts = withTx(ctx.db, 'IMMEDIATE', () => {
      const out = {};
      for (const t of def.tables) out[t] = Number(ctx.db.prepare(`DELETE FROM "${t}"`).run().changes);
      return out;
    });
    const res = { part, counts };
    if (backup) res.backup = backup;
    return res;
  },

  wipe(ctx, args) {
    if (args?.confirm !== WIPE_CONFIRM) fail(`wipe requires confirm: '${WIPE_CONFIRM}'`);
    let backup;
    if (args.keepBackup) {
      backup = vacuumInto(ctx.db, uniquePath(path.join(ctx.dataDir, 'backups'), `pre-wipe-${timestamp()}`, '.db'));
    }
    withTx(ctx.db, 'IMMEDIATE', () => {
      for (const t of [...SNAPSHOT_TABLES, ...[...USER_TABLES].reverse()]) ctx.db.exec(`DELETE FROM "${t}"`);
      ctx.db.prepare("DELETE FROM meta WHERE key = 'last_backup_day'").run();
    });
    let vacuumed = true;
    try {
      retryBusy(() => ctx.db.exec('VACUUM'));
    } catch {
      vacuumed = false; // data is already gone; VACUUM only reclaims space
    }
    const out = { wiped: true, vacuumed };
    if (backup) out.backup = backup;
    return out;
  },

  diag(ctx) {
    const db = ctx.db;
    const integrity = db
      .prepare('PRAGMA quick_check')
      .all()
      .map((r) => r.quick_check);
    return {
      schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
      sqliteVersion: db.prepare('SELECT sqlite_version() AS v').get().v,
      journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
      integrity: integrity.length === 1 ? integrity[0] : integrity,
      counts: withTx(db, 'DEFERRED', () => tableCounts(db)),
      dbBytes: fileSize(ctx.dbPath),
      walBytes: fileSize(ctx.dbPath + '-wal'),
      dataDir: ctx.dataDir,
      dbPath: ctx.dbPath,
      nodeVersion: process.version,
    };
  },
};

export const OP_NAMES = Object.freeze(Object.keys(OPS));

export function runOp(ctx, item) {
  try {
    if (!isObj(item)) fail('op entry must be an object');
    const { op, args } = item;
    if (typeof op !== 'string' || !Object.hasOwn(OPS, op)) fail(`unknown op: ${String(op)}`);
    if (args !== undefined && args !== null && !isObj(args)) fail("'args' must be an object");
    const value = OPS[op](ctx, args ?? {});
    return { ok: true, value: value === undefined ? null : value };
  } catch (e) {
    return { ok: false, error: e instanceof ArgError ? e.message : `${e.code ? e.code + ': ' : ''}${e.message}` };
  }
}

/**
 * Execute one request `{ v: 1, dataDir?, ops: [...] }`.
 * Returns `{ ok: true, schemaVersion, results }` or `{ ok: false, error }` (fatal).
 */
export function executeBatch(req) {
  if (!isObj(req)) return { ok: false, error: 'request must be a JSON object' };
  if (req.v !== 1) return { ok: false, error: `unsupported protocol version: ${JSON.stringify(req.v)} (expected 1)` };
  if (!Array.isArray(req.ops)) return { ok: false, error: "'ops' must be an array" };
  if (req.dataDir !== undefined && req.dataDir !== null && (typeof req.dataDir !== 'string' || !req.dataDir)) {
    return { ok: false, error: "'dataDir' must be a non-empty string" };
  }
  let ctx;
  try {
    ctx = openDatabase(req.dataDir || defaultDataDir());
  } catch (e) {
    return { ok: false, error: `cannot open database: ${e.code ? e.code + ': ' : ''}${e.message}` };
  }
  try {
    const results = req.ops.map((item) => runOp(ctx, item));
    return { ok: true, schemaVersion: SCHEMA_VERSION, results };
  } finally {
    try {
      ctx.db.close();
    } catch {
      /* ignore */
    }
  }
}

// re-export for tests / tooling
export { DatabaseSync };
