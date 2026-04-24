'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { aiApi, type AiProvider, type AiProviderSetting, type AiProviderSettingPayload } from '@/lib/api';
import { toastError } from '@/lib/toast-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PROVIDERS: Array<{
  value: AiProvider;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
}> = [
  { value: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5.4', models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5', 'gpt-4.1'] },
  { value: 'anthropic', label: 'Claude / Anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-opus-4-6', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'] },
  { value: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-3.1-pro-preview', models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  { value: 'openai-compatible', label: 'OpenAI Compatible', defaultBaseUrl: '', defaultModel: 'custom-model', models: ['custom-model', 'llama3.1', 'qwen2.5-coder', 'deepseek-chat'] },
];

function providerMeta(provider: AiProvider) {
  return PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0];
}

interface FormState {
  id?: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  customModel: string;
  apiKey: string;
  isEnabled: boolean;
}

function emptyForm(): FormState {
  const meta = providerMeta('openai');
  return { provider: 'openai', baseUrl: meta.defaultBaseUrl, model: meta.defaultModel, customModel: '', apiKey: '', isEnabled: true };
}

function toForm(setting: AiProviderSetting): FormState {
  const meta = providerMeta(setting.provider);
  const knownModel = meta.models.includes(setting.model);
  return {
    id: setting.id,
    provider: setting.provider,
    baseUrl: setting.baseUrl ?? meta.defaultBaseUrl,
    model: knownModel ? setting.model : '__custom__',
    customModel: knownModel ? '' : setting.model,
    apiKey: '',
    isEnabled: setting.isEnabled,
  };
}

function statusClass(status: string | null): string {
  if (status === 'success') return 'border-green-500/30 bg-green-500/10 text-green-200';
  if (status === 'failed') return 'border-error/30 bg-error/10 text-error';
  return 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant';
}

interface AiProviderSettingsSectionProps {
  scope?: 'user' | 'system';
}

