# Get Mx Office in one line (README › Get Mx Office):
#
#   irm https://raw.githubusercontent.com/keithchin/mx-office/main/scripts/get-mx-office.ps1 | iex
#
# Checks for git and Node.js (offering to install them with winget), clones the office into
# %USERPROFILE%\mx-office-app (or pulls it when it's already there, so running it twice is safe),
# installs and builds it, then starts it with scripts\start-office.ps1, which opens First-run setup.
# Set $env:MX_OFFICE_DIR first for another folder. Nothing is installed without asking.

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/keithchin/mx-office.git'
$dir = if ($env:MX_OFFICE_DIR) { $env:MX_OFFICE_DIR } else { Join-Path $env:USERPROFILE 'mx-office-app' }

function Need($cmd, $package, $what) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "$what isn't installed and winget isn't here: install $what yourself, then run this again." }
  $answer = Read-Host "$what isn't installed. Install it now with winget ($package)? [Y/n]"
  if ($answer -match '^[nN]') { throw "Mx Office needs $what." }
  winget install --id $package --exact --source winget --accept-package-agreements --accept-source-agreements
  # The new program's folder, without opening a new window.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$what was installed but isn't on PATH yet: open a new PowerShell and run this again." }
}

Need git 'Git.Git' 'Git'
Need node 'OpenJS.NodeJS.LTS' 'Node.js'

if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "Mx Office is already in ${dir}: updating it (git pull)"
  git -C $dir pull --ff-only
} else {
  Write-Host "Cloning Mx Office into $dir"
  git clone $repo $dir
}
if ($LASTEXITCODE) { throw 'git failed (see above).' }

Push-Location $dir
try {
  npm ci
  if ($LASTEXITCODE) { throw 'npm ci failed (see above).' }
  npm run build
  if ($LASTEXITCODE) { throw 'npm run build failed (see above).' }
} finally { Pop-Location }

Write-Host "Starting Mx Office: it opens First-run setup in your browser. Later, start it again with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$dir\scripts\start-office.ps1`""
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'scripts\start-office.ps1')
