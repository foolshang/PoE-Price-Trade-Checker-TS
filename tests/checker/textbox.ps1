param([string]$File, [string]$Title, [string]$Ready, [string]$KeyLog, [string]$Grab = "")
# A plain window with one text box holding the file, all of it selected - what F5 copies from in the tests. It stands in for the game:
# Ctrl + anything + C copies (like the game's detailed copy), and every key event is written to $KeyLog as "<ms> D|U <virtual key>".
Add-Type -AssemblyName System.Windows.Forms
$freq = [Diagnostics.Stopwatch]::Frequency
$f = New-Object System.Windows.Forms.Form
$f.Text = $Title
$f.Width = 700; $f.Height = 500
$f.TopMost = $true
$f.StartPosition = "CenterScreen"
$f.KeyPreview = $true
$t = New-Object System.Windows.Forms.TextBox
$t.Multiline = $true; $t.Dock = "Fill"; $t.AcceptsReturn = $true; $t.HideSelection = $false
$t.Text = ([IO.File]::ReadAllText($File) -replace "`r?`n", "`r`n")
$f.Controls.Add($t)
$f.ActiveControl = $t
$logKey = { param($kind, $vk) if ($KeyLog) { $ms = [math]::Round([Diagnostics.Stopwatch]::GetTimestamp() * 1000.0 / $freq, 2); [IO.File]::AppendAllText($KeyLog, "$ms $kind $vk`n") } }
$f.Add_KeyDown({ param($s, $e) & $logKey "D" $e.KeyValue; if ($e.Control -and $e.KeyCode -eq 'C') { $t.Copy(); $e.SuppressKeyPress = $true } })
$f.Add_KeyUp({ param($s, $e) & $logKey "U" $e.KeyValue })
$t.Add_MouseDown({ & $logKey "M" 0 })
$select = { $t.Focus(); $t.SelectAll() }
$f.Add_Shown({ & $select; $tm = New-Object System.Windows.Forms.Timer; $tm.Interval = 600; $tm.Add_Tick({ $tm.Stop(); & $select; [IO.File]::WriteAllText($Ready, "ready") }); $tm.Start() })
$f.Add_Activated($select)
# -Grab 1: behaves like a game that takes the foreground back whenever it loses it (and puts itself on top again)
if ($Grab -eq "1") {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Fg { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags); }'
  $g = New-Object System.Windows.Forms.Timer
  $g.Interval = 120
  $g.Add_Tick({ $g.Stop(); [void][Fg]::SetWindowPos($f.Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0013); [void][Fg]::SetForegroundWindow($f.Handle) })
  $f.Add_Deactivate({ $g.Start() })
}
[void]$f.ShowDialog()
