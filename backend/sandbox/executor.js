import { spawn } from 'child_process';
import { promisify } from 'util';
import treeKill from 'tree-kill';

const treeKillAsync = promisify(treeKill);

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds hard limit

/**
 * Run a command in an isolated child process with timeout + kill.
 *
 * @param {string} command - Executable path
 * @param {string[]} args - Arguments as array (never use shell string concatenation)
 * @param {object} options
 * @param {string} options.cwd - Working directory
 * @param {number} options.timeout - Timeout in ms (default 30s)
 * @param {object} options.env - Environment variables
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
export async function execute(command, args = [], options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd;
  const env = {
    ...process.env,
    // Strip potentially dangerous env vars from child process
    NODE_OPTIONS: '',
    ...(options.env || {}),
  };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false, // NEVER use shell: true (injection risk)
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const settle = async (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 50_000), exitCode: exitCode ?? -1, timedOut });
    };

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => settle(code));
    child.on('error', (err) => {
      stderr += `\nProcess error: ${err.message}`;
      settle(-1);
    });

    // Hard timeout — kill entire process tree
    const timer = setTimeout(async () => {
      timedOut = true;
      stderr += `\n[PRism Sandbox] Process killed after ${timeout}ms timeout.`;
      try { await treeKillAsync(child.pid, 'SIGKILL'); } catch (_) {}
      settle(-1);
    }, timeout);
  });
}

/**
 * Check if a command is available on the system PATH.
 */
export async function commandExists(cmd) {
  const check = process.platform === 'win32'
    ? { command: 'where', args: [cmd] }
    : { command: 'which', args: [cmd] };

  const result = await execute(check.command, check.args, { timeout: 5000 });
  return result.exitCode === 0;
}
