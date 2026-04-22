import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { SectionCard } from '@/components/SectionCard';
import { apiRequest } from '@/lib/api';
import type { AISettingsOut } from '@/types';

export function AiPage() {
  const settingsQuery = useQuery({
    queryKey: ['settings', 'ai'],
    queryFn: () => apiRequest<AISettingsOut>('/api/settings/ai'),
  });

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('20');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!settingsQuery.data) return;
    setBaseUrl(settingsQuery.data.openai_base_url);
    setModel(settingsQuery.data.openai_model);
    setTimeoutSeconds(String(settingsQuery.data.openai_timeout_seconds));
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<AISettingsOut>('/api/settings/ai', {
        method: 'PUT',
        body: JSON.stringify({
          openai_api_key: apiKey || null,
          openai_base_url: baseUrl,
          openai_model: model,
          openai_timeout_seconds: Number(timeoutSeconds),
        }),
      }),
    onSuccess: () => {
      void settingsQuery.refetch();
      setApiKey('');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <SectionCard title="AI Ayarları" description="OpenAI yapılandırması backend tarafından kanonik tutulur.">
      <form className="grid gap-4 xl:grid-cols-2" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-brand-200">Base URL</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-brand-200">Model</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none">
            {settingsQuery.data?.model_options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-brand-200">Timeout (sn)</span>
          <input value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-brand-200">Yeni API Key</span>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none" placeholder={settingsQuery.data?.openai_api_key_masked || 'Mevcut anahtar korunur'} />
        </label>
        <div className="xl:col-span-2 flex items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-4">
          <p className="text-sm text-brand-200/75">
            Backend masking: {settingsQuery.data?.openai_api_key_masked || 'Ayarlı değil'}
          </p>
          <button type="submit" className="rounded-2xl bg-brand-500 px-4 py-3 font-semibold text-white transition hover:bg-brand-400">
            Kaydet
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
