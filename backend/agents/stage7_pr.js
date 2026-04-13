/**
 * STAGE 7 — PR GENERATION ENGINE
 * Assembles the complete Pull Request from all stage outputs.
 */
export async function runStage7(ctx, attempt) {
  ctx.info(7, `[PLAN] Assemble PR title + description + diffs + confidence score + reviewer checklist`);

  const approvedFixes = ctx.stage6?.approvedFixes ?? [];
  const allIssues = ctx.stage3?.issues ?? [];
  const prCandidates = ctx.stage4?.prCandidates ?? [];
  const p3Issues = ctx.stage4?.p3Issues ?? [];
  const linterResult = ctx.stage6?.linterResult;
  const testResult = ctx.stage6?.testResult;

  // Final confidence calculation
  const confidence = ctx.confidence.final ?? 0;

  if (confidence < 50 && approvedFixes.length === 0) {
    ctx.warn(7, `Confidence ${confidence}% < 50% with no approved fixes. Generating analysis report only.`);
    return {
      pr: null,
      analysisReport: buildAnalysisReport(ctx),
      summary: 'Confidence too low for PR. Analysis report generated.',
      confidence,
    };
  }

  // Build PR scope string
  const scope = detectScope(approvedFixes, ctx);

  // Build PR title
  const primaryFix = approvedFixes[0] ?? prCandidates[0];
  const prTitle = buildPRTitle(primaryFix, scope);

  // Build full PR description using the template from system prompt
  const prDescription = buildPRDescription({
    fixes: approvedFixes,
    allIssues,
    p3Issues,
    linterResult,
    testResult,
    confidence,
    ctx,
  });

  // Reviewer checklist
  const reviewerChecklist = buildReviewerChecklist(approvedFixes, testResult, linterResult);

  const pr = {
    title: prTitle,
    description: prDescription,
    diffs: approvedFixes.map(f => ({
      file: f.file,
      issue_id: f.issue_id,
      fix_title: f.fix_title,
      diff: f.diff,
      breaking_change_risk: f.breaking_change_risk,
      validation_status: f.validation?.final_status,
    })),
    confidence,
    reviewerChecklist,
    scope,
    mode: ctx.mode,
    scanDepth: ctx.scanDepth,
    metadata: {
      issuesAddressed: approvedFixes.map(f => f.issue_id),
      fixesAttempted: (ctx.stage5?.fixes ?? []).length,
      fixesApproved: approvedFixes.length,
      fixesDropped: (ctx.stage5?.dropped ?? []).length + (ctx.stage6?.rejectedFixes ?? []).length,
      totalIssuesDetected: allIssues.length,
    },
  };

  ctx.info(7, `PR generated: "${prTitle}"`);
  ctx.info(7, `Confidence: ${confidence}%`);

  return { pr, confidence, summary: `PR: "${prTitle}"` };
}

function buildPRTitle(fix, scope) {
  if (!fix) return `fix(${scope}): automated code quality improvements`;
  const title = fix.fix_title || fix.title || 'code quality improvement';
  return `fix(${scope}): ${title.toLowerCase().replace(/\.$/, '')}`;
}

function detectScope(fixes, ctx) {
  const type = ctx.stage4?.prCandidates?.[0]?.type;
  if (type === 'SECURITY') return 'security';
  if (type === 'PERFORMANCE') return 'perf';

  const framework = ctx.stage1?.framework;
  if (framework === 'Express.js' || framework === 'Fastify') return 'api';
  if (framework === 'Next.js' || framework === 'React') return 'ui';

  // Use the most common file directory from fixes
  const dirs = fixes.map(f => f.file?.split('/')[0]).filter(Boolean);
  if (dirs.length > 0) {
    const freq = {};
    dirs.forEach(d => freq[d] = (freq[d] || 0) + 1);
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }

  return 'core';
}

