/**
 * PRism — Main Application
 * Frontend is a pure display layer that streams results from the backend.
 */

import { startAnalysis, validateApiKey, healthCheck, getBackendUrl, setBackendUrl } from './api.js';
import { PipelineSocket } from './socket.js';
import {
  appendLog, appendStageHeader,
  buildStageTracker, setStageStatus, getStageColor,
  createIssueCard, renderDiff,
  renderConfidenceBadge,
  markdownToHtml, copyToClipboard, downloadFile, showToast,
} from './ui.js';

import { PROVIDER_MODELS } from './models.js';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  sessionId: null,
  socket: null,
  issues: [],
  fixes: [],
  pr: null,
  currentStage: 0,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const views = {
  landing:  $('view-landing'),
  pipeline: $('view-pipeline'),
};

// Landing
const repoUrlInput    = $('repo-url');
const scanDepthSel    = $('scan-depth');
const runModeSel      = $('run-mode');
const providerSel     = $('ai-provider');
const modelSel        = $('ai-model');
const apiKeyInput     = $('api-key');
const githubTokenInput = $('github-token');
const btnAnalyze      = $('btn-analyze');
const formError       = $('form-error');
const btnToggleKey    = $('btn-toggle-key');
const btnSettings     = $('btn-settings');

// Pipeline
const terminalOutput  = $('terminal-output');
const stagesList      = $('stages-list');
const trackerRepo     = $('tracker-repo');
const btnBack         = $('btn-back');
const btnClearLog     = $('btn-clear-log');
const statIssues      = $('stat-issues').querySelector('.stat-num');
const statFixes       = $('stat-fixes').querySelector('.stat-num');
const statConfidence  = $('stat-confidence').querySelector('.stat-num');
const repoSummaryCard = $('repo-summary-card');
const issuesList      = $('issues-list');
const prOutput        = $('pr-output');

// Settings modal
const modalSettings   = $('modal-settings');
const btnCloseSettings = $('btn-close-settings');
const btnSaveSettings = $('btn-save-settings');
const settingBackendUrl = $('setting-backend-url');

// PR modal
const modalPR         = $('modal-pr');
const prModalTitle    = $('pr-modal-title');
const prDescriptionWrap = $('pr-description-wrap');
const prDiffsWrap     = $('pr-diffs-wrap');
const prConfidenceBar = $('pr-confidence-bar');
const prReviewerChecklist = $('pr-reviewer-checklist');
const btnCopyPR       = $('btn-copy-pr');
const btnDownloadPR   = $('btn-download-pr');
const btnClosePR      = $('btn-close-pr');

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  // Load saved settings
  settingBackendUrl.value = getBackendUrl();
  restoreFormValues();
  populateModelSelect(providerSel.value);
  updateAnalyzeButton();

  // Check backend health
  const healthy = await healthCheck();
  if (!healthy) {
    showToast('⚠️ Backend unreachable. Start the server with: npm run dev in /backend', 'error');
  }

  // Build stage tracker
  buildStageTracker(stagesList);

  // Attach events
  attachEvents();
})();

// ── Model select ─────────────────────────────────────────────────────────────
function populateModelSelect(provider) {
  const models = PROVIDER_MODELS[provider] || [];
  modelSel.innerHTML = models.map(m =>
    `<option value="${m.id}">${m.label}</option>`
  ).join('');
}

providerSel.addEventListener('change', () => {
  populateModelSelect(providerSel.value);
  saveFormValues();
});

// ── Form validation ───────────────────────────────────────────────────────────
function updateAnalyzeButton() {
  const hasUrl = repoUrlInput.value.trim().startsWith('https://github.com/');
  const hasKey = apiKeyInput.value.trim().length > 10;
  btnAnalyze.disabled = !(hasUrl && hasKey);
}

[repoUrlInput, apiKeyInput].forEach(el =>
  el.addEventListener('input', () => { updateAnalyzeButton(); clearError(); })
);

function showError(msg) {
  formError.textContent = msg;
  formError.classList.add('visible');
}
function clearError() {
  formError.textContent = '';
  formError.classList.remove('visible');
}

