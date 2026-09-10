import { describe, expect, it } from 'vitest';
import { buildIdentityScanWarnCodes } from '../identityScan';

// Saha telemetrisi (0.3.41): uyarı token'ları -> idscan.warn.* kodları.
// Rust validate_ui_diagnostic atom kısıtı: [A-Za-z0-9-_.:+], en fazla 64
// karakter — üretici bunu kendisi garanti eder. Görüntü/OCR metni/alan
// değeri imza yüzeyi yoktur: girdi yalnız taraf + belge tipi + uyarı
// token'larıdır.
describe('buildIdentityScanWarnCodes', () => {
  it('normal uyarıyı idscan.warn ailesine yazar', () => {
    expect(buildIdentityScanWarnCodes('front', 'sundhedskort', ['glare_detected'])).toEqual([
      'idscan.warn.front.sundhedskort.glare_detected',
    ]);
  });

  it('bilinmeyen türe düşer ve vlm_failed: içindeki iki noktayı korur', () => {
    expect(buildIdentityScanWarnCodes('back', null, ['vlm_failed:timeout'])).toEqual([
      'idscan.warn.back.unknown.vlm_failed:timeout',
    ]);
    expect(buildIdentityScanWarnCodes('back', undefined, ['vlm_failed:timeout'])).toEqual([
      'idscan.warn.back.unknown.vlm_failed:timeout',
    ]);
  });

  it('atom-dışı karakterleri temizler (enjeksiyon yüzeyi yok)', () => {
    expect(buildIdentityScanWarnCodes('front', 'health card!', ['card not_detected'])).toEqual([
      'idscan.warn.front.healthcard.cardnot_detected',
    ]);
  });

  it('64 karakteri asan kodu tavana kırpar', () => {
    const [code] = buildIdentityScanWarnCodes('front', 'unknown', ['x'.repeat(40)]);
    expect(code).toBe(`idscan.warn.front.unknown.${'x'.repeat(35)}...`);
    expect(code.length).toBe(64);
  });

  it('bos/gecersiz tokenlarda sessiz kalir', () => {
    expect(buildIdentityScanWarnCodes('front', 'sundhedskort', ['', '   ', 42, null])).toEqual([]);
  });
});
