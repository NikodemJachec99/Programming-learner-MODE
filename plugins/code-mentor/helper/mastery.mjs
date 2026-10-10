// Pure mastery / spaced-repetition model. No I/O, no clock: every function that
// needs time takes `now` (ms since epoch) explicitly, so results are deterministic.
//
// Rows passed in have the shape of a `knowledge` table row. `correct_days` may be
// given either as an array (`correct_days`) or as JSON text (`correct_days_json`).

export const DAY_MS = 86_400_000;

export const LEVELS = Object.freeze([
  'Nie znam',
  'Uczę się',
  'Rozumiem częściowo',
  'Potrafię zastosować',
  'Opanowane',
]);

export const GRADED_KINDS = Object.freeze(['correct', 'partial', 'incorrect']);
export const EVIDENCE_KINDS = Object.freeze([
  'exposure_claude',
  'lesson_read',
  'sim_experiment',
  'self_report_known',
  'self_report_unknown',
  ...GRADED_KINDS,
]);
export const TASKS = Object.freeze(['choice', 'predict', 'diagnose', 'explain', 'apply']);
export const STRONG_TASKS = Object.freeze(['predict', 'diagnose', 'explain', 'apply']);
export const TASK_WEIGHT = Object.freeze({
  choice: 0.2,
  predict: 0.35,
  diagnose: 0.35,
  explain: 0.35,
  apply: 0.45,
});
export const VERDICT_TARGET = Object.freeze({ correct: 1, partial: 0.5, incorrect: 0 });

export const CONFIDENCE_CAP = 0.97;
export const CONFIDENCE_HALF_LIFE_DAYS = 60; // decay constant (e-folding), not a true half-life
export const MAX_INTERVAL_DAYS = 180;
export const MAX_EASE = 3.0;
export const MIN_EASE = 1.3;
export const CORRECT_DAYS_KEEP = 30;
export const MISCONCEPTION_RESOLVE_AFTER = 2;
export const MISCONCEPTION_EXAMPLES_KEEP = 5;

