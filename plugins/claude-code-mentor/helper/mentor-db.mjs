#!/usr/bin/env node
// CLI entry of the Claude Code Mentor persistence helper.
//   node --no-warnings mentor-db.mjs  < request.json
// stdin:  { "v": 1, "dataDir"?: string, "ops": [ { "op": string, "args"?: object } ] }
// stdout: exactly ONE line of JSON:
//   { ok: true, schemaVersion, results: [ { ok: true, value } | { ok: false, error } ] }
//   or, on a fatal problem (bad JSON, cannot open DB): { ok: false, error } with exit code 1.

// Nothing but the final response may reach stdout.
console.log = console.info = console.debug = console.warn = (...a) => console.error(...a);

const MAX_STDIN = 64 * 1024 * 1024;
let answered = false;

function respond(obj, code) {
  if (answered) return;
  answered = true;
  let line;
  try {
    line = JSON.stringify(obj);
  } catch (e) {
    line = JSON.stringify({ ok: false, error: `cannot serialise response: ${e.message}` });
    code = 1;
  }
  process.exitCode = code;
  process.stdout.write(line + '\n');
}

process.on('uncaughtException', (e) => {
  respond({ ok: false, error: `internal error: ${e?.message ?? e}` }, 1);
});

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > MAX_STDIN) throw new Error(`stdin larger than ${MAX_STDIN} bytes`);
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
}

async function main() {
  let text;
  try {
    text = await readStdin();
  } catch (e) {
    return respond({ ok: false, error: `cannot read stdin: ${e.message}` }, 1);
  }
  let req;
  try {
    req = JSON.parse(text);
  } catch (e) {
    return respond({ ok: false, error: `bad JSON on stdin: ${e.message}` }, 1);
  }
  let executeBatch;
  try {
    ({ executeBatch } = await import('./ops.mjs'));
  } catch (e) {
    return respond({ ok: false, error: `cannot load helper (node:sqlite missing?): ${e.message}` }, 1);
  }
  const res = executeBatch(req);
  respond(res, res.ok ? 0 : 1);
}

main().catch((e) => respond({ ok: false, error: `internal error: ${e?.message ?? e}` }, 1));
