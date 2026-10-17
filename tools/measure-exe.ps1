# Start time and memory of an exe, in a throw-away LOCALAPPDATA (nothing of the real machine is touched):
#   powershell -File tools\measure-exe.ps1 -Exe <path> -TitlePart "Filter Generator" [-Runs 3]
# "window" = from starting the process until a top-level window with the title appears. Memory = the sum of the private
# working sets (WorkingSetMB, shared pages counted once per process) and private bytes (PrivateMB) of the whole process tree 6 seconds after the window appeared. Every run is a fresh start of the exe.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$TitlePart = "Filter Generator",
  [int]$Runs = 3,
  [int]$IdleSeconds = 6
)
$ErrorActionPreference = "Stop"

function Get-Tree([int]$rootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($rootPid)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $grew = $true } }
  }
  return ,$ids   # (the comma keeps PowerShell from unrolling the set into an array)
}

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
  $sbx = Join-Path ([IO.Path]::GetTempPath()) ("pfg-measure-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $sbx | Out-Null
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables["LOCALAPPDATA"] = $sbx
  $psi.EnvironmentVariables["POE_FILTERGEN_DOCUMENTS"] = $sbx
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = [Diagnostics.Process]::Start($psi)
  $winMs = $null
  while ($sw.Elapsed.TotalSeconds -lt 90) {
    $ids = Get-Tree $proc.Id
    $hit = Get-Process | Where-Object { $ids.Contains($_.Id) -and $_.MainWindowTitle -like "*$TitlePart*" } | Select-Object -First 1
    if ($hit) { $winMs = [int]$sw.ElapsedMilliseconds; break }
    Start-Sleep -Milliseconds 25
  }
  $title = if ($hit) { $hit.MainWindowTitle } else { "" }
  Start-Sleep -Seconds $IdleSeconds
  $ids = Get-Tree $proc.Id
  $mem = 0; $priv = 0
  foreach ($p in (Get-Process | Where-Object { $ids.Contains($_.Id) })) { $mem += $p.WorkingSet64; $priv += $p.PrivateMemorySize64 }
  $count = ($ids | Measure-Object).Count
  foreach ($id in $ids) { try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Milliseconds 800
  Remove-Item -Recurse -Force $sbx -ErrorAction SilentlyContinue
  $results += [pscustomobject]@{ Run = $i; WindowMs = $winMs; WorkingSetMB = [math]::Round($mem / 1MB, 1); PrivateMB = [math]::Round($priv / 1MB, 1); Processes = $count; Title = $title }
}
$results | Format-Table -AutoSize | Out-String | Write-Host
$sizeMB = [math]::Round((Get-Item $Exe).Length / 1MB, 1)
Write-Host "exe size: $sizeMB MB"
