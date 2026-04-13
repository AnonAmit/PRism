/**
 * STAGE 4 — PRIORITIZATION ENGINE
 * Scores each issue and assigns priority tiers (P0-P3).
 */
export async function runStage4(ctx, attempt) {
  ctx.info(4, `[PLAN] Score all issues → apply priority tiers → select PR candidates`);

  const issues = ctx.stage3?.issues ?? [];

  if (issues.length === 0) {
    ctx.info(4, `No issues to prioritize.`);
    return {
      prioritizedIssues: [],
      prCandidates: [],
      confidence: 1.0,
      summary: 'No issues to prioritize',
    };
  }

  ctx.info(4, `[EXECUTE] Scoring ${issues.length} issues...`);

  // Score each issue using the formula from the system prompt
  const scored = issues.map(issue => {
    const severity = getSeverityWeight(issue);
    const feasibility = getFixFeasibility(issue);
    const contribution = getContributionValue(issue);
    const riskInverse = getRiskInverse(issue);

    const priorityScore =
      (severity * 0.35) +
      (feasibility * 0.25) +
      (contribution * 0.20) +
      (riskInverse * 0.20);

    const tier = priorityScore >= 8.0 ? 'P0'
               : priorityScore >= 6.0 ? 'P1'
               : priorityScore >= 4.0 ? 'P2'
               : 'P3';

    return {
      ...issue,
      priorityScore: Math.round(priorityScore * 100) / 100,
      tier,
      scoring: { severity, feasibility, contribution, riskInverse },
    };
  });

  // Sort by priority score descending
  scored.sort((a, b) => b.priorityScore - a.priorityScore);

  // Apply PR candidate rule: max 1 P0 OR up to 3 P1/P2
  let prCandidates = [];
  const p0s = scored.filter(i => i.tier === 'P0');
  const p1p2s = scored.filter(i => i.tier === 'P1' || i.tier === 'P2');
  const p3s = scored.filter(i => i.tier === 'P3');

  if (p0s.length > 0) {
    prCandidates = [p0s[0]]; // Only 1 P0 per PR
    ctx.info(4, `PR candidate: 1 P0 issue (${p0s[0].title})`);
  } else {
    prCandidates = p1p2s.slice(0, 3);
    ctx.info(4, `PR candidates: ${prCandidates.length} P1/P2 issues`);
  }

  // Log P3 issues (document only)
  if (p3s.length > 0) {
    ctx.info(4, `${p3s.length} P3 issues will be documented only (not fixed in this PR)`);
  }

  ctx.emit('event', {
    type: 'prioritization_complete',
    p0Count: p0s.length,
    p1p2Count: p1p2s.length,
    p3Count: p3s.length,
    prCandidates: prCandidates.map(i => ({ id: i.id, title: i.title, tier: i.tier, score: i.priorityScore })),
  });

  return {
    prioritizedIssues: scored,
    prCandidates,
    p0Issues: p0s,
    p1p2Issues: p1p2s,
    p3Issues: p3s,
    confidence: 0.9,
    summary: `${prCandidates.length} fix candidates selected from ${issues.length} total issues`,
  };
}

// ── Scoring helpers ──────────────────────────────────────────────────────────

function getSeverityWeight(issue) {
  const type = issue.type;
  const title = (issue.title + ' ' + issue.description).toLowerCase();

  if (type === 'SECURITY') {
    if (title.includes('injection') || title.includes('rce') || title.includes('auth bypass')) return 10;
    if (title.includes('credential') || title.includes('secret') || title.includes('hardcoded')) return 9;
    return 8;
  }
  if (type === 'BUG') {
    if (title.includes('data loss') || title.includes('corruption')) return 9;
    if (title.includes('crash') || title.includes('null') || title.includes('exception')) return 7;
    return 5;
  }
  if (type === 'PERFORMANCE') return 5;
  if (type === 'BAD_PRACTICE') return 4;
  if (type === 'CODE_SMELL') return 3;
  return 2;
}

function getFixFeasibility(issue) {
  const title = (issue.title + ' ' + issue.description).toLowerCase();
  const lineSpan = (issue.line_range[1] - issue.line_range[0]) + 1;

  if (lineSpan <= 5) return 9;
  if (lineSpan <= 15) return 7;
  if (title.includes('refactor') || title.includes('restructure') || title.includes('architecture')) return 2;
  return 5;
}

function getContributionValue(issue) {
  const type = issue.type;
  if (type === 'SECURITY') return 9;
  if (type === 'BUG') return 7;
  if (type === 'PERFORMANCE') return 6;
  if (type === 'BAD_PRACTICE') return 4;
  if (type === 'CODE_SMELL') return 3;
  return 2;
}

function getRiskInverse(issue) {
  const title = (issue.title + ' ' + issue.description).toLowerCase();
  if (title.includes('api') || title.includes('interface') || title.includes('public')) return 4;
  if (title.includes('core') || title.includes('business logic') || title.includes('database')) return 3;
  return 8; // most small fixes are low risk
}
