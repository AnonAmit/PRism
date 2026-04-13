/**
 * Provider model catalog — shared data consumed by the frontend form.
 * This mirrors backend/ai/provider.js PROVIDER_MODELS.
 */
export const PROVIDER_MODELS = {
  gemini: [
    { id: 'gemini-2.5-pro',                label: 'Gemini 2.5 Pro (Best)',    context: 2000000 },
    { id: 'gemini-2.0-flash',              label: 'Gemini 2.0 Flash (Fast)',  context: 1000000 },
    { id: 'gemini-1.5-pro',                label: 'Gemini 1.5 Pro',           context: 2000000 },
    { id: 'gemini-1.5-flash',              label: 'Gemini 1.5 Flash',         context: 1000000 },
  ],
  openai: [
    { id: 'o1',           label: 'o1 (Reasoning)',       context: 200000 },
    { id: 'o1-mini',      label: 'o1 Mini',              context: 128000 },
    { id: 'gpt-4o',       label: 'GPT-4o (Recommended)', context: 128000 },
    { id: 'gpt-4o-mini',  label: 'GPT-4o Mini (Fast)',   context: 128000 },
  ],
  claude: [
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (Advanced)', context: 200000 },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Best)',     context: 200000 },
    { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (Fast)',      context: 200000 },
    { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus',                context: 200000 },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet',        label: 'Claude 3.5 Sonnet (via OR)',     context: 200000  },
    { id: 'openai/gpt-4o',                      label: 'GPT-4o (via OR)',                context: 128000  },
    { id: 'google/gemini-2.0-flash-001',        label: 'Gemini 2.0 Flash (via OR)',      context: 1000000 },
    { id: 'meta-llama/llama-3.3-70b-instruct',  label: 'Llama 3.3 70B (via OR)',         context: 131072  },
    { id: 'deepseek/deepseek-chat',             label: 'DeepSeek v3 (via OR)',           context: 64000   },
  ],
  local: [
    { id: 'llama3.2',          label: 'Llama 3.2 (Ollama)',          context: 32000 },
    { id: 'qwen2.5-coder',     label: 'Qwen 2.5 Coder (Ollama)',     context: 32000 },
    { id: 'mistral',           label: 'Mistral (Ollama)',            context: 32000 },
    { id: 'deepseek-coder-v2', label: 'DeepSeek Coder v2 (Ollama)',  context: 32000 },
  ],
};
