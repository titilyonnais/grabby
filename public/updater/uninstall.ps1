# Removes Grabby's update helper: what install.ps1 told the browsers, and its description file.

$Name = 'com.grabby.updater'
$Browsers = @(
  'Software\Google\Chrome',
  'Software\BraveSoftware\Brave-Browser',
  'Software\Microsoft\Edge',
  'Software\Chromium',
  'Software\Vivaldi'
)
foreach ($b in $Browsers) {
  Remove-Item -Path "HKCU:\$b\NativeMessagingHosts\$Name" -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path (Join-Path $env:LOCALAPPDATA 'Grabby') "$Name.json") -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "  L'assistant de mise à jour de Grabby est désinstallé." -ForegroundColor Green
Write-Host '  Le bouton « Mettre à jour » redemandera de l''installer.'
Write-Host ''
