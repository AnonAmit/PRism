export class LocalProvider {
  constructor(apiKey, model = 'llama3.2') {
    // apiKey can be used to set a custom base URL overrides for Local AI
    // example API key format for overriding: `http://localhost:11434/v1`
    
    this.model = model;
    
    // If apiKey starts with http, treat it as a custom base URL.
    // Otherwise fallback to Ollama default OpenAI-compatible endpoint.
    if (apiKey && apiKey.startsWith('http')) {
      this.baseUrl = apiKey.endsWith('/') ? apiKey.slice(0, -1) : apiKey;
      this.apiKey = 'ollama'; 
    } else {
      this.baseUrl = 'http://localhost:11434/v1';
      this.apiKey = apiKey || 'ollama';
    }

    this.contextWindow = 128000;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  async complete(prompt, options = {}) {
    const body = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8192,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Local AI API error ${res.status}: ${err?.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async *stream(prompt, options = {}) {
    const body = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8192,
      stream: true,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Local AI stream error ${res.status}: ${err?.error?.message || res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial lines
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const chunk = JSON.parse(data);
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch (_) {}
      }
    }
  }

  async validateKey() {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this._headers() });
      return res.ok;
    } catch { return false; }
  }
}
