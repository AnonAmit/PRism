/**
 * Static pattern scanner — runs locally without AI, catches obvious issues fast.
 * All patterns are non-destructive regex checks.
 */

// Issue type constants
export const IssueType = {
  BUG: 'BUG',
  SECURITY: 'SECURITY',
  PERFORMANCE: 'PERFORMANCE',
  CODE_SMELL: 'CODE_SMELL',
  BAD_PRACTICE: 'BAD_PRACTICE',
};

const PATTERNS = [
  // ── SECURITY ──────────────────────────────────────────────
  {
    id: 'SEC-001',
    type: IssueType.SECURITY,
    title: 'Hardcoded secret or credential',
    regex: /(?:password|passwd|secret|api[_-]?key|token|auth[_-]?key|private[_-]?key)\s*=\s*["'][^"']{6,}["']/gi,
    confidence: 0.85,
    description: 'A hardcoded credential was found in source code. This creates a security risk if the file is committed to a public repository.',
  },
  {
    id: 'SEC-002',
    type: IssueType.SECURITY,
    title: 'SQL injection via string concatenation',
    regex: /["'`]\s*SELECT|INSERT|UPDATE|DELETE.*\+\s*(?:req\.|request\.|params\.|query\.|body\.)/gi,
    confidence: 0.75,
    description: 'A SQL query appears to be constructed using string concatenation with user input, which is vulnerable to SQL injection.',
  },
  {
    id: 'SEC-003',
    type: IssueType.SECURITY,
    title: 'Use of eval() or exec() with dynamic input',
    regex: /\beval\s*\(|exec\s*\(\s*(?:req|request|user|input|data|params)/gi,
    confidence: 0.80,
    description: 'eval() or exec() called with potentially user-controlled data. This is a critical code injection vector.',
  },
  {
    id: 'SEC-004',
    type: IssueType.SECURITY,
    title: 'Insecure MD5/SHA1 usage for security',
    regex: /(?:md5|sha1)\s*\(|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-1)["']/gi,
    confidence: 0.70,
    description: 'MD5 or SHA1 is being used, which are broken for cryptographic security purposes (password hashing, signatures).',
  },

  // ── BUG ────────────────────────────────────────────────────
  {
    id: 'BUG-001',
    type: IssueType.BUG,
    title: 'Comparison with NaN using ==',
    regex: /===?\s*NaN|NaN\s*===?/g,
    confidence: 0.95,
    description: 'NaN !== NaN in JavaScript. Use Number.isNaN() instead of comparing with == or ===.',
  },
  {
    id: 'BUG-002',
    type: IssueType.BUG,
    title: 'Promise rejection not handled',
    regex: /\.catch\s*\(\s*\)|new Promise\s*\([^)]*\)\s*(?!\.catch)/g,
    confidence: 0.65,
    description: 'A Promise is created or chained without a .catch() handler, which can cause unhandled rejection errors.',
  },
  {
    id: 'BUG-003',
    type: IssueType.BUG,
    title: 'console.log left in production code',
    regex: /console\.(?:log|debug|warn|error)\s*\(/g,
    confidence: 0.50,
    description: 'console.log/debug statements found that may expose sensitive data or indicate incomplete debugging code.',
  },

  // ── CODE SMELL ─────────────────────────────────────────────
  {
    id: 'SMELL-001',
    type: IssueType.CODE_SMELL,
    title: 'TODO/FIXME/HACK comment in production',
    regex: /\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG)\b/gi,
    confidence: 0.90,
    description: 'A TODO, FIXME, HACK, or similar comment was found, indicating incomplete or problematic code.',
  },
  {
    id: 'SMELL-002',
    type: IssueType.CODE_SMELL,
    title: 'Magic number without named constant',
    regex: /(?<![a-zA-Z_$0-9.])(?:86400|3600|60000|1000|65536|255|2048|4096|8080|3306|5432|27017)\b/g,
    confidence: 0.55,
    description: 'A magic number is used directly in code without a named constant, reducing readability.',
  },
  {
    id: 'SMELL-003',
    type: IssueType.CODE_SMELL,
    title: 'Deeply nested callback (callback hell)',
    regex: /function\s*\([^)]*\)\s*\{[^}]*function\s*\([^)]*\)\s*\{[^}]*function\s*\([^)]*\)\s*\{/g,
    confidence: 0.75,
    description: 'Three or more levels of nested callbacks detected — indicates callback hell that should be refactored with async/await or Promises.',
  },

  // ── BAD PRACTICE ───────────────────────────────────────────
  {
    id: 'BP-001',
    type: IssueType.BAD_PRACTICE,
    title: 'var usage instead of let/const',
    regex: /\bvar\s+[a-zA-Z_$]/g,
    confidence: 0.80,
    description: 'var is used instead of const/let, which has function-scoping semantics that can cause unexpected bugs.',
  },
  {
    id: 'BP-002',
    type: IssueType.BAD_PRACTICE,
    title: 'Empty catch block silences errors',
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    confidence: 0.85,
    description: 'An empty catch block silently swallows exceptions, making debugging very difficult.',
  },
];

/**
 * Scan a single file's content for all patterns.
 * Returns array of issues found.
 */
export function scanFileContent(relPath, content) {
  const issues = [];
  const lines = content.split('\n');

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      // Find line number of match
      const matchStart = match.index;
      let lineNum = 1;
      let charCount = 0;
      for (const line of lines) {
        if (charCount + line.length >= matchStart) break;
        charCount += line.length + 1;
        lineNum++;
      }

      // Get surrounding context (2 lines)
      const contextLines = lines.slice(Math.max(0, lineNum - 2), lineNum + 1);

      issues.push({
        id: `${pattern.id}-${relPath}-L${lineNum}`,
        detectionId: pattern.id,
        type: pattern.type,
        file: relPath,
        line_range: [lineNum, lineNum],
        title: pattern.title,
        description: pattern.description,
        evidence: contextLines.join('\n').trim().slice(0, 300),
        detection_strategy: 'PATTERN',
        confidence: pattern.confidence,
      });

      // Avoid infinite loops on zero-length matches
      if (match[0].length === 0) regex.lastIndex++;
    }
  }

  return issues;
}

/**
 * Scan all loaded files.
 */
export function scanAllFiles(selectedFiles) {
  const issues = [];
  for (const file of selectedFiles) {
    if (!file.content) continue;
    const fileIssues = scanFileContent(file.relPath, file.content);
    issues.push(...fileIssues);
  }
  return issues;
}
