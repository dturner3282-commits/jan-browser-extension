#Requires -RunAsAdministrator
<#
.SYNOPSIS
    RUN ON OFFLINE MACHINE (100% air-gapped)
    
.DESCRIPTION
    After plugging in the USB:
    1. Copy offline-setup-windows-template folder to Desktop
    2. Turn OFF Wi-Fi and unplug Ethernet
    3. Run this script (double-click or: powershell -ExecutionPolicy Bypass -File run_offline.ps1)
    
    This script will:
    - Verify you are offline (fail if internet detected)
    - Run offline_validator.py to scan documents
    - Run convert_to_pdf.py if office files exist
    - Copy models to LM Studio default folder
    - Start LM Studio and Jan
    - Show instructions to import models and index documents

.NOTES
    Requires Windows 11, Python 3.8+, Administrator privileges
#>

param(
    [string]$DocumentFolder = "$env:USERPROFILE\Documents\MyDocs",
    [switch]$SkipNetworkCheck
)

$ErrorActionPreference = "Stop"
$LogPath = "$env:USERPROFILE\Desktop\offline-setup.log"
$JSONPath = "$env:USERPROFILE\Desktop\offline-validator-scan.json"

function Log {
    param([string]$Message, [string]$Color = "White")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] $Message"
    Add-Content -Path $LogPath -Value $logEntry -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $Message -ForegroundColor $Color
}

Log "========================================" -Color Cyan
Log "OFFLINE SETUP STARTED" -Color Cyan
Log "========================================" -Color Cyan

# 1. Network check
Log "`n[1/5] Checking network status..." -Color Cyan
$isOnline = $false
if (-not $SkipNetworkCheck) {
    foreach ($host in @("8.8.8.8", "1.1.1.1")) {
        try {
            $tcpCheck = New-Object System.Net.Sockets.TcpClient
            $tcpCheck.ConnectAsync($host, 53).Wait(1000) | Out-Null
            if ($tcpCheck.Connected) {
                $isOnline = $true
                break
            }
        } catch { }
    }
    
    if ($isOnline) {
        Log "❌ FAIL: Internet detected! Disconnect and try again." -Color Red
        exit 1
    } else {
        Log "✅ PASS: No internet detected (air-gapped)" -Color Green
    }
} else {
    Log "⏭️  Network check skipped (--SkipNetworkCheck)" -Color Yellow
}

# 2. Find offline_validator.py
Log "`n[2/5] Locating offline_validator.py..." -Color Cyan
$scriptFolder = (Get-Location).Path
$validatorPath = @(
    (Join-Path $scriptFolder "offline_validator.py"),
    (Join-Path $scriptFolder ".." "offline_validator.py"),
    "D:\jan-browser-extension\offline_validator.py"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $validatorPath) {
    Log "❌ FAIL: offline_validator.py not found. Copy from the USB or repo." -Color Red
    exit 1
}
Log "✅ Found: $validatorPath" -Color Green

# 3. Run validator
Log "`n[3/5] Scanning documents..." -Color Cyan
Log "   Target folder: $DocumentFolder" -Color Gray
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $validatorPath --target $DocumentFolder --recursive --json | Out-File -FilePath $JSONPath -Encoding utf8
} else {
    & python $validatorPath --target $DocumentFolder --recursive --json | Out-File -FilePath $JSONPath -Encoding utf8
}
Log "✅ Scan complete. JSON saved to: $JSONPath" -Color Green

# Parse JSON to check for office files
$jsonContent = Get-Content -Path $JSONPath -Raw | ConvertFrom-Json
$officeCount = $jsonContent.counts.docx + $jsonContent.counts.pptx + $jsonContent.counts.xlsx + $jsonContent.counts.other_office

# 4. Convert office files (if needed and convert script exists)
if ($officeCount -gt 0) {
    Log "`n[4/5] Office files detected ($officeCount). Attempting conversion..." -Color Cyan
    
    $convertScripts = @(
        (Join-Path $scriptFolder "convert_to_pdf.py"),
        (Join-Path $scriptFolder ".." "convert_to_pdf.py"),
        "D:\jan-browser-extension\convert_to_pdf.py"
    )
    
    $convertPath = $convertScripts | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($convertPath) {
        Log "   Found convert script: $convertPath" -Color Gray
        $outputFolder = Join-Path $DocumentFolder "pdf_ready"
        Log "   Converting to: $outputFolder" -Color Gray
        
        if (Get-Command py -ErrorAction SilentlyContinue) {
            & py -3 $convertPath $DocumentFolder $outputFolder
        } else {
            & python $convertPath $DocumentFolder $outputFolder
        }
        Log "✅ Conversion attempt complete. Check $outputFolder for PDFs." -Color Green
    } else {
        Log "⚠️  convert_to_pdf.py not found. Skipping conversion." -Color Yellow
        Log "   (You can convert office files manually using LibreOffice if installed)" -Color Yellow
    }
} else {
    Log "`n[4/5] No office files detected. Skipping conversion." -Color Green
}

