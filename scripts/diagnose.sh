#!/usr/bin/env bash
# Diagnostyka Programming Learner MODE na macOS i Linuxie. Niczego nie zmienia.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKET='programming-learner-mode'
if [ -n "${CLAUDE_CODE_MENTOR_DATA:-}" ]; then
  DATA_DIR="$CLAUDE_CODE_MENTOR_DATA"
elif [ "$(uname -s)" = Darwin ]; then
  DATA_DIR="$HOME/Library/Application Support/ClaudeCodeMentor"
else
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ClaudeCodeMentor"
fi
if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; N=$'\033[0m'; else G=; R=; N=; fi
line() { if [ "${3:-1}" = 1 ]; then printf '%s%-26s %s%s\n' "$G" "$1" "$2" "$N"; else printf '%s%-26s %s%s\n' "$R" "$1" "$2" "$N"; fi; }

echo "Programming Learner MODE: diagnostyka"
echo
if command -v claude >/dev/null 2>&1; then line 'Claude Code CLI' "$(claude --version 2>/dev/null | head -n 1)"; else line 'Claude Code CLI' 'BRAK' 0; fi

RT="$DATA_DIR/runtime.json"
NODE=''
if [ -f "$RT" ] && command -v node >/dev/null 2>&1; then
  NODE="$(node -e '
    const fs = require("fs")
    const rt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const ok = (rt.candidates || []).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false } })
    process.stdout.write(ok || "")
  ' "$RT")"
  line 'runtime.json' "$RT"
else
  line 'runtime.json' 'brak (uruchom scripts/install.sh)' 0
fi
[ -n "$NODE" ] || NODE="$(command -v node || true)"
if [ -n "$NODE" ]; then line 'Node.js' "$("$NODE" --version) ($NODE)"; else line 'Node.js' 'BRAK' 0; fi

if [ -n "$NODE" ]; then
  REQ="$("$NODE" -e 'process.stdout.write(JSON.stringify({ v: 1, dataDir: process.argv[1], ops: [{ op: "diag" }] }))' "$DATA_DIR")"
  RES="$(printf '%s' "$REQ" | "$NODE" --no-warnings "$ROOT/plugins/claude-code-mentor/helper/mentor-db.mjs" 2>&1)"
  "$NODE" -e '
    const [res, dir] = process.argv.slice(1)
    const G = process.stdout.isTTY ? "\x1b[32m" : "", R = process.stdout.isTTY ? "\x1b[31m" : "", N = process.stdout.isTTY ? "\x1b[0m" : ""
    const line = (k, v, ok = true) => console.log(`${ok ? G : R}${k.padEnd(26)} ${v}${N}`)
    try {
      const r = JSON.parse(res)
      if (!r.ok) throw new Error(r.error)
      const d = r.results[0].value
      line("Baza", `${dir}/mentor.db`)
      line("Schemat / SQLite", `v${d.schemaVersion} / ${d.sqliteVersion} / ${d.journalMode}`)
      line("Integralność", d.integrity, d.integrity === "ok")
      for (const [k, v] of Object.entries(d.counts || {})) line(`  ${k}`, v)
    } catch (e) { line("Baza", `BŁĄD: ${e.message}`, false) }
  ' "$RES" "$DATA_DIR"
fi

LIST="$(claude plugin list 2>&1 || true)"
for p in claude-code-mentor; do
  if printf '%s' "$LIST" | grep -q "$p@$MARKET"; then line "$p" 'zainstalowany'; else line "$p" 'nie zainstalowany' 0; fi
done
