import { scanAllFiles } from '../analysis/pattern_scanner.js';
import { formatFilesForPrompt } from '../analysis/context_loader.js';
import { validateFileTypeRules } from '../analysis/file_type_rules.js';

/**
 * STAGE 3 — ISSUE DETECTION ENGINE
 * Runs: static pattern scanner (no AI) + LLM deep analysis + File-Type Pre-filter
 */
export async function runStage3(ctx, attempt) {
  ctx.info(3, `[PLAN] Run pattern scanner → LLM reasoning → rule-based filter → deduplicate`);

  const { selectedFiles } = ctx.contextData;

  // 3A + 3B: Pattern scanner (fast, no AI)
  ctx.info(3, `[EXECUTE] Running static pattern scanner...`);
  const rawPatternIssues = scanAllFiles(selectedFiles);
  const patternIssues = [];
  
  for (const issue of rawPatternIssues) {
    const ruleCheck = validateFileTypeRules(issue.type, issue.file);
    if (!ruleCheck.valid) {
      ctx.info(3, `Issue rejected (Pattern): invalid for file type -> ${issue.file} (${issue.type})`);
      continue;
    }
    patternIssues.push(issue);
    ctx.emit('event', { type: 'issue_found', source: 'pattern', issue });
  }

  ctx.info(3, `Pattern scanner retained ${patternIssues.length} valid issues.`);

  // 3C + 3D: LLM analysis
  ctx.info(3, `[EXECUTE] Running strict AI-powered issue detection...`);

  const filesPrompt = formatFilesForPrompt(selectedFiles);
  const lang = ctx.stage1.language;
  const framework = ctx.stage1.framework;
  const arch = ctx.stage2?.archPattern ?? 'unknown';

  const retryNote = attempt > 0
    ? `\n\nNOTE: Previous attempt failed: ${ctx.stage3_lastFailure || 'unknown reason'}. Ensure valid JSON output.`
    : '';

  const prompt = `You are the AutoPR Engine Precision Issue Detection System analyzing a ${lang}${framework ? '/' + framework : ''} ${arch} codebase. You operate in HIGH-ACCURACY mode.

REPOSITORY CODE:
${filesPrompt}

ALREADY DETECTED BY PATTERN SCANNER (avoid duplicates):
${patternIssues.map(i => `- ${i.file}:${i.line_range[0]} — ${i.title}`).join('\n') || 'None'}

TASK: Detect issues using deep reasoning. Return ONLY valid JSON:

{
  "issues": [
    {
      "id": "ISSUE-1",
      "type": "BUG|SECURITY|PERFORMANCE|CODE_SMELL|MISSING_FEATURE|BAD_PRACTICE",
      "file": "relative/path/to/file.ext",
      "line_range": [startLine, endLine],
      "title": "Short description (max 10 words)",
      "description": "What is wrong and why it matters",
      "evidence": "Exact code snippet demonstrating the flaw",
      "reasoning": "Step-by-step reasoning: 1. Where is the flaw? 2. How does data reach it? 3. Is there execution? 4. Confirm it is an exploit/bug and not a false positive.",
      "detection_strategy": "LLM_DEEP_REASONING",
      "confidence": 0.0
    }
  ],
  "confidence": 0.0,
  "scanNote": "Any notes on scan coverage"
}

CRITICAL RULES:
- ONLY report issues grounded in code you have ACTUALLY seen above.
- NEVER report vulnerabilities in documentation (.md, .txt) or config files.
- SECURITY RULE: For security vulnerabilities (e.g., SQL injection, XSS), you MUST verify ALL of the following:
  1. A clear entry point or user input exists.
  2. Data flows into the vulnerable function.
  3. Query/Command execution is present.
  4. No sanitization is present.
  If ANY of these are missing, REJECT the issue mentally and do not output it.
- Shallow pattern matches without execution context must be ignored.
- Aim for 100% accuracy. 1 real issue > 50 hallucinations.${retryNote}`;

  let rawResponse = '';
  try {
    rawResponse = await ctx.ai.complete(prompt, { temperature: 0.1, maxTokens: 8192 });
  } catch (err) {
    throw new Error(`AI detection failed: ${err.message}`);
  }

  const aiResult = extractJSON(rawResponse);
  if (!aiResult || !Array.isArray(aiResult.issues)) {
    ctx.stage3_lastFailure = 'Non-JSON or missing issues array';
    throw new Error(`AI returned invalid detection response`);
  }

  const aiIssues = [];
  for (let idx = 0; idx < aiResult.issues.length; idx++) {
    const rawIssue = aiResult.issues[idx];
    if (!rawIssue.file || !rawIssue.title || !rawIssue.evidence) continue;

    const issueType = rawIssue.type || 'CODE_SMELL';
    const ruleCheck = validateFileTypeRules(issueType, rawIssue.file);
    if (!ruleCheck.valid) {
      ctx.info(3, `Issue rejected (LLM): invalid for file type -> ${rawIssue.file} (${issueType})`);
      continue;
    }

    const issue = {
      id: rawIssue.id || `LLM-${idx + 1}`,
      type: issueType,
      file: rawIssue.file,
      line_range: rawIssue.line_range || [1, 1],
      title: rawIssue.title,
      description: rawIssue.description || '',
      evidence: rawIssue.evidence,
      reasoning: rawIssue.reasoning || '',
      detection_strategy: rawIssue.detection_strategy || 'LLM',
      confidence: Math.min(1.0, Math.max(0.0, rawIssue.confidence || 0.7)),
    };

    aiIssues.push(issue);
    ctx.emit('event', { type: 'issue_found', source: 'llm', issue });
  }

  const allIssues = [...patternIssues, ...aiIssues];
  ctx.info(3, `Total valid issues detected: ${allIssues.length} (${patternIssues.length} pattern + ${aiIssues.length} AI)`);

  return {
    issues: allIssues,
    patternCount: patternIssues.length,
    aiCount: aiIssues.length,
    confidence: aiResult.confidence ?? 0.75,
    scanNote: aiResult.scanNote || '',
    summary: `${allIssues.length} issues detected`,
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
