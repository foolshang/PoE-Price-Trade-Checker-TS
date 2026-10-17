# After every build (CLAUDE.md rule 3): close the old exe, (re)build into dist\, start the new one and prove from the title bar
# that it is the new version. Nothing is left in a side folder, and no old process is left holding the single-instance lock.
#   powershell -File tools\swap-exe.ps1            close old -> start dist\PoE-Filter-Generator-TS.exe -> check title
#   powershell -File tools\swap-exe.ps1 -Build     close old -> npm run desktop:pack -> start -> check title
# Exit code 0 = the running window's title says the version of package.json.
param(
  [switch]$Build,
  [string]$Name = "PoE-Filter-Generator-TS",
  [string]$TitleStart = "PoE1 & PoE2 Filter Generator (TypeScript)",
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "dist\$Name.exe"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version

function Stop-Old {
  # the portable exe and its unpacked child have the same name: close every process of this app
  $old = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
  if ($old.Count -eq 0) { Write-Host "no old $Name running"; return }
  Write-Host "closing $($old.Count) old process(es): $(($old | ForEach-Object { $_.Id }) -join ', ')"
  foreach ($p in $old) { try { [void]$p.CloseMainWindow() } catch {} }
  Start-Sleep -Seconds 2
  Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  if (Get-Process -Name $Name -ErrorAction SilentlyContinue) { throw "old $Name processes are still running" }
}

Stop-Old
if ($Build) {
  Push-Location $root
  try { & npm run desktop:pack; if ($LASTEXITCODE -ne 0) { throw "build failed" } } finally { Pop-Location }
}
if (-not (Test-Path $exe)) { throw "$exe does not exist - run with -Build" }
$built = (Get-Item $exe).LastWriteTime
Write-Host "starting $exe (built $built)"
$proc = Start-Process -FilePath $exe -PassThru
$want = "$TitleStart v$version"
$sw = [Diagnostics.Stopwatch]::StartNew()
$title = ""
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
  $hit = Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "$TitleStart*" } | Select-Object -First 1
  if ($hit) { $title = $hit.MainWindowTitle; break }
  Start-Sleep -Milliseconds 200
}
$running = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
Write-Host "title: '$title'  (want '$want')  processes: $($running.Count)"
if ($title -ne $want) { Write-Host "FAIL: the running window is not v$version"; exit 1 }
Write-Host "OK: v$version is running ($($sw.ElapsedMilliseconds) ms to the window)"
