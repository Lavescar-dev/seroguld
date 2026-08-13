import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, History, Pencil, Plus, Save, StickyNote, Trash2, X } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

type CustomerNote = {
  id: string;
  customer_id: string;
  author_name: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type CustomerNoteList = { items: CustomerNote[]; total: number };
type CustomerNoteRevision = { id: string; action: string; body_snapshot: string; version: number; actor_name: string; created_at: string };

export function CustomerNotesPanel({
  customerId,
  customerName,
  manage = false,
  dock = false,
}: {
  customerId: string;
  customerName?: string | null;
  manage?: boolean;
  dock?: boolean;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<CustomerNote | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(false);
    setDraft('');
    setEditing(null);
    setHistoryId(null);
  }, [customerId]);

  const notesQuery = useQuery({
    queryKey: ['customer-notes', customerId, expanded ? 100 : 3],
    queryFn: () => apiRequest<CustomerNoteList>(`/api/customers/${customerId}/notes?limit=${expanded ? 100 : 3}`),
    enabled: Boolean(customerId),
  });
  const historyQuery = useQuery({
    queryKey: ['customer-note-history', customerId, historyId],
    queryFn: () => apiRequest<CustomerNoteRevision[]>(`/api/customers/${customerId}/notes/${historyId}/revisions`),
    enabled: Boolean(historyId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customer-notes', customerId] });
  const createMutation = useMutation({
    mutationFn: (body: string) => apiRequest<CustomerNote>(`/api/customers/${customerId}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: async () => { setDraft(''); await refresh(); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ note, body }: { note: CustomerNote; body: string }) => apiRequest<CustomerNote>(`/api/customers/${customerId}/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ body, base_version: note.version }) }),
    onSuccess: async () => { setEditing(null); setDraft(''); await refresh(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (note: CustomerNote) => apiRequest(`/api/customers/${customerId}/notes/${note.id}?base_version=${note.version}`, { method: 'DELETE' }),
    onSuccess: async () => { setHistoryId(null); await refresh(); },
  });

  const notes = notesQuery.data?.items || [];
  const total = notesQuery.data?.total || 0;
  const pending = createMutation.isPending || updateMutation.isPending;
  const error = notesQuery.error || createMutation.error || updateMutation.error || deleteMutation.error;
  const submit = () => {
    const body = draft.trim();
    if (!body || pending) return;
    if (editing) updateMutation.mutate({ note: editing, body });
    else createMutation.mutate(body);
  };

  return (
    <section className={dock ? 'w-full overflow-hidden rounded-b-xl border border-amber-300 bg-white shadow-2xl' : 'overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface shadow-sm'}>
      <header className="flex items-center justify-between gap-3 border-b border-sg-border bg-amber-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><StickyNote className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sg-text">Müşteri notları <span className="font-normal text-sg-text-soft">({total})</span></p>
            {customerName ? <p className="truncate text-xs text-sg-text-soft">{customerName}</p> : null}
          </div>
        </div>
        {total > 3 ? <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800">{expanded ? 'Son 3 not' : 'Tümünü gör'}{expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button> : null}
      </header>
      <div className={expanded ? 'max-h-[55vh] overflow-y-auto p-3' : 'max-h-72 overflow-y-auto p-3'}>
        {notesQuery.isLoading ? <p className="px-2 py-4 text-sm text-sg-text-soft">Notlar yükleniyor…</p> : null}
        {!notesQuery.isLoading && notes.length === 0 ? <p className="rounded-lg bg-sg-surface-soft px-3 py-4 text-sm text-sg-text-soft">Bu müşteri için henüz manuel not yok.</p> : null}
        <div className="space-y-2">
          {notes.map((note) => (
            <article key={note.id} className="rounded-lg border border-sg-border-soft bg-sg-surface-soft px-3 py-2.5">
              <p className="whitespace-pre-wrap text-sm leading-5 text-sg-text">{note.body}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-sg-text-soft">
                <span>{note.author_name} · {formatRelativeTime(note.updated_at)}</span>
                {manage ? <span className="flex items-center gap-1"><button type="button" title="Not geçmişi" onClick={() => setHistoryId(historyId === note.id ? null : note.id)} className="rounded p-1 hover:bg-white"><History className="h-3.5 w-3.5" /></button><button type="button" title="Notu düzenle" onClick={() => { setEditing(note); setDraft(note.body); }} className="rounded p-1 hover:bg-white"><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="Notu sil" onClick={() => { if (window.confirm('Bu not silinsin mi? Audit geçmişi korunacaktır.')) deleteMutation.mutate(note); }} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button></span> : null}
              </div>
              {historyId === note.id ? <div className="mt-2 space-y-1 border-t border-sg-border-soft pt-2">{historyQuery.isLoading ? <p className="text-xs text-sg-text-soft">Geçmiş yükleniyor…</p> : (historyQuery.data || []).map((revision) => <div key={revision.id} className="rounded bg-white px-2 py-1.5 text-xs"><p className="text-sg-text">{revision.body_snapshot}</p><p className="mt-1 text-[10px] text-sg-text-soft">v{revision.version} · {revision.action} · {revision.actor_name} · {formatRelativeTime(revision.created_at)}</p></div>)}</div> : null}
            </article>
          ))}
        </div>
      </div>
      <div className="border-t border-sg-border bg-white p-3">
        {editing ? <div className="mb-2 flex items-center justify-between text-xs text-amber-800"><span>Not düzenleniyor · v{editing.version}</span><button type="button" onClick={() => { setEditing(null); setDraft(''); }}><X className="h-4 w-4" /></button></div> : null}
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={4000} placeholder="Manuel müşteri notu ekle…" className="min-h-16 flex-1 resize-none rounded-lg border border-sg-border px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent" />
          <button type="button" onClick={submit} disabled={!draft.trim() || pending} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-sg-accent px-3 text-xs font-semibold text-white disabled:opacity-50">{editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{pending ? 'Kaydediliyor' : editing ? 'Kaydet' : 'Not ekle'}</button>
        </div>
        {error ? <p className="mt-2 text-xs text-red-600">{error instanceof Error ? error.message : 'Not işlemi tamamlanamadı.'}</p> : null}
      </div>
    </section>
  );
}
