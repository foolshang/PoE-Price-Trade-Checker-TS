param([string]$File, [string]$Title, [string]$Ready)
# A plain window with one text box holding the file, all of it selected - what F5 copies from in the tests.
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = $Title
$f.Width = 700; $f.Height = 500
$f.TopMost = $true
$f.StartPosition = "CenterScreen"
$t = New-Object System.Windows.Forms.TextBox
$t.Multiline = $true; $t.Dock = "Fill"; $t.AcceptsReturn = $true; $t.HideSelection = $false
$t.Text = ([IO.File]::ReadAllText($File) -replace "`r?`n", "`r`n")
$f.Controls.Add($t)
$f.ActiveControl = $t
$select = { $t.Focus(); $t.SelectAll() }
$f.Add_Shown({ & $select; $tm = New-Object System.Windows.Forms.Timer; $tm.Interval = 600; $tm.Add_Tick({ $tm.Stop(); & $select; [IO.File]::WriteAllText($Ready, "ready") }); $tm.Start() })
$f.Add_Activated($select)
[void]$f.ShowDialog()
