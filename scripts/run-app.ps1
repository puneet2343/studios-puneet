# Keeps the Puneet Studios web app running; restarts it if it ever exits.
$project = Split-Path $PSScriptRoot -Parent
$log = Join-Path $PSScriptRoot "app.log"
Set-Location $project
while ($true) {
  "[$(Get-Date -Format s)] starting app" | Out-File -Append -Encoding utf8 $log
  & npx.cmd next start -p 3000 *>> $log
  "[$(Get-Date -Format s)] app exited ($LASTEXITCODE), restarting in 10s" | Out-File -Append -Encoding utf8 $log
  Start-Sleep -Seconds 10
}
