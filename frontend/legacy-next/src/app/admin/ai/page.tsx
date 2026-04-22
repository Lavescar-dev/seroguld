'use client';

import { FormEvent, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiRequest } from '@/lib/api';
import { AISettings } from '@/types';

export default function AdminAiPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<AISettings | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-5.4');
  const [timeoutSeconds, setTimeoutSeconds] = useState('20');

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest<AISettings>('/api/settings/ai');
      setSettings(payload);
      setBaseUrl(payload.openai_base_url || 'https://api.openai.com/v1');
      setModel(payload.openai_model || 'gpt-5.4');
      setTimeoutSeconds(String(payload.openai_timeout_seconds ?? 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI ayarları yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = await apiRequest<AISettings>('/api/settings/ai', {
        method: 'PUT',
        body: JSON.stringify({
          openai_api_key: apiKeyInput.trim() ? apiKeyInput.trim() : null,
          openai_base_url: baseUrl.trim(),
          openai_model: model,
          openai_timeout_seconds: Number(timeoutSeconds),
        }),
      });
      setSettings(payload);
      setApiKeyInput('');
      setBaseUrl(payload.openai_base_url);
      setModel(payload.openai_model);
      setTimeoutSeconds(String(payload.openai_timeout_seconds));
      setSuccess('AI ayarları kaydedildi. Yeni isteklerde güncel model ve bağlantı kullanılacak.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI ayarları kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 md:p-6">
        <h3 className="text-xl font-semibold text-brand-900">Yapay Zeka Ayarları</h3>
        <p className="mt-1 text-sm text-brand-700">
          Bu form lokal CRM kurulumundaki `.env` ayarlarını günceller. Model seçiminde parantez notları hız/maliyet
          dengesini özetler.
        </p>
      </div>

      <div className="card p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-brand-700">Ayarlar yükleniyor...</p>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-brand-900">OpenAI API Key</label>
              <Input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={
                  settings?.openai_api_key_set
                    ? 'Değiştirmek istemiyorsanız boş bırakın'
                    : 'sk-... ile başlayan anahtar'
                }
                autoComplete="off"
              />
              <p className="text-xs text-brand-700">
                Durum:{' '}
                {settings?.openai_api_key_set
                  ? `Kayıtlı (${settings.openai_api_key_masked || 'maskeli'})`
                  : 'Henüz anahtar girilmemiş'}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-brand-900">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-brand-900">Timeout (saniye)</label>
                <Input
                  type="number"
                  min={5}
                  max={120}
                  step={1}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-brand-900">Model Seçimi</label>
              <Select value={model} onChange={(event) => setModel(event.target.value)}>
                {(settings?.model_options || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} {option.note}
                  </option>
                ))}
              </Select>
            </div>

            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            {success && <p className="text-sm font-semibold text-emerald-700">{success}</p>}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void loadSettings()} disabled={saving}>
                Yenile
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