// ── LocalStorage persistence ─────────────────────────────────────────────────
function saveFormValues() {
  localStorage.setItem('prism_provider', providerSel.value);
  localStorage.setItem('prism_model', modelSel.value);
  localStorage.setItem('prism_scan', scanDepthSel.value);
  localStorage.setItem('prism_mode', runModeSel.value);
  // Never save API key to localStorage
}

function restoreFormValues() {
  providerSel.value = localStorage.getItem('prism_provider') || 'gemini';
  scanDepthSel.value = localStorage.getItem('prism_scan') || 'standard';
  runModeSel.value = localStorage.getItem('prism_mode') || 'autonomous';
}

[providerSel, scanDepthSel, runModeSel, modelSel].forEach(el =>
  el.addEventListener('change', saveFormValues)
);

// ── API key toggle ────────────────────────────────────────────────────────────
btnToggleKey.addEventListener('click', () => {
  const isPass = apiKeyInput.type === 'password';
  apiKeyInput.type = isPass ? 'text' : 'password';
});

// ── Events ────────────────────────────────────────────────────────────────────
function attachEvents() {
  // Analyze button
  btnAnalyze.addEventListener('click', runAnalysis);
  repoUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });

  // Back button
  btnBack.addEventListener('click', goToLanding);

  // Clear log
  btnClearLog.addEventListener('click', () => { terminalOutput.innerHTML = ''; });

  // Result tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Issue filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterIssues(btn.dataset.filter);
    });
  });

  // Settings modal
  btnSettings.addEventListener('click', () => modalSettings.classList.add('open'));
  btnCloseSettings.addEventListener('click', () => modalSettings.classList.remove('open'));
  modalSettings.addEventListener('click', (e) => { if (e.target === modalSettings) modalSettings.classList.remove('open'); });
  btnSaveSettings.addEventListener('click', () => {
    setBackendUrl(settingBackendUrl.value.trim());
    modalSettings.classList.remove('open');
    showToast('Settings saved.', 'success');
  });

  // PR Modal
  btnClosePR.addEventListener('click', () => modalPR.classList.remove('open'));
  modalPR.addEventListener('click', (e) => { if (e.target === modalPR) modalPR.classList.remove('open'); });
  btnCopyPR.addEventListener('click', async () => {
    if (state.pr?.description) {
      await copyToClipboard(state.pr.description);
      showToast('PR description copied!', 'success');
    }
  });
  btnDownloadPR.addEventListener('click', () => {
    if (state.pr) {
      const content = `# ${state.pr.title}\n\n${state.pr.description}`;
      downloadFile(content, 'pull-request.md');
    }
  });
}

// ── Run Analysis ─────────────────────────────────────────────────────────────
async function runAnalysis() {
  clearError();
  const repoUrl = repoUrlInput.value.trim();
  const apiKey  = apiKeyInput.value.trim();
  const provider = providerSel.value;
  const model    = modelSel.value;

  if (!repoUrl.startsWith('https://github.com/')) {
    return showError('Please enter a valid GitHub URL (https://github.com/owner/repo)');
  }
  if (!apiKey) return showError('API key is required.');

  // Loading state
  btnAnalyze.classList.add('loading');
  btnAnalyze.disabled = true;
  const btnText = btnAnalyze.querySelector('.btn-text');
  btnText.textContent = 'Connecting...';

  try {
    const result = await startAnalysis({
      repoUrl,
      mode: runModeSel.value,
      scanDepth: scanDepthSel.value,
      aiProvider: provider,
      apiKey,
      model,
      githubToken: githubTokenInput.value.trim() || undefined,
    });

    state.sessionId = result.sessionId;
    showPipelineView(repoUrl);
    connectWebSocket(state.sessionId);
  } catch (err) {
    showError(err.message);
    btnAnalyze.classList.remove('loading');
    btnAnalyze.disabled = false;
    btnText.textContent = 'Analyze Repository';
  }
}

