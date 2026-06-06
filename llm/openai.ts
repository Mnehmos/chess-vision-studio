// Minimal OpenAI Chat Completions client (fetch-based, no SDK). The model id is
// configurable (the user requested GPT-5.5); override OPENAI_MODEL / OPENAI_BASE_URL
// in .env if your account uses a different id or a compatible endpoint.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface ChatClient {
  chat(messages: ChatMessage[]): Promise<string>;
  model: string;
}

export function createOpenAIClient(opts: OpenAIClientOptions): ChatClient {
  const baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    model: opts.model,
    async chat(messages: ChatMessage[]): Promise<string> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        // Minimal body: some newer models reject custom temperature / max_tokens,
        // so we keep it to model + messages for broad compatibility.
        body: JSON.stringify({ model: opts.model, messages }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
  };
}
