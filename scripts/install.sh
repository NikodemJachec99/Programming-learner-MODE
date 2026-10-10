#!/usr/bin/env bash
# Instaluje Programming Learner MODE (Claude Code Mentor) globalnie, w user scope.
# macOS i Linux. Na Windows użyj scripts/install.ps1.
#
#   1. Sprawdza Claude Code CLI i Node.js 22.5+ (wbudowany node:sqlite).
#   2. Tworzy katalog danych i runtime.json ze ścieżkami do node:
#        macOS: ~/Library/Application Support/ClaudeCodeMentor
#        Linux: $XDG_DATA_HOME/ClaudeCodeMentor (domyślnie ~/.local/share/ClaudeCodeMentor)
#   3. Inicjalizuje bazę SQLite (migracje, WAL) i robi kopię zapasową istniejącej.
#   4. Rejestruje marketplace (ten klon albo repo na GitHubie) i instaluje pluginy w user scope.
# Skrypt jest idempotentny: kolejne uruchomienie aktualizuje instalację bez utraty danych.
#
# Użycie:
#   bash scripts/install.sh
#   bash scripts/install.sh --from-github
set -euo pipefail

FROM_GITHUB=0
for arg in "$@"; do
  case "$arg" in
    --from-github) FROM_GITHUB=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Nieznana opcja: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MENTOR_DIR="$ROOT/plugins/code-mentor"
MARKET='programming-learner-mode'
REPO='NikodemJachec99/Programming-learner-MODE'
PLUGINS='code-mentor'

if [ -n "${CLAUDE_CODE_MENTOR_DATA:-}" ]; then
  DATA_DIR="$CLAUDE_CODE_MENTOR_DATA"
elif [ "$(uname -s)" = Darwin ]; then
  DATA_DIR="$HOME/Library/Application Support/ClaudeCodeMentor"
else
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ClaudeCodeMentor"
fi

if [ -t 1 ]; then C=$'\033[36m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else C=; G=; Y=; R=; N=; fi
step() { printf '\n%s== %s%s\n' "$C" "$1" "$N"; }
ok() { printf '   %sOK%s  %s\n' "$G" "$N" "$1"; }
warn() { printf '   %s!!%s  %s\n' "$Y" "$N" "$1"; }
fail() { printf '   %sXX%s  %s\n' "$R" "$N" "$1" >&2; exit 1; }

step 'Narzędzia'
command -v claude >/dev/null 2>&1 || fail 'Brak polecenia "claude". Zainstaluj Claude Code CLI.'
ok "Claude Code CLI: $(claude --version 2>/dev/null | head -n 1)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || fail 'Brak Node.js w PATH. Wymagany Node 22.5+ (zalecany 24 LTS), np. brew install node.'
SQLITE="$("$NODE" --no-warnings -e "const {DatabaseSync}=require('node:sqlite');process.stdout.write(new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v)" 2>&1)" \
  || fail "Ten Node nie ma node:sqlite ($SQLITE). Wymagany Node 22.5+."
ok "Node $("$NODE" --version), SQLite $SQLITE"

step 'Katalog danych'
mkdir -p "$DATA_DIR/backups" "$DATA_DIR/exports"
# Claude Desktop uruchamia sesje bez PATH z powłoki, więc zapisujemy pełne ścieżki do node.
# Najpierw prawdziwa ścieżka (cel symlinku Homebrew/nvm), potem wpis z PATH.
REAL_NODE="$("$NODE" -e 'process.stdout.write(process.execPath)')"
"$NODE" -e '
  const [file, real, onPath] = process.argv.slice(1)
  const candidates = [...new Set([real, onPath, "/opt/homebrew/bin/node", "/usr/local/bin/node"])]
    .filter(p => { try { require("fs").accessSync(p, require("fs").constants.X_OK); return true } catch { return false } })
  require("fs").writeFileSync(file, JSON.stringify({ candidates, node: real, installedAt: new Date().toISOString() }, null, 2))
' "$DATA_DIR/runtime.json" "$REAL_NODE" "$NODE"
ok "Dane: $DATA_DIR"

step 'Baza SQLite'
REQ="$("$NODE" -e 'process.stdout.write(JSON.stringify({ v: 1, dataDir: process.argv[1], ops: [{ op: "init" }, { op: "backup", args: { keep: 10 } }, { op: "diag" }] }))' "$DATA_DIR")"
RES="$(printf '%s' "$REQ" | "$NODE" --no-warnings "$MENTOR_DIR/helper/mentor-db.mjs")" || fail "Helper bazy: $RES"
"$NODE" -e '
  const r = JSON.parse(process.argv[1])
  if (!r.ok) { console.error(r.error); process.exit(1) }
  const d = r.results[2].value
  console.log(`   OK  Schemat v${r.schemaVersion}, tryb ${d.journalMode}, integralność: ${d.integrity}`)
' "$RES" || fail 'Helper bazy zwrócił błąd'

step 'Marketplace'
if [ "$FROM_GITHUB" = 1 ]; then
  SOURCE="$REPO"
else
  SOURCE="$ROOT"
  claude plugin validate "$ROOT" || fail 'Walidacja marketplace nie przeszła'
fi
if claude plugin marketplace list 2>&1 | grep -q "$MARKET"; then
  claude plugin marketplace update "$MARKET"
  ok "Marketplace $MARKET już zarejestrowany"
else
  claude plugin marketplace add "$SOURCE" || fail "Nie udało się dodać marketplace $SOURCE"
fi

step 'Instalacja (user scope)'
LIST="$(claude plugin list 2>&1 || true)"
# pasek kontekstu jest teraz częścią Mentora: stary osobny plugin zdejmujemy
# do 1.4.2 plugin nazywał się claude-code-mentor; nowsze Claude Code tej nazwy nie przyjmują. Dane zostają.
if printf '%s' "$LIST" | grep -q "claude-code-mentor@$MARKET"; then
  claude plugin uninstall "claude-code-mentor@$MARKET" --scope user || true
  ok 'Usunięta stara nazwa claude-code-mentor (dane zostają, plugin to teraz code-mentor)'
fi
if printf '%s' "$LIST" | grep -q "context-bar@$MARKET"; then
  claude plugin uninstall "context-bar@$MARKET" --scope user || true
  ok 'Usunięty stary context-bar (pasek jest teraz w Mentorze)'
fi
for p in $PLUGINS; do
  id="$p@$MARKET"
  if printf '%s' "$LIST" | grep -q "$id"; then
    claude plugin update "$id" --scope user || warn "Aktualizacja $id nie powiodła się"
  else
    claude plugin install "$id" --scope user || fail "Instalacja $id nie powiodła się"
  fi
done

step 'Weryfikacja'
LIST="$(claude plugin list 2>&1 || true)"
for p in $PLUGINS; do
  if printf '%s' "$LIST" | grep -q "$p@$MARKET"; then ok "$p zainstalowany (user scope)"; else fail "$p nie jest na liście pluginów"; fi
done
printf '\n%sGotowe. Otwórz nową sesję w zakładce Code w Claude Desktop (albo "claude" w terminalu). Panel Mentor otworzy się sam, polecenie: /mentor%s\n' "$G" "$N"
