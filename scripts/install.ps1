<#
.SYNOPSIS
  Instaluje Programming Learner MODE (Claude Code Mentor) globalnie, w user scope.

.DESCRIPTION
  1. Sprawdza Claude Code CLI i Node.js 22.5+ (wbudowany node:sqlite).
  2. Tworzy %LOCALAPPDATA%\ClaudeCodeMentor i runtime.json z kandydatami na node.exe.
  3. Inicjalizuje bazę SQLite (migracje, WAL) i robi kopię zapasową istniejącej.
  4. Rejestruje marketplace (ten klon albo repo na GitHubie) i instaluje pluginy w user scope.
  Skrypt jest idempotentny: kolejne uruchomienie aktualizuje instalację bez utraty danych.

.PARAMETER FromGitHub
  Rejestruje marketplace z GitHuba (NikodemJachec99/Programming-learner-MODE) zamiast lokalnego klonu.

.EXAMPLE
  pwsh -File scripts\install.ps1
.EXAMPLE
  pwsh -File scripts\install.ps1 -FromGitHub
#>
[CmdletBinding()]
param(
  [switch]$FromGitHub
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$MentorDir = Join-Path $Root 'plugins\claude-code-mentor'
$DataDir = Join-Path $env:LOCALAPPDATA 'ClaudeCodeMentor'
$Market = 'programming-learner-mode'
$Repo = 'NikodemJachec99/Programming-learner-MODE'
$Plugins = @('claude-code-mentor')

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   !!  $t" -ForegroundColor Yellow }
function Fail($t) { Write-Host "   XX  $t" -ForegroundColor Red; exit 1 }

Step 'Narzędzia'
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail 'Brak polecenia "claude". Zainstaluj Claude Code CLI.' }
Ok "Claude Code CLI: $((& claude --version) -join ' ')"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Brak Node.js w PATH. Wymagany Node 22.5+ (zalecany 24 LTS).' }
$sqlite = & $node.Source --no-warnings -e "const {DatabaseSync}=require('node:sqlite');process.stdout.write(new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v)" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Ten Node nie ma node:sqlite ($sqlite). Wymagany Node 22.5+." }
Ok "Node $((& $node.Source --version).Trim()), SQLite $sqlite"

Step 'Katalog danych'
New-Item -ItemType Directory -Force -Path $DataDir, (Join-Path $DataDir 'backups'), (Join-Path $DataDir 'exports') | Out-Null
# Najpierw prawdziwe ścieżki (cel symlinku nvm), potem wpisy z PATH: proces sesji
# Claude Desktop nie zawsze uruchamia node przez symlink katalogu.
$candidates = New-Object System.Collections.Generic.List[string]
foreach ($src in (Get-Command node -All -ErrorAction SilentlyContinue).Source) {
  $item = Get-Item (Split-Path -Parent $src) -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -and $item.Target) {
    $real = Join-Path ([string]$item.Target) 'node.exe'
    if ((Test-Path $real) -and -not $candidates.Contains($real)) { $candidates.Add($real) }
  }
  if (-not $candidates.Contains($src)) { $candidates.Add($src) }
}
[ordered]@{ candidates = $candidates.ToArray(); node = $node.Source; installedAt = (Get-Date).ToString('o') } |
  ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $DataDir 'runtime.json')
Ok "Dane: $DataDir"

Step 'Baza SQLite'
$req = @{ v = 1; dataDir = $DataDir; ops = @(@{ op = 'init' }, @{ op = 'backup'; args = @{ keep = 10 } }, @{ op = 'diag' }) } | ConvertTo-Json -Depth 5 -Compress
$res = ($req | & $node.Source --no-warnings (Join-Path $MentorDir 'helper\mentor-db.mjs')) | ConvertFrom-Json
if (-not $res.ok) { Fail "Helper bazy: $($res.error)" }
Ok "Schemat v$($res.schemaVersion), tryb $($res.results[2].value.journalMode), integralność: $($res.results[2].value.integrity)"

Step 'Marketplace'
$source = if ($FromGitHub) { $Repo } else { $Root }
if (-not $FromGitHub) {
  & claude plugin validate $Root | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'Walidacja marketplace nie przeszła' }
}
$markets = (& claude plugin marketplace list 2>&1) -join "`n"
if ($markets -notmatch [regex]::Escape($Market)) {
  & claude plugin marketplace add $source | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "Nie udało się dodać marketplace $source" }
} else {
  & claude plugin marketplace update $Market | Out-Host
  Ok "Marketplace $Market już zarejestrowany"
}

Step 'Instalacja (user scope)'
$list = (& claude plugin list 2>&1) -join "`n"
# pasek kontekstu jest teraz częścią Mentora: stary osobny plugin zdejmujemy
if ($list -match [regex]::Escape("context-bar@$Market")) { & claude plugin uninstall "context-bar@$Market" --scope user | Out-Host; Ok 'Usunięty stary context-bar (pasek jest teraz w Mentorze)' }
foreach ($p in $Plugins) {
  $id = "$p@$Market"
  if ($list -match [regex]::Escape($id)) { & claude plugin update $id --scope user | Out-Host }
  else {
    & claude plugin install $id --scope user | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "Instalacja $id nie powiodła się" }
  }
}

Step 'Weryfikacja'
$list = (& claude plugin list 2>&1) -join "`n"
foreach ($p in $Plugins) {
  if ($list -match [regex]::Escape("$p@$Market")) { Ok "$p zainstalowany (user scope)" } else { Fail "$p nie jest na liście pluginów" }
}
Write-Host "`nGotowe. Otwórz nową sesję w zakładce Code w Claude Desktop (albo 'claude' w terminalu). Panel Mentor otworzy się sam, polecenie: /mentor" -ForegroundColor Green
