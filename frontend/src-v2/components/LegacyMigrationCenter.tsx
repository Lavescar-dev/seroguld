import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseZap, FileSpreadsheet, Loader2, RefreshCw, X } from 'lucide-react';

import { apiRequest, localizeApiError } from '@/lib/api';

type Phase = 'afg' | 'inventory' | 'log';
type PhaseState = { status: string; file_count: number; record_count: number; ready: number; blocked: number; already_imported: number; applied: number; skipped: number };
type MigrationRun = {
  id: string;
  status: string;
  current_phase: Phase;
  settings: { log_year?: number };
  phases: Record<Phase, PhaseState>;
  files: Array<{ id: string; phase: Phase; file_name: string; status: string; error?: string | null }>;
};
type MigrationRecord = { id: string; source_key: string; status: string; payload: Record<string, unknown>; warnings: string[]; errors: string[] };

const phases: Array<{ id: Phase; title: string; copy: string; multiple: boolean }> = [
  { id: 'afg', title: '1. Toplu AFG', copy: 'Eski AFG .xlsx ve .xlsm belgeleri. Tarihsel tutarlar korunur.', multiple: true },
  { id: 'inventory', title: '2. Depolama', copy: 'Lager sayfasındaki yalnız gerçek ve pozitif stok satırları.', multiple: false },
  { id: 'log', title: '3. Log', copy: 'Ark1 rota ve eritme lotu verileri. Bütün AFG referansları bulunmalıdır.', multiple: false },
];

const storageKey = 'seroguld.legacyMigrationRunId';