export function AiProviderSettingsSection({ scope = 'user' }: AiProviderSettingsSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = scope === 'system' ? ['ai-provider-settings', 'system'] : ['ai-provider-settings', 'user'];
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [isEditing, setIsEditing] = useState(false);

  const { data: settings = [], isLoading } = useQuery({
    queryKey,
    queryFn: scope === 'system' ? aiApi.listSystemSettings : aiApi.listSettings,
  });
  const setting = settings[0];
  const isSystem = scope === 'system';

  useEffect(() => {
    if (setting && !isEditing) setForm(toForm(setting));
  }, [isEditing, setting]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: (payload: AiProviderSettingPayload & { apiKey: string }) => (isSystem ? aiApi.createSystemSetting(payload) : aiApi.createSetting(payload)),
    onSuccess: () => {
      toast.success(isSystem ? 'System AI provider saved' : 'Your AI provider saved');
      setIsEditing(false);
      void invalidate();
    },
    onError: (err) => toastError('Failed to save AI provider', err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AiProviderSettingPayload> }) => (isSystem ? aiApi.updateSystemSetting(id, payload) : aiApi.updateSetting(id, payload)),
    onSuccess: () => {
      toast.success(isSystem ? 'System AI provider updated' : 'Your AI provider updated');
      setIsEditing(false);
      void invalidate();
    },
    onError: (err) => toastError('Failed to update AI provider', err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => (isSystem ? aiApi.deleteSystemSetting(id) : aiApi.deleteSetting(id)),
    onSuccess: () => {
      toast.success(isSystem ? 'System AI provider removed' : 'User AI override removed');
      setForm(emptyForm());
      setIsEditing(false);
      void invalidate();
    },
    onError: (err) => toastError('Failed to remove AI provider', err),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => (isSystem ? aiApi.testSystemSetting(id) : aiApi.testSetting(id)),
    onSuccess: (result) => {
      if (result.ok) toast.success('AI connection OK');
      else toast.error(result.message || 'AI connection failed');
      void invalidate();
    },
    onError: (err) => toastError('Failed to test AI provider', err),
  });

  const selectedMeta = providerMeta(form.provider);
  const selectedModel = form.model === '__custom__' ? form.customModel.trim() : form.model;

  const submit = () => {
    const payload: AiProviderSettingPayload = {
      provider: form.provider,
      name: selectedMeta.label,
      baseUrl: form.baseUrl.trim() || undefined,
      model: selectedModel,
      isEnabled: form.isEnabled,
      isDefault: true,
    };
    if (!payload.model) return toast.error('Model is required');
    if (!payload.baseUrl) return toast.error('Base URL is required');
    if (setting) {
      updateMutation.mutate({ id: setting.id, payload: { ...payload, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) } });
      return;
    }
    if (!form.apiKey.trim()) return toast.error('API key is required');
    createMutation.mutate({ ...payload, apiKey: form.apiKey.trim() });
  };

  const title = isSystem ? 'System AI Provider' : 'AI Provider';
  const description = isSystem
    ? 'Admin config used by all users who do not set their own AI provider. Only one system provider is active.'
    : 'Configure your personal AI provider. If you leave this empty, SQLForge uses the admin system provider when available.';

  return (
    <section className="section-card card-padding">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="page-section-title">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">{description}</p>
        </div>
        {!isEditing ? (
          <Button variant="secondary" onClick={() => { setForm(setting ? toForm(setting) : emptyForm()); setIsEditing(true); }}>
            <span className="material-symbols-outlined text-base">{setting ? 'edit' : 'add'}</span>
            {setting ? 'Edit provider' : 'Setup provider'}
          </Button>
        ) : null}
      </div>

      <div className="mt-5">
        {isLoading ? (
          <p className="text-sm text-on-surface-variant">Loading AI provider…</p>
        ) : !setting ? (
          <div className="rounded-xl border border-dashed border-outline-variant/30 bg-surface-container-low p-5 text-sm text-on-surface-variant">
            {isSystem ? 'No system AI provider configured yet.' : 'No personal AI provider. Admin fallback will be used if configured.'}
          </div>
        ) : (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-headline text-base font-semibold text-on-surface">{providerMeta(setting.provider).label}</h3>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{isSystem ? 'System fallback' : 'Personal'}</span>
                  {!setting.isEnabled ? <span className="rounded-full bg-outline/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-outline">Disabled</span> : null}
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(setting.lastTestStatus)}`}>{setting.lastTestStatus ?? 'Untested'}</span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">{setting.model} · {setting.baseUrl ?? 'default endpoint'} · {setting.apiKeyMasked}</p>
                {setting.lastTestMessage ? <p className="mt-1 text-xs text-outline">{setting.lastTestMessage}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" loading={testMutation.isPending} onClick={() => testMutation.mutate(setting.id)}>Test</Button>
                <Button variant="ghost" size="sm" onClick={() => { setForm(toForm(setting)); setIsEditing(true); }}>Edit</Button>
                <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(setting.id)}>{isSystem ? 'Remove' : 'Use admin fallback'}</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-5 rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-on-surface-variant">
              Provider
              <select
                value={form.provider}
                onChange={(event) => {
                  const provider = event.target.value as AiProvider;
                  const meta = providerMeta(provider);
                  setForm((current) => ({ ...current, provider, baseUrl: meta.defaultBaseUrl, model: meta.defaultModel, customModel: '' }));
                }}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-on-surface-variant">
              Default model
              <select
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {selectedMeta.models.map((model) => <option key={model} value={model}>{model}</option>)}
                <option value="__custom__">Custom model…</option>
              </select>
            </label>
            {form.model === '__custom__' ? <Input label="Custom model" value={form.customModel} onChange={(event) => setForm((current) => ({ ...current, customModel: event.target.value }))} /> : null}
            <div className="space-y-1.5">
              <Input label="Base URL" value={form.baseUrl} placeholder={selectedMeta.defaultBaseUrl || 'https://your-provider.example/v1'} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} />
              {form.baseUrl.includes('localhost') || form.baseUrl.includes('127.0.0.1') ? (
                <p className="text-xs leading-relaxed text-outline">If SQLForge API runs in Docker, localhost points to the API container. Use <code className="rounded bg-surface-container-high px-1 py-0.5 text-on-surface-variant">host.docker.internal</code> for services running on your Mac.</p>
              ) : null}
            </div>
            <Input label={setting ? 'API key (leave blank to keep existing)' : 'API key'} type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} />
            <div className="flex items-end text-sm text-on-surface-variant">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.isEnabled} onChange={(event) => setForm((current) => ({ ...current, isEnabled: event.target.checked }))} /> Enabled</label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setIsEditing(false); setForm(setting ? toForm(setting) : emptyForm()); }}>Cancel</Button>
            <Button variant="primary" loading={createMutation.isPending || updateMutation.isPending} onClick={submit}>{setting ? 'Update provider' : 'Save provider'}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
