<#
.SYNOPSIS
  Downloads ShotStream + Wan2.1 weights to D:\shotstream (or $env:SHOTSTREAM_MODELS_DIR).

.DESCRIPTION
  Matches upstream tools/setup/download_ckpt.sh. Uses git + git-lfs (~15 GB total).
  Safe to re-run — existing directories are skipped.

.EXAMPLE
  # From an elevated PowerShell:
  cd shotstream-daemon\scripts
  .\download_models.ps1

.EXAMPLE
  # Custom location:
  $env:SHOTSTREAM_MODELS_DIR = "E:\ml\shotstream"
  .\download_models.ps1
#>

$ErrorActionPreference = "Stop"

$Root = $env:SHOTSTREAM_MODELS_DIR
if (-not $Root) { $Root = "D:\shotstream" }

Write-Host "Using models dir: $Root" -ForegroundColor Cyan

# Preflight
foreach ($tool in @("git", "git-lfs")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required. Install Git for Windows (includes git-lfs) from https://git-scm.com/download/win"
    }
}

git lfs install | Out-Null

# Ensure directories
New-Item -ItemType Directory -Force -Path $Root            | Out-Null
New-Item -ItemType Directory -Force -Path "$Root\outputs"  | Out-Null
New-Item -ItemType Directory -Force -Path "$Root\hf_cache" | Out-Null

function Clone-IfMissing([string]$Url, [string]$Dest) {
    if (Test-Path $Dest) {
        Write-Host "[skip] $Dest already exists" -ForegroundColor Yellow
        return
    }
    Write-Host "[clone] $Url -> $Dest" -ForegroundColor Green
    git clone $Url $Dest
}

Clone-IfMissing "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B" "$Root\wan_models"
Clone-IfMissing "https://huggingface.co/KlingTeam/ShotStream"   "$Root\ckpts"

Write-Host ""
Write-Host "Done. Contents:" -ForegroundColor Cyan
Get-ChildItem $Root | Format-Table Name, LastWriteTime, @{N="SizeGB";E={[math]::Round((Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB, 2)}}

# Sanity check
$Required = @(
    "$Root\ckpts\shotstream.yaml",
    "$Root\ckpts\shotstream_merged.pt"
)
foreach ($f in $Required) {
    if (-not (Test-Path $f)) {
        Write-Warning "Missing expected file: $f — check the KlingTeam/ShotStream HuggingFace repo for the actual filename and rename if needed."
    }
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1) Copy shotstream-daemon\.env.example -> .env (adjust SHOTSTREAM_MODELS_DIR if not D:\shotstream)"
Write-Host "  2) cd shotstream-daemon"
Write-Host "  3) docker compose up --build"
