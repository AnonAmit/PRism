import { scanAllFiles } from '../analysis/pattern_scanner.js';
import { formatFilesForPrompt } from '../analysis/context_loader.js';

/**
 * STAGE 3 — ISSUE DETECTION ENGINE
 * Runs: static pattern scanner (no AI) + LLM deep analysis
 */
export async function runStage3(ctx, attempt) {
  ctx.info(3, `[PLAN] Run pattern scanner → LLM analysis → merge and deduplicate issues`);

  const { selectedFiles } = ctx.contextData;

  // 3A + 3B: Pattern scanner (fast, no AI)
  ctx.info(3, `[EXECUTE] Running static pattern scanner...`);
  const patternIssues = scanAllFiles(selectedFiles);
  ctx.info(3, `Pattern scanner found ${patternIssues.length} potential issues.`);

  for (const issue of patternIssues) {
    ctx.emit('event', { type: 'issue_found', source: 'pattern', issue });
  }

  // 3C + 3D: LLM analysis
  ctx.info(3, `[EXECUTE] Running AI-powered issue detection...`);

  const filesPrompt = formatFilesForPrompt(selectedFiles);
  const lang = ctx.stage1.language;
  const framework = ctx.stage1.framework;
  const arch = ctx.stage2?.archPattern ?? 'unknown';

  // Retry prompt includes previous failure reason if retrying
  const retryNote = attempt > 0
    ? `\n\nNOTE: Previous attempt failed: ${ctx.stage3_lastFailure || 'unknown reason'}. Ensure valid JSON output.`
    : '';

  const prompt = `You are the AutoPR Engine Issue Detection System analyzing a ${lang}${framework ? '/' + framework : ''} ${arch} codebase.

REPOSITORY CODE:
${filesPrompt}

ALREADY DETECTED BY PATTERN SCANNER (avoid duplicates):
${patternIssues.map(i => `- ${i.file}:${i.line_range[0]} — ${i.title}`).join('\n') || 'None'}

TASK: Detect issues using heuristic + LLM reasoning strategies. Return ONLY valid JSON:

{
  "issues": [
    {
      "id": "ISSUE-1",
      "type": "BUG|SECURITY|PERFORMANCE|CODE_SMELL|MISSING_FEATURE|BAD_PRACTICE",
      "file": "relative/path/to/file.ext",
      "line_range": [startLine, endLine],
      "title": "Short description (max 10 words)",
      "description": "What is wrong and why it matters",
      "evidence": "Exact code snippet or pattern that proves this issue",
      "detection_strategy": "HEURISTIC|LLM",
      "confidence": 0.0
    }
  ],
  "confidence": 0.0,
  "scanNote": "Any important notes about scan coverage or limitations"
}

RULES:
- ONLY report issues grounded in code you have ACTUALLY seen in the file contents above.
- Do NOT report hypothetical or theoretical issues.
- Do NOT duplicate issues already found by pattern scanner.
- evidence must be an actual code snippet from the file, not a description.
- Aim for quality over quantity. 5 real issues > 20 fabricated ones.
- Issue types: BUG (logic/runtime errors), SECURITY (vulns), PERFORMANCE (bottlenecks), CODE_SMELL (maintainability), BAD_PRACTICE (anti-patterns)${retryNote}`;

  let rawResponse = '';
  try {
    rawResponse = await ctx.ai.complete(prompt, { temperature: 0.15, maxTokens: 8192 });
  } catch (err) {
    throw new Error(`AI detection failed: ${err.message}`);
  }

  const aiResult = extractJSON(rawResponse);
  if (!aiResult || !Array.isArray(aiResult.issues)) {
    ctx.stage3_lastFailure = 'Non-JSON or missing issues array';
    throw new Error(`AI returned invalid detection response`);
  }

  // Normalize AI issues — ensure required fields
  const aiIssues = aiResult.issues
    .filter(i => i.file && i.title && i.evidence)
    .map((i, idx) => ({
      id: i.id || `LLM-${idx + 1}`,
      type: i.type || 'CODE_SMELL',
      file: i.file,
      line_range: i.line_range || [1, 1],
      title: i.title,
      description: i.description || '',
      evidence: i.evidence,
      detection_strategy: i.detection_strategy || 'LLM',
      confidence: Math.min(1.0, Math.max(0.0, i.confidence || 0.7)),
    }));

  for (const issue of aiIssues) {
    ctx.emit('event', { type: 'issue_found', source: 'llm', issue });
  }

  // Merge all issues
  const allIssues = [...patternIssues, ...aiIssues];
  const totalIssues = allIssues.length;

  ctx.info(3, `Total issues detected: ${totalIssues} (${patternIssues.length} pattern + ${aiIssues.length} AI)`);

  return {
    issues: allIssues,
    patternCount: patternIssues.length,
    aiCount: aiIssues.length,
    confidence: aiResult.confidence ?? 0.75,
    scanNote: aiResult.scanNote || '',
    summary: `${totalIssues} issues detected`,
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
