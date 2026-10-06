# Installs Grabby's update helper for this Windows user (no administrator rights needed):
# tells Chrome, Brave, Edge, Chromium and Vivaldi where the helper is, for Grabby only.
# Run by "installer-mises-a-jour.cmd"; "desinstaller-mises-a-jour.cmd" undoes it.

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$ExtDir = Split-Path -Parent $Here
$Name = 'com.grabby.updater'
$Browsers = @(
  'Software\Google\Chrome',
  'Software\BraveSoftware\Brave-Browser',
  'Software\Microsoft\Edge',
  'Software\Chromium',
  'Software\Vivaldi'
)

try {
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ExtDir 'manifest.json') | ConvertFrom-Json
  if ($manifest.short_name -ne 'Grabby' -or -not $manifest.key) { throw "Ce dossier ne contient pas Grabby : $ExtDir" }

  # Grabby's id, from its key (the browser computes it the same way).
  $der = [Convert]::FromBase64String($manifest.key)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($der)
  $id = -join ($hash[0..15] | ForEach-Object { $_.ToString('x2') } | ForEach-Object { $_.ToCharArray() } | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })

  $dir = Join-Path $env:LOCALAPPDATA 'Grabby'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $json = Join-Path $dir "$Name.json"
  $host_ = [ordered]@{
    name            = $Name
    description     = 'Grabby update helper'
    path            = (Join-Path $Here 'grabby-updater.cmd')
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$id/")
  }
  [IO.File]::WriteAllText($json, ($host_ | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding $false))

  foreach ($b in $Browsers) {
    $key = "HKCU:\$b\NativeMessagingHosts\$Name"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $json
  }

  Write-Host ''
  Write-Host "  L'assistant de mise à jour de Grabby est installé." -ForegroundColor Green
  Write-Host "  Dossier de Grabby : $ExtDir"
  Write-Host ''
  Write-Host "  Dans Grabby, le bouton « Mettre à jour » installe maintenant les nouvelles versions tout seul."
  Write-Host "  Si tu déplaces le dossier de Grabby, relance ce fichier depuis le nouveau dossier."
  Write-Host ''
} catch {
  Write-Host ''
  Write-Host "  L'installation n'a pas pu se faire : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ''
  exit 1
}
