// Eritme / Satış / Payout paneli — Classic MeltSection + MeltLotCard
// (LogPage.tsx:1275-1376, 1553-1811) paritesi: katlanabilir bölüm, eritme havuzu
// özeti, Öncesi/Sonrası/Fark izgarası, gider toplamı, has × quote × kurs = DK
// Total paneli, "Avance I alt (A51)" ve payout sapması uyarısı.
import { AlertTriangle, ChevronDown, ChevronUp, Download, Flame, History, List, Lock, Save, Trash2, Unlock } from 'lucide-react';

import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { toFloat } from '@/make/log/lineHelpers';
import { toLotDraft, type MeltLotDraft } from '@/make/log/types';
import { EmptyState, ModernSection, shellButtonClass } from '@/modern/modules/shared';
import type { LogBucketWorkspace, LogMeltLot } from '@/types';

import { hasPayoutVariance, labelLotStatus, payoutVariancePercent } from './labels';

const inputClass =
  'mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none focus:border-sg-accent';
const tinyHeader = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft';

export interface MeltLotPanelProps {
  bucket: LogBucketWorkspace;
  lotDrafts: Record<string, MeltLotDraft>;
  show: boolean;
  meltBusy: boolean;
  createMeltBusy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  pureUnit: 'has' | 'saf';
  onToggleMeltSection: () => void;
  onCreateMeltLot: () => void;
  onLotDraftChange: (lotId: string, patch: Partial<MeltLotDraft>) => void;
  onSaveLot: (lotId: string) => void;
  onFinalizeLot: (lotId: string, reverse: boolean) => void;
  onDeleteLot: (lotId: string) => void;
  onDownloadLotPdf: (lotId: string) => void;
  onOpenLotHistory: (lotId: string) => void;
  onOpenLotLines: (lotId: string) => void;
}

