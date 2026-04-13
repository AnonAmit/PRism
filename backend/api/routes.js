import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { SessionStore } from '../engine/context.js';
import { createAIProvider } from '../ai/provider.js';
import { runPipeline } from '../engine/pipeline.js';

export const router = express.Router();

// POST /api/analyze — start a pipeline session
router.post('/analyze', async (req, res) => {
  const { repoUrl, mode, scanDepth, aiProvider, apiKey, githubToken } = req.body;

  if (!repoUrl || !repoUrl.startsWith('https://github.com/')) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL.' });
  }
  if (!apiKey && aiProvider !== 'none') {
    return res.status(400).json({ error: 'API key is required.' });
  }

  // Check repo size via GitHub API before cloning
  try {
    const repoPath = repoUrl.replace('https://github.com/', '');
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'PRism/1.0' };
    if (githubToken) headers['Authorization'] = `token ${githubToken}`;

    const ghRes = await fetch(`https://api.github.com/repos/${repoPath}`, { headers });
    if (!ghRes.ok) {
      const msg = ghRes.status === 404 ? 'Repository not found or is private.' : `GitHub API error: ${ghRes.statusText}`;
      return res.status(400).json({ error: msg });
    }
    const repoData = await ghRes.json();
    const sizeMB = repoData.size / 1024;
    if (sizeMB > 500) {
      return res.status(400).json({ error: `Repository is too large (${Math.round(sizeMB)}MB). Maximum allowed: 500MB.` });
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to validate repository: ${err.message}` });
  }

  const sessionId = uuidv4();

  let ctx;
  try {
    ctx = SessionStore.create(sessionId, { repoUrl, mode, scanDepth, aiProvider, apiKey, githubToken });
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  // Respond immediately with sessionId — client will connect via WebSocket
  res.json({ sessionId, wsUrl: `/ws?session=${sessionId}` });

  // Run pipeline asynchronously (fire and forget, results stream via WebSocket)
  setImmediate(() => {
    runPipeline(ctx).catch((err) => {
      ctx.error(0, `Pipeline crashed: ${err.message}`);
      ctx.status = 'failed';
      ctx.emit('event', { type: 'pipeline_error', message: err.message, recoverable: false });
    });
  });
});

// GET /api/session/:id — get session status + results
router.get('/session/:id', (req, res) => {
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  res.json({
    sessionId: session.sessionId,
    status: session.status,
    currentStage: session.currentStage,
    repoUrl: session.repoUrl,
    confidence: session.confidence,
    stage1: session.stage1,
    stage3: session.stage3 ? { issues: session.stage3.issues } : null,
    stage4: session.stage4,
    stage7: session.stage7,
  });
});

// DELETE /api/session/:id — cancel + cleanup
router.delete('/session/:id', async (req, res) => {
  const session = SessionStore.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  session.cancel();
  await SessionStore.cleanup(req.params.id);
  res.json({ ok: true });
});

// POST /api/validate-key — check if an API key is valid
router.post('/validate-key', async (req, res) => {
  const { provider, apiKey, model } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: 'provider and apiKey required.' });
  try {
    const ai = createAIProvider(provider, apiKey, model);
    const valid = await ai.validateKey();
    res.json({ valid });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// GET /api/health
router.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));