// ── Pipeline View ─────────────────────────────────────────────────────────────
function showPipelineView(repoUrl) {
  views.landing.classList.remove('active');
  views.pipeline.classList.add('active');

  // Reset state
  state.issues = [];
  state.fixes = [];
  state.pr = null;
  state.currentStage = 0;

  // Reset UI
  terminalOutput.innerHTML = '';
  issuesList.innerHTML = '<div class="empty-state">Issues will appear here as they are detected.</div>';
  prOutput.innerHTML   = '<div class="empty-state">Pull Request will appear here when pipeline completes.</div>';
  repoSummaryCard.innerHTML = '<div class="repo-skeleton">Analyzing...</div>';
  statIssues.textContent = '—';
  statFixes.textContent  = '—';
  statConfidence.textContent = '—';

  trackerRepo.textContent = repoUrl.replace('https://github.com/', '');
  buildStageTracker(stagesList);

  appendLog(terminalOutput, { stage: 0, level: 'info', message: `Starting PRism AutoPR Engine`, ts: Date.now() });
  appendLog(terminalOutput, { stage: 0, level: 'info', message: `Repo: ${repoUrl}`, ts: Date.now() });
  appendLog(terminalOutput, { stage: 0, level: 'info', message: `Mode: ${runModeSel.value} | Depth: ${scanDepthSel.value} | Provider: ${providerSel.value}`, ts: Date.now() });
}

function goToLanding() {
  if (state.socket) { state.socket.disconnect(); state.socket = null; }
  views.pipeline.classList.remove('active');
  views.landing.classList.add('active');
  const btnText = btnAnalyze.querySelector('.btn-text');
  btnText.textContent = 'Analyze Repository';
  btnAnalyze.classList.remove('loading');
  updateAnalyzeButton();
}