export function LegacyMigrationCenter({ open, onClose, initialPhase = 'afg' }: { open: boolean; onClose: () => void; initialPhase?: Phase }) {
  const [run, setRun] = useState<MigrationRun | null>(null);
  const [activePhase, setActivePhase] = useState<Phase>(initialPhase);
  const [records, setRecords] = useState<MigrationRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const refresh = async (runId = run?.id) => {
    if (!runId) return;
    const next = await apiRequest<MigrationRun>(`/api/v2/legacy-migrations/runs/${runId}`);
    setRun(next);
    localStorage.setItem(storageKey, next.id);
    const list = await apiRequest<{ items: MigrationRecord[] }>(`/api/v2/legacy-migrations/runs/${next.id}/${activePhase}/records?limit=100`);
    setRecords(list.items);
  };

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const next = await apiRequest<MigrationRun>('/api/v2/legacy-migrations/runs', {
        method: 'POST',
        body: JSON.stringify({ log_year: new Date().getFullYear() }),
      });
      setRun(next);
      setRecords([]);
      setActivePhase('afg');
      localStorage.setItem(storageKey, next.id);
    } catch (reason) {
      setError(localizeApiError(reason));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    setActivePhase(initialPhase);
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      void create();
      return;
    }
    setBusy('load');
    apiRequest<MigrationRun>(`/api/v2/legacy-migrations/runs/${saved}`)
      .then((next) => { setRun(next); setError(null); })
      .catch(() => { localStorage.removeItem(storageKey); return create(); })
      .finally(() => setBusy(null));
  }, [open]);

  useEffect(() => {
    if (!open || !run) return;
    void apiRequest<{ items: MigrationRecord[] }>(`/api/v2/legacy-migrations/runs/${run.id}/${activePhase}/records?limit=100`)
      .then((response) => setRecords(response.items))
      .catch((reason) => setError(localizeApiError(reason)));
  }, [activePhase, open, run?.id]);

  useEffect(() => {
    if (!open || !run || run.status !== 'analyzing') return;
    const timer = window.setInterval(() => void refresh(run.id).catch((reason) => setError(localizeApiError(reason))), 1500);
    return () => window.clearInterval(timer);
  }, [open, run?.id, run?.status, activePhase]);

  const upload = async (files: FileList | File[] | null) => {
    if (!run || !files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    setBusy('upload');
    setError(null);
    try {
      const next = await apiRequest<MigrationRun>(`/api/v2/legacy-migrations/runs/${run.id}/${activePhase}/files`, { method: 'POST', body: form });
      setRun(next);
    } catch (reason) {
      setError(localizeApiError(reason));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!run) return;
    setBusy('analyze');
    setError(null);
    try {
      const next = await apiRequest<MigrationRun>(`/api/v2/legacy-migrations/runs/${run.id}/${activePhase}/analyze`, { method: 'POST' });
      setRun(next);
    } catch (reason) {
      setError(localizeApiError(reason));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!run || !window.confirm(`${activePhase.toUpperCase()} adımı atomik olarak canlı sisteme uygulansın mı?`)) return;
    setBusy('apply');
    setError(null);
    try {
      const next = await apiRequest<MigrationRun>(`/api/v2/legacy-migrations/runs/${run.id}/${activePhase}/apply`, { method: 'POST' });
      setRun(next);
      const nextPhase = phases.find((phase) => phase.id === next.current_phase)?.id;
      if (nextPhase) setActivePhase(nextPhase);
    } catch (reason) {
      setError(localizeApiError(reason));
    } finally {
      setBusy(null);
    }
  };

  const phaseState = run?.phases[activePhase];
  const activeIndex = phases.findIndex((phase) => phase.id === activePhase);
  const currentIndex = phases.findIndex((phase) => phase.id === run?.current_phase);
  const canEditPhase = Boolean(run && (activeIndex <= currentIndex || phaseState?.status === 'applied'));
  const canApply = Boolean(phaseState && phaseState.file_count > 0 && phaseState.blocked === 0 && ['ready', 'applied'].includes(phaseState.status));
  const selectedDefinition = useMemo(() => phases.find((phase) => phase.id === activePhase)!, [activePhase]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-critical-top flex justify-end bg-slate-950/35 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Eski sistem taşıma merkezi">
      <section className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Veri taşıma merkezi</p><h2 className="mt-1 text-2xl font-black text-slate-950">Eski Excel sistemini taşı</h2><p className="mt-1 text-sm text-slate-500">Sıra zorunludur: AFG, Depolama, Log. Dış entegrasyonlar kapalıdır.</p></div>
          <div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={!run} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button></div>
        </header>
        <div className="grid border-b border-slate-200 md:grid-cols-3">
          {phases.map((phase, index) => { const item = run?.phases[phase.id]; const locked = Boolean(run && index > currentIndex && item?.status !== 'applied'); return <button key={phase.id} type="button" disabled={locked} onClick={() => setActivePhase(phase.id)} className={`border-b-2 px-5 py-4 text-left ${activePhase === phase.id ? 'border-blue-600 bg-blue-50' : 'border-transparent hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-40`}><span className="flex items-center justify-between gap-2 text-sm font-black text-slate-900">{phase.title}{item?.status === 'applied' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}</span><span className="mt-1 block text-xs text-slate-500">{item?.file_count || 0} dosya · {item?.status || 'bekliyor'}</span></button>; })}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {error ? <div className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</div> : null}
          <div
            onDragOver={(event) => { event.preventDefault(); if (canEditPhase) setDragActive(true); }}
            onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              if (!canEditPhase) return;
              const files = Array.from(event.dataTransfer?.files || []).filter((file) => /\.(xlsx|xlsm)$/i.test(file.name));
              if (files.length) void upload(files);
            }}
            className={`rounded-2xl border bg-slate-50 p-5 transition ${dragActive ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-black text-slate-950">{selectedDefinition.title}</h3><p className="mt-1 text-sm text-slate-600">{dragActive ? 'Dosyaları buraya bırakın (.xlsx / .xlsm)' : selectedDefinition.copy}</p></div><span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600">{phaseState?.status || 'boş'}</span></div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{phaseState?.ready || 0} hazır</span><span className="rounded-full bg-red-100 px-3 py-1 text-red-800">{phaseState?.blocked || 0} engelli</span><span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">{phaseState?.already_imported || 0} daha önce işlendi</span></div>
            <div className="mt-5 flex flex-wrap gap-3"><label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 ${!canEditPhase ? 'pointer-events-none opacity-40' : ''}`}><FileSpreadsheet className="h-4 w-4" />Dosyaları seç<input type="file" accept=".xlsx,.xlsm" multiple={selectedDefinition.multiple} className="sr-only" onChange={(event) => void upload(event.target.files)} /></label><button type="button" onClick={() => void analyze()} disabled={!canEditPhase || !phaseState?.file_count || Boolean(busy) || run?.status === 'analyzing'} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 disabled:opacity-40">{run?.status === 'analyzing' ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Analiz ediliyor</span> : 'Önizlemeyi analiz et'}</button><button type="button" onClick={() => void apply()} disabled={!canApply || Boolean(busy)} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">Adımı atomik uygula</button></div>
          </div>
          <div className="mt-5 space-y-3">
            {(run?.files.filter((file) => file.phase === activePhase) || []).map((file) => <div key={file.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3"><div><p className="break-all text-sm font-bold text-slate-900">{file.file_name}</p>{file.error ? <p className="mt-1 text-xs text-red-700">{file.error}</p> : null}</div><span className="shrink-0 text-xs font-bold text-slate-500">{file.status}</span></div>)}
            {records.slice(0, 30).map((record) => <div key={record.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="flex justify-between gap-3"><code className="break-all text-xs text-slate-600">{record.source_key}</code><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${record.status === 'blocked' ? 'bg-red-100 text-red-800' : record.status === 'ready' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{record.status}</span></div>{record.errors?.map((message) => <p key={message} className="mt-2 text-xs text-red-700">{message}</p>)}{record.warnings?.map((message) => <p key={message} className="mt-2 text-xs text-amber-700">{message}</p>)}</div>)}
          </div>
        </div>
        <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4"><button type="button" onClick={() => void create()} disabled={Boolean(busy)} className="text-sm font-bold text-slate-600 hover:text-slate-950"><DatabaseZap className="mr-2 inline h-4 w-4" />Yeni taşıma çalışması</button><button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-800">Kapat</button></footer>
      </section>
    </div>
  );
}
