param([long]$WindowHandle, [string]$OutputPath)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DesktopFrameCapture {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 public struct RECT {public int Left,Top,Right,Bottom;}
}
'@
[DesktopFrameCapture]::SetProcessDPIAware() | Out-Null
[DesktopFrameCapture]::ShowWindowAsync([IntPtr]$WindowHandle,5) | Out-Null
[DesktopFrameCapture]::SetForegroundWindow([IntPtr]$WindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
$captureRect=New-Object DesktopFrameCapture+RECT
if(-not [DesktopFrameCapture]::GetWindowRect([IntPtr]$WindowHandle,[ref]$captureRect)){throw 'GetWindowRect failed'}
$captureBitmap=New-Object System.Drawing.Bitmap(($captureRect.Right-$captureRect.Left+16),($captureRect.Bottom-$captureRect.Top+16))
$captureGraphics=[System.Drawing.Graphics]::FromImage($captureBitmap)
$captureGraphics.CopyFromScreen($captureRect.Left-8,$captureRect.Top-8,0,0,$captureBitmap.Size)
$captureBitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
$captureGraphics.Dispose();$captureBitmap.Dispose()
