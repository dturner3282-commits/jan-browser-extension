#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PREPARE USB FOR AIR-GAP SETUP (run on online machine)
    
.DESCRIPTION
    Verifies required files exist, computes checksums, and prepares a USB drive
    for transfer to an offline machine. This script does NOT require internet once
    you have the installer and model files downloaded locally.
    
.NOTES
    Run as Administrator. Place this script in the offline-setup-windows-template folder.
    Required files (place in same folder structure before running):
    - installers\LM_Studio_installer.exe (or .msi)
    - installers\Jan_installer.zip (or similar)
    - models\Qwen-7B-Chat.gguf
    - models\all-MiniLM-L6-v2.gguf
    - (optional) convert_to_pdf.py (root or docs-samples folder)
#>

param(
    [string]$TemplatePath = (Get-Location).Path,
    [string]$USBDriveLetter = $null,
    [switch]$SkipUSB,
    [switch]$GenerateChecksumsOnly
)

$ErrorActionPreference = "Stop"
$TemplateFolder = Get-Item -Path $TemplatePath -ErrorAction SilentlyContinue
if (-not $TemplateFolder -or -not $TemplateFolder.PSIsContainer) {
    Write-Host "❌ ERROR: Template folder not found at $TemplatePath" -ForegroundColor Red
    Write-Host "Usage: .\prepare_usb.ps1 -TemplatePath 'C:\path\to\offline-setup-windows-template'" -ForegroundColor Yellow
    exit 1
}

Write-Host "🔍 STEP 1: Verify required files exist" -ForegroundColor Cyan
$requiredDirs = @("installers", "models", "docs-samples")
$requiredFiles = @(
    "installers\*LM*Studio*.exe",
    "installers\*LM*Studio*.msi",
    "installers\*Jan*.zip",
    "installers\*Jan*.exe",
    "models\*Qwen*7B*.gguf",
    "models\*MiniLM*.gguf"
)

$missingFiles = @()
foreach ($pattern in $requiredFiles) {
    $found = @(Get-ChildItem -Path (Join-Path $TemplatePath $pattern) -ErrorAction SilentlyContinue)
    if ($found.Count -eq 0) {
        $missingFiles += $pattern
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "⚠️  WARNING: Some files are missing. The USB will be incomplete." -ForegroundColor Yellow
    Write-Host "    Missing patterns:" -ForegroundColor Yellow
    foreach ($f in $missingFiles) {
        Write-Host "      - $f" -ForegroundColor Yellow
    }
    Write-Host "" -ForegroundColor Yellow
    Write-Host "    Place the following files in the template folder and try again:" -ForegroundColor Yellow
    Write-Host "      installers\LM_Studio_installer.exe" -ForegroundColor Yellow
    Write-Host "      installers\Jan_installer.zip" -ForegroundColor Yellow
    Write-Host "      models\Qwen-7B-Chat.gguf" -ForegroundColor Yellow
    Write-Host "      models\all-MiniLM-L6-v2.gguf" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor Yellow
} else {
    Write-Host "✅ All critical files found!" -ForegroundColor Green
}

Write-Host "`n🔐 STEP 2: Calculate SHA256 checksums" -ForegroundColor Cyan
$checksums = @()
$allFiles = @(
    Get-ChildItem -Path (Join-Path $TemplatePath "installers") -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $TemplatePath "models") -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $TemplatePath) -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "convert_to_pdf.py" }
)

foreach ($file in $allFiles) {
    $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
    $relPath = $file.FullName -replace [regex]::Escape($TemplatePath), ""
    $relPath = $relPath.TrimStart("\")
    $checksums += "$hash  $relPath"
    Write-Host "  ✓ $($file.Name) : $hash" -ForegroundColor Gray
}

$checksumsPath = Join-Path $TemplatePath "checksums.txt"
$checksums | Set-Content -Path $checksumsPath -Encoding UTF8
Write-Host "✅ Checksums saved to: checksums.txt" -ForegroundColor Green

if ($GenerateChecksumsOnly) {
    Write-Host "`n✅ Checksums generated. Exiting (--GenerateChecksumsOnly)." -ForegroundColor Green
    exit 0
}

if ($SkipUSB) {
    Write-Host "`n✅ Template prepared (--SkipUSB flag). Exiting." -ForegroundColor Green
    exit 0
}

Write-Host "`n💾 STEP 3: Prepare USB for transfer" -ForegroundColor Cyan

# List available USB drives (volumes not C: or D:)
$driveLetters = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveLetter -notin @("C", "D") } | Select-Object -ExpandProperty DriveLetter)

