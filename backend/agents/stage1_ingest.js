import simpleGit from 'simple-git';
import { walkDirectory, buildTreeString } from '../analysis/file_tree.js';
import { detectLanguage } from '../analysis/language_detector.js';
import { mkdir } from 'fs/promises';

/**
 * STAGE 1 — REPO INGESTION
 * Clones the repository and extracts structural metadata.
 */
export async function runStage1(ctx, attempt) {
  ctx.info(1, `[PLAN] Clone repo → detect language/framework → build file tree`);

  // Validate URL format
  const repoUrl = ctx.repoUrl;
  if (!repoUrl.match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/)) {
    throw new Error(`Invalid GitHub URL format: ${repoUrl}`);
  }

  await mkdir(ctx.workspaceDir, { recursive: true });

  // Git clone with --depth=1 (no history needed for analysis)
  ctx.info(1, `[EXECUTE] Cloning ${repoUrl} ...`);
  const git = simpleGit();
  const cloneArgs = ['--depth=1'];
  if (ctx.githubToken) {
    // Inject token for private repos
    const authedUrl = repoUrl.replace('https://', `https://${ctx.githubToken}@`);
    await git.clone(authedUrl, ctx.workspaceDir, cloneArgs);
  } else {
    await git.clone(repoUrl, ctx.workspaceDir, cloneArgs);
  }
  ctx.info(1, `Cloned successfully into workspace.`);

  // Walk directory
  ctx.info(1, `[EXECUTE] Walking file tree...`);
  const fileTree = await walkDirectory(ctx.workspaceDir, {
    maxDepth: ctx.scanDepth === 'shallow' ? 3 : ctx.scanDepth === 'deep' ? 12 : 6,
    includeSource: true,
  });
  ctx.info(1, `Found ${fileTree.length} source files.`);

  // Language detection
  ctx.info(1, `[EXECUTE] Detecting language and framework...`);
  const langInfo = await detectLanguage(fileTree, ctx.workspaceDir);
  ctx.info(1, `Detected: ${langInfo.language}${langInfo.framework ? ' / ' + langInfo.framework : ''}`, {
    confidence: langInfo.confidence
  });

  // Emit file tree event
  ctx.emit('event', {
    type: 'repo_ingested',
    language: langInfo.language,
    framework: langInfo.framework,
    testFramework: langInfo.testFramework,
    ciConfig: langInfo.ciConfig,
    fileCount: fileTree.length,
    deps: langInfo.deps,
  });

  const repoName = repoUrl.split('/').pop()?.replace('.git', '') ?? 'repo';
  const repoSummary = `${repoName} — ${langInfo.language}${langInfo.framework ? '/' + langInfo.framework : ''}, ${fileTree.length} files`;

  return {
    language: langInfo.language,
    framework: langInfo.framework,
    testFramework: langInfo.testFramework,
    ciConfig: langInfo.ciConfig,
    deps: langInfo.deps,
    fileTree,
    treeString: buildTreeString(fileTree),
    repoSummary,
    confidence: langInfo.confidence === 'HIGH' ? 0.9 : 0.6,
    summary: repoSummary,
  };
}
