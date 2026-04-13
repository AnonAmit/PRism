import path from 'path';
import { readFile } from 'fs/promises';

// Extension → language mapping (most-specific first)
const EXT_TO_LANG = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
  '.c': 'C',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.scala': 'Scala',
  '.lua': 'Lua',
  '.r': 'R',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
};

// Manifest file → language/framework hint
const MANIFEST_HINTS = {
  'package.json': { language: 'JavaScript', check: 'dependencies' },
  'pyproject.toml': { language: 'Python' },
  'requirements.txt': { language: 'Python' },
  'setup.py': { language: 'Python' },
  'Cargo.toml': { language: 'Rust' },
  'go.mod': { language: 'Go' },
  'pom.xml': { language: 'Java' },
  'build.gradle': { language: 'Java' },
  'Gemfile': { language: 'Ruby' },
  'composer.json': { language: 'PHP' },
  'pubspec.yaml': { language: 'Dart' },
  'Package.swift': { language: 'Swift' },
  'CMakeLists.txt': { language: 'C++' },
  '*.csproj': { language: 'C#' },
  '*.sln': { language: 'C#' },
};

// Framework detection (filename/dirname → framework)
const FRAMEWORK_INDICATORS = {
  'next.config.js': 'Next.js', 'next.config.ts': 'Next.js', 'next.config.mjs': 'Next.js',
  'vite.config.js': 'Vite', 'vite.config.ts': 'Vite',
  'nuxt.config.js': 'Nuxt.js', 'nuxt.config.ts': 'Nuxt.js',
  'svelte.config.js': 'SvelteKit',
  'astro.config.mjs': 'Astro',
  'remix.config.js': 'Remix',
  'angular.json': 'Angular',
  'manage.py': 'Django',
  'wsgi.py': 'Flask/Django',
  'asgi.py': 'FastAPI/Django',
  'Dockerfile': null, // not a framework, handled separately
  'docker-compose.yml': null,
  'docker-compose.yaml': null,
};

// Test framework indicators
const TEST_FRAMEWORKS = {
  'jest.config.js': 'Jest', 'jest.config.ts': 'Jest',
  'vitest.config.js': 'Vitest', 'vitest.config.ts': 'Vitest',
  'pytest.ini': 'Pytest', 'conftest.py': 'Pytest', 'setup.cfg': 'Pytest (possible)',
  'rspec': 'RSpec',
  '.mocharc.js': 'Mocha', '.mocharc.yml': 'Mocha',
  'karma.conf.js': 'Karma',
  'cypress.config.js': 'Cypress', 'cypress.config.ts': 'Cypress',
  'playwright.config.js': 'Playwright', 'playwright.config.ts': 'Playwright',
};

// CI config detection
const CI_INDICATORS = {
  '.github/workflows': 'GitHub Actions',
  '.circleci': 'CircleCI',
  'Jenkinsfile': 'Jenkins',
  '.travis.yml': 'Travis CI',
  'azure-pipelines.yml': 'Azure Pipelines',
  '.gitlab-ci.yml': 'GitLab CI',
  'bitbucket-pipelines.yml': 'Bitbucket Pipelines',
};

/**
 * Detect language, framework, test framework, and CI from the file list.
 * @param {FileEntry[]} files
 * @param {string} rootDir
 * @returns {object}
 */
export async function detectLanguage(files, rootDir) {
  const fileNames = new Set(files.map(f => f.name));
  const relPaths = new Set(files.map(f => f.relPath));
  const filePaths = files.map(f => f.fullPath);

  // 1. Extension frequency analysis
  const extCounts = {};
  for (const f of files) {
    if (f.ext) extCounts[f.ext] = (extCounts[f.ext] || 0) + 1;
  }
  const sortedExts = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
  const topExt = sortedExts[0]?.[0];
  let detectedLang = EXT_TO_LANG[topExt] || 'Unknown';

  // 2. Manifest-based override (more reliable)
  for (const [manifest, hint] of Object.entries(MANIFEST_HINTS)) {
    if (manifest.startsWith('*')) {
      // Glob pattern
      const pat = manifest.slice(2); // e.g., '.csproj'
      if (files.some(f => f.ext === pat)) {
        detectedLang = hint.language;
        break;
      }
    } else if (fileNames.has(manifest)) {
      detectedLang = hint.language;
      break;
    }
  }

  // 3. Framework detection
  let detectedFramework = null;
  for (const [indicator, framework] of Object.entries(FRAMEWORK_INDICATORS)) {
    if (!framework) continue;
    if (fileNames.has(indicator) || relPaths.has(indicator)) {
      detectedFramework = framework;
      break;
    }
  }

  // Check package.json for framework if JS/TS
  if (!detectedFramework && (detectedLang === 'JavaScript' || detectedLang === 'TypeScript')) {
    const pkgPath = path.join(rootDir, 'package.json');
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['next']) detectedFramework = 'Next.js';
      else if (allDeps['react']) detectedFramework = 'React';
      else if (allDeps['vue']) detectedFramework = 'Vue.js';
      else if (allDeps['svelte']) detectedFramework = 'SvelteKit';
      else if (allDeps['@angular/core']) detectedFramework = 'Angular';
      else if (allDeps['express']) detectedFramework = 'Express.js';
      else if (allDeps['fastify']) detectedFramework = 'Fastify';
      else if (allDeps['hono']) detectedFramework = 'Hono';
    } catch (_) {}
  }

  // 4. Test framework
  let testFramework = null;
  for (const [indicator, tf] of Object.entries(TEST_FRAMEWORKS)) {
    if (fileNames.has(indicator)) { testFramework = tf; break; }
  }

  // 5. CI config
  let ciConfig = null;
  for (const [indicator, ci] of Object.entries(CI_INDICATORS)) {
    if (relPaths.has(indicator) || files.some(f => f.relPath.startsWith(indicator + '/'))) {
      ciConfig = ci; break;
    }
    if (fileNames.has(indicator)) { ciConfig = ci; break; }
  }

  // 6. Package dependencies summary
  let deps = [];
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch (_) {}

  return {
    language: detectedLang,
    framework: detectedFramework,
    testFramework,
    ciConfig,
    deps,
    extCounts,
    confidence: detectedLang === 'Unknown' ? 'LOW' : 'HIGH',
  };
}
