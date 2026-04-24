import { config } from '../../lib/config';
import type { AiProvider } from './ai.schema';

export interface AiProviderRequest {
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  apiKey: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export interface AiProviderResponse {
  content: string;
  model: string;
  provider: AiProvider;
  usage?: Record<string, unknown>;
}

const DEFAULT_BASE_URL: Record<AiProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  'openai-compatible': '',
};

export function defaultBaseUrl(provider: AiProvider): string {
  return DEFAULT_BASE_URL[provider];
}

function resolveBaseUrl(provider: AiProvider, baseUrl: string | null): string {
  const url = baseUrl?.trim() || DEFAULT_BASE_URL[provider];
  if (!url) throw new Error('Base URL is required for OpenAI-compatible providers.');
  return url.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function toDockerHostUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!isLoopbackHost(parsed.hostname)) return null;
    parsed.hostname = 'host.docker.internal';
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatFetchError(url: string, err: unknown): Error {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = rawMessage === 'This operation was aborted' || rawMessage.toLowerCase().includes('aborted')
    ? `AI request timed out after ${Math.round(config.AI_REQUEST_TIMEOUT_MS / 1000)}s`
    : rawMessage;
  try {
    const parsed = new URL(url);
    if (isLoopbackHost(parsed.hostname)) {
      return new Error(`${message}. The API server cannot reach ${parsed.host}. If SQLForge runs in Docker and your AI gateway runs on your Mac, use http://host.docker.internal:${parsed.port || 'PORT'} instead of localhost.`);
    }
  } catch {
    // Fall through to the original message.
  }
  return new Error(message);
}

async function fetchJsonOnce(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.AI_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = typeof data === 'object' && data && 'error' in data
        ? JSON.stringify((data as { error: unknown }).error)
        : text || res.statusText;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  try {
    return await fetchJsonOnce(url, init);
  } catch (err) {
    const fallbackUrl = toDockerHostUrl(url);
    if (fallbackUrl) {
      try {
        return await fetchJsonOnce(fallbackUrl, init);
      } catch (fallbackErr) {
        throw formatFetchError(fallbackUrl, fallbackErr);
      }
    }
    throw formatFetchError(url, err);
  }
}

function toOpenAiMessages(messages: AiProviderRequest['messages']) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

async function callOpenAiCompatible(req: AiProviderRequest): Promise<AiProviderResponse> {
  const base = resolveBaseUrl(req.provider, req.baseUrl);
  const data = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({ model: req.model, messages: toOpenAiMessages(req.messages), temperature: 0.2 }),
  }) as { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, unknown>; model?: string };
  return {
    content: data.choices?.[0]?.message?.content?.trim() || '',
    model: data.model ?? req.model,
    provider: req.provider,
    usage: data.usage,
  };
}

async function callAnthropic(req: AiProviderRequest): Promise<AiProviderResponse> {
  const base = resolveBaseUrl(req.provider, req.baseUrl);
  const system = req.messages.find((m) => m.role === 'system')?.content;
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const data = await fetchJson(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: req.model, max_tokens: 1200, temperature: 0.2, system, messages }),
  }) as { content?: Array<{ type?: string; text?: string }>; usage?: Record<string, unknown>; model?: string };
  return {
    content: data.content?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n').trim() || '',
    model: data.model ?? req.model,
    provider: req.provider,
    usage: data.usage,
  };
}

async function callGemini(req: AiProviderRequest): Promise<AiProviderResponse> {
  const base = resolveBaseUrl(req.provider, req.baseUrl);
  const prompt = req.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const data = await fetchJson(`${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
  }) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: Record<string, unknown> };
  return {
    content: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n').trim() || '',
    model: req.model,
    provider: req.provider,
    usage: data.usageMetadata,
  };
}

export async function callAiProvider(req: AiProviderRequest): Promise<AiProviderResponse> {
  if (req.provider === 'anthropic') return callAnthropic(req);
  if (req.provider === 'gemini') return callGemini(req);
  return callOpenAiCompatible(req);
}
