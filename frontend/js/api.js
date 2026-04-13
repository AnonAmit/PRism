/**
 * REST API client — calls backend endpoints.
 * All AI/analysis happens on the backend.
 */

let BACKEND_URL = localStorage.getItem('prism_backend_url') || 'http://localhost:3001';

export function setBackendUrl(url) {
  BACKEND_URL = url;
  localStorage.setItem('prism_backend_url', url);
}

export function getBackendUrl() { return BACKEND_URL; }

/**
 * Start a new analysis pipeline.
 */
export async function startAnalysis({ repoUrl, mode, scanDepth, aiProvider, apiKey, githubToken, model }) {
  const res = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl, mode, scanDepth, aiProvider, apiKey, githubToken, model }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // { sessionId, wsUrl }
}

/**
 * Get session status and results.
 */
export async function getSession(sessionId) {
  const res = await fetch(`${BACKEND_URL}/api/session/${sessionId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Cancel and cleanup a session.
 */
export async function cancelSession(sessionId) {
  await fetch(`${BACKEND_URL}/api/session/${sessionId}`, { method: 'DELETE' });
}

/**
 * Validate an API key.
 */
export async function validateApiKey(provider, apiKey, model) {
  const res = await fetch(`${BACKEND_URL}/api/validate-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, model }),
  });
  const data = await res.json();
  return data.valid;
}

/**
 * Health check.
 */
export async function healthCheck() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
