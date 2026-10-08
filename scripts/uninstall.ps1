<#
.SYNOPSIS
  Odinstalowuje pluginy. Domyślnie ZACHOWUJE dane nauki.

.PARAMETER DeleteData
  Trwale usuwa %LOCALAPPDATA%\ClaudeCodeMentor. Wcześniej zapisuje eksport JSON na Pulpicie.

.PARAMETER KeepMarketplace
  Nie wyrejestrowuje marketplace (łatwiejsza ponowna instalacja).
#>
[CmdletBinding()]
param([switch]$DeleteData, [switch]$KeepMarketplace)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $env:LOCALAPPDATA 'ClaudeCodeMentor'
$Market = 'programming-learner-mode'

foreach ($p in 'claude-code-mentor', 'context-bar') {
  & claude plugin uninstall "$p@$Market" --scope user 2>&1 | Out-Host
}
if (-not $KeepMarketplace) { & claude plugin marketplace remove $Market 2>&1 | Out-Host }

if ($DeleteData -and (Test-Path $DataDir)) {
  $export = Join-Path ([Environment]::GetFolderPath('Desktop')) ("mentor-export-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $req = @{ v = 1; dataDir = $DataDir; ops = @(@{ op = 'export'; args = @{ path = $export } }) } | ConvertTo-Json -Depth 5 -Compress
  $req | & node --no-warnings (Join-Path $Root 'plugins\claude-code-mentor\helper\mentor-db.mjs') | Out-Null
  if (Test-Path $export) { Write-Host "Eksport przed usunięciem: $export" -ForegroundColor Yellow }
  Remove-Item -Recurse -Force $DataDir
  Write-Host "Usunięto dane: $DataDir" -ForegroundColor Yellow
} else {
  Write-Host "Dane nauki zostają w $DataDir. Ponowna instalacja je podchwyci." -ForegroundColor Green
}
