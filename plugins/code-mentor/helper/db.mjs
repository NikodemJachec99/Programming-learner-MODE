// Open + pragmas + migrations for the Claude Code Mentor database.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCHEMA_VERSION = 2;
export const DB_FILE = 'mentor.db';
export const BUSY_TIMEOUT_MS = 10_000;
export const BUSY_RETRIES = 5;

const SCHEMA_V1 = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
) STRICT;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at INTEGER
) STRICT;

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  root       TEXT NOT NULL UNIQUE CHECK (length(root) > 0),
  name       TEXT,
  remote     TEXT,
  first_seen INTEGER,
  last_seen  INTEGER
) STRICT;

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  started_at INTEGER,
  ended_at   INTEGER,
  surface    TEXT
) STRICT;

CREATE TABLE concepts (
  id           TEXT PRIMARY KEY CHECK (length(id) > 0),
  name         TEXT NOT NULL,
  area         TEXT NOT NULL,
  langs_json   TEXT CHECK (langs_json IS NULL OR json_valid(langs_json)),
  prereqs_json TEXT CHECK (prereqs_json IS NULL OR json_valid(prereqs_json)),
  weight       INTEGER
) STRICT;

CREATE TABLE concept_edges (
  from_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id),
  CHECK (from_id <> to_id)
) STRICT;

CREATE TABLE knowledge (
  concept_id        TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  mastery           REAL NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 1),
  confidence        REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  level             INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
  exposures         INTEGER DEFAULT 0 CHECK (exposures >= 0),
  engagements       INTEGER DEFAULT 0 CHECK (engagements >= 0),
  correct           INTEGER DEFAULT 0 CHECK (correct >= 0),
  partial           INTEGER DEFAULT 0 CHECK (partial >= 0),
  incorrect         INTEGER DEFAULT 0 CHECK (incorrect >= 0),
  strong_correct    INTEGER DEFAULT 0 CHECK (strong_correct >= 0),
  correct_days_json TEXT DEFAULT '[]' CHECK (correct_days_json IS NULL OR json_valid(correct_days_json)),
  last_evidence_at  INTEGER,
  last_verified_at  INTEGER,
  next_review_at    INTEGER,
  interval_days     REAL DEFAULT 0 CHECK (interval_days >= 0),
  ease              REAL DEFAULT 2.5 CHECK (ease > 0),
  notes             TEXT,
  updated_at        INTEGER
) STRICT;

CREATE TABLE evidence (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id     TEXT NOT NULL REFERENCES concepts(id),
  ts             INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (length(kind) > 0),
  source         TEXT,
  project_id     TEXT,
  lesson_id      TEXT,
  exercise_id    TEXT,
  mastery_before REAL,
  mastery_after  REAL,
  detail_json    TEXT CHECK (detail_json IS NULL OR json_valid(detail_json))
) STRICT;

CREATE TABLE history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id     TEXT REFERENCES concepts(id),
  ts             INTEGER,
  level_before   INTEGER CHECK (level_before IS NULL OR level_before BETWEEN 0 AND 4),
  level_after    INTEGER CHECK (level_after IS NULL OR level_after BETWEEN 0 AND 4),
  mastery_before REAL,
  mastery_after  REAL,
  reason         TEXT
) STRICT;

CREATE TABLE misconceptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id       TEXT NOT NULL REFERENCES concepts(id),
  key              TEXT NOT NULL CHECK (length(key) > 0),
  description      TEXT,
  count            INTEGER DEFAULT 1 CHECK (count >= 0),
  correct_since    INTEGER DEFAULT 0 CHECK (correct_since >= 0),
  first_seen       INTEGER,
  last_seen        INTEGER,
  resolved_at      INTEGER,
  examples_json    TEXT DEFAULT '[]' CHECK (examples_json IS NULL OR json_valid(examples_json)),
  project_ids_json TEXT DEFAULT '[]' CHECK (project_ids_json IS NULL OR json_valid(project_ids_json)),
  UNIQUE (concept_id, key)
) STRICT;

CREATE TABLE observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT,
  project_id    TEXT,
  turn_id       TEXT,
  ts            INTEGER,
  kind          TEXT,
  tool          TEXT,
  file_path     TEXT,
  line          INTEGER,
  summary       TEXT,
  added         INTEGER,
  removed       INTEGER,
  snippet       TEXT,
  concepts_json TEXT CHECK (concepts_json IS NULL OR json_valid(concepts_json)),
  meta_json     TEXT CHECK (meta_json IS NULL OR json_valid(meta_json))
) STRICT;

