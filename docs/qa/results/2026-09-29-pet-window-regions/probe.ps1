param([long]$WindowHandle, [switch]$Move, [switch]$Click, [switch]$Down, [switch]$Up, [int]$X, [int]$Y)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class PetRegionProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr w, IntPtr r);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
  [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr r, out Rect box);
  [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr r, int x, int y);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
if ($Move -or $Click -or $Down -or $Up) { [void][PetRegionProbe]::SetCursorPos($X,$Y) }
if ($Click -or $Down) { [PetRegionProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero) }
if ($Click -or $Up) { [PetRegionProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
$region = [PetRegionProbe]::CreateRectRgn(0,0,0,0)
try {
  $kind = [PetRegionProbe]::GetWindowRgn([IntPtr]$WindowHandle, $region)
  $box = New-Object PetRegionProbe+Rect
  [void][PetRegionProbe]::GetRgnBox($region, [ref]$box)
  [pscustomobject]@{ kind = $kind; box = $box } | ConvertTo-Json -Compress
} finally { [void][PetRegionProbe]::DeleteObject($region) }
