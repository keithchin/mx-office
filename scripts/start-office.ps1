# Starts Mx Office from this checkout, on this machine. Works in Windows PowerShell 5.1 and PowerShell 7.
#
#   .\scripts\start-office.ps1                       # office home %USERPROFILE%\mx-office, port 4600
#   .\scripts\start-office.ps1 -OfficeHome D:\office -Port 4610
#   .\scripts\start-office.ps1 -- --city Berlin       # anything after the options goes to the office
#
# What it does:
#   - The office keeps its data in <office home>\.agent-office and clones new projects into the office
#     home: -OfficeHome, else AGENT_OFFICE_HOME, else %USERPROFILE%\mx-office.
#   - Builds the office first when there's no dist folder yet (npm install too, on a fresh clone).
#   - If an office already answers on the port, it just opens it in the browser and stops.
#   - Starts the office; the office opens the browser itself once it's listening, signed in, and a new
#     office opens on its first-run setup (password, prerequisites, GitHub, Mendix, toolkit).
#   - Keeps it running across Settings > Agents > Restart safely (the office exits with code 75 and is
#     started again; AGENT_OFFICE_LAUNCHER_LOOP=1 tells it a restart is possible).
#
# Tokens and the password are NOT read here: the office keeps them itself, encrypted for this Windows
# user (Settings > Connections), and still reads the old dot-files and environment variables. Any
# environment variable already set when this runs (GH_TOKEN, AGENT_OFFICE_PASSWORD, AGENT_OFFICE_HOME,
# AGENT_OFFICE_MXCLI, ...) is left as it is and wins over what this script would pick.
#
# -DryRun prints what it would do (as JSON) and starts nothing. Keep this file ASCII: Windows
# PowerShell 5.1 reads a script without a BOM in the machine's code page.

[CmdletBinding()]
param(
  # Where the office keeps its data and clones projects (default %USERPROFILE%\mx-office).
  [string]$OfficeHome = '',
  # The port to listen on (default: PORT, else 4600).
  [int]$Port = 0,
  # Don't open the browser.
  [switch]$NoBrowser,
  # Don't build, even when dist is missing.
  [switch]$NoBuild,
  # Print what would happen and stop.
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$OfficeArgs = @()
)

$ErrorActionPreference = 'Stop'
$RestartExitCode = 75
$NodeMin = [version]'22.5.0'
$repo = Split-Path -Parent $PSScriptRoot

function Resolve-FullPath([string]$p) {
  if ($p -match '^~(?=$|[\\/])') { $p = $HOME + $p.Substring(1) }
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath([Environment]::ExpandEnvironmentVariables($p))
}

