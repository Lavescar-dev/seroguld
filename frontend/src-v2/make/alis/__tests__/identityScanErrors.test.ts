import { describe, expect, it } from 'vitest';

import { describeScannerError } from '../identityScan';

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
