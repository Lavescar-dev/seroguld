import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { formatNumber } from '@/lib/format';
import type { PosDisplaySnapshot, PosWorkspaceGoldRow, PosWorkspaceSilverRow } from '@/types';

type CustomerDisplayIdleViewProps = {
  embedded?: boolean;
  now?: Date;
};

type CustomerDisplayLiveViewProps = {
  snapshot: PosDisplaySnapshot;
  connection: 'connecting' | 'live' | 'offline';
  embedded?: boolean;
};

const DISPLAY_SCENE_WIDTH = 1920;
const DISPLAY_SCENE_HEIGHT = 1080;

const FONT_STACK_SANS = "'IBM Plex Sans', system-ui, sans-serif";
const FONT_STACK_SERIF = "Georgia, 'Times New Roman', serif";

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeLabel(value?: Date) {
  if (!value) return '—';
  return value.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function decimalLabel(value?: string | number | null, suffix = '') {
  const formatted = formatNumber(value, suffix);
  return formatted === '-' ? '—' : formatted;
}

function parseDecimalValue(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasWorksheetGram(value?: string | number | null) {
  return parseDecimalValue(value) > 0;
}

function useDisplaySceneScale() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: DISPLAY_SCENE_WIDTH, height: DISPLAY_SCENE_HEIGHT });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: Math.max(rect.width, 1),
        height: Math.max(rect.height, 1),
      });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const scaleX = size.width / DISPLAY_SCENE_WIDTH;
  const scaleY = size.height / DISPLAY_SCENE_HEIGHT;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (size.width - DISPLAY_SCENE_WIDTH * scale) / 2;
  const offsetY = (size.height - DISPLAY_SCENE_HEIGHT * scale) / 2;

  return { containerRef, scale, offsetX, offsetY };
}