export function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Local-time calendar day 'YYYY-MM-DD' of `now`. */
export function localDay(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function correctDaysOf(row) {
  if (Array.isArray(row?.correct_days)) return row.correct_days.slice();
  const raw = row?.correct_days_json;
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function gradedCount(row) {
  return (row.correct || 0) + (row.partial || 0) + (row.incorrect || 0);
}

/** Self-reported "known" is the only way mastery can be > 0 without any graded answer. */
export function isSelfReportedKnown(row) {
  return gradedCount(row) === 0 && (row.mastery || 0) > 0;
}

export function levelFor(row) {
  const mastery = row.mastery || 0;
  const correct = row.correct || 0;
  const strong = row.strong_correct || 0;
  const days = new Set(correctDaysOf(row)).size;
  if (mastery >= 0.85 && correct >= 3 && days >= 2 && strong >= 1) return 4;
  if (mastery >= 0.65 && correct >= 2 && strong >= 1) return 3;
  if (mastery >= 0.35 && correct >= 1) return 2;
  if ((row.engagements || 0) > 0 || gradedCount(row) > 0 || isSelfReportedKnown(row)) return 1;
  return 0;
}

export function effectiveConfidence(row, now) {
  if (row.last_verified_at == null) return 0;
  const days = Math.max(0, (now - row.last_verified_at) / DAY_MS);
  return (row.confidence || 0) * Math.exp(-days / CONFIDENCE_HALF_LIFE_DAYS);
}

export function isDue(row, now) {
  return row.next_review_at != null && row.next_review_at <= now;
}

export function confidenceFor(n) {
  return Math.min(CONFIDENCE_CAP, 1 - Math.pow(0.7, n));
}

/** SM-2-like scheduling step. Uses the ease *before* this answer to grow the interval. */
export function scheduleNext({ interval_days = 0, ease = 2.5 }, verdict, now) {
  let interval = Number(interval_days) || 0;
  let e = Number(ease) || 2.5;
  if (verdict === 'correct') {
    interval = interval === 0 ? 1 : Math.min(MAX_INTERVAL_DAYS, interval * e);
    e = Math.min(MAX_EASE, e + 0.05);
  } else if (verdict === 'partial') {
    interval = Math.max(1, interval * 0.6);
    e = Math.max(MIN_EASE, e - 0.15);
  } else if (verdict === 'incorrect') {
    interval = 0.5;
    e = Math.max(MIN_EASE, e - 0.2);
  } else {
    throw new Error(`scheduleNext: not a graded verdict: ${verdict}`);
  }
  return { interval_days: interval, ease: e, next_review_at: Math.round(now + interval * DAY_MS) };
}

export function emptyKnowledge(conceptId) {
  return {
    concept_id: conceptId,
    mastery: 0,
    confidence: 0,
    level: 0,
    exposures: 0,
    engagements: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
    strong_correct: 0,
    correct_days_json: '[]',
    last_evidence_at: null,
    last_verified_at: null,
    next_review_at: null,
    interval_days: 0,
    ease: 2.5,
    notes: null,
    updated_at: null,
  };
}

/**
 * Apply one piece of evidence to a knowledge row.
 * @returns {{ row, changed, ignored, levelBefore, levelAfter, masteryBefore, masteryAfter }}
 *   `row` is a new object (input untouched) with `correct_days_json` as JSON text.
 */
export function applyEvidence(row, evidence, now) {
  const { kind, task } = evidence || {};
  if (!EVIDENCE_KINDS.includes(kind)) throw new Error(`unknown evidence kind: ${kind}`);
  if (GRADED_KINDS.includes(kind) && !TASKS.includes(task)) {
    throw new Error(`graded evidence '${kind}' needs task in ${TASKS.join('|')}, got: ${task}`);
  }
  if (!Number.isFinite(now)) throw new Error('applyEvidence: now must be a finite number');

  const prev = { ...emptyKnowledge(row?.concept_id), ...row };
  const days = correctDaysOf(prev);
  const next = { ...prev };
  delete next.correct_days;
  const levelBefore = Number.isInteger(prev.level) ? prev.level : levelFor(prev);
  const masteryBefore = prev.mastery || 0;
  let ignored = false;

  switch (kind) {
    case 'exposure_claude':
      next.exposures = (prev.exposures || 0) + 1;
      break;
    case 'lesson_read':
    case 'sim_experiment':
      next.engagements = (prev.engagements || 0) + 1;
      break;
    case 'self_report_known':
    case 'self_report_unknown':
      if (gradedCount(prev) === 0) {
        next.mastery = kind === 'self_report_known' ? 0.3 : 0.0;
        next.confidence = 0.1;
      } else {
        ignored = true;
      }
      break;
    default: {
      // graded
      const w = TASK_WEIGHT[task];
      const t = VERDICT_TARGET[kind];
      next.mastery = clamp01(masteryBefore + w * (t - masteryBefore));
      next[kind] = (prev[kind] || 0) + 1;
      if (kind === 'correct') {
        if (STRONG_TASKS.includes(task)) next.strong_correct = (prev.strong_correct || 0) + 1;
        const day = localDay(now);
        const set = days.filter((d) => d !== day);
        set.push(day);
        days.length = 0;
        days.push(...set.slice(-CORRECT_DAYS_KEEP));
      }
      next.confidence = confidenceFor(gradedCount(next));
      Object.assign(next, scheduleNext(prev, kind, now));
      next.last_verified_at = now;
    }
  }

  if (ignored) {
    return {
      row: { ...next, correct_days_json: JSON.stringify(days) },
      changed: false,
      ignored: true,
      levelBefore,
      levelAfter: levelBefore,
      masteryBefore,
      masteryAfter: masteryBefore,
    };
  }

  next.correct_days_json = JSON.stringify(days);
  next.level = levelFor(next);
  next.last_evidence_at = now;
  next.updated_at = now;
  return {
    row: next,
    changed: true,
    ignored: false,
    levelBefore,
    levelAfter: next.level,
    masteryBefore,
    masteryAfter: next.mastery,
  };
}

function parseArr(v) {
  if (Array.isArray(v)) return v.slice();
  if (typeof v !== 'string') return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

/**
 * A misconception was observed again (or for the first time) on incorrect/partial evidence.
 * `existing` is the DB row or null. Returns the new row values (JSON columns as text).
 */
export function hitMisconception(existing, m, projectId, now) {
  const examples = parseArr(existing?.examples_json);
  if (m.example !== undefined && m.example !== null) examples.push(m.example);
  const projects = parseArr(existing?.project_ids_json);
  if (projectId && !projects.includes(projectId)) projects.push(projectId);
  return {
    key: m.key,
    description: m.description ?? existing?.description ?? null,
    count: existing ? (existing.count || 0) + 1 : 1,
    correct_since: 0,
    first_seen: existing?.first_seen ?? now,
    last_seen: now,
    resolved_at: null,
    examples_json: JSON.stringify(examples.slice(-MISCONCEPTION_EXAMPLES_KEEP)),
    project_ids_json: JSON.stringify(projects),
  };
}

/** A correct answer on the concept counts towards resolving an unresolved misconception. */
export function correctAgainstMisconception(row, now) {
  if (row.resolved_at != null) return { correct_since: row.correct_since, resolved_at: row.resolved_at };
  const correct_since = (row.correct_since || 0) + 1;
  return {
    correct_since,
    resolved_at: correct_since >= MISCONCEPTION_RESOLVE_AFTER ? now : null,
  };
}
