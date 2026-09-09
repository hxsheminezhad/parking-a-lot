@echo off
title Parking-A-Lot Real-Time Server Host
echo ============================================================
echo   🚗 Starting Parking-A-Lot Real-Time Server Host...
echo ============================================================
echo.
cd /d "%~dp0"
node server.js
pause