CREATE TABLE lessons (
  id               TEXT PRIMARY KEY CHECK (length(id) > 0),
  project_id       TEXT,
  session_id       TEXT,
  ts               INTEGER,
  title            TEXT,
  concept_ids_json TEXT CHECK (concept_ids_json IS NULL OR json_valid(concept_ids_json)),
  file_path        TEXT,
  line             INTEGER,
  body_json        TEXT NOT NULL CHECK (json_valid(body_json)),
  source           TEXT CHECK (source IN ('model','builtin')),
  model            TEXT,
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  cache_key        TEXT,
  status           TEXT DEFAULT 'new'
) STRICT;

CREATE TABLE exercises (
  id            TEXT PRIMARY KEY CHECK (length(id) > 0),
  lesson_id     TEXT,
  concept_id    TEXT,
  project_id    TEXT,
  ts            INTEGER,
  kind          TEXT,
  question_json TEXT NOT NULL CHECK (json_valid(question_json)),
  answer_text   TEXT,
  grade_json    TEXT CHECK (grade_json IS NULL OR json_valid(grade_json)),
  verdict       TEXT DEFAULT 'pending' CHECK (verdict IN ('pending','correct','partial','incorrect','skipped')),
  graded_at     INTEGER
) STRICT;

CREATE TABLE lesson_cache (
  cache_key  TEXT PRIMARY KEY,
  body_json  TEXT NOT NULL CHECK (json_valid(body_json)),
  created_at INTEGER,
  hits       INTEGER DEFAULT 0 CHECK (hits >= 0)
) STRICT;

CREATE TABLE usage (
  day        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  calls      INTEGER DEFAULT 0 CHECK (calls >= 0),
  tokens_in  INTEGER DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER DEFAULT 0 CHECK (tokens_out >= 0),
  PRIMARY KEY (day, kind)
) STRICT;