if ($null -eq $USBDriveLetter) {
    if ($driveLetters.Count -eq 0) {
        Write-Host "⚠️  No USB drives detected. Plug in a USB drive (32GB+ recommended) and try again." -ForegroundColor Yellow
        exit 1
    } elseif ($driveLetters.Count -eq 1) {
        $USBDriveLetter = $driveLetters[0]
        Write-Host "✅ Auto-detected USB drive: $USBDriveLetter" -ForegroundColor Green
    } else {
        Write-Host "Multiple USB drives found. Please specify with -USBDriveLetter:" -ForegroundColor Yellow
        foreach ($d in $driveLetters) {
            Write-Host "  - $d" -ForegroundColor Yellow
        }
        exit 1
    }
}

$USBPath = "$($USBDriveLetter):"
$USBExists = Test-Path $USBPath
if (-not $USBExists) {
    Write-Host "❌ ERROR: USB drive $USBPath not found." -ForegroundColor Red
    exit 1
}

$freeSpace = (Get-Volume -DriveLetter $USBDriveLetter).SizeRemaining / 1GB
$usedSpace = 0
foreach ($file in $allFiles) {
    $usedSpace += $file.Length / 1GB
}

Write-Host "  USB Drive: $USBPath" -ForegroundColor Green
Write-Host "  Free space: $([math]::Round($freeSpace, 2)) GB" -ForegroundColor Green
Write-Host "  Required space: $([math]::Round($usedSpace, 2)) GB" -ForegroundColor Green

if ($freeSpace -lt $usedSpace) {
    Write-Host "❌ ERROR: Insufficient space on USB drive." -ForegroundColor Red
    exit 1
}

Write-Host "`n📋 Ready to copy. This may take 5-30 minutes depending on file sizes..." -ForegroundColor Cyan
$confirm = Read-Host "Continue copying to $USBPath ? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n⏳ Copying files to USB..." -ForegroundColor Cyan
$destFolder = Join-Path $USBPath "offline-setup-windows-template"
if (Test-Path $destFolder) {
    Write-Host "  Removing existing offline-setup-windows-template folder on USB..." -ForegroundColor Gray
    Remove-Item -Path $destFolder -Recurse -Force -ErrorAction SilentlyContinue
}

Copy-Item -Path $TemplatePath -Destination $USBPath -Recurse -Force
Write-Host "✅ Files copied to: $destFolder" -ForegroundColor Green

Write-Host "`n🛑 STEP 4: Safely eject USB" -ForegroundColor Cyan
$volume = Get-Volume -DriveLetter $USBDriveLetter
$physicalDrive = Get-Partition -DriveLetter $USBDriveLetter | Select-Object -ExpandProperty DiskNumber
Write-Host "  Safe eject for USB drive $USBDriveLetter (disk $physicalDrive)..." -ForegroundColor Gray

try {
    $ejectCmd = "cmd.exe /c `"powershell -Command `'& {Remove-Item -LiteralPath \\\"\\\"?\\GLOBALROOT\\Device\\Harddisk$physicalDrive\\DP(1)\\\" -ErrorAction Ignore}`'`""
    Invoke-Expression $ejectCmd -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
} catch {
    Write-Host "  (Auto-eject via PowerShell skipped; use Safely Remove Hardware icon in system tray)" -ForegroundColor Gray
}

Write-Host "`n✅ STEP 5: Next steps" -ForegroundColor Green
Write-Host "  1. Close all open files on the USB" -ForegroundColor White
Write-Host "  2. Right-click the USB icon in the system tray → Eject" -ForegroundColor White
Write-Host "  3. When Windows says 'Safe to Remove', physically unplug the USB" -ForegroundColor White
Write-Host "  4. Move USB to the offline machine" -ForegroundColor White
Write-Host "  5. On the offline machine, run: run_offline.ps1" -ForegroundColor White
Write-Host "`n✅ USB preparation complete!" -ForegroundColor Green
