import path from 'path';

/**
 * Validates if an issue type is logically possible for a given file type.
 * This rule-based pre-filter outright rejects hallucinations (e.g. SQL injection in README.md).
 * 
 * @param {string} issueType - The type of the issue (e.g., SECURITY, BUG, CODE_SMELL)
 * @param {string} filePath - The path of the file
 * @returns {object} { valid: boolean, reason: string }
 */
export function validateFileTypeRules(issueType, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  // Documentation files
  if (['.md', '.txt', '.rst', '.csv'].includes(ext) || name === 'license') {
    if (['SECURITY', 'BUG', 'PERFORMANCE'].includes(issueType)) {
      return { 
        valid: false, 
        reason: `Documentation files (${ext || name}) cannot contain ${issueType} vulnerabilities.` 
      };
    }
  }

  // Configuration and Data files
  if (['.json', '.yaml', '.yml', '.toml', '.ini', '.env'].includes(ext) || name.includes('config')) {
    // Configs can technically have security issues (like hardcoded secrets, which might be SECURITY)
    // But they cannot have logic bugs or performance issues.
    if (['BUG', 'PERFORMANCE'].includes(issueType)) {
      return { 
        valid: false, 
        reason: `Configuration/data files (${ext}) cannot contain runtime logic ${issueType}s.` 
      };
    }
  }

  // Asset files
  if (['.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.css'].includes(ext)) {
    if (['SECURITY', 'BUG', 'PERFORMANCE', 'CODE_SMELL', 'BAD_PRACTICE'].includes(issueType)) {
      return { 
        valid: false, 
        reason: `Asset files (${ext}) do not contain executable logic issues.` 
      };
    }
  }

  return { valid: true, reason: '' };
}
