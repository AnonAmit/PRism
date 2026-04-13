import { execute, commandExists } from './executor.js';
import path from 'path';
import { readFile } from 'fs/promises';

/**
 * Run a language-appropriate linter on the workspace.
 * Returns linter output and any issues found.
 *
 * @param {string} workspaceDir
 * @param {object} langInfo - from language_detector
 * @returns {Promise<LinterResult>}
 */
export async function runLinter(workspaceDir, langInfo) {
  const lang = langInfo.language;

  // Dispatch to language-specific linter
  if (lang === 'JavaScript' || lang === 'TypeScript') {
    return runESLint(workspaceDir, langInfo);
  } else if (lang === 'Python') {
    return runPyLint(workspaceDir);
  } else if (lang === 'Go') {
    return runGoVet(workspaceDir);
  } else if (lang === 'Rust') {
    return runClippy(workspaceDir);
  } else if (lang === 'Ruby') {
    return runRuboCop(workspaceDir);
  }

  return { available: false, lang, message: `No linter configured for ${lang}` };
}

async function runESLint(workspaceDir, langInfo) {
  // Check for local eslint first (most reliable)
  const localEslint = path.join(workspaceDir, 'node_modules', '.bin', 'eslint');
  const globalAvailable = await commandExists('eslint');

  const cmd = globalAvailable ? 'eslint' : localEslint;
  const hasConfig = await hasLintConfig(workspaceDir, [
    '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml',
    '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs',
  ]);

  if (!hasConfig && !globalAvailable) {
    return { available: false, lang: 'JavaScript/TypeScript', message: 'No ESLint config or global eslint found.' };
  }

  const ext = langInfo.language === 'TypeScript' ? '.ts,.tsx,.js,.jsx' : '.js,.jsx';
  const result = await execute(
    cmd,
    ['--format', 'json', `--ext`, ext, '.'],
    { cwd: workspaceDir, timeout: 20_000 }
  );

  let parsedIssues = [];
  try {
    const raw = JSON.parse(result.stdout || '[]');
    for (const file of raw) {
      for (const msg of file.messages || []) {
        parsedIssues.push({
          file: path.relative(workspaceDir, file.filePath).replace(/\\/g, '/'),
          line: msg.line,
          column: msg.column,
          severity: msg.severity === 2 ? 'error' : 'warning',
          rule: msg.ruleId,
          message: msg.message,
        });
      }
    }
  } catch (_) {}

  return {
    available: true,
    lang: 'JavaScript/TypeScript',
    tool: 'ESLint',
    exitCode: result.exitCode,
    issues: parsedIssues,
    raw: result.stdout + result.stderr,
    timedOut: result.timedOut,
  };
}

async function runPyLint(workspaceDir) {
  const available = await commandExists('pylint') || await commandExists('flake8');
  if (!available) return { available: false, lang: 'Python', message: 'pylint/flake8 not found.' };

  const tool = await commandExists('flake8') ? 'flake8' : 'pylint';
  const args = tool === 'flake8'
    ? ['--format', 'json', '.']
    : ['--output-format', 'json', '--recursive', 'yes', '.'];

  const result = await execute(tool, args, { cwd: workspaceDir, timeout: 20_000 });

  return {
    available: true,
    lang: 'Python',
    tool,
    exitCode: result.exitCode,
    raw: result.stdout + result.stderr,
    timedOut: result.timedOut,
    issues: [],
  };
}

async function runGoVet(workspaceDir) {
  const available = await commandExists('go');
  if (!available) return { available: false, lang: 'Go', message: 'go toolchain not found.' };

  const result = await execute('go', ['vet', './...'], { cwd: workspaceDir, timeout: 30_000 });
  return {
    available: true, lang: 'Go', tool: 'go vet',
    exitCode: result.exitCode, raw: result.stdout + result.stderr, timedOut: result.timedOut, issues: [],
  };
}

async function runClippy(workspaceDir) {
  const available = await commandExists('cargo');
  if (!available) return { available: false, lang: 'Rust', message: 'cargo not found.' };

  const result = await execute(
    'cargo', ['clippy', '--message-format=json', '--quiet'],
    { cwd: workspaceDir, timeout: 60_000 }
  );
  return {
    available: true, lang: 'Rust', tool: 'cargo clippy',
    exitCode: result.exitCode, raw: result.stdout + result.stderr, timedOut: result.timedOut, issues: [],
  };
}

async function runRuboCop(workspaceDir) {
  const available = await commandExists('rubocop');
  if (!available) return { available: false, lang: 'Ruby', message: 'rubocop not found.' };

  const result = await execute('rubocop', ['--format', 'json', '.'], { cwd: workspaceDir, timeout: 20_000 });
  return {
    available: true, lang: 'Ruby', tool: 'RuboCop',
    exitCode: result.exitCode, raw: result.stdout + result.stderr, timedOut: result.timedOut, issues: [],
  };
}

async function hasLintConfig(dir, fileNames) {
  const { readdir } = await import('fs/promises');
  try {
    const entries = await readdir(dir);
    return fileNames.some(f => entries.includes(f));
  } catch { return false; }
}
