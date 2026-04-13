import { runAgentLoop } from './agent_loop.js';
import { createAIProvider } from '../ai/provider.js';
import { mkdir } from 'fs/promises';

import { runStage1 } from '../agents/stage1_ingest.js';
import { runStage2 } from '../agents/stage2_understand.js';
import { runStage3 } from '../agents/stage3_detect.js';
import { runSanityCheck } from '../agents/sanity_agent.js';
import { runStage4 } from '../agents/stage4_prioritize.js';
import { runStage5 } from '../agents/stage5_fix.js';
import { runStage6 } from '../agents/stage6_validate.js';
import { runStage7 } from '../agents/stage7_pr.js';

/**
 * Main pipeline orchestrator — runs all 7 stages via the agent loop.
 * Each stage is a mini THINK→PLAN→EXECUTE→VALIDATE→DEBUG→RETRY loop.
 */
export async function runPipeline(ctx) {
  ctx.status = 'running';
  ctx.emit('event', {
    type: 'pipeline_start',
    sessionId: ctx.sessionId,
    repoUrl: ctx.repoUrl,
    mode: ctx.mode,
    scanDepth: ctx.scanDepth,
    aiProvider: ctx.aiProvider,
  });

  // Create workspace directory
  await mkdir(ctx.workspaceDir, { recursive: true });

  // Initialize AI provider
  ctx.ai = createAIProvider(ctx.aiProvider, ctx.apiKey);
  ctx.info(0, `AI provider: ${ctx.aiProvider} | Scan depth: ${ctx.scanDepth}`);

  // ═══════════════════════════════════════════════
  // STAGE 1  — REPO INGESTION
  // ═══════════════════════════════════════════════
  ctx.currentStage = 1;
  ctx.stage1 = await runAgentLoop({
    stage: 1,
    name: 'Repo Ingestion',
    execute: (c, attempt) => runStage1(c, attempt),
    validate: (r) => {
      if (!r) return { valid: false, reason: 'Stage returned null.' };
      if (!r.fileTree || r.fileTree.length === 0) return { valid: false, reason: 'No source files found.' };
      return { valid: true };
    },
    ctx,
  });

  if (!ctx.stage1) {
    ctx.status = 'failed';
    ctx.emit('event', { type: 'pipeline_error', message: 'Stage 1 failed: could not ingest repository.', recoverable: false });
    await ctx.cleanup();
    return;
  }

  // ═══════════════════════════════════════════════
  // STAGE 2 — CODE UNDERSTANDING
  // ═══════════════════════════════════════════════
  ctx.currentStage = 2;
  ctx.stage2 = await runAgentLoop({
    stage: 2,
    name: 'Code Understanding',
    execute: (c, attempt) => runStage2(c, attempt),
    validate: (r) => {
      if (!r) return { valid: false, reason: 'No understanding output.' };
      if (!r.moduleSummaries || Object.keys(r.moduleSummaries).length === 0)
        return { valid: false, reason: 'No module summaries generated.' };
      return { valid: true };
    },
    ctx,
  });
  if (ctx.stage2) ctx.confidence.stage2 = ctx.stage2.confidence ?? 0.7;

  // ═══════════════════════════════════════════════
  // STAGE 3 — ISSUE DETECTION + SANITY CHECK
  // ═══════════════════════════════════════════════
  ctx.currentStage = 3;
  ctx.stage3 = await runAgentLoop({
    stage: 3,
    name: 'Issue Detection',
    execute: async (c, attempt) => {
      const detectResult = await runStage3(c, attempt);
      // Run sanity check right away on the merged issues
      detectResult.issues = await runSanityCheck(c, detectResult.issues);
      detectResult.summary = `${detectResult.issues.length} valid issues survived sanity check`;
      return detectResult;
    },
    validate: (r) => {
      if (!r) return { valid: false, reason: 'No detection output.' };
      if (!Array.isArray(r.issues)) return { valid: false, reason: 'issues must be an array.' };
      return { valid: true };
    },
    ctx,
  });
  if (ctx.stage3) ctx.confidence.stage3 = ctx.stage3.confidence ?? 0.7;

  // ═══════════════════════════════════════════════
  // STAGE 4 — PRIORITIZATION
  // ═══════════════════════════════════════════════
  ctx.currentStage = 4;
  ctx.stage4 = await runAgentLoop({
    stage: 4,
    name: 'Prioritization',
    execute: (c, attempt) => runStage4(c, attempt),
    validate: (r) => {
      if (!r) return { valid: false, reason: 'No prioritization output.' };
      return { valid: true };
    },
    ctx,
  });

  // ═══════════════════════════════════════════════
  // STAGE 5 — FIX GENERATION
  // ═══════════════════════════════════════════════
  ctx.currentStage = 5;
  ctx.stage5 = await runAgentLoop({
    stage: 5,
    name: 'Fix Generation',
    execute: (c, attempt) => runStage5(c, attempt),
    validate: (r) => {
      if (!r) return { valid: false, reason: 'No fixes generated.' };
      return { valid: true };
    },
    ctx,
  });
  if (ctx.stage5) ctx.confidence.stage5 = ctx.stage5.confidence ?? 0.6;

  // ═══════════════════════════════════════════════
  // STAGE 6 — VALIDATION (REAL execution)
  // ═══════════════════════════════════════════════
  ctx.currentStage = 6;
  ctx.stage6 = await runAgentLoop({
    stage: 6,
    name: 'Validation',
    execute: (c, attempt) => runStage6(c, attempt),
    validate: (r) => {
      if (!r) return { valid: false, reason: 'Validation stage returned null.' };
      return { valid: true };
    },
    ctx,
  });
  if (ctx.stage6) ctx.confidence.stage6 = ctx.stage6.confidence ?? 0.5;

  // ═══════════════════════════════════════════════
  // STAGE 7 — PR GENERATION
  // ═══════════════════════════════════════════════
  ctx.currentStage = 7;
  ctx.stage7 = await runAgentLoop({
    stage: 7,
    name: 'PR Generation',
    execute: (c, attempt) => runStage7(c, attempt),
    validate: (r) => {
      if (!r || !r.pr) return { valid: false, reason: 'No PR output generated.' };
      if (!r.pr.title) return { valid: false, reason: 'PR missing title.' };
      return { valid: true };
    },
    ctx,
  });

  // ═══════════════════════════════════════════════
  // FINAL CONFIDENCE SCORE
  // ═══════════════════════════════════════════════
  let finalConfidence = Math.min(
    ctx.confidence.stage2 || 1.0,
    ctx.confidence.stage3 || 1.0,
    ctx.confidence.stage5 || 1.0,
    ctx.confidence.stage6 || 1.0
  );

  // If no tests/linter were successfully executed, max confidence is 60%
  const noValidation = (!ctx.stage6?.testResult?.available && !ctx.stage6?.linterResult?.available);
  if (noValidation && finalConfidence > 0.60) {
    ctx.info(0, 'Validation execution unavailable (no tests/linter). Capping confidence at 60%.');
    finalConfidence = 0.60;
  }

  // If sanity agent or any stage dropped confidence extremely low, respect the cap
  if (ctx.stage3?.issues && ctx.stage3.issues.some(i => i.confidence < 0.5)) {
    finalConfidence = Math.min(finalConfidence, 0.50);
  }

  ctx.confidence.final = Math.round(finalConfidence * 100);

  ctx.status = 'complete';
  ctx.info(0, `Pipeline complete. Final confidence: ${ctx.confidence.final}%`);

  ctx.emit('event', {
    type: 'pipeline_complete',
    confidence: ctx.confidence,
    pr: ctx.stage7?.pr ?? null,
    issues: ctx.stage3?.issues ?? [],
    fixes: ctx.stage6?.approvedFixes ?? [],
    summary: ctx.stage1?.repoSummary ?? null,
  });

  // Schedule workspace cleanup after 1 hour
  setTimeout(() => ctx.cleanup(), 60 * 60 * 1000);
}
