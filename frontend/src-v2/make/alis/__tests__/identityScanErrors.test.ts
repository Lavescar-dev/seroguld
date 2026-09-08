import { describe, expect, it } from 'vitest';

import {
  buildIdentityScanLowResCode,
  describeLowResIdentityScan,
  describeScannerError,
  isLowResolutionIdentityImage,
} from '../identityScan';

// İş 4 — tarayıcı hata kodlarının UI ayrımı: kod teşhisi saha metnine
// bağlanır, iptal sessizdir. (Pure sözleşme; hook/panel testleri ayrı dosyada.)
describe('describeScannerError (İş 4 hata ayrımı)', () => {
  it('SCAN_CANCELLED sessizdir — kullanıcı iptali hata değildir', () => {
    expect(
      describeScannerError({ code: 'SCAN_CANCELLED', message: 'Tarama iptal edildi.', retryable: true }),
    ).toBeNull();
  });

  it('SCANNER_UNAVAILABLE cihaz-açık/ağda ve WIA sürücüsü yönlendirmesini taşır', () => {
    const described = describeScannerError({
      code: 'SCANNER_UNAVAILABLE',
      message: 'WIA tarayıcı hizmeti veya cihazı kullanılamıyor.',
      retryable: true,
    });
    expect(described?.code).toBe('SCANNER_UNAVAILABLE');
    // exit 3 (cihaz yok) artık "iptal edildi" sanılmaz: cihaz+ ağ + sürücü teşhisi.
    expect(described?.message).toContain('açık');
    expect(described?.message).toContain('ağda');
    expect(described?.message).toContain('WIA');
    // Alternatif hat da gösterilir: WIA çalışmıyorsa klasör izleme devreye girer.
    expect(described?.message).toContain('Klasörden');
  });

  it('INVALID_IMAGE Epson profili JPEG + tek sayfa ayarı metnini taşır', () => {
    const described = describeScannerError({
      code: 'INVALID_IMAGE',
      message: 'Yalnızca geçerli JPG, PNG, TIFF veya BMP görüntüleri seçilebilir.',
      retryable: false,
    });
    expect(described?.code).toBe('INVALID_IMAGE');
    expect(described?.message).toContain('JPEG');
    expect(described?.message).toContain('tek sayfa');
    expect(described?.message).toContain('Epson');
  });

  it('WATCH_* kodları izleme hattına özgü metinle açıklanır', () => {
    const unavailable = describeScannerError({
      code: 'WATCH_FOLDER_UNAVAILABLE',
      message: 'İzlenecek klasör açılamıyor — yolu ve erişim izinlerini kontrol edin.',
      retryable: true,
    });
    expect(unavailable?.code).toBe('WATCH_FOLDER_UNAVAILABLE');
    expect(unavailable?.message).toContain('klasör');

    const active = describeScannerError({
      code: 'WATCH_ALREADY_ACTIVE',
      message: 'Klasör izleme zaten etkin — önce durdurun.',
      retryable: false,
    });
    expect(active?.code).toBe('WATCH_ALREADY_ACTIVE');
    expect(active?.message).toContain('durdurun');
  });

  it('ipuçlı kodu olmayan hatalar Rust mesajını ve kodu olduğu gibi taşır', () => {
    const described = describeScannerError({
      code: 'FILE_TOO_LARGE',
      message: 'Görüntü dosyası 10 MB sınırını aşıyor.',
      retryable: false,
    });
    expect(described).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'Görüntü dosyası 10 MB sınırını aşıyor.',
    });
  });

  it('şekilsiz hata INTERNAL_ERROR koduyla genel mesaja düşer', () => {
    expect(describeScannerError('patladı')).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Tarama başarısız oldu.',
    });
    // Error örneği de (kod alanı yoksa) aynı sözleşmeye düşer.
    expect(describeScannerError(new Error('boom'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });
  });
});

// 0.3.36 — düşük çözünürlük yönlendirmesi: 125 DPI WIA varsayılanı (419×288)
// saha taraması "tanınamadı" yerine DPI/çekim yönlendirmesi alır. Pure sözleşme.
describe('düşük çözünürlük yönlendirmesi (0.3.36)', () => {
  it('419×288 saha taraması DPI + yakından çekim yönlendirmesi taşır', () => {
    const message = describeLowResIdentityScan(419, 288);
    expect(message).toContain('çok düşük çözünürlüklü');
    expect(message).toContain('(419×288)');
    expect(message).toContain('300 DPI');
    expect(message).toContain('yakinden');
  });

  it('eşik üstü ya da boyutu bilinmeyen görüntüde yönlendirme yok (null)', () => {
    expect(describeLowResIdentityScan(1011, 1099)).toBeNull();
    // Eşik değerler dahil edilmez: 600×400 kabul edilir.
    expect(describeLowResIdentityScan(600, 400)).toBeNull();
    expect(describeLowResIdentityScan(undefined, undefined)).toBeNull();
  });

  it('tek ekseni düşük görüntü de düşük çözünürlük sayılır', () => {
    expect(isLowResolutionIdentityImage(599, 1200)).toBe(true);
    expect(isLowResolutionIdentityImage(1200, 399)).toBe(true);
    expect(isLowResolutionIdentityImage(600, 400)).toBe(false);
    expect(isLowResolutionIdentityImage(undefined, 1200)).toBe(false);
  });

  it('hata imzası idscan ailesinden ve ascii atom kısıtına uyar', () => {
    expect(buildIdentityScanLowResCode(419, 288)).toBe('idscan.lowres.419x288');
    expect(buildIdentityScanLowResCode(undefined, undefined)).toBe('idscan.lowres');
    // Rust validate_ui_diagnostic safe_atom: alfanumerik + -_.:+, en fazla 64.
    expect(buildIdentityScanLowResCode(419, 288)).toMatch(/^[A-Za-z0-9_.:+-]{1,64}$/);
    // Yönlendirme ham OCR satırını içermez (PII sızması yok).
    expect(describeLowResIdentityScan(419, 288)).not.toContain('9aa');
  });
});
