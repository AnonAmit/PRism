import { readFileContent } from '../analysis/file_tree.js';
import path from 'path';

/**
 * STAGE 5 — FIX GENERATION ENGINE
 * Generates minimal unified diffs for P0/P1/P2 issues.
 */
export async function runStage5(ctx, attempt) {
  ctx.info(5, `[PLAN] For each PR candidate, read actual file → generate minimal diff`);

  const prCandidates = ctx.stage4?.prCandidates ?? [];

  if (prCandidates.length === 0) {
    ctx.info(5, `No PR candidates to fix.`);
    return { fixes: [], confidence: 1.0, summary: 'No fixes needed' };
  }

  ctx.info(5, `Generating fixes for ${prCandidates.length} issues...`);

  const fixes = [];
  const dropped = [];

  for (const issue of prCandidates) {
    ctx.info(5, `Fixing: [${issue.tier}] ${issue.title} in ${issue.file}`);

    try {
      const fix = await generateFix(issue, ctx);
      if (fix) {
        fixes.push(fix);
        ctx.emit('event', { type: 'fix_generated', fix: { issue_id: fix.issue_id, fix_title: fix.fix_title, lines_changed: fix.lines_changed } });
      } else {
        dropped.push({ issue_id: issue.id, reason: 'Confidence below 0.70 threshold' });
        ctx.warn(5, `Dropped fix for ${issue.id}: confidence below threshold`);
      }
    } catch (err) {
      dropped.push({ issue_id: issue.id, reason: err.message });
      ctx.warn(5, `Could not generate fix for ${issue.id}: ${err.message}`);
    }
  }

  ctx.info(5, `Fixes generated: ${fixes.length}/${prCandidates.length}. Dropped: ${dropped.length}`);

  const avgConfidence = fixes.length > 0
    ? fixes.reduce((sum, f) => sum + f.confidence, 0) / fixes.length
    : 0;

  return {
    fixes,
    dropped,
    confidence: avgConfidence,
    summary: `${fixes.length} fixes generated`,
  };
}

async function generateFix(issue, ctx) {
  // Read the actual file content
  const filePath = path.join(ctx.workspaceDir, issue.file);
  const fileContent = await readFileContent(filePath, ctx);

  if (!fileContent) {
    throw new Error(`File not found: ${issue.file}`);
  }

  const lines = fileContent.split('\n');
  const startLine = Math.max(0, (issue.line_range[0] || 1) - 1);
  const endLine = Math.min(lines.length, (issue.line_range[1] || issue.line_range[0] || 1) + 5);
  const contextCode = lines.slice(Math.max(0, startLine - 5), endLine + 5).join('\n');

  const prompt = `You are the AutoPR Engine Fix Generation System.

ISSUE TO FIX:
ID: ${issue.id}
Type: ${issue.type}
File: ${issue.file}
Lines: ${issue.line_range[0]}-${issue.line_range[1]}
Title: ${issue.title}
Description: ${issue.description}
Evidence: ${issue.evidence}

ACTUAL FILE CONTENT (full):
\`\`\`
${fileContent.slice(0, 8000)}
\`\`\`

CONTEXT AROUND ISSUE (lines ${Math.max(1, startLine - 4)}-${endLine + 5}):
\`\`\`
${contextCode}
\`\`\`

TASK: Generate the minimal fix for this issue. Return ONLY valid JSON:

{
  "fix_title": "Short description of the fix",
  "diff": "unified diff string in standard format (--- a/file\\n+++ b/file\\n@@ ... @@\\n lines)",
  "lines_changed": 0,
  "new_imports_required": [],
  "breaking_change_risk": "NONE|LOW|MEDIUM|HIGH",
  "rollback_instruction": "How to undo this change",
  "confidence": 0.0,
  "confidence_reason": "why this confidence level"
}

RULES:
1. Generate the MINIMAL viable diff — change ONLY what is necessary.
2. Preserve the EXACT coding style (indentation, quotes, naming).
3. Do NOT change anything outside the fix scope.
4. Do NOT introduce new external dependencies.
5. If confidence < 0.70, set confidence below 0.70 and explain why.
6. The diff must use standard unified diff format with +/- lines.
7. Never generate destructive operations (rm, drop table, delete, truncate).`;

  let rawResponse = '';
  try {
    rawResponse = await ctx.ai.complete(prompt, { temperature: 0.05, maxTokens: 4096 });
  } catch (err) {
    throw new Error(`AI fix generation failed: ${err.message}`);
  }

  const result = extractJSON(rawResponse);
  if (!result || !result.diff) {
    throw new Error(`Fix generation returned no diff`);
  }

  // Enforce confidence threshold
  if ((result.confidence ?? 0) < 0.70) {
    ctx.warn(5, `Fix confidence ${result.confidence?.toFixed(2)} < 0.70 for ${issue.id}. Dropping.`);
    return null;
  }

  return {
    issue_id: issue.id,
    fix_title: result.fix_title || `Fix: ${issue.title}`,
    diff: result.diff,
    lines_changed: result.lines_changed || 0,
    new_imports_required: result.new_imports_required || [],
    breaking_change_risk: result.breaking_change_risk || 'LOW',
    rollback_instruction: result.rollback_instruction || 'Revert this commit.',
    confidence: result.confidence,
    file: issue.file,
  };
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
