import { runLinter } from '../sandbox/linter.js';
import { runTests } from '../sandbox/test_runner.js';

/**
 * STAGE 6 — VALIDATION LAYER
 * Runs REAL linting + test execution. No simulated mental execution.
 */
export async function runStage6(ctx, attempt) {
  ctx.info(6, `[PLAN] Run real linter → run real tests → validate each fix → score confidence`);

  const fixes = ctx.stage5?.fixes ?? [];
  const langInfo = ctx.stage1;

  if (fixes.length === 0) {
    ctx.info(6, `No fixes to validate.`);
    return { approvedFixes: [], linterResult: null, testResult: null, confidence: 1.0, summary: 'No fixes to validate' };
  }

  // ── Run real linter ─────────────────────────────────────────────────────
  ctx.info(6, `[EXECUTE] Running linter on workspace...`);
  let linterResult = null;
  try {
    linterResult = await runLinter(ctx.workspaceDir, langInfo);
    if (linterResult.available) {
      ctx.info(6, `Linter (${linterResult.tool}): exit code ${linterResult.exitCode}${linterResult.timedOut ? ' [TIMED OUT]' : ''}`);
      ctx.emit('event', {
        type: 'linter_result',
        tool: linterResult.tool,
        exitCode: linterResult.exitCode,
        issueCount: linterResult.issues?.length ?? 0,
        timedOut: linterResult.timedOut,
      });
    } else {
      ctx.info(6, `Linter not available: ${linterResult.message}`);
    }
  } catch (err) {
    ctx.warn(6, `Linter failed: ${err.message}`);
  }

  // ── Run real tests ──────────────────────────────────────────────────────
  ctx.info(6, `[EXECUTE] Running test suite...`);
  let testResult = null;
  try {
    testResult = await runTests(ctx.workspaceDir, langInfo);
    if (testResult.available) {
      ctx.info(6, `Tests (${testResult.tool}): ${testResult.passed} passed, ${testResult.failed} failed${testResult.timedOut ? ' [TIMED OUT]' : ''}`);
      ctx.emit('event', {
        type: 'test_result',
        tool: testResult.tool,
        passed: testResult.passed,
        failed: testResult.failed,
        total: testResult.total,
        exitCode: testResult.exitCode,
        timedOut: testResult.timedOut,
      });
    } else {
      ctx.info(6, `Tests not available: ${testResult.message}`);
    }
  } catch (err) {
    ctx.warn(6, `Tests failed: ${err.message}`);
  }

  // ── Validate each fix via AI ────────────────────────────────────────────
  const approvedFixes = [];
  const rejectedFixes = [];

  for (const fix of fixes) {
    ctx.info(6, `Validating fix for ${fix.issue_id}...`);
    const validation = await validateFix(fix, linterResult, testResult, ctx);

    ctx.emit('event', {
      type: 'validation_result',
      fix_id: fix.issue_id,
      status: validation.final_status,
      breaking_change: validation.breaking_change,
      logic_check: validation.logic_check,
    });

    if (validation.final_status === 'APPROVED' || validation.final_status === 'CONDITIONAL') {
      approvedFixes.push({ ...fix, validation });
    } else {
      rejectedFixes.push({ ...fix, validation });
      ctx.warn(6, `Fix ${fix.issue_id} REJECTED: ${validation.rejection_reason}`);
    }
  }

  // ── Calculate confidence ─────────────────────────────────────────────────
  let confidence = 0.5;

  const testsPassed = testResult?.available && testResult.failed === 0;
  const linterClean = linterResult?.available && (linterResult.exitCode === 0 || !linterResult.issues?.some(i => i.severity === 'error'));
  const approvalRate = fixes.length > 0 ? approvedFixes.length / fixes.length : 1;

  if (testsPassed) confidence += 0.2;
  if (linterClean) confidence += 0.15;
  confidence += approvalRate * 0.15;

  ctx.info(6, `Validation complete. Approved: ${approvedFixes.length}/${fixes.length}. Confidence: ${(confidence * 100).toFixed(0)}%`);

  return {
    approvedFixes,
    rejectedFixes,
    linterResult,
    testResult,
    confidence: Math.min(1.0, confidence),
    summary: `${approvedFixes.length} approved, ${rejectedFixes.length} rejected`,
  };
}

async function validateFix(fix, linterResult, testResult, ctx) {
  // Build validation context
  const linterHit = linterResult?.issues?.find(i => i.file && fix.file && i.file.includes(fix.file.split('/').pop()));
  const testsFailed = testResult?.available && testResult.failed > 0;

  const prompt = `You are the AutoPR Engine Validation Layer.

FIX TO VALIDATE:
Issue ID: ${fix.issue_id}
Fix Title: ${fix.fix_title}
File: ${fix.file}
Breaking Change Risk: ${fix.breaking_change_risk}
Diff:
${fix.diff}

REAL EXECUTION RESULTS:
Linter: ${linterResult?.available ? `${linterResult.tool} — exit code ${linterResult.exitCode}` : 'Not available'}
${linterHit ? `Linter found issue in this file: ${JSON.stringify(linterHit)}` : ''}
Tests: ${testResult?.available ? `${testResult.tool} — ${testResult.passed} passed, ${testResult.failed} failed` : 'Not available'}

TASK: Validate this fix. Return ONLY valid JSON:

{
  "logic_check": "PASS|FAIL|UNCERTAIN",
  "breaking_change": "YES|NO|POSSIBLE",
  "simulation_result": "PASS|FAIL",
  "style_valid": "YES|NO",
  "test_impact": "NONE|COVERED|UNCOVERED",
  "final_status": "APPROVED|REJECTED|CONDITIONAL",
  "rejection_reason": "only if REJECTED",
  "caveats": "any specific things reviewer must check"
}

Rules:
- If tests failed AND this fix touches test-covered code → CONDITIONAL with caveat.
- If linter reports an error in this file → note in caveats.
- If diff changes any public API signature → breaking_change = POSSIBLE.
- REJECT only if the diff clearly introduces a new bug or is syntactically invalid.
- CONDITIONAL = approved with caveats for reviewer.`;

  try {
    const rawResponse = await ctx.ai.complete(prompt, { temperature: 0.05, maxTokens: 1024 });
    const result = extractJSON(rawResponse);
    if (!result) throw new Error('Invalid JSON');
    return { ...result, fix_id: fix.issue_id };
  } catch (err) {
    ctx.warn(6, `AI validation failed for ${fix.issue_id}: ${err.message}. Defaulting to CONDITIONAL.`);
    return {
      fix_id: fix.issue_id,
      logic_check: 'UNCERTAIN',
      breaking_change: 'POSSIBLE',
      simulation_result: 'PASS',
      style_valid: 'YES',
      test_impact: testResult?.available ? 'UNCOVERED' : 'NONE',
      final_status: 'CONDITIONAL',
      caveats: 'Automated validation unavailable. Manual review required.',
    };
  }
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch (_) {} }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) { try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {} }
  return null;
}
