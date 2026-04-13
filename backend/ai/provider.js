/**
 * AI Provider Abstraction Layer
 * All providers implement the same interface:
 *   complete(prompt, options) → string
 *   stream(prompt, options)   → AsyncGenerator<string>
 *   validateKey()             → boolean
 *   models                    → string[]
 *   contextWindow             → number (tokens)
 */

import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeProvider } from './claude.js';
import { OpenRouterProvider } from './openrouter.js';
import { LocalProvider } from './local.js';

const PROVIDERS = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
  claude: ClaudeProvider,
  openrouter: OpenRouterProvider,
  local: LocalProvider,
};

export function createAIProvider(providerName, apiKey, model) {
  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) throw new Error(`Unknown AI provider: "${providerName}"`);
  return new ProviderClass(apiKey, model);
}

export const PROVIDER_MODELS = {
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Fast)', context: 1000000 },
    { id: 'gemini-2.5-pro-preview-03-25', label: 'Gemini 2.5 Pro (Best)', context: 1000000 },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', context: 2000000 },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (Recommended)', context: 128000 },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', context: 128000 },
    { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Fast)', context: 16385 },
  ],
  claude: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Best)', context: 200000 },
    { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Fast)', context: 200000 },
  ],
  openrouter: [
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (via OR)', context: 1000000 },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (via OR)', context: 200000 },
    { id: 'openai/gpt-4o', label: 'GPT-4o (via OR)', context: 128000 },
    { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (via OR)', context: 131072 },
  ],
};
