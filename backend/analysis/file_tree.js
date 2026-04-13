import { readdir, stat, readFile } from 'fs/promises';
import path from 'path';

// Files/dirs to always exclude
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'vendor', 'venv', '.venv', 'env', '.env', 'target', 'out', 'coverage',
  '.gradle', '.idea', '.vscode', 'bower_components',
]);

const EXCLUDE_EXTENSIONS = new Set([
  '.lock', '.min.js', '.min.css', '.map', '.snap', '.sum',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.docx', '.xlsx',
  '.pyc', '.pyo', '.class', '.o', '.a',
]);

// Extensions that are parseable source files
const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs', '.vb', '.fs',
  '.php', '.swift', '.dart', '.lua',
  '.html', '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env.example',
  '.md', '.mdx', '.txt', '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.graphql', '.proto',
  '.tf', '.hcl', '.dockerfile',
]);

/**
 * Recursively walk a directory and return all non-excluded files
 * @param {string} rootDir
 * @param {object} opts
 * @returns {Promise<FileEntry[]>}
 */
export async function walkDirectory(rootDir, opts = {}) {
  const maxDepth = opts.maxDepth ?? 10;
  const includeSource = opts.includeSource ?? true;
  const results = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (EXCLUDE_EXTENSIONS.has(ext)) continue;
        if (includeSource && !SOURCE_EXTENSIONS.has(ext)) continue;

        let fileStat;
        try { fileStat = await stat(fullPath); }
        catch (_) { continue; }

        // Skip files > 2MB
        if (fileStat.size > 2 * 1024 * 1024) continue;

        results.push({
          fullPath,
          relPath: relPath.replace(/\\/g, '/'),
          name: entry.name,
          ext,
          size: fileStat.size,
          isSourceFile: SOURCE_EXTENSIONS.has(ext),
        });
      }
    }
  }

  await walk(rootDir, 0);
  return results;
}

/**
 * Read file content, cached in context._fileCache
 */
export async function readFileContent(fullPath, ctx) {
  if (ctx?._fileCache?.has(fullPath)) return ctx._fileCache.get(fullPath);
  try {
    const content = await readFile(fullPath, 'utf-8');
    ctx?._fileCache?.set(fullPath, content);
    return content;
  } catch (_) {
    return null;
  }
}

/**
 * Build a compact text representation of the file tree (for AI prompts)
 */
export function buildTreeString(files, maxFiles = 200) {
  const subset = files.slice(0, maxFiles);
  const lines = subset.map(f => `  ${f.relPath} (${formatSize(f.size)})`);
  if (files.length > maxFiles) lines.push(`  ... and ${files.length - maxFiles} more files`);
  return lines.join('\n');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