// ── WebSocket connection ──────────────────────────────────────────────────────
function connectWebSocket(sessionId) {
  const socket = new PipelineSocket(sessionId, {
    onConnected: () => {
      appendLog(terminalOutput, { stage: 0, level: 'info', message: 'Connected to backend engine.', ts: Date.now() });
    },
    onDisconnected: (code, reason) => {
      if (code !== 1000) {
        appendLog(terminalOutput, { stage: 0, level: 'warn', message: `Disconnected (${code}): ${reason || 'Reconnecting...'}`, ts: Date.now() });
      }
    },
    onError: () => {
      appendLog(terminalOutput, { stage: 0, level: 'error', message: 'WebSocket error. Check backend is running.', ts: Date.now() });
    },

    onPipelineStart: (evt) => {
      appendLog(terminalOutput, { stage: 0, level: 'info', message: `Pipeline started. Session: ${evt.sessionId}`, ts: evt.ts });
    },

    onStageStart: (evt) => {
      state.currentStage = evt.stage;
      const color = getStageColor(evt.stage);
      appendStageHeader(terminalOutput, evt.stage, evt.name, color);
      setStageStatus(evt.stage, 'active');
    },

    onLog: (evt) => {
      appendLog(terminalOutput, evt);
    },

    onStageComplete: (evt) => {
      setStageStatus(evt.stage, 'complete', evt.summary || 'Done');
    },

    onStageFailed: (evt) => {
      setStageStatus(evt.stage, 'failed', evt.reason || 'Failed');
      appendLog(terminalOutput, { stage: evt.stage, level: 'error', message: `Stage failed: ${evt.reason || 'Unknown error'}`, ts: evt.ts });
    },

    onStageRetry: (evt) => {
      appendLog(terminalOutput, { stage: evt.stage, level: 'warn', message: `Retry ${evt.attempt}: ${evt.reason}`, ts: evt.ts });
    },

    onRepoIngested: (evt) => {
      repoSummaryCard.innerHTML = `
        <div class="repo-field">
          <div class="repo-field-label">Language / Framework</div>
          <div class="repo-field-val">
            <span class="lang-badge">${evt.language}</span>
            ${evt.framework ? `<span class="lang-badge" style="margin-left:6px;--violet:#378ADD">${evt.framework}</span>` : ''}
          </div>
        </div>
        <div class="repo-field">
          <div class="repo-field-label">Files Analyzed</div>
          <div class="repo-field-val">${evt.fileCount} source files</div>
        </div>
        ${evt.testFramework ? `<div class="repo-field"><div class="repo-field-label">Test Framework</div><div class="repo-field-val">${evt.testFramework}</div></div>` : ''}
        ${evt.ciConfig ? `<div class="repo-field"><div class="repo-field-label">CI/CD</div><div class="repo-field-val">${evt.ciConfig}</div></div>` : ''}
        ${evt.deps?.length ? `<div class="repo-field"><div class="repo-field-label">Key Dependencies</div><div class="repo-field-val" style="font-size:12px;color:var(--text-muted)">${evt.deps.slice(0,8).join(', ')}${evt.deps.length > 8 ? ` +${evt.deps.length-8} more` : ''}</div></div>` : ''}
      `;
    },

    onIssueFound: (evt) => {
      const { issue } = evt;
      state.issues.push(issue);
      statIssues.textContent = state.issues.length;

      // Add to issues list (only if first occurrence)
      const existingEmpty = issuesList.querySelector('.empty-state');
      if (existingEmpty) existingEmpty.remove();

      const card = createIssueCard(issue);
      issuesList.appendChild(card);

      // Switch to issues tab if first issue
      if (state.issues.length === 1) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="issues"]').classList.add('active');
        $('tab-issues').classList.add('active');
      }
    },

    onPrioritizationComplete: (evt) => {
      // Update issue cards with tier info
      const tieredMap = {};
      evt.prCandidates?.forEach(c => { tieredMap[c.id] = c.tier; });

      // Re-render issues list with tier badges
      state.issues = state.issues.map(i => ({
        ...i,
        tier: tieredMap[i.id] || i.tier || 'P3',
      }));
    },

    onFixGenerated: (evt) => {
      state.fixes.push(evt.fix);
      statFixes.textContent = state.fixes.length;
    },

    onLinterResult: (evt) => {
      appendLog(terminalOutput, {
        stage: 6, level: evt.exitCode === 0 ? 'info' : 'warn',
        message: `[Linter: ${evt.tool}] Exit ${evt.exitCode} — ${evt.issueCount} issues${evt.timedOut ? ' [TIMED OUT]' : ''}`,
        ts: evt.ts,
      });
    },

    onTestResult: (evt) => {
      appendLog(terminalOutput, {
        stage: 6, level: evt.failed > 0 ? 'warn' : 'info',
        message: `[Tests: ${evt.tool}] ${evt.passed} passed, ${evt.failed} failed${evt.timedOut ? ' [TIMED OUT]' : ''}`,
        ts: evt.ts,
      });
    },

    onValidationResult: (evt) => {
      const level = evt.status === 'REJECTED' ? 'error' : evt.status === 'CONDITIONAL' ? 'warn' : 'info';
      appendLog(terminalOutput, {
        stage: 6, level,
        message: `Fix ${evt.fix_id}: ${evt.status} (breaking: ${evt.breaking_change}, logic: ${evt.logic_check})`,
        ts: evt.ts,
      });
    },

    onPipelineComplete: (evt) => {
      state.pr = evt.pr;
      const conf = evt.confidence?.final ?? 0;
      statConfidence.textContent = `${conf}%`;

      // Re-render issues with final tier info
      renderFinalIssueList(evt.issues);

      // Render PR output panel
      if (evt.pr) {
        renderPRPanel(evt.pr);
      } else {
        renderAnalysisOnlyPanel(evt);
      }

      appendLog(terminalOutput, {
        stage: 7, level: 'info',
        message: `✓ Pipeline complete! Confidence: ${conf}%`,
        ts: evt.ts,
      });

      // Switch to PR tab
      setTimeout(() => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="pr"]').classList.add('active');
        $('tab-pr').classList.add('active');
      }, 800);

      // Re-enable back button
      const btnText = btnAnalyze.querySelector('.btn-text');
      btnText.textContent = 'Analyze Repository';
      btnAnalyze.classList.remove('loading');
    },

    onPipelineError: (evt) => {
      appendLog(terminalOutput, {
        stage: state.currentStage, level: 'error',
        message: `Pipeline error: ${evt.message}`,
        ts: evt.ts,
      });
      showToast('Pipeline error: ' + evt.message, 'error');
      const btnText = btnAnalyze.querySelector('.btn-text');
      btnText.textContent = 'Analyze Repository';
      btnAnalyze.classList.remove('loading');
    },
  });

  socket.connect(getBackendUrl());
  state.socket = socket;
}

