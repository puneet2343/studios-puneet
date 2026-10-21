# Moves files sent with Tailscale (Taildrop) into Desktop\Phone Media; restarts if it exits.
$dest = Join-Path $env:USERPROFILE "Desktop\Phone Media"
$log = Join-Path $PSScriptRoot "taildrop.log"
New-Item -ItemType Directory -Force $dest | Out-Null
while ($true) {
  & "C:\Program Files\Tailscale\tailscale.exe" file get --loop --conflict=rename $dest *>> $log
  Start-Sleep -Seconds 15
}
