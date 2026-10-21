@echo off
title Puneet Studios (keep open)
rem Double-click after the PC restarts. Keep this window open: closing it stops the app.
rem It also watches the code: any change is rebuilt and reaches the phone by itself.
cd /d "C:\Users\Puneet Shukla\Desktop\ssimaya\testing\testing"
echo Starting Puneet Studios... wait for "App running", then open the app on your phone.
echo Do NOT close this window. You can minimize it.
echo.
node scripts\serve.js
echo.
echo The app stopped. Press any key to close this window, then double-click the start file again.
pause >nul
