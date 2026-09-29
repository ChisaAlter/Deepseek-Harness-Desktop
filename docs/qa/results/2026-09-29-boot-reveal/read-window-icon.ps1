param([int]$ProcessId, [string]$OutputDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowIconDiagnostic {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
}
'@
$process = Get-Process -Id $ProcessId
$window = $process.MainWindowHandle
if ($window -eq 0) { throw 'The selected process has no main window.' }
foreach ($kind in 0,1,2) {
  $result = [UIntPtr]::Zero
  $sent = [WindowIconDiagnostic]::SendMessageTimeout($window, 0x7F, [UIntPtr]$kind, [IntPtr]::Zero, 2, 2000, [ref]$result)
  if ($sent -eq [IntPtr]::Zero) { throw 'WM_GETICON timed out or failed.' }
  $file = $null
  if ($result -ne [UIntPtr]::Zero) {
    $icon = [System.Drawing.Icon]::FromHandle([IntPtr]$result.ToUInt64())
    $bitmap = $icon.ToBitmap()
    $file = Join-Path $OutputDirectory "window-$ProcessId-icon-$kind.png"
    try { $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose(); $icon.Dispose() }
  }
  [pscustomobject]@{ ProcessId=$ProcessId; Window=$window.ToInt64(); Kind=$kind; Icon=$result.ToUInt64(); File=$file }
}
