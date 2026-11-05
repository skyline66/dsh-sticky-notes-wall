# Pushes the repository, tags the release and uploads the tarball asset.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File scripts/publish.ps1
param(
  [string]$Version = '',
  [string]$Repo = 'skyline66/dsh-sticky-notes-wall'
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$manifest = Get-Content package.json -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $manifest.version }
if ("v$($manifest.version)" -ne "v$Version") {
  throw "package.json is at $($manifest.version) but $Version was requested"
}

$asset = 'dsh-sticky-notes-wall.tgz'
if (-not (Test-Path $asset)) {
  npm pack | Out-Null
  $packed = Get-ChildItem -Filter 'dsh-sticky-notes-wall-*.tgz' | Select-Object -First 1
  if (-not $packed) { throw 'npm pack produced no tarball' }
  Copy-Item $packed.FullName $asset -Force
}

git push -u origin main
git tag -f "v$Version"
git push -f origin "v$Version"

$notes = (Get-Content CHANGELOG.md -Raw -Encoding UTF8)
gh release create "v$Version" $asset --repo $Repo --title "v$Version" --notes $notes

Write-Host ''
Write-Host "Release: https://github.com/$Repo/releases/tag/v$Version"
Write-Host "Asset:   https://github.com/$Repo/releases/latest/download/$asset"
Write-Host ''
Write-Host 'Next: open the marketplace PR (see PUBLISH.md, section 2).'