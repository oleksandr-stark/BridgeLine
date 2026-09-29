# Installs the built panel into After Effects on Windows. Then restart AE (first install) or reopen Window > BridgeLine.jsx.
#   powershell -ExecutionPolicy Bypass -File install.ps1                  newest release build
#   powershell -ExecutionPolicy Bypass -File install.ps1 beta             After Effects (Beta)
#   powershell -ExecutionPolicy Bypass -File install.ps1 all              every After Effects found
#   powershell -ExecutionPolicy Bypass -File install.ps1 "C:\Program Files\Adobe\Adobe After Effects 2025"
# The panel folder is under Program Files, so Windows asks for administrator rights (UAC) once.
param([string]$Target = "", [switch]$Elevated)
$ErrorActionPreference = "Stop"
trap {
    Write-Host "ERROR: $_"
    if ($Elevated) { Read-Host "Press Enter to close" | Out-Null }
    exit 1
}
$src = Join-Path $PSScriptRoot "BridgeLine.jsx"
if (-not (Test-Path $src)) { throw "BridgeLine.jsx not found next to install.ps1" }

$adobe = Join-Path $env:ProgramFiles "Adobe"
$releases = @(Get-ChildItem $adobe -Directory -Filter "Adobe After Effects 20*" -ErrorAction SilentlyContinue | Sort-Object Name)
$beta = Join-Path $adobe "Adobe After Effects (Beta)"
switch ($Target) {
    ""      { $targets = @($releases | Select-Object -Last 1 | ForEach-Object { $_.FullName }) }
    "beta"  { $targets = @($beta) }
    "all"   { $targets = @($releases | ForEach-Object { $_.FullName }) + @($beta) }
    default { $targets = @($Target) }
}
if ($targets.Count -eq 0) { throw "No After Effects found in $adobe. Pass the AE folder as an argument." }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    # run this script again elevated (UAC prompt) and wait for it
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Elevated")
    if ($Target) { $argList += "`"$Target`"" }
    $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru
    exit $p.ExitCode
}

foreach ($ae in $targets) {
    $dir = Join-Path $ae "Support Files\Scripts\ScriptUI Panels"
    if (-not (Test-Path (Join-Path $ae "Support Files"))) { Write-Host "skip (not found): $ae"; continue }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item $src $dir -Force
    Write-Host "Installed into: $dir\BridgeLine.jsx"
}
# the elevated window closes on exit: keep it open so the result can be read
if ($Elevated) { Read-Host "Done. Press Enter to close" | Out-Null }
