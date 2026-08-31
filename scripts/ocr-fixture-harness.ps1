# OCR fixture harness — üretim yolunun birebir aynısı.
#
# WinRT çağrıları, dil seçimi ve görüntü ön işlemesi ÜRETİMLE AYNI dosyadan
# gelir: desktop/src-tauri/src/identity_ocr.ps1 (main.rs include_str! ile aynı
# içeriği gömer). Drift bu noktada kalıcı olarak kapalıdır; motor/dil paketi
# değişince yeniden koşulur.
#
# Kullanım (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ocr-fixture-harness.ps1 `
#     -ImageDir backend\tests\fixtures\ocr\images -OutFile backend\tests\fixtures\ocr\raw_ocr.json
param(
    [Parameter(Mandatory = $true)][string]$ImageDir,
    [Parameter(Mandatory = $true)][string]$OutFile,
    # Üretim script'inin yolu; varsayılan repo içi ortak dosya.
    [string]$ScriptPath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $ScriptPath) {
    $base = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ScriptPath = Join-Path $base '..\desktop\src-tauri\src\identity_ocr.ps1'
}

# Ortak üretim fonksiyonlarını yükle: Select-OcrEngine / New-OcrSoftwareBitmap / Get-OcrJson
. (Resolve-Path $ScriptPath)

$selection = Select-OcrEngine
$engine = $selection.Engine
if ($null -eq $engine) {
    Write-Error 'OCR motoru yok.'
    exit 3
}
Write-Output ("engine language: " + $engine.RecognizerLanguage.LanguageTag)

$results = [ordered]@{}
$images = Get-ChildItem -Path $ImageDir -File | Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg' } | Sort-Object Name
foreach ($image in $images) {
    $json = Get-OcrJson -Path $image.FullName
    if ($null -eq $json) {
        Write-Output ("{0}: OCR motoru yok" -f $image.Name)
        continue
    }
    $record = $json | ConvertFrom-Json
    $lines = @($record.lines)
    $results[$image.Name] = $lines
    $scaledNote = if ($record.scaled) { ", ölçeklendi $($record.sourceWidth)x$($record.sourceHeight)" } else { "" }
    Write-Output ("{0}: {1} satır{2}" -f $image.Name, $lines.Count, $scaledNote)
}

$payload = [ordered]@{
    engine_language = $engine.RecognizerLanguage.LanguageTag
    note            = 'Ham Windows.Media.Ocr satırları; scripts/ocr-fixture-harness.ps1 ile üretildi (identity_ocr.ps1 ortak script).'
    results         = $results
}
$json = $payload | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output ("yazıldı: " + $OutFile)
