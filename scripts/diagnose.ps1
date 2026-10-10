<#
.SYNOPSIS
  Diagnostyka Programming Learner MODE. Niczego nie zmienia.
#>
$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $env:LOCALAPPDATA 'ClaudeCodeMentor'
$Market = 'programming-learner-mode'
function Line($k, $v, $ok = $true) { Write-Host ('{0,-26} {1}' -f $k, $v) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) }

Write-Host "Programming Learner MODE: diagnostyka`n" -ForegroundColor Cyan
$claude = Get-Command claude -ErrorAction SilentlyContinue
Line 'Claude Code CLI' $(if ($claude) { (& claude --version) -join ' ' } else { 'BRAK' }) ([bool]$claude)

$rt = Join-Path $DataDir 'runtime.json'
$runtime = if (Test-Path $rt) { Get-Content $rt -Raw | ConvertFrom-Json } else { $null }
Line 'runtime.json' $(if ($runtime) { "$($runtime.candidates.Count) kandydatów node" } else { 'brak (uruchom install.ps1)' }) ([bool]$runtime)
$node = @($runtime.candidates) + @('node') | Where-Object { $_ -and (($_ -eq 'node') -or (Test-Path $_)) } | Select-Object -First 1
Line 'Node.js' "$(& $node --version 2>&1) ($node)" ($LASTEXITCODE -eq 0)

$req = @{ v = 1; dataDir = $DataDir; ops = @(@{ op = 'diag' }) } | ConvertTo-Json -Depth 5 -Compress
try {
  $d = (($req | & $node --no-warnings (Join-Path $Root 'plugins\code-mentor\helper\mentor-db.mjs')) | ConvertFrom-Json).results[0].value
  Line 'Baza' "$DataDir\mentor.db"
  Line 'Schemat / SQLite' "v$($d.schemaVersion) / $($d.sqliteVersion) / $($d.journalMode)"
  Line 'Integralność' $d.integrity ($d.integrity -eq 'ok')
  $d.counts.PSObject.Properties | ForEach-Object { Line ('  ' + $_.Name) $_.Value }
} catch { Line 'Baza' "BŁĄD: $_" $false }

$list = (& claude plugin list 2>&1) -join "`n"
foreach ($p in 'code-mentor') {
  $ok = $list -match [regex]::Escape("$p@$Market")
  Line $p $(if ($ok) { 'zainstalowany' } else { 'nie zainstalowany' }) $ok
}
