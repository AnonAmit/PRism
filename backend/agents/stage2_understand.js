import { loadContext, formatFilesForPrompt } from '../analysis/context_loader.js';

/**
 * STAGE 2 — CODE UNDERSTANDING ENGINE
 * Builds dependency graph, entry points, module summaries, and architecture classification.
 */
export async function runStage2(ctx, attempt) {
  const { fileTree, language, framework } = ctx.stage1;

  ctx.info(2, `[PLAN] Load smart context → build dep graph + module summaries via AI`);

  // Load source files into context with token budget
  ctx.info(2, `Loading files with scan depth: ${ctx.scanDepth}...`);
  const contextData = await loadContext(fileTree, ctx.stage1, ctx.scanDepth, ctx);
  ctx.info(2, `Loaded ${contextData.filesLoaded}/${contextData.filesTotal} files (~${contextData.totalTokens} tokens)`);

  // Store context data for later stages
  ctx.contextData = contextData;

  const filesPrompt = formatFilesForPrompt(contextData.selectedFiles);

  const prompt = `You are analyzing a ${language}${framework ? '/' + framework : ''} repository for the AutoPR Engine.

REPOSITORY FILE CONTENTS:
${filesPrompt}

FILE TREE (full):
${ctx.stage1.treeString}

TASK: Perform Stage 2 Code Understanding. Return ONLY valid JSON (no markdown, no explanation):

{
  "entryPoints": ["list of entry point files/functions"],
  "archPattern": "MVC | microservice | monolith | event-driven | functional | procedural | mixed",
  "moduleSummaries": {
    "path/to/file.ext": "1-3 sentence description of what this module does, what it depends on, and what depends on it"
  },
  "depGraph": {
    "file.ext": ["imported-module-1", "imported-module-2"]
  },
  "antiPatterns": ["list of structural anti-patterns observed"],
  "circularDeps": ["file-a → file-b → file-a"],
  "confidence": 0.0,
  "confidenceReason": "why this confidence level"
}

Rules:
- Only list files you have actually seen in the FILE CONTENTS above.
- moduleSummaries must cover at least the top 5 most important files.
- confidence should be 0.0-1.0 reflecting how much of the codebase you were able to analyze.
- Do NOT invent or assume any file, function, or import you did not observe.`;

  ctx.info(2, `[EXECUTE] Calling AI for code understanding...`);

  let rawResponse = '';
  try {
    rawResponse = await ctx.ai.complete(prompt, { temperature: 0.1, maxTokens: 8192 });
  } catch (err) {
    throw new Error(`AI call failed: ${err.message}`);
  }

  // Extract JSON from response
  const result = extractJSON(rawResponse);
  if (!result) throw new Error(`AI returned non-JSON response: ${rawResponse.slice(0, 200)}`);

  ctx.info(2, `Architecture: ${result.archPattern} | Entry points: ${result.entryPoints?.length ?? 0} | Modules summarized: ${Object.keys(result.moduleSummaries || {}).length}`);

  ctx.emit('event', {
    type: 'understanding_complete',
    archPattern: result.archPattern,
    entryPoints: result.entryPoints,
    modulesAnalyzed: Object.keys(result.moduleSummaries || {}).length,
    antiPatterns: result.antiPatterns,
  });

  return {
    ...result,
    confidence: result.confidence ?? 0.7,
    summary: `${result.archPattern} architecture, ${Object.keys(result.moduleSummaries || {}).length} modules analyzed`,
  };
}

function extractJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch (_) {}

  // Extract from code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch (_) {}
  }

  // Find first { ... } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }

  return null;
}