function DisplaySceneViewport({
  children,
  embedded = false,
}: {
  children: ReactNode;
  embedded?: boolean;
}) {
  const { containerRef, scale, offsetX, offsetY } = useDisplaySceneScale();

  return (
    <div className={embedded ? 'relative aspect-video w-full overflow-hidden' : 'relative h-screen w-screen overflow-hidden'}>
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        style={{ backgroundColor: 'var(--display-surface-page)' }}
      >
        <div
          className="origin-top-left"
          style={{
            width: `${DISPLAY_SCENE_WIDTH}px`,
            height: `${DISPLAY_SCENE_HEIGHT}px`,
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarField({
  label,
  value,
  bigValue = false,
  wrap = false,
}: {
  label: string;
  value: string;
  bigValue?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className="mb-2 text-[14px] uppercase tracking-wider"
        style={{ color: 'var(--display-ink-muted)' }}
      >
        {label}
      </div>
      <div
        className={`font-bold ${bigValue ? 'text-[28px] leading-tight' : 'text-[20px]'} ${
          wrap ? 'break-words leading-snug' : 'truncate'
        }`}
        style={{ color: 'var(--display-ink-on-card)' }}
      >
        {value || '—'}
      </div>
    </div>
  );
}

function LogoBar() {
  return (
    <div
      className="flex shrink-0 items-center justify-center border-b px-10 py-10"
      style={{
        backgroundColor: 'var(--display-surface-logo)',
        borderColor: 'var(--display-border-sidebar)',
      }}
    >
      <img src="/seroguld-logo.png" alt="SERO GULD" className="h-16 w-auto" />
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex shrink-0 items-center gap-6 px-10 py-3">
      <span
        className="whitespace-nowrap text-[20px] font-bold uppercase tracking-[0.25em]"
        style={{ color: 'var(--display-accent)', fontFamily: FONT_STACK_SERIF }}
      >
        {title}
      </span>
      <span
        className="h-[3px] flex-1"
        style={{
          background:
            'linear-gradient(to right, var(--display-gradient-divider-from), var(--display-gradient-divider-to))',
        }}
      />
    </div>
  );
}

function DisplayWaitingPanel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="flex w-[980px] flex-col items-center justify-center border px-16 py-20 text-center"
      style={{
        backgroundColor: 'var(--display-surface-logo)',
        borderColor: 'var(--display-border-subtle)',
        boxShadow: '0 30px 70px rgba(48, 32, 24, 0.08)',
      }}
    >
      <img src="/seroguld-logo.png" alt="SERO GULD" className="mb-12 h-24 w-auto" />
      <p
        className="text-[30px] font-bold uppercase tracking-[0.18em]"
        style={{ color: 'var(--display-ink-strong)', fontFamily: FONT_STACK_SERIF }}
      >
        {title}
      </p>
      <p className="mt-5 text-[18px] uppercase tracking-[0.16em]" style={{ color: 'var(--display-ink-muted)' }}>
        {subtitle}
      </p>
    </div>
  );
}

type T5RowProps =
  | { kind: 'gold'; row: PosWorkspaceGoldRow }
  | { kind: 'silver'; row: PosWorkspaceSilverRow };

function T5Row(props: T5RowProps) {
  const { kind, row } = props;
  const purity =
    kind === 'gold'
      ? [row.karat ? `${row.karat} K` : null, row.lodighed].filter(Boolean).join(' · ')
      : row.lodighed || '—';
  const label = kind === 'gold' ? 'Guld' : 'Sølv';

  return (
    <div
      className="flex min-h-0 flex-1 items-center border-b last:border-0"
      style={{ borderColor: 'var(--display-border-subtle)' }}
    >
      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[260px_140px_240px_200px_280px] items-center gap-x-10 px-10">
        <span
          className="text-[17px] font-medium"
          style={{ color: 'var(--display-ink-on-card)', fontFamily: FONT_STACK_SERIF }}
        >
          {label} {row.label || ''}
        </span>
        <span className="text-[16px] font-medium" style={{ color: 'var(--display-ink-muted)' }}>
          {purity || '—'}
        </span>
        <span
          className="tabular-nums text-[16px]"
          style={{ color: 'var(--display-ink-on-card)' }}
        >
          {decimalLabel(row.gram, ' g')}
        </span>
        <span
          className="tabular-nums text-[16px] font-medium"
          style={{ color: 'var(--display-ink-muted)' }}
        >
          {decimalLabel(row.unit_price_dkk, ' DKK')}
        </span>
        <span
          className="tabular-nums text-right text-[17px] font-semibold"
          style={{ color: 'var(--display-ink-on-card)' }}
        >
          {decimalLabel(row.line_total_dkk, ' DKK')}
        </span>
      </div>
    </div>
  );
}

export function CustomerDisplayIdleView({ embedded = false, now = new Date() }: CustomerDisplayIdleViewProps) {
  const scene = (
    <div
      data-testid="customer-display-idle"
      className="flex h-[1080px] w-[1920px]"
      style={{ backgroundColor: 'var(--display-surface-page)', fontFamily: FONT_STACK_SANS }}
    >
      <aside
        className="flex w-[480px] shrink-0 flex-col border-r"
        style={{
          backgroundColor: 'var(--display-surface-sidebar)',
          borderColor: 'var(--display-border-sidebar)',
        }}
      >
        <LogoBar />
        <div
          className="border-b px-10 py-12"
          style={{ borderColor: 'var(--display-border-subtle)' }}
        >
          <h2
            className="mb-6 text-[18px] font-semibold tracking-[0.15em]"
            style={{ color: 'var(--display-ink-muted)' }}
          >
            AFREGNING · BELGE
          </h2>
          <div className="grid grid-cols-3 gap-5">
            <SidebarField label="NUMARA" value="—" />
            <SidebarField label="DATO" value={dateLabel(now.toISOString())} />
            <SidebarField label="SAAT" value={timeLabel(now)} />
          </div>
        </div>
        <div className="flex-1 px-10 py-12">
          <h2
            className="mb-6 text-[18px] font-semibold tracking-[0.15em]"
            style={{ color: 'var(--display-ink-muted)' }}
          >
            KUNDEOPLYSNINGER · MÜŞTERİ BİLGİLERİ
          </h2>
          <p className="text-[20px]" style={{ color: 'var(--display-ink-muted)' }}>
            Müşteri seçimi bekleniyor
          </p>
          <p className="mt-1 text-[14px]" style={{ color: 'var(--display-ink-muted)' }}>
            Afventer kunde
          </p>
        </div>
      </aside>

      <main
        className="flex flex-1 flex-col items-center justify-center gap-10 px-16"
        style={{ backgroundColor: 'var(--display-surface-card)' }}
      >
        <DisplayWaitingPanel title="Alış hazırlanıyor" subtitle="Kundevisning er klar" />
        <div className="flex items-center gap-6">
          <span
            className="h-[3px] w-28"
            style={{
              background:
                'linear-gradient(to right, var(--display-gradient-divider-from), var(--display-gradient-divider-to))',
            }}
          />
          <span
            className="text-[22px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--display-ink-strong)', fontFamily: FONT_STACK_SERIF }}
          >
            Aktuelle Guld og Sølvpriser
          </span>
        </div>
        <p
          className="tabular-nums text-[76px] font-bold leading-none"
          style={{ color: 'var(--display-ink-strong)' }}
        >
          {timeLabel(now)}
        </p>
        <p
          className="text-[18px] uppercase tracking-[0.25em]"
          style={{ color: 'var(--display-ink-muted)' }}
        >
          İşlem bekleniyor · Awaiting transaction
        </p>
      </main>
    </div>
  );

  return <DisplaySceneViewport embedded={embedded}>{scene}</DisplaySceneViewport>;
}

export function CustomerDisplayLiveView({
  snapshot,
  connection,
  embedded = false,
}: CustomerDisplayLiveViewProps) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const goldRows = useMemo(() => snapshot.gold_rows ?? [], [snapshot.gold_rows]);
  const silverRows = useMemo(() => snapshot.silver_rows ?? [], [snapshot.silver_rows]);
  const goldFilled = useMemo(() => goldRows.filter((row) => hasWorksheetGram(row.gram)), [goldRows]);
  const silverFilled = useMemo(() => silverRows.filter((row) => hasWorksheetGram(row.gram)), [silverRows]);
  const hasAnyRow = goldFilled.length > 0 || silverFilled.length > 0;
  const totalAmount = useMemo(() => {
    if (snapshot.lines_total_dkk) return snapshot.lines_total_dkk;
    const sum = [...goldRows, ...silverRows].reduce(
      (acc, row) => acc + parseDecimalValue(row.line_total_dkk),
      0,
    );
    if (sum > 0) return sum.toFixed(2);
    return snapshot.final_offer_dkk ?? '0';
  }, [goldRows, silverRows, snapshot.final_offer_dkk, snapshot.lines_total_dkk]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const addressLine = useMemo(() => {
    const lines: string[] = [];
    if (snapshot.customer_address) lines.push(snapshot.customer_address);
    const postalCity = [snapshot.customer_postal_code, snapshot.customer_city].filter(Boolean).join(' ');
    if (postalCity) lines.push(postalCity);
    return lines.join('\n') || '—';
  }, [snapshot.customer_address, snapshot.customer_city, snapshot.customer_postal_code]);

  const cprDisplay = snapshot.customer_cpr_masked || '—';
  const idDocDisplay = snapshot.customer_identity_doc_number_masked || '—';

  const documentNumber = snapshot.document_number || snapshot.session_code || '—';

  const scene = (
    <div
      data-testid="customer-display-live"
      className="flex h-[1080px] w-[1920px]"
      style={{ backgroundColor: 'var(--display-surface-page)', fontFamily: FONT_STACK_SANS }}
    >
      {/* === SOL: S1 Detailed Form === */}
      <aside
        className="flex w-[480px] shrink-0 flex-col border-r"
        style={{
          backgroundColor: 'var(--display-surface-sidebar)',
          borderColor: 'var(--display-border-sidebar)',
        }}
      >
        <LogoBar />
        <div
          className="border-b px-10 py-12"
          style={{ borderColor: 'var(--display-border-subtle)' }}
        >
          <h2
            className="mb-6 text-[18px] font-semibold tracking-[0.15em]"
            style={{ color: 'var(--display-ink-muted)' }}
          >
            AFREGNING · BELGE
          </h2>
          <div className="grid grid-cols-3 gap-5">
            <SidebarField label="NUMARA" value={documentNumber} />
            <SidebarField label="DATO" value={dateLabel(snapshot.updated_at)} />
            <SidebarField label="SAAT" value={timeLabel(currentTime)} />
          </div>
        </div>
        <div className="flex-1 px-10 py-12">
          <h2
            className="mb-6 text-[18px] font-semibold tracking-[0.15em]"
            style={{ color: 'var(--display-ink-muted)' }}
          >
            KUNDEOPLYSNINGER · MÜŞTERİ BİLGİLERİ
          </h2>
          <div className="space-y-7">
            <SidebarField label="NAVN · AD SOYAD" value={snapshot.customer_name || '—'} bigValue />
            <div className="grid grid-cols-2 gap-4">
              <SidebarField label="TELEFON / TLF" value={snapshot.customer_phone || '—'} />
              <SidebarField label="TARİH" value={dateLabel(snapshot.updated_at)} />
            </div>
            <SidebarField label="E-POSTA · E-MAIL" value={snapshot.customer_email || '—'} wrap />
            <div className="grid grid-cols-2 gap-4">
              <SidebarField label="KØREKORT · PAS" value={idDocDisplay} />
              <SidebarField label="CPR" value={cprDisplay} />
            </div>
            <div>
              <div
                className="mb-2 text-[14px] uppercase tracking-wider"
                style={{ color: 'var(--display-ink-muted)' }}
              >
                ADRES
              </div>
              <p
                className="whitespace-pre-line text-[18px] font-medium leading-relaxed"
                style={{ color: 'var(--display-ink-on-card)' }}
              >
                {addressLine}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* === SAĞ: T5 Premium Editorial + F7 Emerald Footer === */}
      <section
        className="flex min-h-0 flex-1 flex-col"
        style={{ backgroundColor: 'var(--display-surface-card)' }}
      >
        <div
          className="flex shrink-0 items-center justify-center border-b px-10 py-6"
          style={{ borderColor: 'var(--display-border-subtle)' }}
        >
          <h1
            className="text-[24px] font-bold uppercase tracking-[0.25em]"
            style={{ color: 'var(--display-ink-strong)', fontFamily: FONT_STACK_SERIF }}
          >
            Aktuelle Guld og Sølvpriser
          </h1>
        </div>

        {goldFilled.length > 0 && (
          <>
            <GroupHeader title="GULD · ALTIN" />
            <div
              className="flex flex-[8] flex-col"
              style={{ backgroundColor: 'var(--display-metal-gold-tint)' }}
            >
              {goldFilled.map((row) => (
                <T5Row key={row.row_key} kind="gold" row={row} />
              ))}
            </div>
          </>
        )}

        {silverFilled.length > 0 && (
          <>
            <GroupHeader title="SØLV · GÜMÜŞ" />
            <div
              className="flex flex-[5] flex-col"
              style={{ backgroundColor: 'var(--display-metal-silver-tint)' }}
            >
              {silverFilled.map((row) => (
                <T5Row key={row.row_key} kind="silver" row={row} />
              ))}
            </div>
          </>
        )}

        {/* TODO: backend PosSessionDisplayOut.platinum_rows eklenince PLATIN bloğu aktive edilecek */}

        {!hasAnyRow && (
          <div className="flex flex-1 items-center justify-center">
            <DisplayWaitingPanel title="Ürün satırı bekleniyor" subtitle="Afventer varelinjer" />
          </div>
        )}

        <footer
          className="flex w-full shrink-0 items-center justify-between gap-6 px-10 py-5"
          style={{
            background:
              'linear-gradient(to right, var(--display-gradient-footer-from), var(--display-gradient-footer-to))',
          }}
        >
          <div className="flex flex-col gap-0.5">
            <div className="text-[14px] font-bold uppercase tracking-[0.25em] text-white">
              Genel Toplam
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/70">
              I alt · Grand Total
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className="tabular-nums whitespace-nowrap text-[40px] font-bold leading-none tracking-tight"
              style={{ color: 'var(--display-footer-amount-ink)' }}
            >
              {decimalLabel(totalAmount)}
            </span>
            <span
              className="text-[18px] font-bold"
              style={{ color: 'var(--display-footer-amount-ink)' }}
            >
              DKK
            </span>
          </div>
        </footer>
      </section>

      {/* Connection state hidden in priser design; aria-live for accessibility */}
      <span aria-live="polite" className="sr-only">
        {connection === 'offline'
          ? 'Bağlantı bekleniyor'
          : connection === 'connecting'
            ? 'Bağlanıyor'
            : 'Canlı bağlantı'}
      </span>
    </div>
  );

  return <DisplaySceneViewport embedded={embedded}>{scene}</DisplaySceneViewport>;
}
