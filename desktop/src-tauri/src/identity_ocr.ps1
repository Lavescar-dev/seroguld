# Kimlik OCR ortak PowerShell/WinRT script'i.
#
# Iki tuketici vardir ve ayni dosyayi kullanir (drift kalici olarak kapalidir):
#  - Uretim: desktop/src-tauri/src/main.rs `include_str!` ile gomer, -Command
#    metninin sonuna Get-OcrJson cagrisi ekler.
#  - scripts/ocr-fixture-harness.ps1: dot-source eder, fonksiyonlari goruntuler
#    icin cagirir.
#
# Fonksiyonlar ASLA `exit` yapmaz; exit kodlari uretim sarmalayicisindadir.
# Dil tercihi: da-DK -> da -> kullanici profili. Secilen motor dili ve goruntu
# on-isleme bilgiyi ciktiya yazilir (saha teshisi icin).

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

# AsTask($op) dogrudan cagrisi PowerShell 5.1'de generic overload'u cozemeyip
# MethodCountCouldNotFindBest ile patlayabiliyor (gercek makinede dogrulandi);
# bu yuzden AsTask, MakeGenericMethod ile reflection uzerinden baglanir.
$script:IdentityOcrAsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await-WinRt($operation, [Type]$resultType) {
  $task = $script:IdentityOcrAsTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}

function Select-OcrEngine {
  # Danca once; yoksa kullanici profili. Donus: @{ Engine; RequestedLanguage }
  # Engine null ise OCR paketi yok demektir (uretim tarafinda exit 3).
  foreach ($tag in @('da-DK', 'da')) {
    try {
      $candidate = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($tag))
    } catch {
      $candidate = $null
    }
    if ($null -ne $candidate) {
      return @{ Engine = $candidate; RequestedLanguage = $tag }
    }
  }
  return @{ Engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); RequestedLanguage = '' }
}

function New-OcrSoftwareBitmap {
  # MaxImageDimension'u asan goruntuler Windows OCR'da sessizce bos/az satir
  # dondurur (semptom: "N satir okudu" cok dusuk). Bu yuzden decoder
  # olculerine gore BitmapTransform ile olceklenir; kucuk goruntuler (uzun kenar
  # <1000px) okunabilirlik icin en fazla 2x buyutulur.
  param([string]$Path)

  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

  $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($maxDim -lt 100) { $maxDim = 2600 }
  $sourceWidth = [int]$decoder.OrientedPixelWidth
  $sourceHeight = [int]$decoder.OrientedPixelHeight
  $longest = [Math]::Max($sourceWidth, $sourceHeight)

  $scale = 1.0
  if ($longest -gt $maxDim) {
    $scale = $maxDim / [double]$longest
  } elseif ($longest -lt 1000) {
    $scale = [Math]::Min(2.0, 1400.0 / [double]$longest)
  }

  $scaled = $false
  if ($scale -ne 1.0) {
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $transform.ScaledWidth = [int][Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
    $transform.ScaledHeight = [int][Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))
    $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Linear
    try {
      $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync(
          [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
          [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
          $transform,
          [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
          [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $scaled = $true
    } catch {
      # 5-parametreli overload bazi PS 5.1 kurulumlarinda cozulemeyebilir;
      # bugunku tek-parametreli davranis alt sinirdir.
      $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    }
  } else {
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  }

  return @{
    Bitmap       = $bitmap
    Stream       = $stream
    Scaled       = $scaled
    MaxDimension = $maxDim
    SourceWidth  = $sourceWidth
    SourceHeight = $sourceHeight
  }
}

function Get-OcrJson {
  # Tam hatt: motor sec -> bitmap olcele -> tania -> JSON (base64 YOK; uretim
  # sarmalayicisi base64+stdout'u kendisi yapar; harness dogrudan JSON alir).
  param([string]$Path)

  $selection = Select-OcrEngine
  $engine = $selection.Engine
  if ($null -eq $engine) { return $null }

  $prepared = New-OcrSoftwareBitmap -Path $Path
  try {
    $result = Await-WinRt ($engine.RecognizeAsync($prepared.Bitmap)) ([Windows.Media.Ocr.OcrResult])
  } finally {
    $prepared.Stream.Dispose()
  }
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  # PS 5.1 pipeline unwrap'i tek/bos diziyi bozar; -InputObject ile nesne
  # grafigi aynen kalir (Rust Vec<String> sozlesmesi).
  return ConvertTo-Json -InputObject @{
      lines             = @($lines)
      language          = [string]$engine.RecognizerLanguage.LanguageTag
      requestedLanguage = [string]$selection.RequestedLanguage
      maxImageDimension = $prepared.MaxDimension
      scaled            = [bool]$prepared.Scaled
      sourceWidth       = $prepared.SourceWidth
      sourceHeight      = $prepared.SourceHeight
    } -Compress -Depth 4
}