# What the office will be started with, from the options, the environment and the office's own settings.
function Resolve-OfficeLaunch {
  param([string]$OfficeHome, [int]$Port, [bool]$NoBrowser, [string]$Repo, [string[]]$Extra = @())
  $setEnv = [ordered]@{}
  if ($OfficeHome) { $officeHome = Resolve-FullPath $OfficeHome; $homeFrom = 'option' }
  elseif ($env:AGENT_OFFICE_HOME) { $officeHome = Resolve-FullPath $env:AGENT_OFFICE_HOME; $homeFrom = 'env' }
  else { $officeHome = Join-Path $env:USERPROFILE 'mx-office'; $homeFrom = 'default' }
  if ($homeFrom -ne 'env') { $setEnv['AGENT_OFFICE_HOME'] = $officeHome }
  # New projects go into the office home unless AGENT_OFFICE_PROJECTS says otherwise.
  if (-not $env:AGENT_OFFICE_PROJECTS) { $setEnv['AGENT_OFFICE_PROJECTS'] = $officeHome }

  if ($Port -gt 0) { $port = $Port; $portFrom = 'option' }
  elseif ($env:PORT -and ($env:PORT -as [int])) { $port = [int]$env:PORT; $portFrom = 'env' }
  else { $port = 4600; $portFrom = 'default' }

  # The browser's first-run setup asks what the terminal walkthrough would.
  $setEnv['AGENT_OFFICE_NO_WELCOME'] = '1'
  $setEnv['AGENT_OFFICE_LAUNCHER_LOOP'] = '1'
  if ($NoBrowser -and -not $env:AGENT_OFFICE_NO_OPEN) { $setEnv['AGENT_OFFICE_NO_OPEN'] = '1' }

  # The office's own settings (not secret): the mxcli picked in first-run setup goes first on PATH.
  $pathAdd = @()
  $mxcli = $null
  $settingsFile = Join-Path $officeHome '.agent-office\office-settings.json'
  if (Test-Path -LiteralPath $settingsFile) {
    try {
      $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
      if ($settings.PSObject.Properties['mxcliPath'] -and $settings.mxcliPath) {
        $mxcli = [string]$settings.mxcliPath
        $dir = Split-Path -Parent $mxcli
        $onPath = @($env:Path -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $dir.TrimEnd('\')) })
        if ((Test-Path -LiteralPath $dir) -and $onPath.Count -eq 0) { $pathAdd += $dir }
      }
    } catch {
      [Console]::Error.WriteLine("warning: couldn't read $settingsFile ($($_.Exception.Message)); starting without it.")
    }
  }

  $officeArgs = @()
  if ($portFrom -eq 'option') { $officeArgs += @('--port', [string]$port) }
  $officeArgs += @($Extra | Where-Object { $_ -and $_ -ne '--' })

  return [pscustomobject][ordered]@{
    repo = $Repo
    officeHome = $officeHome
    homeFrom = $homeFrom
    port = $port
    portFrom = $portFrom
    url = "http://localhost:$port"
    entry = Join-Path $Repo 'bin\agent-office.js'
    needsInstall = -not (Test-Path -LiteralPath (Join-Path $Repo 'node_modules'))
    needsBuild = -not (Test-Path -LiteralPath (Join-Path $Repo 'dist\server\server\cli.js'))
    mxcli = $mxcli
    pathAdd = $pathAdd
    setEnv = $setEnv
    officeArgs = $officeArgs
    restartExitCode = $RestartExitCode
  }
}

function Test-OfficeUp([int]$port) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true'
  } catch {
    return $false
  }
}

function Test-PortTaken([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    return $wait.AsyncWaitHandle.WaitOne(800) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$plan = Resolve-OfficeLaunch -OfficeHome $OfficeHome -Port $Port -NoBrowser $NoBrowser.IsPresent -Repo $repo -Extra $OfficeArgs
if ($DryRun) {
  $plan | ConvertTo-Json -Depth 4
  return
}

# Node.js 22.5 or newer runs the office.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js isn't installed (or not on PATH). Install Node.js $NodeMin or newer from https://nodejs.org (winget install OpenJS.NodeJS.LTS), open a new PowerShell and run this again." }
$nodeVersion = [version]((& node -p 'process.versions.node') -replace '[^0-9.]', '')
if ($nodeVersion -lt $NodeMin) { throw "Node.js $nodeVersion is too old: the office needs $NodeMin or newer (https://nodejs.org)." }

# Already running here: just open it.
if (Test-OfficeUp $plan.port) {
  Write-Host "Mx Office is already running at $($plan.url)"
  if (-not $NoBrowser) { Start-Process "$($plan.url)/home" }
  return
}
if (Test-PortTaken $plan.port) { throw "Port $($plan.port) is in use by another program. Start the office on another port: .\scripts\start-office.ps1 -Port 4610" }

Push-Location $repo
try {
  if ($plan.needsInstall -and -not $NoBuild) {
    Write-Host '==> npm install (first start of this checkout)' -ForegroundColor Cyan
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
  }
  if ($plan.needsBuild -and -not $NoBuild) {
    Write-Host '==> npm run build (no dist yet)' -ForegroundColor Cyan
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
  }
} finally {
  Pop-Location
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'dist\server\server\cli.js'))) { throw "The office isn't built: run npm install and npm run build in $repo" }

foreach ($k in $plan.setEnv.Keys) { Set-Item -Path "Env:$k" -Value $plan.setEnv[$k] }
if ($plan.pathAdd.Count) { $env:Path = (($plan.pathAdd + @($env:Path)) -join ';') }

Write-Host "==> Mx Office: home $($plan.officeHome), $($plan.url)" -ForegroundColor Cyan
$passArgs = @($plan.officeArgs)
do {
  & node $plan.entry @passArgs
  $code = $LASTEXITCODE
  # Restarted: the pages reconnect by themselves, so no second browser window.
  if ($code -eq $RestartExitCode) { $env:AGENT_OFFICE_NO_OPEN = '1'; Write-Host '==> Restarting Mx Office...' -ForegroundColor Cyan }
} while ($code -eq $RestartExitCode)
exit $code
