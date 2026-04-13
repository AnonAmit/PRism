import { execute, commandExists } from './executor.js';
import { readdir } from 'fs/promises';
import path from 'path';

/**
 * Detect and run the appropriate test suite for the repository.
 * Returns test results with pass/fail counts.
 */
export async function runTests(workspaceDir, langInfo) {
  const lang = langInfo.language;

  if (lang === 'JavaScript' || lang === 'TypeScript') {
    return runJSTests(workspaceDir, langInfo);
  } else if (lang === 'Python') {
    return runPytest(workspaceDir);
  } else if (lang === 'Go') {
    return runGoTest(workspaceDir);
  } else if (lang === 'Rust') {
    return runCargoTest(workspaceDir);
  }

  return { available: false, lang, message: `No test runner configured for ${lang}` };
}

async function runJSTests(workspaceDir, langInfo) {
  // Detect test runner from package.json scripts
  let runner = null;
  let runCmd = null;
  let runArgs = [];

  try {
    const { readFile } = await import('fs/promises');
    const pkg = JSON.parse(await readFile(path.join(workspaceDir, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};

    if (allDeps['vitest'] || (scripts.test && scripts.test.includes('vitest'))) {
      runner = 'vitest';
    } else if (allDeps['jest'] || (scripts.test && scripts.test.includes('jest'))) {
      runner = 'jest';
    } else if (scripts.test) {
      runner = 'npm-script';
    }
  } catch (_) {}

  if (!runner) {
    return { available: false, lang: 'JavaScript/TypeScript', message: 'No test runner detected.' };
  }

  // Check for local binary first
  const localBin = path.join(workspaceDir, 'node_modules', '.bin');

  if (runner === 'vitest') {
    runCmd = path.join(localBin, process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
    runArgs = ['run', '--reporter=json'];
  } else if (runner === 'jest') {
    runCmd = path.join(localBin, process.platform === 'win32' ? 'jest.cmd' : 'jest');
    runArgs = ['--json', '--passWithNoTests'];
  } else {
    // npm test fallback
    const available = await commandExists('npm');
    if (!available) return { available: false, lang: 'JavaScript/TypeScript', message: 'npm not found.' };
    runCmd = 'npm';
    runArgs = ['test', '--', '--passWithNoTests'];
  }

  const result = await execute(runCmd, runArgs, { cwd: workspaceDir, timeout: 60_000 });

  // Try to parse JSON output
  let summary = { passed: 0, failed: 0, total: 0 };
  try {
    const json = JSON.parse(result.stdout);
    if (runner === 'jest') {
      summary = {
        passed: json.numPassedTests || 0,
        failed: json.numFailedTests || 0,
        total: json.numTotalTests || 0,
      };
    }
  } catch (_) {}

  return {
    available: true,
    lang: 'JavaScript/TypeScript',
    tool: runner,
    exitCode: result.exitCode,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    raw: (result.stdout + result.stderr).slice(0, 10_000),
    timedOut: result.timedOut,
  };
}

async function runPytest(workspaceDir) {
  const available = await commandExists('pytest');
  const pipAvailable = await commandExists('python') || await commandExists('python3');
  if (!available && !pipAvailable) return { available: false, lang: 'Python', message: 'pytest not found.' };

  const cmd = available ? 'pytest' : (process.platform === 'win32' ? 'python' : 'python3');
  const args = available ? ['-v', '--tb=short', '--json-report', '--json-report-file=-'] : ['-m', 'pytest', '-v'];

  const result = await execute(cmd, args, { cwd: workspaceDir, timeout: 60_000 });
  return {
    available: true, lang: 'Python', tool: 'pytest',
    exitCode: result.exitCode, raw: (result.stdout + result.stderr).slice(0, 10_000), timedOut: result.timedOut,
    passed: 0, failed: 0, total: 0,
  };
}

async function runGoTest(workspaceDir) {
  const available = await commandExists('go');
  if (!available) return { available: false, lang: 'Go', message: 'go not found.' };

  const result = await execute('go', ['test', '-v', '-json', './...'], { cwd: workspaceDir, timeout: 60_000 });
  let passed = 0, failed = 0;
  for (const line of result.stdout.split('\n')) {
    try {
      const obj = JSON.parse(line);
      if (obj.Action === 'pass') passed++;
      if (obj.Action === 'fail') failed++;
    } catch (_) {}
  }
  return {
    available: true, lang: 'Go', tool: 'go test',
    exitCode: result.exitCode, raw: (result.stdout + result.stderr).slice(0, 10_000),
    timedOut: result.timedOut, passed, failed, total: passed + failed,
  };
}

async function runCargoTest(workspaceDir) {
  const available = await commandExists('cargo');
  if (!available) return { available: false, lang: 'Rust', message: 'cargo not found.' };

  const result = await execute('cargo', ['test', '--', '--format=json'], { cwd: workspaceDir, timeout: 120_000 });
  return {
    available: true, lang: 'Rust', tool: 'cargo test',
    exitCode: result.exitCode, raw: (result.stdout + result.stderr).slice(0, 10_000),
    timedOut: result.timedOut, passed: 0, failed: 0, total: 0,
  };
}
