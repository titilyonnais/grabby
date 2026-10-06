# Grabby's update helper, started by the browser when Grabby asks (native messaging).
#
# It reads one message and answers one:
#   {"action":"hello"}   -> {"ok":true,"helper":1,"version":"<installed>"}
#   {"action":"update"}  -> {"ok":true,"version":"<new>","from":"<old>"} once Grabby's files
#                           are those of the latest release, {"ok":true,"upToDate":true} when
#                           they already are, {"ok":false,"error":"<code>"} otherwise.
#
# Only Grabby's release on GitHub is taken: its zip must come from the project's release
# address, match the SHA-256 GitHub gives for it, and hold Grabby with the same key. Only
# Grabby's own files are replaced or removed (the list each version ships), nothing else in
# the folder. Nothing is sent anywhere but the two requests to GitHub.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'titilyonnais/grabby'
$Api = "https://api.github.com/repos/$Repo/releases/latest"
$DownloadPrefix = "https://github.com/$Repo/releases/download/"
# Grabby's tests only: a local copy of a release (never set by Grabby or its installer).
if ($env:GRABBY_UPDATER_TEST_API) {
  $Api = $env:GRABBY_UPDATER_TEST_API
  $DownloadPrefix = $env:GRABBY_UPDATER_TEST_PREFIX
}

# Grabby's folder: the one this helper is in is inside it.
$ExtDir = Split-Path -Parent $PSScriptRoot
$FileList = 'updater/files.txt'

function Read-Message {
  $in = [Console]::OpenStandardInput()
  $head = New-Object byte[] 4
  $n = 0
  while ($n -lt 4) {
    $r = $in.Read($head, $n, 4 - $n)
    if ($r -le 0) { return $null }
    $n += $r
  }
  $size = [BitConverter]::ToInt32($head, 0)
  if ($size -le 0 -or $size -gt 65536) { return $null }
  $buf = New-Object byte[] $size
  $n = 0
  while ($n -lt $size) {
    $r = $in.Read($buf, $n, $size - $n)
    if ($r -le 0) { return $null }
    $n += $r
  }
  return ([Text.Encoding]::UTF8.GetString($buf) | ConvertFrom-Json)
}

function Send-Message($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 4))
  $out = [Console]::OpenStandardOutput()
  $out.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $out.Write($bytes, 0, $bytes.Length)
  $out.Flush()
}

function Read-Manifest($dir) {
  $path = Join-Path $dir 'manifest.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return (Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json)
}

function Version-Of($s) {
  try { return [Version]$s } catch { return [Version]'0.0.0' }
}

# The files a version is made of, from the list it ships (paths inside Grabby's folder).
function Files-Of($dir) {
  $path = Join-Path $dir $FileList
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  return @(Get-Content -Encoding UTF8 -LiteralPath $path | Where-Object { $_ -and $_ -notmatch '(^|/)\.\.(/|$)' -and $_ -notmatch '^[/\\]' -and $_ -notmatch ':' })
}

function Update {
  $current = Read-Manifest $ExtDir
  if (-not $current -or $current.short_name -ne 'Grabby' -or -not $current.key) { return @{ ok = $false; error = 'not_grabby' } }
  $headers = @{ 'User-Agent' = 'Grabby-updater'; 'Accept' = 'application/vnd.github+json' }
  $rel = Invoke-RestMethod -Uri $Api -Headers $headers -UseBasicParsing
  if ($rel.draft -or $rel.prerelease) { return @{ ok = $false; error = 'no_release' } }
  $asset = @($rel.assets | Where-Object { $_.name -match '^grabby-v(\d+\.\d+\.\d+)\.zip$' })[0]
  if (-not $asset) { return @{ ok = $false; error = 'no_release' } }
  $version = [regex]::Match($asset.name, '^grabby-v(\d+\.\d+\.\d+)\.zip$').Groups[1].Value
  if ((Version-Of $version) -le (Version-Of $current.version)) { return @{ ok = $true; upToDate = $true; version = $current.version } }
  $url = [string]$asset.browser_download_url
  if (-not $url.StartsWith($DownloadPrefix)) { return @{ ok = $false; error = 'bad_source' } }
  if ([string]$asset.digest -notmatch '^sha256:([0-9a-fA-F]{64})$') { return @{ ok = $false; error = 'no_digest' } }
  $want = $Matches[1].ToLowerInvariant()

  $work = Join-Path ([IO.Path]::GetTempPath()) ('grabby-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $zip = Join-Path $work 'grabby.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ 'User-Agent' = 'Grabby-updater' } -UseBasicParsing
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
    if ($got -ne $want) { return @{ ok = $false; error = 'bad_digest' } }
    $new = Join-Path $work 'new'
    Expand-Archive -LiteralPath $zip -DestinationPath $new
    $m = Read-Manifest $new
    if (-not $m -or $m.key -ne $current.key -or $m.version -ne $version) { return @{ ok = $false; error = 'bad_package' } }
    $newFiles = Files-Of $new
    if (-not $newFiles.Count) { return @{ ok = $false; error = 'bad_package' } }
    $oldFiles = Files-Of $ExtDir

    # The new version's files over the old ones (their list last, see below)…
    foreach ($f in $newFiles) {
      if ($f -eq $FileList) { continue }
      $from = Join-Path $new $f
      if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { continue }
      $to = Join-Path $ExtDir $f
      $toDir = Split-Path -Parent $to
      if (-not (Test-Path -LiteralPath $toDir)) { New-Item -ItemType Directory -Path $toDir -Force | Out-Null }
      Copy-Item -LiteralPath $from -Destination $to -Force
    }
    # …then the old version's files the new one no longer has (and only those).
    $keep = @{}
    foreach ($f in $newFiles) { $keep[$f.ToLowerInvariant()] = $true }
    foreach ($f in $oldFiles) {
      if ($keep.ContainsKey($f.ToLowerInvariant())) { continue }
      $old = Join-Path $ExtDir $f
      if (Test-Path -LiteralPath $old -PathType Leaf) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
    }
    # The list last: a copy cut short is tried again in full next time.
    Copy-Item -LiteralPath (Join-Path $new $FileList) -Destination (Join-Path $ExtDir $FileList) -Force
    return @{ ok = $true; version = $version; from = $current.version }
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
  }
}

try {
  $msg = Read-Message
  if ($null -eq $msg) { exit 0 }
  switch ([string]$msg.action) {
    'hello' { Send-Message @{ ok = $true; helper = 1; version = (Read-Manifest $ExtDir).version } }
    'update' { Send-Message (Update) }
    default { Send-Message @{ ok = $false; error = 'unknown_action' } }
  }
} catch {
  $text = [string]$_.Exception.Message
  $code = 'failed'
  if ($text -match 'remote name could not be resolved|Unable to connect|connection|timed out|Impossible de se connecter|nom distant') { $code = 'offline' }
  Send-Message @{ ok = $false; error = $code; detail = $text.Substring(0, [Math]::Min(300, $text.Length)) }
}
