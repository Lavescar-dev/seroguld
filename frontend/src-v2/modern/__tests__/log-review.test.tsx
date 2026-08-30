import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { createModernLogViewModel } from '@/modern/adapters/log';
import type { LogPageProps } from '@/make/log/LogPage';
import { ModernLogModule } from '@/modern/modules/log';
import { DocumentPipeline } from '@/modern/modules/log/DocumentPipeline';
import { MeltLotPanel } from '@/modern/modules/log/MeltLotPanel';
import { SplitBoard } from '@/modern/modules/log/SplitBoard';
import { effectiveLineState, hasPayoutVariance, labelLotHistoryAction, lineStateTone } from '@/modern/modules/log/labels';
import { ModernReviewBar } from '@/modern/modules/shared';
import type { LogBucketWorkspace } from '@/types';

import { buildLogBucket, buildLogDocument, buildLogLine, buildLogState, buildLogWorkspace } from './logFixtures';

describe('ModernReviewBar', () => {
  it('renders pending summary and applies', () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    render(<ModernReviewBar summary={{ count: 3, weight: 10.5, amount: 4200, pure: 6.25 }} busy={false} onApply={onApply} onDiscard={onDiscard} />);

    expect(screen.getByTestId('modern-review-bar')).toBeInTheDocument();
    expect(screen.getByTestId('modern-review-count')).toHaveTextContent('3 bekleyen değişiklik');
    expect(screen.getByTestId('modern-review-bar')).toHaveTextContent('10.50 g · 4200 kr · 6.250 has');

    fireEvent.click(screen.getByTestId('modern-review-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('modern-review-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while a route request is in flight', () => {
    render(<ModernReviewBar summary={{ count: 1, weight: 1, amount: 1, pure: 1 }} busy onApply={() => undefined} onDiscard={() => undefined} />);
    expect(screen.getByTestId('modern-review-apply')).toBeDisabled();
    expect(screen.getByTestId('modern-review-discard')).toBeDisabled();
  });
});

describe('log split board', () => {
  const documents = [
    buildLogDocument({
      sequence_no: 1,
      lines: [
        buildLogLine({ id: 's-line', line_no: 1, operation_classification: 'jewelry_cleaning', operation_destination: 'inventory' }),
        buildLogLine({ id: 'h-line', line_no: 2, metal_type: 'white_gold', operation_destination: null }),
        buildLogLine({ id: 'd-line', line_no: 3, operation_classification: 'separate_storage', operation_destination: 'inventory' }),
      ],
    }),
  ];

  it('groups lines by splitGroupKeyForDraft thresholds and renders the S/H/D cards', () => {
    render(
      <SplitBoard
        documents={documents}
        lineDrafts={{ 'h-line': { classification: 'white_gold', note: 'beyaz', destination: 'inventory' } }}
        routeBusy={false}
        onDraftChange={() => undefined}
        onRoute={() => undefined}
      />,
    );

    expect(screen.getByTestId('log-split-group-jewelry_cleaning')).toHaveTextContent('S');
    expect(screen.getByTestId('log-split-group-white_gold')).toHaveTextContent('H');
    expect(screen.getByTestId('log-split-group-separate_storage')).toHaveTextContent('D');
    const notes = screen.getAllByTestId('log-line-note');
    expect(notes.some((input) => (input as HTMLInputElement).value === 'beyaz')).toBe(true);
    expect(screen.getAllByTestId('log-route-group')).toHaveLength(3);
  });

  it('marks staged lines with the review badge', () => {
    render(
      <SplitBoard
        documents={documents}
        lineDrafts={{ 'h-line': { classification: 'white_gold', note: 'beyaz', destination: 'inventory' } }}
        routeBusy={false}
        onDraftChange={() => undefined}
        onRoute={() => undefined}
      />,
    );
    expect(screen.getAllByTestId('log-line-pending')).toHaveLength(1);
  });
});

describe('log document pipeline', () => {
  const document = buildLogDocument({
    sequence_no: 1,
    total_pure_gold_grams: '10.05',
    lines: [
      buildLogLine({ id: 'grouped', line_no: 1, operation_classification: 'white_gold', operation_destination: 'inventory', pure_gold_grams: '2.4', weight_grams: '4' }),
      buildLogLine({ id: 'pending', line_no: 2, pure_gold_grams: '1.8', weight_grams: '3' }),
    ],
  });

  it('shows pending lines with live staging controls and the separated/remaining strip', () => {
    render(
      <DocumentPipeline
        selected={{
          document,
          pending: [document.lines[1]],
          groups: { jewelry_cleaning: [], white_gold: [document.lines[0]], separate_storage: [] },
          groupedTotals: { jewelry_cleaning: { weight: 0, amount: 0, pure: 0 }, white_gold: { weight: 4, amount: 1600, pure: 2.4 }, separate_storage: { weight: 0, amount: 0, pure: 0 } },
          groupedCount: 1,
          routedWeight: 4,
          routedAmount: 1600,
          routedPure: 2.4,
          remainingPure: 10.05 - 2.4,
        }}
        lineDrafts={{}}
        routeBusy={false}
        pureUnit="has"
        onDraftChange={() => undefined}
        onRoute={() => undefined}
        onOpenDocument={() => undefined}
      />,
    );

    expect(screen.getByText('Bekleyen Satırlar')).toBeInTheDocument();
    expect(screen.getByTestId('log-line-classification')).toBeInTheDocument();
    expect(screen.getByTestId('log-line-note')).toBeInTheDocument();
    expect(screen.getByTestId('log-document-strip')).toHaveTextContent('Ayrılan:');
    expect(screen.getByTestId('log-document-strip')).toHaveTextContent('7,65 has');
    expect(screen.getByRole('button', { name: /Belgeyi Aç/ })).toBeInTheDocument();
  });

  it('renders the empty state when every line is already grouped', () => {
    render(
      <DocumentPipeline
        selected={{
          document,
          pending: [],
          groups: { jewelry_cleaning: [], white_gold: document.lines, separate_storage: [] },
          groupedTotals: { jewelry_cleaning: { weight: 0, amount: 0, pure: 0 }, white_gold: { weight: 7, amount: 5600, pure: 4.2 }, separate_storage: { weight: 0, amount: 0, pure: 0 } },
          groupedCount: 2,
          routedWeight: 7,
          routedAmount: 5600,
          routedPure: 4.2,
          remainingPure: 5.85,
        }}
        lineDrafts={{}}
        routeBusy={false}
        pureUnit="has"
        onDraftChange={() => undefined}
        onRoute={() => undefined}
        onOpenDocument={() => undefined}
      />,
    );

    expect(screen.getByText('Bekleyen satır yok')).toBeInTheDocument();
    expect(screen.queryByTestId('log-line-note')).not.toBeInTheDocument();
  });
});

describe('log melt lot panel', () => {
  function renderPanel(bucket: LogBucketWorkspace, show = true) {
    return render(
      <MeltLotPanel
        bucket={bucket}
        lotDrafts={{}}
        show={show}
        meltBusy={false}
        createMeltBusy={false}
        finalizeBusy={false}
        deleteBusy={false}
        pureUnit="has"
        onToggleMeltSection={() => undefined}
        onCreateMeltLot={() => undefined}
        onLotDraftChange={() => undefined}
        onSaveLot={() => undefined}
        onFinalizeLot={() => undefined}
        onDeleteLot={() => undefined}
        onDownloadLotPdf={() => undefined}
        onOpenLotHistory={() => undefined}
        onOpenLotLines={() => undefined}
      />,
    );
  }

  it('locks the new lot button while the melt queue is empty', () => {
    renderPanel(buildLogBucket({ melt_queue: { line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', earliest_purchase_date: null, latest_purchase_date: null, document_numbers: [] } }));
    expect(screen.getByTestId('log-create-melt-lot')).toBeDisabled();
  });

  it('enables the new lot button once the melt queue has lines', () => {
    renderPanel(
      buildLogBucket({
        melt_queue: { line_count: 2, total_weight_grams: '5', total_pure_gold_grams: '3', total_amount_dkk: '2000', earliest_purchase_date: null, latest_purchase_date: null, document_numbers: [] },
      }),
    );
    const button = screen.getByTestId('log-create-melt-lot');
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('title', 'Yeni eritme lotu oluştur');
  });

  it('renders lot payout parity panels when the section is expanded', () => {
    renderPanel(
      buildLogBucket({
        melt_lots: [
          {
            id: 'lot-1',
            metal_bucket: 'gold',
            sent_date: '2026-08-10',
            purchased_from_date: '2026-08-01',
            before_weight_grams: '10',
            before_amount_dkk: '4000',
            before_pure_gold_grams: '5.85',
            after_pure_gold_grams: '5.7',
            insurance_dkk: '100',
            shipping_dkk: '150',
            refining_dkk: '50',
            sale_date: '2026-08-20',
            quote_eur: '4300',
            exchange_rate_dkk: '7.46',
            payout_total_dkk: '32000',
            notes: '',
            cost_total_dkk: '300',
            estimated_sale_value_dkk: '32078',
            net_after_costs_dkk: '27700',
            bridge_difference_dkk: '0',
            advance_per_gram_dkk: null,
            status: 'draft',
            finalized_at: null,
            finalized_by_user_id: null,
            line_count: 3,
            created_at: '2026-08-10T10:00:00Z',
            updated_at: '2026-08-10T10:00:00Z',
          },
        ],
      }),
    );

    expect(screen.getByTestId('log-lot-purity-grid')).toHaveTextContent('Öncesi');
    expect(screen.getByTestId('log-lot-dk-total')).toHaveTextContent('= DK Total');
    expect(screen.getByText('Avance I alt (A51)')).toBeInTheDocument();
    expect(screen.getByTestId('log-lot-advance')).toHaveTextContent('27700 DKK');
    // 32000 vs 32078 → %0.24 sapma, eşik altı: uyarı yok
    expect(screen.queryByTestId('log-payout-variance')).not.toBeInTheDocument();
  });

  it('warns when the payout deviates by 5 percent or more', () => {
    renderPanel(
      buildLogBucket({
        melt_lots: [
          {
            id: 'lot-2',
            metal_bucket: 'gold',
            sent_date: '2026-08-10',
            purchased_from_date: null,
            before_weight_grams: '10',
            before_amount_dkk: '4000',
            before_pure_gold_grams: '5.85',
            after_pure_gold_grams: '5.7',
            insurance_dkk: '0',
            shipping_dkk: '0',
            refining_dkk: '0',
            sale_date: null,
            quote_eur: '4300',
            exchange_rate_dkk: '7.46',
            payout_total_dkk: '25000',
            notes: '',
            cost_total_dkk: '0',
            estimated_sale_value_dkk: '32078',
            net_after_costs_dkk: '21000',
            bridge_difference_dkk: '0',
            advance_per_gram_dkk: null,
            status: 'draft',
            finalized_at: null,
            finalized_by_user_id: null,
            line_count: 1,
            created_at: '2026-08-10T10:00:00Z',
            updated_at: '2026-08-10T10:00:00Z',
          },
        ],
      }),
    );

    expect(screen.getByTestId('log-payout-variance')).toHaveTextContent('Payout sapması');
  });

  it('hides lot cards while the section is collapsed', () => {
    renderPanel(buildLogBucket(), false);
    expect(screen.queryByTestId('log-melt-lot-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('log-melt-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('log label helpers', () => {
  it('uses the backend history enum values line_attached / line_detached', () => {
    expect(labelLotHistoryAction('line_attached')).toBe('Satır bağlandı');
    expect(labelLotHistoryAction('line_detached')).toBe('Satır ayrıldı');
    expect(labelLotHistoryAction('finalized')).toBe('Finalize edildi');
    expect(labelLotHistoryAction('reopened')).toBe('Tekrar açıldı');
    expect(labelLotHistoryAction('created')).toBe('Oluşturuldu');
    expect(labelLotHistoryAction('line_added')).toBe('line_added');
  });

  it('maps effective line states to token tones', () => {
    expect(effectiveLineState(buildLogLine({ id: 'a', line_no: 1, operation_destination: 'melt' }))).toBe('melted');
    expect(lineStateTone('in_inventory')).toBe('success');
    expect(lineStateTone('melted')).toBe('danger');
    expect(lineStateTone('undecided')).toBe('warning');
    expect(lineStateTone('awaiting_decision')).toBe('neutral');
  });

  it('flags payout variance only above the 5 percent threshold', () => {
    expect(hasPayoutVariance('32000', '32078')).toBe(false);
    expect(hasPayoutVariance('30000', '32078')).toBe(true);
    expect(hasPayoutVariance('0', '32078')).toBe(false);
  });
});

describe('modern log module wiring', () => {
  function renderModule(partial: Partial<LogPageProps> = {}) {
    const document = buildLogDocument({
      sequence_no: 1,
      lines: [buildLogLine({ id: 'mod-line', line_no: 1 })],
    });
    render(
      <ModernLogModule
        viewModel={createModernLogViewModel(
          buildLogState({
            workspace: buildLogWorkspace({ gold: { documents: [document] } }),
            ...partial,
          }),
        )}
      />,
    );
  }

  it('locks the office switch and mounts the review bar while route drafts are pending', () => {
    renderModule({ pendingRouteCount: 1, pendingRouteSummary: { count: 1, weight: 10, amount: 4000, pure: 5.85 } });
    const office = screen.getByTestId('log-office-button');
    expect(office).toBeDisabled();
    expect(office).toHaveAttribute('title', 'Önce inceleme barından uygula veya vazgeç');
    expect(screen.getByTestId('modern-review-apply')).toBeInTheDocument();
    // design-system drawer'ları open={Boolean(...)} sözleşmesiyle kapalı başlar
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the office switch available and the review bar hidden when nothing is pending', () => {
    renderModule();
    expect(screen.getByTestId('log-office-button')).toBeEnabled();
    expect(screen.queryByTestId('modern-review-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('log-document-strip')).toBeInTheDocument();
  });
});

describe('log workspace state contract', () => {
  it('keeps both UI variants on the shared useLogMakeState shape', () => {
    const state = buildLogState({ workspace: buildLogWorkspace({ gold: { melt_queue: { line_count: 2, total_weight_grams: '5', total_pure_gold_grams: '3', total_amount_dkk: '2000', earliest_purchase_date: null, latest_purchase_date: null, document_numbers: [] } } }) });
    expect(state.workspace?.gold.melt_queue.line_count).toBe(2);
    expect(state.pendingRouteSummary).toEqual({ count: 0, weight: 0, amount: 0, pure: 0 });
  });
});
