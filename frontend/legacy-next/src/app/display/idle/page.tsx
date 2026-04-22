'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';

export default function DisplayIdlePage() {
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [clock, setClock] = useState('');
  const [dateText, setDateText] = useState('');
  const kioskMode = searchParams.get('kiosk') === '1';

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(
        new Intl.DateTimeFormat('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(now),
      );
      setDateText(
        new Intl.DateTimeFormat('tr-TR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }).format(now),
      );
    };

    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        setFullscreenError('');
      }
    };
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenError('');
    } catch {
      setFullscreenError('Tam ekran acilamadi. Butona tekrar tiklayin.');
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await enterFullscreen();
  }

  useEffect(() => {
    if (!kioskMode || isFullscreen) return;
    const timer = window.setTimeout(() => {
      void enterFullscreen();
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [kioskMode, isFullscreen]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#231c14_0%,#10141a_62%)] text-[#f5efe1]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1880px] grid-rows-[auto,1fr] gap-4 p-3 md:gap-5 md:p-6">
        <header className="rounded-[2rem] border border-[#4c3f2d] bg-[linear-gradient(120deg,#1f1811_0%,#14110f_55%,#101318_100%)] px-6 py-5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] md:px-8 md:py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#c5aa74] md:text-sm">Sero Guld POS</p>
              <h1 className="mt-1 text-3xl font-semibold text-[#f8edcf] md:text-5xl">Musteri Ekrani Hazir</h1>
              <p className="mt-2 text-base text-[#d6c8ad] md:text-2xl">Yeni islem bekleniyor</p>
              <p className="mt-2 max-w-3xl text-sm text-[#cbb892] md:text-lg">
                Bu ekran ikinci monitor / TV icin hazirdir. Satici POS oturumu baslattiginda ilgili display sayfasi otomatik acilir.
              </p>
              <p className="mt-1 text-[11px] text-[#cab893]">UI: DISPLAY-IDLE-V5-2026-03-17</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-200 md:text-base">
                Hazir
              </span>
              <Button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="rounded-full border border-[#7a6543] bg-[#2a2218] px-5 py-2 text-[#ecd8ab] hover:bg-[#342a1f]"
              >
                {isFullscreen ? 'Tam Ekrandan Cik' : 'Tam Ekran'}
              </Button>
            </div>
          </div>
          {fullscreenError && <p className="mt-3 text-sm font-semibold text-amber-300 md:text-lg">{fullscreenError}</p>}
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="grid place-items-center rounded-[2rem] border border-[#4a3d2a] bg-[radial-gradient(circle_at_top,#30261a_0%,#18130f_58%)] px-6 py-12 text-center shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
            <div className="max-w-5xl">
              <p className="text-base font-semibold uppercase tracking-[0.2em] text-[#ccb17c] md:text-2xl">Islem Bekleniyor</p>
              <p className="mt-4 text-[clamp(2.2rem,6vw,5.2rem)] font-semibold leading-tight text-[#f7ebd2]">
                Lutfen satici ekranindan POS islemini baslatin
              </p>
              <p className="mt-6 text-lg text-[#d7c7a6] md:text-2xl">
                Satirlar, toplamlar ve belge durumu islem basladigi anda bu ekrana canli yansitilir.
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[2rem] border border-[#4c3f2d] bg-[linear-gradient(135deg,#1c1611_0%,#131820_100%)] px-6 py-8 shadow-[0_20px_40px_rgba(0,0,0,0.36)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#c8af7b]">Saat</p>
              <p className="mt-3 text-[clamp(2.6rem,5vw,4.8rem)] font-semibold text-[#f3dfb1]">{clock}</p>
              <p className="mt-2 text-base text-[#d6c4a3] md:text-2xl capitalize">{dateText}</p>
            </div>

            <div className="rounded-[2rem] border border-[#4c3f2d] bg-[#18140f]/95 px-6 py-6 shadow-[0_20px_40px_rgba(0,0,0,0.32)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c8af7b]">Hazirlik Durumu</p>
              <div className="mt-3 grid gap-3">
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100">
                  Kiosk / fullscreen modu aktif olmaya hazir
                </div>
                <div className="rounded-2xl border border-[#5b4a33] bg-[#231c14] px-4 py-3 text-sm text-[#e7d8ba]">
                  Satici ekraninda islem acildiginda:
                  <div className="mt-2 grid gap-2 text-[#d6c4a3]">
                    <p>Belge basligi ve durum bilgisi yuklenir</p>
                    <p>Kalemler satir satir görünur</p>
                    <p>Toplam teklif anlik guncellenir</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
