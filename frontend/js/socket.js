/**
 * WebSocket client — connects to backend and dispatches events to UI handlers.
 * Frontend is a pure display layer. Zero AI logic here.
 */

export class PipelineSocket {
  constructor(sessionId, handlers = {}) {
    this.sessionId = sessionId;
    this.handlers = handlers;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 3;
  }

  connect(backendUrl = 'http://localhost:3001') {
    const wsUrl = backendUrl
      .replace('http://', 'ws://')
      .replace('https://', 'wss://');

    this.ws = new WebSocket(`${wsUrl}/ws?session=${this.sessionId}`);

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.handlers.onConnected?.();
    });

    this.ws.addEventListener('message', (evt) => {
      try {
        const event = JSON.parse(evt.data);
        this._dispatch(event);
      } catch (err) {
        console.error('[WS] Failed to parse event:', evt.data);
      }
    });

    this.ws.addEventListener('close', (evt) => {
      this.handlers.onDisconnected?.(evt.code, evt.reason);

      // Auto-reconnect for transient disconnects
      if (this.reconnectAttempts < this.maxReconnects && evt.code !== 1008) {
        this.reconnectAttempts++;
        const delay = Math.pow(2, this.reconnectAttempts) * 500;
        setTimeout(() => this.connect(backendUrl), delay);
      }
    });

    this.ws.addEventListener('error', (err) => {
      this.handlers.onError?.(err);
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _dispatch(event) {
    const { type } = event;

    switch (type) {
      case 'pipeline_start':        return this.handlers.onPipelineStart?.(event);
      case 'stage_start':           return this.handlers.onStageStart?.(event);
      case 'log':                   return this.handlers.onLog?.(event);
      case 'stage_complete':        return this.handlers.onStageComplete?.(event);
      case 'stage_failed':          return this.handlers.onStageFailed?.(event);
      case 'stage_retry':           return this.handlers.onStageRetry?.(event);
      case 'stage_validation_failed': return this.handlers.onStageValidationFailed?.(event);
      case 'repo_ingested':         return this.handlers.onRepoIngested?.(event);
      case 'understanding_complete': return this.handlers.onUnderstandingComplete?.(event);
      case 'issue_found':           return this.handlers.onIssueFound?.(event);
      case 'prioritization_complete': return this.handlers.onPrioritizationComplete?.(event);
      case 'fix_generated':         return this.handlers.onFixGenerated?.(event);
      case 'linter_result':         return this.handlers.onLinterResult?.(event);
      case 'test_result':           return this.handlers.onTestResult?.(event);
      case 'validation_result':     return this.handlers.onValidationResult?.(event);
      case 'pipeline_complete':     return this.handlers.onPipelineComplete?.(event);
      case 'pipeline_error':        return this.handlers.onPipelineError?.(event);
      case 'pipeline_cancelled':    return this.handlers.onPipelineCancelled?.(event);
      default:
        console.debug('[WS] Unknown event type:', type, event);
    }
  }
}
