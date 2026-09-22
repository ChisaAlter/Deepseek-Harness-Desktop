@echo off
setlocal EnableExtensions
title ChisaCode Desktop

cd /d "C:\Ai\ChisaCode"
if errorlevel 1 (
  echo [ChisaCode] Cannot open C:\Ai\ChisaCode
  pause
  exit /b 1
)

set "PATH=C:\Program Files\nodejs;%CD%\node_modules\.bin;%PATH%"

echo [ChisaCode] Starting latest desktop...
echo [ChisaCode] Keep this window open.
echo.

rem Do NOT kill processes named start-chisacode-desktop here.
rem Just start. If ports are busy, the desktop script will pick free ones.
call "C:\Program Files\nodejs\npm.cmd" run dev:win --workspace=@chisacode/desktop
set "CODE=%ERRORLEVEL%"

echo.
echo [ChisaCode] Exited with code %CODE%
pause
exit /b %CODE%
