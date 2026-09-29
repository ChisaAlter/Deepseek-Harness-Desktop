param([long]$WindowHandle)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StyleProbe {
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h,int n);
 [DllImport("user32.dll",EntryPoint="SetWindowLongW")] public static extern int SetWindowLong(IntPtr h,int n,int v);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f);
}
"@
$cornerHandle=[IntPtr]$WindowHandle
$cornerStyle=[StyleProbe]::GetWindowLong($cornerHandle,-16)
[StyleProbe]::SetWindowLong($cornerHandle,-16,($cornerStyle -bor 0xc40000)) | Out-Null
[StyleProbe]::SetWindowPos($cornerHandle,[IntPtr]::Zero,0,0,0,0,0x37) | Out-Null