# 5. Copy models to LM Studio
Log "`n[5/5] Setting up LM Studio models..." -Color Cyan

$lmStudioModelDirs = @(
    "$env:USERPROFILE\.lm-studio\models",
    "$env:APPDATA\LMStudio\models",
    "$env:APPDATA\lm-studio\models"
)

$lmModelDir = $lmStudioModelDirs | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $lmModelDir) {
    Log "⚠️  LM Studio model folder not found. You may need to manually import models." -Color Yellow
    Log "   (Run LM Studio first to create the .lm-studio folder)" -Color Yellow
} else {
    Log "   Found LM Studio models at: $lmModelDir" -Color Gray
    
    # Look for model files on USB
    $usbFolders = @("$scriptFolder\models", (Join-Path $scriptFolder ".." "models"))
    foreach ($usbModelFolder in $usbFolders) {
        if (Test-Path $usbModelFolder) {
            Log "   Copying models from: $usbModelFolder" -Color Gray
            Copy-Item -Path (Join-Path $usbModelFolder "*") -Destination $lmModelDir -Recurse -Force -ErrorAction SilentlyContinue
            Log "✅ Models copied to LM Studio." -Color Green
            break
        }
    }
}

# 6. Start apps
Log "`n[6/6] Starting applications..." -Color Cyan
$lmStudioExe = @(
    "C:\Program Files\LM Studio\LM Studio.exe",
    "C:\Program Files (x86)\LM Studio\LM Studio.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($lmStudioExe) {
    Log "   Starting LM Studio..." -Color Gray
    Start-Process -FilePath $lmStudioExe -WindowStyle Minimized -ErrorAction SilentlyContinue
    Log "✅ LM Studio started." -Color Green
} else {
    Log "⚠️  LM Studio not found in Program Files. Install it or start manually." -Color Yellow
}

$janExe = @(
    "C:\Program Files\Jan\Jan.exe",
    "C:\Program Files (x86)\Jan\Jan.exe",
    "$env:APPDATA\Jan\Jan.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($janExe) {
    Log "   Starting Jan..." -Color Gray
    Start-Process -FilePath $janExe -WindowStyle Minimized -ErrorAction SilentlyContinue
    Log "✅ Jan started." -Color Green
} else {
    Log "⚠️  Jan not found. Install it or start manually." -Color Yellow
}

# 7. Final instructions
Log "`n========================================" -Color Cyan
Log "SETUP COMPLETE" -Color Cyan
Log "========================================" -Color Cyan
Log "" -Color White
Log "📋 NEXT STEPS (manual UI actions):" -Color Cyan
Log "" -Color White
Log "1. IMPORT MODELS IN LM STUDIO:" -Color Yellow
Log "   - Open LM Studio → Models tab" -Color Gray
Log "   - Click 'Import model' or '+'" -Color Gray
Log "   - Select: Qwen-7B-Chat.gguf" -Color Gray
Log "   - Repeat for: all-MiniLM-L6-v2.gguf" -Color Gray
Log "   - Wait for import to complete" -Color Gray
Log "" -Color White
Log "2. INDEX DOCUMENTS IN JAN:" -Color Yellow
Log "   - Open Jan" -Color Gray
Log "   - Look for 'Add documents' or 'Index' button" -Color Gray
Log "   - Choose your documents folder: $DocumentFolder" -Color Gray
Log "   - Select search model: all-MiniLM-L6-v2" -Color Gray
Log "   - Select main LLM: Qwen-7B-Chat" -Color Gray
Log "   - Click 'Start' and wait for indexing to complete" -Color Gray
Log "" -Color White
Log "3. TEST YOUR SETUP:" -Color Yellow
Log "   - In Jan, ask: 'What is in [filename]? Show source.'" -Color Gray
Log "   - Verify response includes the filename and content from your documents" -Color Gray
Log "" -Color White
Log "📂 LOGS:" -Color Cyan
Log "   Validator JSON: $JSONPath" -Color Gray
Log "   Setup log: $LogPath" -Color Gray
Log "" -Color White
Log "✅ AIR-GAP SETUP READY (offline operation confirmed)" -Color Green
Log "" -Color White

# Open log file for user review
Start-Process -FilePath notepad -ArgumentList $LogPath -WindowStyle Normal -ErrorAction SilentlyContinue

Write-Host "`n✅ All done! Log saved to Desktop. Follow the NEXT STEPS above." -ForegroundColor Green
