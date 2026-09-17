param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$demoUrl = 'http://127.0.0.1:8771'
$serverScript = Join-Path $demoRoot 'serve.mjs'
$pidFile = Join-Path $demoRoot '.server.pid'
if ($Stop) {
  if (Test-Path -LiteralPath $pidFile) {
    $serverProcessId = [int](Get-Content -LiteralPath $pidFile)
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
    if ($serverProcess -and $serverProcess.Name -eq 'node.exe' -and $serverProcess.CommandLine.Contains($serverScript)) {
      Stop-Process -Id $serverProcessId
    }
    Remove-Item -LiteralPath $pidFile
  }
  return
}
$running = $false
try {
  $health = Invoke-RestMethod -Uri ($demoUrl + '/health') -TimeoutSec 2
  if ($health.app -eq 'kinetic-parkour-lab') { $running = $true }
  else { throw 'Port 8771 is occupied by another application.' }
} catch {
  if ($_.Exception.Message -match 'occupied') { throw }
}
if (-not $running) {
  $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $nodePath) { throw 'Node.js is required. Install Node.js 22 or newer, then run this file again.' }
  if (-not (Test-Path -LiteralPath (Join-Path $demoRoot 'dist\index.html'))) {
    throw 'Missing dist build. Run npm install and npm run build in this folder first.'
  }
  $demoLog = Join-Path $demoRoot 'server.log'
  $demoErrorLog = Join-Path $demoRoot 'server-error.log'
  $process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $demoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $demoLog -RedirectStandardError $demoErrorLog
  $process.Id | Set-Content -LiteralPath $pidFile
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    Start-Sleep -Milliseconds 200
    try { $health = Invoke-RestMethod -Uri ($demoUrl + '/health') -TimeoutSec 1; if ($health.app -eq 'kinetic-parkour-lab') { $running = $true; break } } catch { }
    if ($process.HasExited) { break }
  }
  if (-not $running) { throw 'Could not start the local server. Check server-error.log.' }
}
Start-Process ($demoUrl + '/')
