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

  // 1: Filter out low confidence and deduplicate
  const uniqueIssuesMap = new Map();
  for (const issue of issues) {
    if ((issue.confidence ?? 0.7) < 0.5) {
      ctx.info(4, `Filtered out low-confidence issue: ${issue.id} (${issue.confidence})`);
      continue;
    }
    
    // Deduplication key: type + file + first 25 chars of title
    const dedupKey = `${issue.type}:${issue.file}:${issue.title.substring(0, 25).toLowerCase()}`;
    if (!uniqueIssuesMap.has(dedupKey)) {
      uniqueIssuesMap.set(dedupKey, issue);
    } else {
      // Keep the one with higher confidence
      if ((issue.confidence ?? 0) > (uniqueIssuesMap.get(dedupKey).confidence ?? 0)) {
        uniqueIssuesMap.set(dedupKey, issue);
      } else {
        ctx.info(4, `Filtered out duplicate issue: ${issue.id}`);
      }
    }
  }

  const filteredIssues = Array.from(uniqueIssuesMap.values());
  ctx.info(4, `[EXECUTE] Scoring ${filteredIssues.length} unique, high-confidence issues...`);

  // 2: Score each issue
  const scored = filteredIssues.map(issue => {
    const severity = getSeverityWeight(issue);
    const feasibility = getFixFeasibility(issue);
    const contribution = getContributionValue(issue);
    const riskInverse = getRiskInverse(issue);
    const confidenceWeight = (issue.confidence ?? 0.7) * 5; // 0 to 5 max

    const priorityScore =
      (severity * 0.30) +
      (confidenceWeight * 0.20) +
      (feasibility * 0.20) +
      (contribution * 0.15) +
      (riskInverse * 0.15);

    const tier = priorityScore >= 7.5 ? 'P0'
               : priorityScore >= 5.5 ? 'P1'
               : priorityScore >= 3.5 ? 'P2'
               : 'P3';

    return {
      ...issue,
      priorityScore: Math.round(priorityScore * 100) / 100,
      tier,
      scoring: { severity, feasibility, contribution, riskInverse, confidenceWeight },
    };
  });

  // Sort by priority score descending
  scored.sort((a, b) => b.priorityScore - a.priorityScore);

  // Apply PR candidate rule: Take top 5-10
  let prCandidates = scored.slice(0, 10); // keep up to top 10
  
  const p0s = prCandidates.filter(i => i.tier === 'P0');
  const p1p2s = prCandidates.filter(i => i.tier === 'P1' || i.tier === 'P2');
  const p3s = prCandidates.filter(i => i.tier === 'P3');

  if (p0s.length > 0) {
    // If we have P0s, prioritize them but allow some high P1s if room
    prCandidates = [...p0s, ...p1p2s].slice(0, 5); // At least 5 high-priority issues
    ctx.info(4, `PR candidates: ${p0s.length} P0 issue(s) and ${prCandidates.length - p0s.length} P1/P2(s)`);
  } else if (p1p2s.length > 0) {
    prCandidates = p1p2s.slice(0, 8); // Up to 8 P1/P2s
    ctx.info(4, `PR candidates: ${prCandidates.length} P1/P2 issues`);
  } else {
    prCandidates = p3s.slice(0, 5);
    ctx.info(4, `PR candidates: ${prCandidates.length} P3 issues`);
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
