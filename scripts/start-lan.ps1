param(
  [string]$MusicDirectory = "",
  [string]$SharedLyricsDirectory = "",
  [switch]$OpenFirewall
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$logDir = Join-Path $root ".codex-run"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Some shells expose both Path and PATH. Start-Process can fail on Windows when
# both are present, so keep the canonical Path entry for child processes.
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")

function Get-LanAddress {
  $addresses = @([System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).AddressList |
    Where-Object {
      $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
      -not $_.IPAddressToString.StartsWith("127.") -and
      -not $_.IPAddressToString.StartsWith("169.254.")
    } |
    ForEach-Object { $_.IPAddressToString })

  if ($addresses.Count -gt 0) {
    return $addresses[0]
  }
  return "localhost"
}

function Ensure-FirewallRule {
  param(
    [string]$Name,
    [int]$Port
  )

  $existing = netsh advfirewall firewall show rule name="$Name" 2>$null
  if ($LASTEXITCODE -eq 0 -and ($existing -join "`n") -match [regex]::Escape($Name)) {
    return
  }
  netsh advfirewall firewall add rule name="$Name" dir=in action=allow protocol=TCP localport=$Port profile=private | Out-Null
}

if ($OpenFirewall) {
  Ensure-FirewallRule "Media Player Frontend 5173" 5173
  Ensure-FirewallRule "Media Player Backend 9000" 9000
}

$env:DATABASE_URL = "postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable"
$env:SERVER_ADDR = ":9000"
$env:CORS_ORIGIN = "*"
if ($MusicDirectory -ne "") {
  $env:MUSIC_DIRECTORY = $MusicDirectory
}
if ($SharedLyricsDirectory -ne "") {
  $env:SHARED_LYRICS_DIRECTORY = $SharedLyricsDirectory
}

$backendOut = Join-Path $logDir "backend.out.log"
$backendErr = Join-Path $logDir "backend.err.log"
$frontendOut = Join-Path $logDir "frontend.out.log"
$frontendErr = Join-Path $logDir "frontend.err.log"

$backend = Start-Process -FilePath "go" -ArgumentList @("run", "./cmd/server") -WorkingDirectory $backendDir -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -WindowStyle Hidden -PassThru

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
  Push-Location $frontendDir
  npm ci
  Pop-Location
}

$frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $frontendDir -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr -WindowStyle Hidden -PassThru

$lanAddress = Get-LanAddress
Write-Host "Media Player LAN server started."
Write-Host "Frontend PID: $($frontend.Id)"
Write-Host "Backend PID:  $($backend.Id)"
Write-Host "Local:        http://localhost:5173"
Write-Host "LAN:          http://$lanAddress`:5173"
Write-Host "Health:       http://$lanAddress`:9000/healthz"
Write-Host "Logs:         $logDir"
