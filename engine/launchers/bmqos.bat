@echo off
rem BMQOS Windows One-Click Launcher
rem Double-click this file in Windows Explorer to start BMQOS and open your browser.

title BMQOS Local Launcher
cd /d "%~dp0\.."

echo =========================================
echo  Starting BMQOS Local Services
echo =========================================
echo.

call npm run start:all

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] BMQOS exited with error code %ERRORLEVEL%.
    echo Please verify that Node.js and npm dependencies are installed (run 'npm install').
    echo.
    pause
)
