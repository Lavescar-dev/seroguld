import { ChevronDown, ChevronUp, ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';

import type { OfficeDockDescriptor } from '@/lib/officeDock';
import { useOfficeDocumentState } from '@/make/office/useOfficeDocumentState';
import type { ModernOfficeViewModel } from '@/modern/adapters/office';

import { DataPill, ModernModuleShell, ModernSection, shellButtonClass, toneBadgeClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

export function ModernOfficeModule({ viewModel }: { viewModel: ModernOfficeViewModel }) {
  return (
    <ModernModuleShell
      eyebrow="Embedded Office"
      title={viewModel.title}
      subtitle={viewModel.subtitle}
      blocker={viewModel.blocker}
      badges={
        <>
          {viewModel.revisions.map((item) => (
            <span key={item.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${toneBadgeClass(item.tone)}`}>
              <span className="opacity-70">{item.label}</span>
              <span>{item.value}</span>
            </span>
          ))}
        </>
      }
      actions={
        <>
          {viewModel.onToggleOpen ? (
            <button type="button" onClick={viewModel.onToggleOpen} className={shellButtonClass('secondary')}>
              {viewModel.isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {viewModel.isOpen ? 'Kapat' : 'Aç'}
            </button>
          ) : null}
          {viewModel.onToggleExpanded ? (
            <button type="button" onClick={viewModel.onToggleExpanded} className={shellButtonClass('secondary')}>
              {viewModel.isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {viewModel.isExpanded ? 'Daralt' : 'Genişlet'}
            </button>
          ) : null}
          <button type="button" onClick={viewModel.state.onReopenWindow} className={shellButtonClass('secondary')}>
            <ExternalLink className="h-4 w-4" />
            Ayrı Pencere
          </button>
          {viewModel.onClose ? (
            <button type="button" onClick={viewModel.onClose} className={shellButtonClass('danger')}>
              <X className="h-4 w-4" />
              Kapat
            </button>
          ) : null}
        </>
      }
    >
      <ModernSection title="Senkron ve Revision" subtitle="CRM, workbook ve base revision görünürlüğü route seviyesinde tutulur.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {viewModel.syncBadges.map((item) => (
            <div key={item.id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{item.label}</p>
              <p className="mt-2 text-sm font-semibold text-sg-text">{item.value}</p>
            </div>
          ))}
        </div>
      </ModernSection>

      {viewModel.resolutionFields.length > 0 ? (
        <ModernSection title="Conflict Resolution" subtitle="Per-field çözüm butonları yalnız callback verildiğinde görünür.">
          <div className="grid gap-3">
            {viewModel.resolutionFields.map((field) => (
              <div key={field.id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-sg-text">{field.label}</p>
                    <div className="mt-2 grid gap-2 text-sm text-sg-text-soft sm:grid-cols-2">
                      <div className="rounded-sg-lg border border-sg-border bg-sg-surface px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">CRM</p>
                        <p className="mt-1 break-words text-sg-text">{field.crmValue || '—'}</p>
                      </div>
                      <div className="rounded-sg-lg border border-sg-border bg-sg-surface px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Workbook</p>
                        <p className="mt-1 break-words text-sg-text">{field.workbookValue || '—'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {field.onKeepCrm ? <button type="button" onClick={field.onKeepCrm} className={shellButtonClass('secondary')}>CRM'yi Koru</button> : null}
                    {field.onKeepWorkbook ? <button type="button" onClick={field.onKeepWorkbook} className={shellButtonClass('primary')}>Workbook'u Uygula</button> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ModernSection>
      ) : null}

      {viewModel.isOpen ? (
        <div className={`overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface shadow-sg-sm ${viewModel.isExpanded ? 'min-h-[78vh]' : 'min-h-[52vh]'}`}>
          <div className={`${viewModel.isExpanded ? 'h-[78vh]' : 'h-[52vh]'} min-h-[480px]`}>
            <ModernOfficeSurface state={viewModel.state} mode="workspace" onClose={viewModel.onClose} />
          </div>
        </div>
      ) : null}
    </ModernModuleShell>
  );
}

export function ModernOfficeDockPanel({ document, onClose }: { document: OfficeDockDescriptor; onClose: () => void }) {
  const state = useOfficeDocumentState({ kind: document.kind, artifactKey: document.key });
  return <ModernOfficeSurface state={state} mode="dock" onClose={onClose} titleOverride={document.title || undefined} />;
}
