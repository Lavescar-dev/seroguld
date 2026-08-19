# OCR fixture harness — üretim yolunun birebir kopyası.
#
# desktop/src-tauri/src/main.rs WINDOWS_OCR_SCRIPT ile aynı WinRT çağrılarını
# (StorageFile -> BitmapDecoder -> SoftwareBitmap -> OcrEngine -> RecognizeAsync)
# kullanır ve her görsel için ham OCR satırlarını tek bir JSON dosyasına yazar.
# Testler gerçek motoru değil bu kaydedilmiş çıktıyı tüketir; motor/dil paketi
# değişince yeniden koşulur.
#
# Not: [System.WindowsRuntimeSystemExtensions]::AsTask($op) doğrudan çağrısı
# PowerShell 5.1'de overload çözememe hatası verir (MethodCountCouldNotFindBest).
# Bu yüzden AsTask, MakeGenericMethod ile reflection üzerinden bağlanır.
#
# Kullanım (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ocr-fixture-harness.ps1 `
#     -ImageDir backend\tests\fixtures\ocr\images -OutFile backend\tests\fixtures\ocr\raw_ocr.json
param(
    [Parameter(Mandatory = $true)][string]$ImageDir,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

function Await-WinRt($operation, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait() | Out-Null
    return $task.Result
}

# Hedef makine (Danimarka) profili Danca çözer; fixture üretiminde de önce
# Danca denenir ki kayıtlı satırlar hedef davranışı temsil etsin.
$engine = $null
foreach ($tag in @('da', 'da-DK', 'en-US')) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($tag))
    if ($null -ne $engine) { break }
}
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) {
    Write-Error 'OCR motoru yok.'
    exit 3
}
Write-Output ("engine language: " + $engine.RecognizerLanguage.LanguageTag)

$results = [ordered]@{}
$images = Get-ChildItem -Path $ImageDir -File | Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg' } | Sort-Object Name
foreach ($image in $images) {
    $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $recognized = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($recognized.Lines | ForEach-Object { $_.Text })
    $results[$image.Name] = $lines
    Write-Output ("{0}: {1} satır" -f $image.Name, $lines.Count)
    $stream.Dispose()
}

$payload = [ordered]@{
    engine_language = $engine.RecognizerLanguage.LanguageTag
    note            = 'Ham Windows.Media.Ocr satırları; scripts/ocr-fixture-harness.ps1 ile üretildi.'
    results         = $results
}
$json = $payload | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output ("yazıldı: " + $OutFile)
