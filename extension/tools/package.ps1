$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$entries = @(
  "background.js",
  "manifest.json",
  "popup/popup.css",
  "popup/popup.html",
  "popup/popup.js"
)
foreach ($icon in Get-ChildItem (Join-Path $root "icons") -File) {
  $entries += "icons/$($icon.Name)"
}

$payload = @{}
foreach ($rel in $entries) {
  $path = Join-Path $root ($rel -replace "/", [IO.Path]::DirectorySeparatorChar)
  $payload[$rel] = [IO.File]::ReadAllBytes($path)
}

function New-RelayZip {
  param([string]$ZipPath)

  if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
  $archive = [System.IO.Compression.ZipArchive]::new(
    [IO.File]::Open($ZipPath, [IO.FileMode]::CreateNew),
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($rel in ($payload.Keys | Sort-Object)) {
      $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $stream = $entry.Open()
      try { $stream.Write($payload[$rel], 0, $payload[$rel].Length) } finally { $stream.Dispose() }
    }
  } finally { $archive.Dispose() }
}

$zip = Join-Path $dist "relay-$version.zip"
New-RelayZip -ZipPath $zip
$xpi = Join-Path $dist "relay-$version.xpi"
Copy-Item $zip $xpi -Force

Write-Host "Packaged $zip"
Write-Host "  $xpi  (Firefox .xpi alias)"
Write-Host "Load '$zip' (or the .xpi) in about:debugging, or unzip it for Chrome 'Load unpacked'."