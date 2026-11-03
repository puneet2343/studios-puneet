@echo off
rem One-time setup of the Android build tools for the Puneet Studios phone app.
rem Java and the Android command-line tools are already in %LOCALAPPDATA%\PuneetStudiosBuild;
rem this downloads the Android 35 platform and build tools. Google asks you to accept
rem the Android SDK license: type  y  and press Enter when asked.
setlocal
for %%I in ("%LOCALAPPDATA%\PuneetStudiosBuild") do set "T=%%~sI"
for /d %%J in ("%T%\jdk-17*") do set "JAVA_HOME=%%~sJ"
call "%T%\sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="%T%\sdk" "platforms;android-35" "build-tools;35.0.0"
echo.
if exist "%T%\sdk\build-tools\35.0.0\aapt2.exe" (echo All set. You can close this window.) else (echo Something went wrong - send Claude a screenshot of this window.)
pause
