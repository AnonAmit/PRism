import { readFileContent } from './file_tree.js';

// Rough token estimator (4 chars per token average)
const charsPerToken = 4;

/**
 * Token budget management — select the most important files to fit within token limits.
 * Priority: manifest files > entry points > test examples > everything else by import frequency
 *
 * @param {FileEntry[]} files - All files from file_tree walker
 * @param {object} langInfo - Output from language_detector
 * @param {string} scanDepth - 'shallow' | 'standard' | 'deep'
 * @param {PipelineContext} ctx
 * @returns {Promise<{selectedFiles: ContentFile[], totalTokens: number}>}
 */
export async function loadContext(files, langInfo, scanDepth, ctx) {
  const tokenBudgets = {
    shallow:  40_000,
    standard: 80_000,
    deep:    160_000,
  };
  const budget = tokenBudgets[scanDepth] ?? 80_000;

  // Sort files by priority
  const prioritized = prioritizeFiles(files, langInfo);

  const selectedFiles = [];
  let totalChars = 0;
  const budgetChars = budget * charsPerToken;

  for (const file of prioritized) {
    if (totalChars >= budgetChars) break;

    const content = await readFileContent(file.fullPath, ctx);
    if (!content) continue;

    // Truncate individual files if they'd blow the budget
    const remaining = budgetChars - totalChars;
    const sliced = content.length > remaining ? content.slice(0, remaining) + '\n[... truncated ...]' : content;

    selectedFiles.push({
      ...file,
      content: sliced,
      truncated: content.length > remaining,
    });

    totalChars += sliced.length;
  }

  return {
    selectedFiles,
    totalTokens: Math.round(totalChars / charsPerToken),
    filesLoaded: selectedFiles.length,
    filesTotal: files.length,
  };
}

/**
 * Format selected files into a prompt-friendly string.
 */
export function formatFilesForPrompt(selectedFiles) {
  return selectedFiles.map(f =>
    `=== FILE: ${f.relPath} ===\n${f.content}\n`
  ).join('\n');
}

function prioritizeFiles(files, langInfo) {
  const priority = (file) => {
    const name = file.name.toLowerCase();
    const rel = file.relPath.toLowerCase();

    // Highest priority — manifest and config files
    if (['readme.md', 'readme.txt', 'readme'].includes(name)) return 100;
    if (['package.json', 'cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
         'pom.xml', 'build.gradle', 'gemfile', 'composer.json'].includes(name)) return 95;

    // Entry points
    if (['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
         'main.py', 'app.py', 'server.js', 'server.ts', 'index.html'].includes(name)) return 90;

    // Config files
    if (name.endsWith('.config.js') || name.endsWith('.config.ts') || name.endsWith('.config.mjs')) return 80;
    if (['.env.example', 'docker-compose.yml', 'dockerfile'].includes(name)) return 75;

    // Test files (good for understanding intent)
    if (rel.includes('/test') || rel.includes('/spec') || rel.includes('__test__') ||
        name.includes('.test.') || name.includes('.spec.')) return 60;

    // Source files in src/ or lib/ directories
    if (rel.startsWith('src/') || rel.startsWith('lib/')) return 50;

    // All other source files
    return 30;
  };

  return [...files].sort((a, b) => priority(b) - priority(a));
}
