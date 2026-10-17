# After every build (CLAUDE.md rule 3): close the old program, (re)build the installer into dist\, install it silently over the
# old one, start the INSTALLED program and prove from the title bar that it is the new version. No old process is left holding
# the single-instance lock, and nothing runs from a side folder.
#   powershell -File tools\swap-exe.ps1            close old -> install dist\...-Setup-<version>.exe -> start -> check title
#   powershell -File tools\swap-exe.ps1 -Build     close old -> npm run desktop:pack -> install -> start -> check title
# Exit code 0 = the running window's title says the version of package.json.
param(
  [switch]$Build,
  [string]$Name = "PoE-Filter-Generator-TS",
  [string]$TitleStart = "PoE1 & PoE2 Filter Generator (TypeScript)",
  [int]$TimeoutSeconds = 90
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$setup = Join-Path $root "dist\$Name-Setup-$version.exe"
$installed = Join-Path $env:LOCALAPPDATA "Programs\$Name\$Name.exe"

function Stop-Old {
  $old = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
  if ($old.Count -eq 0) { Write-Host "no old $Name running"; return }
  Write-Host "closing $($old.Count) old process(es): $(($old | ForEach-Object { $_.Id }) -join ', ')"
  foreach ($p in $old) { try { [void]$p.CloseMainWindow() } catch {} }
  Start-Sleep -Seconds 3
  Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  if (Get-Process -Name $Name -ErrorAction SilentlyContinue) { throw "old $Name processes are still running" }
}

Stop-Old
if ($Build) {
  Push-Location $root
  try { & npm run desktop:pack; if ($LASTEXITCODE -ne 0) { throw "build failed" } } finally { Pop-Location }
}
if (-not (Test-Path $setup)) { throw "$setup does not exist - run with -Build" }
Write-Host "installing $setup (silent, over the old version, for this user)"
$sw = [Diagnostics.Stopwatch]::StartNew()
$inst = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru -Wait
Write-Host "installer exit code $($inst.ExitCode) after $($sw.ElapsedMilliseconds) ms"
if ($inst.ExitCode -ne 0) { throw "installer failed" }
if (-not (Test-Path $installed)) { throw "$installed was not installed" }
# the installer starts the program itself when it finishes; start it if it did not
Start-Sleep -Seconds 2
if (-not (Get-Process -Name $Name -ErrorAction SilentlyContinue)) { Start-Process -FilePath $installed | Out-Null }
$want = "$TitleStart v$version"
$sw = [Diagnostics.Stopwatch]::StartNew()
$title = ""
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
  $hit = Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "$TitleStart*" } | Select-Object -First 1
  if ($hit) { $title = $hit.MainWindowTitle; break }
  Start-Sleep -Milliseconds 200
}
$running = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
$exes = ($running | ForEach-Object { $_.Path } | Select-Object -Unique) -join "; "
Write-Host "title: '$title'  (want '$want')  processes: $($running.Count)  from: $exes"
if ($title -ne $want) { Write-Host "FAIL: the running window is not v$version"; exit 1 }
if ($exes -ne $installed) { Write-Host "FAIL: not running from the installed folder ($installed)"; exit 1 }
Write-Host "OK: v$version is installed and running"