// ── Final issue list render ───────────────────────────────────────────────────
function renderFinalIssueList(issues) {
  if (!issues?.length) return;
  issuesList.innerHTML = '';
  state.issues = issues;
  statIssues.textContent = issues.length;
  for (const issue of issues) {
    const card = createIssueCard(issue);
    issuesList.appendChild(card);
  }
}

function filterIssues(type) {
  document.querySelectorAll('.issue-card').forEach(card => {
    card.style.display = (type === 'all' || card.dataset.type === type) ? 'block' : 'none';
  });
}

// ── PR Output Panel ───────────────────────────────────────────────────────────
function renderPRPanel(pr) {
  const conf = pr.confidence ?? 0;
  const confClass = conf >= 85 ? 'confidence-high' : conf >= 65 ? 'confidence-medium' : 'confidence-low';
  const confLabel = conf >= 85 ? 'High — Safe to merge after review' : conf >= 65 ? 'Medium — Review carefully' : 'Low — Treat as proposal';

  prOutput.innerHTML = `
    <div class="pr-summary-card">
      <div class="pr-title">${pr.title}</div>
      <div class="pr-confidence-badge ${confClass}">⬡ ${conf}% — ${confLabel}</div>
    </div>
    <div class="pr-actions">
      <button class="btn-ghost" id="btn-open-pr-modal">View Full PR</button>
      <button class="btn-ghost" id="btn-copy-pr-title">Copy Title</button>
    </div>
    ${pr.diffs?.length ? `<div style="font-size:12px;color:var(--text-muted)">${pr.diffs.length} diff${pr.diffs.length !== 1 ? 's' : ''} generated</div>` : ''}
    ${pr.reviewerChecklist?.length ? `
      <div class="reviewer-checklist-wrap">
        <div class="repo-field-label">Reviewer Checklist</div>
        ${pr.reviewerChecklist.map(item =>
          `<div class="checklist-item"><input type="checkbox"> ${item}</div>`
        ).join('')}
      </div>
    ` : ''}
  `;

  $('btn-open-pr-modal')?.addEventListener('click', () => openPRModal(pr));
  $('btn-copy-pr-title')?.addEventListener('click', async () => {
    await copyToClipboard(pr.title);
    showToast('PR title copied!', 'success');
  });
}

function renderAnalysisOnlyPanel(evt) {
  prOutput.innerHTML = `
    <div class="pr-summary-card">
      <div class="pr-title" style="color:var(--amber)">⚠️ Analysis Report Only</div>
      <div style="font-size:13px;color:var(--text-secondary);margin-top:8px">
        Confidence too low (${evt.confidence?.final ?? 0}%) to generate a safe PR.
        Issues have been documented for manual review.
      </div>
    </div>
    <div style="font-size:13px;color:var(--text-muted)">Review the Issues tab for all detected problems.</div>
  `;
}

// ── PR Modal ──────────────────────────────────────────────────────────────────
function openPRModal(pr) {
  const conf = pr.confidence ?? 0;
  prModalTitle.textContent = pr.title;

  // Confidence bar
  prConfidenceBar.innerHTML = renderConfidenceBadge(conf);

  // Description (markdown → HTML)
  prDescriptionWrap.innerHTML = markdownToHtml(pr.description || '');

  // Diffs
  prDiffsWrap.innerHTML = '';
  for (const diff of pr.diffs || []) {
    if (diff.diff) {
      const diffEl = renderDiff(diff.diff, diff.file, diff.fix_title);
      prDiffsWrap.appendChild(diffEl);
    }
  }

  // Reviewer checklist
  if (pr.reviewerChecklist?.length) {
    prReviewerChecklist.innerHTML = `
      <div class="reviewer-checklist-wrap">
        <h3>Reviewer Checklist</h3>
        ${pr.reviewerChecklist.map(item =>
          `<div class="checklist-item"><input type="checkbox"> <label>${item}</label></div>`
        ).join('')}
      </div>
    `;
  }

  modalPR.classList.add('open');
}
