' Starts the app and the Taildrop receiver with no visible windows.
' Put a shortcut to this file in the Windows Startup folder to run it at every login.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\run-app.ps1""", 0, False
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\run-taildrop.ps1""", 0, False
