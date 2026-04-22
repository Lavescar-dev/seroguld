'use client';

type DisplayState = 'loading' | 'empty' | 'waiting_lines' | 'confirmed' | 'cancelled';

type DisplayStatePanelProps = {
  state: DisplayState;
  connectionState: 'connecting' | 'live' | 'offline';
};

const COPY: Record<DisplayState, { title: string; description: string }> = {
  loading: {
    title: 'Veri yukleniyor',
    description: 'Lutfen bekleyin, islem bilgileri ve canli satirlar getiriliyor.',
  },
  empty: {
    title: 'Islem bekleniyor',
    description: 'Satici ekraninda yeni bir POS oturumu baslatildiginda bilgiler burada gorunur.',
  },
  waiting_lines: {
    title: 'Kalem bekleniyor',
    description: 'Satici kalem ekledikce satirlar burada canli olarak listelenir.',
  },
  confirmed: {
    title: 'Islem onaylandi',
    description: 'Bu islem tamamlandi. Gerekirse yeni islem baslatilabilir.',
  },
  cancelled: {
    title: 'Islem iptal edildi',
    description: 'Bu oturum iptal edildi. Yeni bir oturum acildiginda ekran otomatik guncellenir.',
  },
};

export function DisplayStatePanel({ state, connectionState }: DisplayStatePanelProps) {
  const copy = COPY[state];
  const isWaiting = state === 'waiting_lines' || state === 'empty';

  return (
    <div className="grid min-h-[480px] place-items-center rounded-3xl border border-[#4a3d2a] bg-[radial-gradient(circle_at_top,#2d2419_0%,#18130f_58%)] px-6 py-12 text-center shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
      <div className="w-full max-w-5xl">
        {isWaiting ? (
          <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-500/12 px-5 py-2 text-sm font-semibold text-emerald-100 md:text-base">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300" />
            Canli bekleme modu aktif
          </div>
        ) : null}

        <p className="text-4xl font-semibold text-[#f7ebd1] md:text-7xl">{copy.title}</p>
        <p className="mx-auto mt-4 max-w-4xl text-lg text-[#dccbac] md:text-3xl">{copy.description}</p>

        {isWaiting ? (
          <div className="mx-auto mt-8 grid max-w-3xl gap-2 rounded-2xl border border-[#5b4a33] bg-[#231c14] p-5 text-left">
            <p className="text-base text-[#eddcb8] md:text-lg">1) Satici belge satirini ekler</p>
            <p className="text-base text-[#eddcb8] md:text-lg">2) Satir burada anlik olarak gorunur</p>
            <p className="text-base text-[#eddcb8] md:text-lg">3) Toplam teklif ve kalem sayisi otomatik guncellenir</p>
          </div>
        ) : null}

        {connectionState !== 'live' && (
          <p className="mt-7 text-base font-semibold text-amber-300 md:text-2xl">
            Baglanti durumu: {connectionState === 'connecting' ? 'yeniden baglaniyor' : 'baglanti kesildi'}
          </p>
        )}
      </div>
    </div>
  );
}
