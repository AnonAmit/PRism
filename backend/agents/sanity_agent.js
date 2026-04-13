/**
 * STAGE 3.5 — SANITY CHECK AGENT
 * Runs after detection (Stage 3). Groups issues by type and uses LLM to systematically
 * reject logical impossibilities and hallucinations using structured validation.
 */

export async function runSanityCheck(ctx, issues) {
  if (!issues || issues.length === 0) return [];

  ctx.info(3, `[SANITY] Running strict logical sanity check on ${issues.length} detected issues...`);

  // Group issues by type
  const groupedIssues = {};
  for (const issue of issues) {
    if (!groupedIssues[issue.type]) groupedIssues[issue.type] = [];
    groupedIssues[issue.type].push(issue);
  }

  const validIssues = [];

  for (const [type, typeIssues] of Object.entries(groupedIssues)) {
    ctx.info(3, `[SANITY] Validating ${typeIssues.length} ${type} issues...`);

    const issuesPromptList = typeIssues.map((i, idx) => `
{
  "index": ${idx},
  "id": "${i.id}",
  "file": "${i.file}",
  "line": ${i.line_range[0]},
  "title": "${i.title.replace(/"/g, '\\"')}",
  "evidence": "${i.evidence.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
  "reasoning": "${(i.reasoning || i.description || '').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
}`).join(',\n');

    const prompt = `You are the AutoPR Engine Sanity Check Agent.
You operate in STRICT FIX AND CORRECT mode. Your job is to aggressively REJECT hallucinations, logically impossible flaws, and false positives.

You are evaluating issues of type: ${type}.

ISSUES TO VALIDATE (JSON Array Format):
[
${issuesPromptList}
]

TASK:
For EACH issue provided above, analyze its logical possibility and evidence context.
- If it lacks a clear execution path -> reject.
- If it is based on a weak assumption -> reject.
- If it is impossible in the file format (e.g., SQL injection in a static asset) -> reject.
- If the evidence does not undeniably prove the issue -> reject.

Return EXACTLY valid JSON in this format:

{
  "results": [
    {
      "index": 0,
      "valid": true|false,
      "reason": "Why this issue passes or fails logical scrutiny based on the rigorous constraints."
    }
  ]
}

Only return the raw JSON.`;

    let rawResponse = '';
    try {
      rawResponse = await ctx.ai.complete(prompt, { temperature: 0.05, maxTokens: 4096 });
    } catch (err) {
      ctx.warn(3, `[SANITY] LLM failed for ${type}: ${err.message}. Defaulting to allowing pattern issues.`);
      validIssues.push(...typeIssues); // Fallback if LLM fails
      continue;
    }

    const aiResult = extractJSON(rawResponse);
    if (!aiResult || !Array.isArray(aiResult.results)) {
      ctx.warn(3, `[SANITY] Invalid JSON response for ${type}. Keeping issues as fallback.`);
      validIssues.push(...typeIssues);
      continue;
    }

    const resultMap = new Map(aiResult.results.map(r => [r.index, r]));

    for (let idx = 0; idx < typeIssues.length; idx++) {
      const issue = typeIssues[idx];
      const result = resultMap.get(idx);

      if (result && result.valid === false) {
        ctx.warn(3, `Issue rejected (Sanity): ${issue.id} - ${result.reason}`);
        issue.confidence = 0.0; // Penalty applied: Sanity rejection = 0%
      } else {
        if (result && result.reason) {
          issue.description += `\n\n[Sanity Passed: ${result.reason}]`;
        }
        validIssues.push(issue);
      }
    }
  }

  ctx.info(3, `[SANITY] Sanity check complete. Retained ${validIssues.length} out of ${issues.length} issues.`);
  return validIssues;
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
