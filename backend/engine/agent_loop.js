const MAX_RETRIES = 2;

/**
 * Agent loop — wraps each pipeline stage in a Think→Plan→Execute→Validate→Debug→Retry loop.
 *
 * @param {object} opts
 * @param {number} opts.stage - Stage number (1-7)
 * @param {string} opts.name - Stage name (for logging)
 * @param {Function} opts.execute - Async fn(ctx, attempt) → result
 * @param {Function} opts.validate - Fn(result) → { valid: bool, reason: string }
 * @param {PipelineContext} opts.ctx
 * @returns {Promise<result>}
 */
export async function runAgentLoop({ stage, name, execute, validate, ctx }) {
  let attempt = 0;
  let lastError = null;

  ctx.emit('event', { type: 'stage_start', stage, name });
  ctx.info(stage, `Starting ${name}`);

  while (attempt <= MAX_RETRIES) {
    if (ctx.signal.aborted) {
      throw new Error('Pipeline cancelled');
    }

    if (attempt > 0) {
      ctx.warn(stage, `Retry attempt ${attempt}/${MAX_RETRIES} — previous issue: ${lastError}`);
      ctx.emit('event', { type: 'stage_retry', stage, attempt, reason: lastError });
    }

    try {
      // THINK: Log what we're about to do
      ctx.info(stage, attempt === 0
        ? `[THINK] Analyzing inputs for ${name}...`
        : `[THINK] Re-evaluating after failure: ${lastError}`
      );

      // EXECUTE: Run the stage function
      const result = await execute(ctx, attempt, lastError);

      // VALIDATE: Check the result
      const validation = validate ? validate(result) : { valid: true };

      if (validation.valid) {
        // SUCCESS
        ctx.info(stage, `[VALIDATE] Stage ${stage} output accepted.`);
        ctx.emit('event', {
          type: 'stage_complete',
          stage,
          name,
          confidence: result?.confidence ?? null,
          summary: result?.summary ?? null,
        });
        return result;
      } else {
        // VALIDATION FAILED → DEBUG → RETRY
        lastError = validation.reason;
        ctx.warn(stage, `[VALIDATE] Failed: ${validation.reason}`);
        ctx.emit('event', { type: 'stage_validation_failed', stage, reason: validation.reason });
        attempt++;
      }
    } catch (err) {
      lastError = err.message;
      ctx.error(stage, `[ERROR] ${err.message}`);
      attempt++;

      // If it's a network/API error, retry
      if (attempt > MAX_RETRIES) break;
    }
  }

  // All retries exhausted — degrade gracefully
  ctx.warn(stage, `Stage ${stage} failed after ${MAX_RETRIES} retries. Continuing in degraded mode.`);
  ctx.emit('event', {
    type: 'stage_failed',
    stage,
    name,
    reason: lastError,
    degraded: true,
  });

  // Return null — pipeline must handle null gracefully
  return null;
}
