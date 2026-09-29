param([long]$WindowHandle, [int]$Action, [string]$OutputPath, [string]$TriggerPath)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MotionCapture {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
}
"@
[MotionCapture]::SetProcessDPIAware() | Out-Null
$motionArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$motionFrame = New-Object System.Drawing.Bitmap($motionArea.Width, $motionArea.Height)
$motionGraphics = [System.Drawing.Graphics]::FromImage($motionFrame)
$motionTileWidth = 384
$motionTileHeight = [int]($motionTileWidth * $motionArea.Height / $motionArea.Width)
$motionSheet = New-Object System.Drawing.Bitmap(($motionTileWidth*6), (($motionTileHeight+22)*4))
$motionSheetGraphics = [System.Drawing.Graphics]::FromImage($motionSheet)
$motionSheetGraphics.Clear([System.Drawing.Color]::White)
$motionFont = New-Object System.Drawing.Font('Arial', 10)
$motionClock = [System.Diagnostics.Stopwatch]::StartNew()
for ($motionIndex=0; $motionIndex -lt 24; $motionIndex++) {
 if ($motionIndex -eq 1) {
  if ($TriggerPath) { [System.IO.File]::WriteAllText($TriggerPath,'ready') }
  else { [MotionCapture]::ShowWindowAsync([IntPtr]$WindowHandle, $Action) | Out-Null }
  $motionClock.Restart()
 }
 $motionGraphics.CopyFromScreen($motionArea.Left, $motionArea.Top, 0, 0, $motionArea.Size)
 $motionX = ($motionIndex % 6) * $motionTileWidth
 $motionY = [int][Math]::Floor($motionIndex / 6) * ($motionTileHeight+22)
 $motionRect = New-Object System.Drawing.Rectangle($motionX, $motionY, $motionTileWidth, $motionTileHeight)
 $motionSheetGraphics.DrawImage($motionFrame, $motionRect)
 $motionLabel = if ($motionIndex -eq 0) { 'before' } else { "$($motionClock.ElapsedMilliseconds) ms" }
 $motionSheetGraphics.DrawString($motionLabel, $motionFont, [System.Drawing.Brushes]::Black, $motionX, ($motionY+$motionTileHeight))
 Start-Sleep -Milliseconds 15
}
$motionSheet.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$motionFont.Dispose()
$motionSheetGraphics.Dispose()
$motionGraphics.Dispose()
$motionFrame.Dispose()
$motionSheet.Dispose()
