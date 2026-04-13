import { EventEmitter } from 'events';
import { rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..', 'workspace');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '5', 10);

/**
 * Pipeline session context — shared state object passed through all pipeline stages.
 * Each session is isolated by sessionId (UUID).
 */
export class PipelineContext extends EventEmitter {
  constructor(sessionId, options = {}) {
    super();
    this.sessionId = sessionId;
    this.createdAt = Date.now();

    // Input options
    this.repoUrl = options.repoUrl;
    this.mode = options.mode || 'autonomous'; // 'autonomous' | 'semi'
    this.scanDepth = options.scanDepth || 'standard'; // 'shallow' | 'standard' | 'deep'
    this.aiProvider = options.aiProvider || 'gemini';
    this.apiKey = options.apiKey;
    this.githubToken = options.githubToken || null;

    // Workspace
    this.workspaceDir = path.join(WORKSPACE_ROOT, sessionId);

    // Pipeline state
    this.status = 'pending'; // pending | running | complete | failed | cancelled
    this.currentStage = 0;

    // Stage outputs
    this.stage1 = null; // { language, framework, deps, fileTree, testFramework, ciConfig }
    this.stage2 = null; // { depGraph, entryPoints, flowMap, moduleSummaries, archPattern }
    this.stage3 = null; // { issues[] }
    this.stage4 = null; // { prioritizedIssues[] }
    this.stage5 = null; // { fixes[] }
    this.stage6 = null; // { approvedFixes[] }
    this.stage7 = null; // { pr: { title, description, diffs[], confidence } }

    // Confidence tracking (0.0–1.0 per stage)
    this.confidence = {
      stage2: 0, stage3: 0, stage5: 0, stage6: 0, final: 0
    };

    // WebSocket reference (set by server.js when client connects)
    this.ws = null;

    // Buffered events for clients that connect after pipeline starts
    this.eventBuffer = [];

    // File contents cache (to avoid re-reading)
    this._fileCache = new Map();

    // Abort controller for cancellation
    this._abortController = new AbortController();
  }

  get signal() { return this._abortController.signal; }

  cancel() {
    this.status = 'cancelled';
    this._abortController.abort();
    this.emit('event', { type: 'pipeline_cancelled', sessionId: this.sessionId });
  }

  /**
   * Emit a typed event — broadcasts to WebSocket client and stores in buffer.
   */
  emit(name, payload) {
    if (name !== 'event') return super.emit(name, payload);

    const event = { ...payload, ts: Date.now() };
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > 500) this.eventBuffer.shift(); // cap buffer

    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try { this.ws.send(JSON.stringify(event)); } catch (_) {}
    }

    return super.emit('event', event);
  }

  log(stage, level, message, data = null) {
    this.emit('event', { type: 'log', stage, level, message, ...(data ? { data } : {}) });
    const prefix = `[Stage ${stage}][${level.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, message);
    else console.log(prefix, message);
  }

  info(stage, message, data) { this.log(stage, 'info', message, data); }
  warn(stage, message, data) { this.log(stage, 'warn', message, data); }
  error(stage, message, data) { this.log(stage, 'error', message, data); }

  async cleanup() {
    try {
      await rm(this.workspaceDir, { recursive: true, force: true });
      this._fileCache.clear();
    } catch (_) {}
  }
}

/**
 * Session store — singleton map of all active sessions.
 */
class _SessionStore extends Map {
  create(sessionId, options) {
    if (this.size >= MAX_CONCURRENT) {
      throw new Error(`Max concurrent sessions (${MAX_CONCURRENT}) reached. Try again later.`);
    }
    const ctx = new PipelineContext(sessionId, options);
    this.set(sessionId, ctx);
    return ctx;
  }

  async cleanup(sessionId) {
    const session = this.get(sessionId);
    if (session) {
      await session.cleanup();
      this.delete(sessionId);
    }
  }
}

export const SessionStore = new _SessionStore();