CREATE INDEX idx_evidence_concept_ts     ON evidence(concept_id, ts);
CREATE INDEX idx_observations_project_ts ON observations(project_id, ts);
CREATE INDEX idx_observations_session    ON observations(session_id);
CREATE INDEX idx_lessons_project_ts      ON lessons(project_id, ts);
CREATE INDEX idx_exercises_concept       ON exercises(concept_id);
CREATE INDEX idx_misconceptions_resolved ON misconceptions(resolved_at);
CREATE INDEX idx_knowledge_next_review   ON knowledge(next_review_at);
`;

// v2: Change Lab. Każda zmiana Claude w pliku z kodem przed i po (okno wokół zmiany),
// zapisana z narzędzia (originalFile + patch), nigdy odtwarzana.
const SCHEMA_V2 = `
CREATE TABLE changes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT,
  project_id   TEXT,
  turn_key     TEXT,
  turn_label   TEXT,
  ts           INTEGER NOT NULL,
  tool         TEXT,
  kind         TEXT,
  status       TEXT NOT NULL DEFAULT 'ok',
  file_path    TEXT,
  lang         TEXT,
  line         INTEGER,
  added        INTEGER,
  removed      INTEGER,
  summary      TEXT,
  concepts_json TEXT CHECK (concepts_json IS NULL OR json_valid(concepts_json)),
  facts_json   TEXT CHECK (facts_json IS NULL OR json_valid(facts_json)),
  unified      TEXT,
  before_text  TEXT,
  before_start INTEGER,
  after_text   TEXT,
  after_start  INTEGER
) STRICT;
CREATE INDEX idx_changes_project_ts ON changes(project_id, ts);
CREATE INDEX idx_changes_turn       ON changes(turn_key);
`;

export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    up(db) {
      db.exec(SCHEMA_V1);
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(SCHEMA_V2);
    },
  },
]);

// ---------------------------------------------------------------- utilities

export function defaultDataDir() {
  if (process.env.CLAUDE_CODE_MENTOR_DATA) return process.env.CLAUDE_CODE_MENTOR_DATA;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ClaudeCodeMentor');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeMentor');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ClaudeCodeMentor');
}

export function isBusyError(e) {
  if (!e) return false;
  const code = typeof e.errcode === 'number' ? e.errcode & 0xff : -1;
  if (code === 5 || code === 6) return true; // SQLITE_BUSY, SQLITE_LOCKED
  return /database is locked|database table is locked|SQLITE_BUSY/i.test(String(e.message));
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
export function sleepSync(ms) {
  Atomics.wait(sleepCell, 0, 0, ms);
}

/** Retry `fn` on SQLITE_BUSY/LOCKED (on top of busy_timeout) with small jittered backoff. */
export function retryBusy(fn, retries = BUSY_RETRIES) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      if (!isBusyError(e) || attempt >= retries) throw e;
      sleepSync(25 * 2 ** attempt + Math.floor(Math.random() * 25));
    }
  }
}

/** Run `fn` inside BEGIN <mode> … COMMIT; ROLLBACK on error; retried on BUSY. */
export function withTx(db, mode, fn) {
  return retryBusy(() => {
    db.exec(`BEGIN ${mode}`);
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      if (db.isTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* connection keeps the original error */
        }
      }
      throw e;
    }
  });
}

export function timestamp(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** `<dir>/<base><ext>`, or `<dir>/<base>-N<ext>` when that already exists. */
export function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext);
  for (let i = 1; fs.existsSync(p) || fs.existsSync(p + '.tmp'); i++) p = path.join(dir, `${base}-${i}${ext}`);
  return p;
}

/** Consistent copy of the live DB via VACUUM INTO (tmp file + rename, so no half-written backups). */
export function vacuumInto(db, target) {
  if (db.isTransaction) throw new Error('vacuumInto: cannot run inside a transaction');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  try {
    fs.rmSync(tmp, { force: true });
    retryBusy(() => db.prepare('VACUUM INTO ?').run(tmp));
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
  return target;
}

export function userVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function hasAnySchema(db) {
  return db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().n > 0;
}

// ---------------------------------------------------------------- migrations

/**
 * Bring `db` up to the highest version in `migrations`.
 * - Takes a VACUUM INTO backup first when the DB already holds a schema (version N>0, or N=0 but non-empty).
 * - Applies the pending `up()`s and the user_version bump inside one BEGIN EXCLUSIVE transaction,
 *   re-reading user_version after the lock is held, so concurrent processes migrate exactly once.
 * @returns {{ from:number, to:number, backup:string|null }}
 */
export function migrate(db, migrations, dataDir, { now = Date.now() } = {}) {
  if (!Array.isArray(migrations) || migrations.length === 0) throw new Error('migrate: empty migration list');
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (!Number.isInteger(m.version) || m.version < 1 || typeof m.up !== 'function') {
      throw new Error(`migrate: bad migration entry at index ${i}`);
    }
    if (i > 0 && sorted[i - 1].version === m.version) throw new Error(`migrate: duplicate version ${m.version}`);
  });
  const target = sorted[sorted.length - 1].version;

  for (let attempt = 0; attempt < 20; attempt++) {
    const cur = retryBusy(() => userVersion(db));
    if (cur > target) {
      throw new Error(`database schema v${cur} is newer than this helper (v${target}); update the plugin`);
    }
    if (cur === target) return { from: cur, to: cur, backup: null };

    let backup = null;
    if (cur > 0 || retryBusy(() => hasAnySchema(db))) {
      backup = vacuumInto(
        db,
        uniquePath(path.join(dataDir, 'backups'), `pre-migration-v${cur}-${timestamp(now)}`, '.db'),
      );
    }

    const done = retryBusy(() => {
      db.exec('BEGIN EXCLUSIVE');
      try {
        const cur2 = userVersion(db);
        if (cur2 !== cur) {
          db.exec('ROLLBACK');
          return false; // someone else migrated meanwhile; start over
        }
        for (const m of sorted) {
          if (m.version <= cur) continue;
          m.up(db);
          db.exec(`PRAGMA user_version = ${m.version}`);
        }
        db.exec('COMMIT');
        return true;
      } catch (e) {
        if (db.isTransaction) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
        }
        throw e;
      }
    });
    if (done) return { from: cur, to: target, backup };
    if (backup) fs.rmSync(backup, { force: true }); // stale snapshot, the other process kept its own
  }
  throw new Error('migrate: could not settle schema version (too much contention)');
}

// ---------------------------------------------------------------- open

/**
 * Open (creating if needed) `<dataDir>/mentor.db`, apply pragmas and migrations.
 * @returns {{ db: DatabaseSync, dbPath: string, dataDir: string, migration }}
 */
export function openDatabase(dataDir = defaultDataDir(), { migrations = MIGRATIONS } = {}) {
  dataDir = path.resolve(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, DB_FILE);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const mode = retryBusy(() => db.prepare('PRAGMA journal_mode = WAL').get().journal_mode);
    if (String(mode).toLowerCase() !== 'wal') throw new Error(`could not enable WAL (journal_mode=${mode})`);
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    const migration = migrate(db, migrations, dataDir);
    return { db, dbPath, dataDir, migration };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    throw e;
  }
}
