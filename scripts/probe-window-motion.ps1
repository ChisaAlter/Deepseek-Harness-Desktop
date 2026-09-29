param([long]$WindowHandle)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowMotionProbe {
 [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int n);
 [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint p, ref ANIMATIONINFO info, uint f);
 [StructLayout(LayoutKind.Sequential)] public struct ANIMATIONINFO { public uint cbSize; public int iMinAnimate; }
}
"@
$motionStyle = [WindowMotionProbe]::GetWindowLong([IntPtr]$WindowHandle, -16)
$motionExStyle = [WindowMotionProbe]::GetWindowLong([IntPtr]$WindowHandle, -20)
$info = New-Object WindowMotionProbe+ANIMATIONINFO
$info.cbSize = 8
$ok = [WindowMotionProbe]::SystemParametersInfo(72, 8, [ref]$info, 0)
@{ caption = (($motionStyle -band 0x00c00000) -eq 0x00c00000); thickFrame = [bool]($motionStyle -band 0x40000); layered = [bool]($motionExStyle -band 0x80000); systemAnimations = $info.iMinAnimate; systemReadOk = $ok } | ConvertTo-Json -Compress
