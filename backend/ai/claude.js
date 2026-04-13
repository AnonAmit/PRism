export class ClaudeProvider {
  constructor(apiKey, model = 'claude-3-5-sonnet-20241022') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = 'https://api.anthropic.com/v1';
    this.contextWindow = 200000;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  async complete(prompt, options = {}) {
    const body = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.2,
      messages: [{ role: 'user', content: prompt }],
    };
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Claude API error ${res.status}: ${err?.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  async *stream(prompt, options = {}) {
    const body = {
      model: this.model,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.2,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    };
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Claude stream error ${res.status}: ${err?.error?.message || res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === 'content_block_delta') {
            const text = chunk.delta?.text;
            if (text) yield text;
          }
        } catch (_) {}
      }
    }
  }

  async validateKey() {
    try {
      // Minimal call just to validate the key
      await this.complete('Reply: ok', { maxTokens: 10 });
      return true;
    } catch { return false; }
  }
}
