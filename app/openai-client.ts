export interface OpenAIProxyHealth {
  ok: boolean;
  hasKey: boolean;
  model: string;
}

export async function getOpenAIProxyHealth(fallbackModel: string): Promise<OpenAIProxyHealth> {
  const response = await fetch('/api/openai/health');
  if (!response.ok) {
    throw new Error(`OpenAI proxy health failed (${response.status})`);
  }

  const body = (await response.json()) as unknown;
  if (!body || typeof body !== 'object') {
    throw new Error('OpenAI proxy health schema mismatch');
  }

  const record = body as Record<string, unknown>;
  return {
    ok: record.ok === true,
    hasKey: record.hasKey === true,
    model: typeof record.model === 'string' && record.model ? record.model : fallbackModel,
  };
}
