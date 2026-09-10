param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$applicationUrl = 'http://localhost:5173'
Set-Location -LiteralPath $projectDirectory

function Test-GiveawayRunning {
    try {
        $result = Invoke-RestMethod -Uri "$applicationUrl/api/health" -TimeoutSec 2
        return ($result.service -eq 'giveaway' -and $result.ready)
    } catch { return $false }
}

if (-not (Test-GiveawayRunning)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Install Node.js 22.12+ or 24+, then run this file again.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules'))) {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'dist/index.html'))) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    $logDirectory = Join-Path $projectDirectory '.local'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $nodeProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList 'server/index.mjs','--production' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') -PassThru
    $nodeProcess.Id | Set-Content -LiteralPath (Join-Path $logDirectory 'server.pid')
    $running = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-GiveawayRunning) { $running = $true; break }
        if ($nodeProcess.HasExited) { throw "Server could not start. See .local/server-error.log" }
        Start-Sleep -Milliseconds 250
    }
    if (-not $running) { throw 'Startup timed out. See .local/server-error.log' }
}
Write-Host "Giveaway is ready: $applicationUrl"
if (-not $NoBrowser) { Start-Process $applicationUrl }
