# Puts a "Mx Office" shortcut on the desktop and in the Start menu that runs scripts\start-office.ps1
# from this checkout (it starts the office, or opens it when it's already running). Run it once:
#
#   .\scripts\install-shortcut.ps1
#   .\scripts\install-shortcut.ps1 -OfficeHome D:\office -Port 4610   # passed on to start-office.ps1
#   .\scripts\install-shortcut.ps1 -NoDesktop                          # Start menu only
#   .\scripts\install-shortcut.ps1 -Remove                             # take them away again
#
# -DryRun prints what it would write (as JSON) and writes nothing. Works in Windows PowerShell 5.1 and
# PowerShell 7. Keep this file ASCII (5.1 reads a script without a BOM in the machine's code page).

[CmdletBinding()]
param(
  [string]$OfficeHome = '',
  [int]$Port = 0,
  [switch]$NoDesktop,
  [switch]$NoStartMenu,
  [switch]$Remove,
  [switch]$DryRun,
  # Where to put them instead of the desktop and Start menu (tests).
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$name = 'Mx Office'
$repo = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-office.ps1'

$dirs = @()
if ($Destination) { $dirs += $Destination }
else {
  if (-not $NoDesktop) { $dirs += [Environment]::GetFolderPath('Desktop') }
  if (-not $NoStartMenu) { $dirs += Join-Path ([Environment]::GetFolderPath('Programs')) $name }
}

$launch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$launcher`"")
if ($OfficeHome) { $launch += @('-OfficeHome', "`"$OfficeHome`"") }
if ($Port -gt 0) { $launch += @('-Port', [string]$Port) }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# The office's own icon: its 192 px PNG wrapped as an .ico (Windows takes a PNG inside one), written to
# %LOCALAPPDATA%\Mx Office (or -Destination), never into the checkout.
$png = Join-Path $repo 'src\client\public\icons\icon-192.png'
$iconDir = if ($Destination) { $Destination } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $name }
$icon = Join-Path $iconDir 'mx-office.ico'

function Write-Icon {
  if (-not (Test-Path -LiteralPath $png)) { return "$powershell,0" }
  if (-not (Test-Path -LiteralPath $iconDir)) { New-Item -ItemType Directory -Path $iconDir -Force | Out-Null }
  $bytes = [IO.File]::ReadAllBytes($png)
  $out = New-Object IO.MemoryStream
  $w = New-Object IO.BinaryWriter($out)
  # ICONDIR (reserved, type 1 = icon, one image), then its entry (192x192, 32 bpp, size, offset 22), then the PNG.
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
  $w.Write([byte]192); $w.Write([byte]192); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$bytes.Length); $w.Write([uint32]22)
  $w.Write($bytes)
  $w.Flush()
  [IO.File]::WriteAllBytes($icon, $out.ToArray())
  return $icon
}

$links = @($dirs | ForEach-Object { Join-Path $_ "$name.lnk" })
if ($DryRun) {
  [pscustomobject][ordered]@{ links = $links; target = $powershell; arguments = ($launch -join ' '); workingDirectory = $repo; icon = $icon; remove = $Remove.IsPresent } | ConvertTo-Json -Depth 3
  return
}

if ($Remove) {
  foreach ($l in $links) {
    if (Test-Path -LiteralPath $l) { Remove-Item -LiteralPath $l -Force; Write-Host "Removed $l" }
  }
  if (-not $Destination -and -not $NoStartMenu) {
    $folder = Join-Path ([Environment]::GetFolderPath('Programs')) $name
    if ((Test-Path -LiteralPath $folder) -and -not (Get-ChildItem -LiteralPath $folder)) { Remove-Item -LiteralPath $folder -Force }
  }
  return
}

$icon = Write-Icon
$shell = New-Object -ComObject WScript.Shell
foreach ($d in $dirs) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  $path = Join-Path $d "$name.lnk"
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $powershell
  $lnk.Arguments = $launch -join ' '
  $lnk.WorkingDirectory = $repo
  $lnk.IconLocation = $icon
  $lnk.Description = 'Start Mx Office (or open it when it is already running)'
  $lnk.Save()
  Write-Host "Created $path"
}