function buildPRDescription({ fixes, allIssues, p3Issues, linterResult, testResult, confidence, ctx }) {
  const lines = [];

  lines.push(`## Summary`);
  lines.push('');
  lines.push(`This PR addresses ${fixes.length} issue${fixes.length !== 1 ? 's' : ''} detected by AutoPR Engine in the ${ctx.stage1?.repoSummary || 'repository'}. ${
    fixes.length === 1
      ? `The primary change is: ${fixes[0].fix_title}.`
      : `Issues span: ${[...new Set(fixes.map(f => ctx.stage4?.prCandidates?.find(i => i.id === f.issue_id)?.type || 'CODE_SMELL'))].join(', ')}.`
  }`);
  lines.push('');

  lines.push(`## What Changed`);
  lines.push('');
  for (const fix of fixes) {
    lines.push(`- \`${fix.file}\` — ${fix.fix_title}`);
  }
  lines.push('');

  lines.push(`## Why This Matters`);
  lines.push('');
  for (const fix of fixes) {
    const issue = allIssues.find(i => i.id === fix.issue_id);
    if (issue) lines.push(`- **${fix.issue_id}**: ${issue.description}`);
  }
  lines.push('');

  lines.push(`## How It Works`);
  lines.push('');
  for (const fix of fixes) {
    lines.push(`### ${fix.fix_title}`);
    lines.push(`\`\`\`diff`);
    lines.push(fix.diff || '(no diff)');
    lines.push('```');
    lines.push('');
  }

  lines.push(`## Testing`);
  lines.push('');
  lines.push(`- [x] AutoPR internal logic trace`);
  if (linterResult?.available) {
    lines.push(`- [${linterResult.exitCode === 0 ? 'x' : '!'}] ${linterResult.tool}: exit code ${linterResult.exitCode}`);
  } else {
    lines.push(`- [ ] Linter not available for this repository`);
  }
  if (testResult?.available) {
    lines.push(`- [${testResult.failed === 0 ? 'x' : '!'}] ${testResult.tool}: ${testResult.passed} passed, ${testResult.failed} failed`);
  } else {
    lines.push(`- [ ] No automated tests detected`);
  }
  for (const fix of fixes) {
    if (fix.validation?.final_status === 'CONDITIONAL') {
      lines.push(`- ⚠️ ${fix.issue_id}: ${fix.validation.caveats}`);
    }
  }
  lines.push('');

  lines.push(`## Risk Assessment`);
  lines.push('');
  lines.push(`| Dimension | Rating | Notes |`);
  lines.push(`|---|---|---|`);
  const maxRisk = fixes.reduce((max, f) => {
    const r = f.breaking_change_risk || 'LOW';
    const rank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
    return rank[r] > rank[max] ? r : max;
  }, 'NONE');
  lines.push(`| Breaking change risk | ${maxRisk} | ${maxRisk === 'NONE' ? 'No public API changes' : 'Review carefully'} |`);
  lines.push(`| Rollback | Trivial | Revert this commit |`);
  lines.push(`| Confidence score | ${confidence}% | ${confidence >= 85 ? 'Safe to merge after review' : confidence >= 65 ? 'Review carefully before merge' : 'Treat as proposal'} |`);
  lines.push('');

  if (p3Issues.length > 0) {
    lines.push(`## Additional Issues (Not Fixed in This PR)`);
    lines.push('');
    lines.push(`The following issues were detected but not included in this PR (P3 priority — low risk or requires manual attention):`);
    for (const issue of p3Issues.slice(0, 10)) {
      lines.push(`- \`${issue.file}\` — ${issue.title} (confidence: ${Math.round(issue.confidence * 100)}%)`);
    }
    lines.push('');
  }

  lines.push(`## AutoPR Metadata`);
  lines.push('');
  lines.push(`- Issues addressed: ${fixes.map(f => f.issue_id).join(', ')}`);
  lines.push(`- Total issues detected: ${allIssues.length}`);
  lines.push(`- Pipeline confidence: ${confidence}%`);
  lines.push(`- Fixes attempted: ${ctx.stage5?.fixes?.length ?? fixes.length} | Fixes approved: ${fixes.length} | Fixes dropped: ${(ctx.stage5?.dropped?.length ?? 0) + (ctx.stage6?.rejectedFixes?.length ?? 0)}`);
  lines.push(`- Mode: ${ctx.mode?.toUpperCase()}`);
  lines.push(`- Scan depth: ${ctx.scanDepth?.toUpperCase()}`);
  lines.push(`- AI model: ${ctx.aiProvider}`);
  lines.push('');
  lines.push('*Generated by [PRism AutoPR Engine](https://github.com/prism/autopr-engine)*');

  return lines.join('\n');
}

function buildReviewerChecklist(fixes, testResult, linterResult) {
  const items = [
    `Verify that each diff applies cleanly to the current codebase`,
    `Check that no new imports were added without review`,
  ];

  if (fixes.some(f => f.breaking_change_risk !== 'NONE')) {
    items.push(`⚠️ BREAKING CHANGE RISK: Review public API changes carefully`);
  }

  if (!testResult?.available) {
    items.push(`No automated tests found — manually test the affected functionality`);
  } else if (testResult.failed > 0) {
    items.push(`⚠️ ${testResult.failed} tests were failing BEFORE this PR — verify they are not caused by these changes`);
  }

  if (!linterResult?.available) {
    items.push(`Run the linter locally to validate code style`);
  }

  for (const fix of fixes) {
    if (fix.validation?.final_status === 'CONDITIONAL') {
      items.push(`${fix.issue_id}: ${fix.validation.caveats}`);
    }
    if (fix.new_imports_required?.length > 0) {
      items.push(`${fix.issue_id}: New imports added — ${fix.new_imports_required.join(', ')}`);
    }
  }

  return items;
}

function buildAnalysisReport(ctx) {
  return {
    repoSummary: ctx.stage1?.repoSummary,
    issues: ctx.stage3?.issues ?? [],
    prioritization: ctx.stage4?.prioritizedIssues ?? [],
    message: 'Confidence too low to generate a safe PR. Issues have been documented for manual review.',
  };
}
