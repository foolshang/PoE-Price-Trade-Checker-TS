param([string]$File, [string]$Title, [string]$Ready, [string]$KeyLog)
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
$select = { $t.Focus(); $t.SelectAll() }
$f.Add_Shown({ & $select; $tm = New-Object System.Windows.Forms.Timer; $tm.Interval = 600; $tm.Add_Tick({ $tm.Stop(); & $select; [IO.File]::WriteAllText($Ready, "ready") }); $tm.Start() })
$f.Add_Activated($select)
[void]$f.ShowDialog()
