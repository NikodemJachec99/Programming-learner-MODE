#!/usr/bin/env bash
# Odinstalowuje pluginy. Domyślnie ZACHOWUJE dane nauki. macOS i Linux.
#
#   --delete-data       trwale usuwa katalog danych, wcześniej zapisuje eksport JSON w ~/Desktop (albo ~)
#   --keep-marketplace  nie wyrejestrowuje marketplace (łatwiejsza ponowna instalacja)
set -euo pipefail

DELETE_DATA=0
KEEP_MARKET=0
for arg in "$@"; do
  case "$arg" in
    --delete-data) DELETE_DATA=1 ;;
    --keep-marketplace) KEEP_MARKET=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Nieznana opcja: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKET='programming-learner-mode'
if [ -n "${CLAUDE_CODE_MENTOR_DATA:-}" ]; then
  DATA_DIR="$CLAUDE_CODE_MENTOR_DATA"
elif [ "$(uname -s)" = Darwin ]; then
  DATA_DIR="$HOME/Library/Application Support/ClaudeCodeMentor"
else
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ClaudeCodeMentor"
fi

for p in claude-code-mentor context-bar; do
  claude plugin uninstall "$p@$MARKET" --scope user 2>&1 || true
done
[ "$KEEP_MARKET" = 1 ] || claude plugin marketplace remove "$MARKET" 2>&1 || true

if [ "$DELETE_DATA" = 1 ] && [ -d "$DATA_DIR" ]; then
  DEST="$HOME/Desktop"
  [ -d "$DEST" ] || DEST="$HOME"
  EXPORT="$DEST/mentor-export-$(date +%Y%m%d-%H%M%S).json"
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify({ v: 1, dataDir: process.argv[1], ops: [{ op: "export", args: { path: process.argv[2] } }] }))' "$DATA_DIR" "$EXPORT" \
      | node --no-warnings "$ROOT/plugins/claude-code-mentor/helper/mentor-db.mjs" >/dev/null || true
  fi
  [ -f "$EXPORT" ] && echo "Eksport przed usunięciem: $EXPORT"
  rm -rf "$DATA_DIR"
  echo "Usunięto dane: $DATA_DIR"
else
  echo "Dane nauki zostają w $DATA_DIR. Ponowna instalacja je podchwyci."
fi