export function MeltLotPanel({
  bucket,
  lotDrafts,
  show,
  meltBusy,
  createMeltBusy,
  finalizeBusy,
  deleteBusy,
  pureUnit,
  onToggleMeltSection,
  onCreateMeltLot,
  onLotDraftChange,
  onSaveLot,
  onFinalizeLot,
  onDeleteLot,
  onDownloadLotPdf,
  onOpenLotHistory,
  onOpenLotLines,
}: MeltLotPanelProps) {
  const queue = bucket.melt_queue;
  const queueEmpty = queue.line_count === 0;

  return (
    <ModernSection
      title="Melt Lotları"
      subtitle="Eritme havuzundan lot aç, lot verilerini güncelle ve kesinleştir; payout sonucu burada oluşur."
      actions={
        <button
          type="button"
          onClick={onToggleMeltSection}
          aria-expanded={show}
          data-testid="log-melt-toggle"
          className={shellButtonClass('secondary')}
        >
          {show ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {show ? 'Gizle' : 'Göster'}
        </button>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2">
          <div className="min-w-0">
            <p className={tinyHeader}>Eritme Havuzu</p>
            <p className="mt-1 text-xs text-sg-text-soft">Bu havuzdan yeni melt lot kartı açılır.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sg-text">
            <span>{queue.line_count} satır</span>
            <span>{formatNumber(queue.total_weight_grams, ' g')}</span>
            <span>{formatMoney(queue.total_amount_dkk)}</span>
            <span className="font-semibold text-sg-amber">{formatNumber(queue.total_pure_gold_grams, ` ${pureUnit}`)}</span>
            <button
              type="button"
              onClick={onCreateMeltLot}
              disabled={createMeltBusy || queueEmpty}
              title={queueEmpty ? 'Eritme kuyruğunda satır yok' : 'Yeni eritme lotu oluştur'}
              data-testid="log-create-melt-lot"
              className={shellButtonClass('primary')}
            >
              <Flame className="h-4 w-4" />
              Yeni Eritme Lotu
            </button>
          </div>
        </div>

        {show ? (
          bucket.melt_lots.length === 0 ? (
            <EmptyState title="Lot Yok" message="Seçili bucket için henüz melt lot oluşturulmadı." />
          ) : (
            bucket.melt_lots.map((lot, index) => (
              <MeltLotCard
                key={lot.id}
                index={index}
                lot={lot}
                // Classic paritesi (LogPage MeltSection): henüz seed edilmemiş lot için
                // kart, lot'un kayıtlı değerlerini gösterir — boş input göstermez.
                draft={lotDrafts[lot.id] ?? toLotDraft(lot)}
                meltBusy={meltBusy}
                finalizeBusy={finalizeBusy}
                deleteBusy={deleteBusy}
                onLotDraftChange={(patch) => onLotDraftChange(lot.id, patch)}
                onSave={() => onSaveLot(lot.id)}
                onFinalize={(reverse) => onFinalizeLot(lot.id, reverse)}
                onDelete={() => onDeleteLot(lot.id)}
                onDownloadPdf={() => onDownloadLotPdf(lot.id)}
                onOpenHistory={() => onOpenLotHistory(lot.id)}
                onOpenLines={() => onOpenLotLines(lot.id)}
              />
            ))
          )
        ) : (
          <p className="text-xs text-sg-text-soft">Lot kartlarını görmek için bölümü açın.</p>
        )}
      </div>
    </ModernSection>
  );
}

function MeltLotCard({
  index,
  lot,
  draft,
  meltBusy,
  finalizeBusy,
  deleteBusy,
  onLotDraftChange,
  onSave,
  onFinalize,
  onDelete,
  onDownloadPdf,
  onOpenHistory,
  onOpenLines,
}: {
  index: number;
  lot: LogMeltLot;
  draft: MeltLotDraft | undefined;
  meltBusy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  onLotDraftChange: (patch: Partial<MeltLotDraft>) => void;
  onSave: () => void;
  onFinalize: (reverse: boolean) => void;
  onDelete: () => void;
  onDownloadPdf: () => void;
  onOpenHistory: () => void;
  onOpenLines: () => void;
}) {
  const isFinalized = lot.status === 'finalized';
  const lineCount = lot.line_count || 0;
  const varianceVisible = hasPayoutVariance(lot.payout_total_dkk, lot.estimated_sale_value_dkk);
  const variancePercent = payoutVariancePercent(lot.payout_total_dkk, lot.estimated_sale_value_dkk);
  const netAfterCosts = toFloat(lot.net_after_costs_dkk);
  const netToneClass = netAfterCosts > 0 ? 'border-sg-green/40 bg-sg-green-soft text-sg-green-strong' : netAfterCosts < 0 ? 'border-sg-red/40 bg-sg-red-soft text-sg-red' : 'border-sg-border bg-sg-surface-soft text-sg-text-soft';

  return (
    <div className="overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface-soft" data-testid="log-melt-lot-card">
      <div className="flex flex-col gap-3 border-b border-sg-border bg-sg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-sg-text">Lot #{index + 1}</p>
            {isFinalized ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sg-green/20 bg-sg-green-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sg-green-strong">
                <Lock className="h-3 w-3" />
                {labelLotStatus(lot.status)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-sg-amber/20 bg-sg-amber-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sg-amber">
                <Unlock className="h-3 w-3" />
                {labelLotStatus(lot.status)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-sg-text-soft">
            {lot.sent_date ? formatDate(lot.sent_date) : 'Gönderim tarihi yok'}
            {lot.purchased_from_date ? ` · Købt fra ${formatDate(lot.purchased_from_date)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenLines} title="Bağlı AFG satırları" className={shellButtonClass('ghost')}>
            <List className="h-4 w-4" />
            Satırlar
            <span className="rounded-sg-sm border border-sg-border bg-sg-surface px-1.5 text-[10px] font-semibold text-sg-text-soft">{lineCount}</span>
          </button>
          <button type="button" onClick={onOpenHistory} title="Geçmiş" className={shellButtonClass('ghost')}>
            <History className="h-4 w-4" />
            Geçmiş
          </button>
          <button type="button" onClick={onDownloadPdf} title="PDF olarak indir" className={shellButtonClass('ghost')}>
            <Download className="h-4 w-4" />
            PDF
          </button>
          {!isFinalized ? (
            <button type="button" onClick={onSave} disabled={meltBusy} className={shellButtonClass('secondary')}>
              <Save className="h-4 w-4" />
              Kaydet
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onFinalize(isFinalized)}
            disabled={finalizeBusy}
            className={shellButtonClass(isFinalized ? 'secondary' : 'primary')}
          >
            {isFinalized ? 'Yeniden aç' : 'Kesinleştir'}
          </button>
          {!isFinalized && lineCount === 0 ? (
            <button type="button" onClick={onDelete} disabled={deleteBusy} title="Lotu sil" className={shellButtonClass('danger')}>
              <Trash2 className="h-4 w-4" />
              Sil
            </button>
          ) : null}
        </div>
      </div>

      {varianceVisible ? (
        <div className="flex items-start gap-2 border-b border-sg-amber/30 bg-sg-amber-soft px-4 py-2.5" data-testid="log-payout-variance">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sg-amber" />
          <div className="min-w-0 text-xs">
            <p className="font-bold uppercase tracking-[0.12em] text-sg-amber">Payout sapması: %{variancePercent.toFixed(1)}</p>
            <p className="mt-0.5 text-sg-text">
              Tahmini {formatMoney(lot.estimated_sale_value_dkk)} · Gerçek {formatMoney(lot.payout_total_dkk)}. Fark{' '}
              {formatMoney(toFloat(lot.payout_total_dkk) - toFloat(lot.estimated_sale_value_dkk))}. Lütfen quote/kurs/payout girişlerini doğrulayın.
            </p>
          </div>
        </div>
      ) : null}

      <fieldset disabled={isFinalized} className={`grid gap-3 p-4 xl:grid-cols-3 ${isFinalized ? 'opacity-70' : ''}`}>
        <div className="grid gap-2">
          <p className={tinyHeader}>Gram ve Has Altın</p>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Gönderim tarihi
            <input
              type="date"
              value={draft?.sent_date ?? ''}
              onChange={(event) => onLotDraftChange({ sent_date: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Alış başlangıcı
            <input
              type="date"
              value={draft?.purchased_from_date ?? ''}
              onChange={(event) => onLotDraftChange({ purchased_from_date: event.target.value })}
              className={inputClass}
            />
          </label>
          <div className="overflow-hidden rounded-sg-md border border-sg-border" data-testid="log-lot-purity-grid">
            <div className="grid grid-cols-3 border-b border-sg-border-soft bg-sg-surface-soft text-[11px] font-semibold uppercase tracking-[0.12em] text-sg-text-soft">
              <span className="px-2 py-1.5" />
              <span className="px-2 py-1.5 text-center">Gram</span>
              <span className="px-2 py-1.5 text-center text-sg-amber">Has</span>
            </div>
            <div className="grid grid-cols-3 border-b border-sg-border-soft text-xs">
              <span className="px-2 py-1.5 font-semibold text-sg-text-soft">Öncesi</span>
              <span className="px-2 py-1.5 text-center tabular-nums text-sg-text">{toFloat(lot.before_weight_grams).toFixed(2)}</span>
              <span className="bg-sg-amber-soft px-2 py-1.5 text-center font-semibold tabular-nums text-sg-amber">
                {toFloat(lot.before_pure_gold_grams).toFixed(3)}
              </span>
            </div>
            <div className="grid grid-cols-3 border-b border-sg-border-soft text-xs">
              <span className="px-2 py-1.5 font-semibold text-sg-green-strong">Sonrası</span>
              <span className="bg-sg-surface-soft px-2 py-1.5 text-center text-sg-text-soft">—</span>
              <input
                type="number"
                step="0.001"
                inputMode="decimal"
                value={draft?.after_pure_gold_grams ?? ''}
                onChange={(event) => onLotDraftChange({ after_pure_gold_grams: event.target.value })}
                placeholder="0.000"
                aria-label="Eritme sonrası has (g)"
                className="border-0 bg-sg-green-soft px-2 py-1.5 text-center text-xs font-semibold tabular-nums text-sg-green-strong outline-none"
              />
            </div>
            <div className="grid grid-cols-3 text-xs">
              <span className="px-2 py-1.5 font-semibold text-sg-red">Fark</span>
              <span className="bg-sg-surface-soft px-2 py-1.5 text-center text-sg-text-soft">—</span>
              <span className="px-2 py-1.5 text-center font-semibold tabular-nums text-sg-red">
                {toFloat(lot.bridge_difference_dkk) !== 0 ? formatMoney(lot.bridge_difference_dkk) : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <p className={tinyHeader}>Giderler ve Satış</p>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Sigorta
            <input inputMode="decimal" value={draft?.insurance_dkk ?? ''} onChange={(event) => onLotDraftChange({ insurance_dkk: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Kargo
            <input inputMode="decimal" value={draft?.shipping_dkk ?? ''} onChange={(event) => onLotDraftChange({ shipping_dkk: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Rafinasyon
            <input inputMode="decimal" value={draft?.refining_dkk ?? ''} onChange={(event) => onLotDraftChange({ refining_dkk: event.target.value })} className={inputClass} />
          </label>
          <div className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">Toplam Gider</span>
            <span className="font-bold tabular-nums text-sg-text">{formatMoney(lot.cost_total_dkk)}</span>
          </div>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Satış tarihi
            <input type="date" value={draft?.sale_date ?? ''} onChange={(event) => onLotDraftChange({ sale_date: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Fiyat teklifi (EUR)
            <input inputMode="decimal" value={draft?.quote_eur ?? ''} onChange={(event) => onLotDraftChange({ quote_eur: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Kur (DKK/EUR)
            <input inputMode="decimal" value={draft?.exchange_rate_dkk ?? ''} onChange={(event) => onLotDraftChange({ exchange_rate_dkk: event.target.value })} className={inputClass} />
          </label>
        </div>

        <div className="grid gap-2">
          <p className={tinyHeader}>Payout — Sonuç</p>
          <div className="overflow-hidden rounded-sg-md border border-sg-border" data-testid="log-lot-dk-total">
            <div className="flex items-center justify-between border-b border-sg-border-soft px-3 py-1.5 text-xs">
              <span className="text-sg-text-soft">Has altın (sonrası)</span>
              <span className="font-semibold tabular-nums text-sg-amber">{formatNumber(draft?.after_pure_gold_grams || lot.after_pure_gold_grams, ' g')}</span>
            </div>
            <div className="flex items-center justify-between border-b border-sg-border-soft px-3 py-1.5 text-xs">
              <span className="text-sg-text-soft">× Quote</span>
              <span className="font-semibold tabular-nums text-sg-text">{draft?.quote_eur || lot.quote_eur || '—'}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="text-sg-text-soft">× Kurs</span>
              <span className="font-semibold tabular-nums text-sg-text">{draft?.exchange_rate_dkk || lot.exchange_rate_dkk || '—'}</span>
            </div>
            <div className="flex items-center justify-between border-t border-sg-green/30 bg-sg-green-soft px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-sg-green-strong">= DK Total</span>
              <span className="font-bold tabular-nums text-sg-green-strong">{formatMoney(lot.estimated_sale_value_dkk)}</span>
            </div>
          </div>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Toplam ödeme
            <input inputMode="decimal" value={draft?.payout_total_dkk ?? ''} onChange={(event) => onLotDraftChange({ payout_total_dkk: event.target.value })} className={inputClass} />
          </label>
          <div className="rounded-sg-md border border-sg-border">
            <div className="flex items-center justify-between border-b border-sg-border-soft px-3 py-1.5 text-xs">
              <span className="text-sg-text-soft">Alış maliyeti</span>
              <span className="font-semibold tabular-nums text-sg-red">−{formatMoney(lot.before_amount_dkk)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="text-sg-text-soft">Giderler</span>
              <span className="font-semibold tabular-nums text-sg-red">−{formatMoney(lot.cost_total_dkk)}</span>
            </div>
          </div>
          <div className={`rounded-sg-md border-2 px-3 py-3 ${netToneClass}`} data-testid="log-lot-advance">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sg-text-soft">Avance I alt (A51)</p>
            <p className="mt-1 text-2xl font-bold tracking-[-0.01em] tabular-nums">{lot.net_after_costs_dkk ? `${netAfterCosts.toFixed(0)} DKK` : '—'}</p>
            <p className="mt-1 text-xs text-sg-text-soft">= Total − Alış − Giderler</p>
          </div>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Not
            <textarea
              value={draft?.notes ?? ''}
              onChange={(event) => onLotDraftChange({ notes: event.target.value })}
              rows={2}
              placeholder="Lot notu"
              className={inputClass}
            />
          </label>
        </div>
      </fieldset>
    </div>
  );
}
