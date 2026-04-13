/**
 * UI helpers — terminal, diff renderer, issue cards, confidence gauge, modals, toasts.
 * No business logic. Pure display.
 */

// ── Terminal ─────────────────────────────────────────────────────────────────

export function appendLog(terminalEl, { stage, level = 'info', message, ts }) {
  const line = document.createElement('div');
  line.className = 'log-line';

  const time = ts ? new Date(ts).toLocaleTimeString('en', { hour12: false }) : '--:--:--';
  const stageStr = stage ? `S${stage}` : '   ';

  line.innerHTML = `
    <span class="log-ts">${time}</span>
    <span class="log-stage">${stageStr}</span>
    <span class="log-level ${level}">${level.toUpperCase().slice(0,4).padEnd(4)}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;

  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
  return line;
}

export function appendStageHeader(terminalEl, stageNum, stageName, stageColor) {
  const line = document.createElement('div');
  line.className = 'log-line stage-header';
  line.style.setProperty('--stage-color', stageColor);
  line.innerHTML = `
    <span class="log-ts">──────</span>
    <span class="log-stage">S${stageNum}</span>
    <span class="log-level" style="color: ${stageColor}; width: 46px;">START</span>
    <span class="log-msg">═══ STAGE ${stageNum}: ${escapeHtml(stageName)} ═══</span>
  `;
  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

// ── Stage Tracker ─────────────────────────────────────────────────────────────

const STAGES = [
  { num: 1, name: 'Repo Ingestion',   color: '#7F77DD' },
  { num: 2, name: 'Code Understanding', color: '#378ADD' },
  { num: 3, name: 'Issue Detection',  color: '#1D9E75' },
  { num: 4, name: 'Prioritization',   color: '#EF9F27' },
  { num: 5, name: 'Fix Generation',   color: '#E24B4A' },
  { num: 6, name: 'Validation',       color: '#C44BDE' },
  { num: 7, name: 'PR Generation',    color: '#27C4B4' },
];

export function buildStageTracker(containerEl) {
  containerEl.innerHTML = '';
  for (const s of STAGES) {
    const item = document.createElement('div');
    item.className = 'stage-item';
    item.id = `stage-item-${s.num}`;
    item.style.setProperty('--stage-color', s.color);
    item.innerHTML = `
      <div class="stage-icon">${s.num}</div>
      <div class="stage-info">
        <div class="stage-name">${s.name}</div>
        <div class="stage-status">Pending</div>
      </div>
    `;
    containerEl.appendChild(item);
  }
}

export function getStageColor(stageNum) {
  return STAGES.find(s => s.num === stageNum)?.color || '#7F77DD';
}

export function setStageStatus(stageNum, status, message = '') {
  const item = document.getElementById(`stage-item-${stageNum}`);
  if (!item) return;

  item.className = `stage-item ${status}`;
  const statusEl = item.querySelector('.stage-status');
  const iconEl = item.querySelector('.stage-icon');

  if (status === 'active') {
    statusEl.textContent = 'Running...';
    iconEl.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="animation: spin 0.8s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
  } else if (status === 'complete') {
    statusEl.textContent = message || 'Done';
    iconEl.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
  } else if (status === 'failed') {
    statusEl.textContent = message || 'Failed';
    iconEl.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
  }
}

// ── Diff Renderer ─────────────────────────────────────────────────────────────

export function renderDiff(diffStr, file, fixTitle) {
  const block = document.createElement('div');
  block.className = 'diff-block';

  block.innerHTML = `
    <div class="diff-header">
      <span class="diff-file">${escapeHtml(file)}</span>
      <span>—</span>
      <span>${escapeHtml(fixTitle)}</span>
    </div>
    <div class="diff-content" id="dc-${Math.random().toString(36).slice(2)}"></div>
  `;

  const content = block.querySelector('.diff-content');
  const lines = diffStr.split('\n');
  let lineNum = 0;

  for (const rawLine of lines) {
    const div = document.createElement('div');
    div.className = 'diff-line';

    if (rawLine.startsWith('+++') || rawLine.startsWith('---')) {
      div.classList.add('meta');
      div.innerHTML = `<span class="diff-line-num">   </span><span class="diff-line-content" style="color:var(--text-muted)">${escapeHtml(rawLine)}</span>`;
    } else if (rawLine.startsWith('@@')) {
      div.classList.add('hunk');
      div.innerHTML = `<span class="diff-line-num">@@ </span><span class="diff-line-content">${escapeHtml(rawLine)}</span>`;
    } else if (rawLine.startsWith('+')) {
      lineNum++;
      div.classList.add('add');
      div.innerHTML = `<span class="diff-line-num">${lineNum}</span><span class="diff-line-content">${escapeHtml(rawLine)}</span>`;
    } else if (rawLine.startsWith('-')) {
      div.classList.add('del');
      div.innerHTML = `<span class="diff-line-num"> </span><span class="diff-line-content">${escapeHtml(rawLine)}</span>`;
    } else {
      lineNum++;
      div.innerHTML = `<span class="diff-line-num">${lineNum}</span><span class="diff-line-content">${escapeHtml(rawLine)}</span>`;
    }

    content.appendChild(div);
  }

  return block;
}

// ── Issue Card ────────────────────────────────────────────────────────────────

const ISSUE_COLORS = {
  SECURITY: '#E24B4A',
  BUG: '#EF9F27',
  PERFORMANCE: '#378ADD',
  CODE_SMELL: '#1D9E75',
  BAD_PRACTICE: '#7F77DD',
  MISSING_FEATURE: '#C44BDE',
};

export function createIssueCard(issue, repoUrl = '') {
  const card = document.createElement('div');
  card.className = 'issue-card';
  card.dataset.type = issue.type;
  const color = ISSUE_COLORS[issue.type] || '#888';
  card.style.setProperty('--issue-color', color);

  const tier = issue.tier || 'P3';
  const confidencePct = Math.round((issue.confidence || 0) * 100);

  // Generate GitHub link if repoUrl is present
  let fileMarkup = escapeHtml(issue.file);
  const lineStart = issue.line_range ? issue.line_range[0] : null;
  const lineEnd   = issue.line_range ? issue.line_range[1] : null;
  const lineHash  = lineStart ? (lineEnd && lineEnd !== lineStart ? `#L${lineStart}-L${lineEnd}` : `#L${lineStart}`) : '';
  
  if (repoUrl) {
    const cleanRepoUrl = repoUrl.replace(/\/$/, '');
    // Simple heuristic: default to branch main
    const fileUrl = `${cleanRepoUrl}/blob/main/${issue.file}${lineHash}`;
    fileMarkup = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:underline;" title="Open in GitHub">${escapeHtml(issue.file)}${lineStart ? `:${lineStart}` : ''}</a>`;
  } else {
    fileMarkup = `${escapeHtml(issue.file)}${lineStart ? `:${lineStart}` : ''}`;
  }

  card.innerHTML = `
    <div class="issue-header">
      <span class="issue-tier ${tier}">${tier}</span>
      <span class="issue-type-badge" style="color:${color}">${issue.type}</span>
    </div>
    <div class="issue-title">${escapeHtml(issue.title)}</div>
    <div class="issue-file">${fileMarkup}</div>
    <div class="issue-confidence">Confidence: ${confidencePct}% · ${issue.detection_strategy || 'UNKNOWN'}</div>
  `;

  return card;
}

// ── Confidence badge ──────────────────────────────────────────────────────────

export function renderConfidenceBadge(score) {
  const cls = score >= 85 ? 'confidence-high' : score >= 65 ? 'confidence-medium' : 'confidence-low';
  const label = score >= 85 ? 'High — Safe to merge after review'
              : score >= 65 ? 'Medium — Review carefully'
              : score >= 50 ? 'Low — Treat as proposal'
              : 'Very Low';
  return `<span class="pr-confidence-badge ${cls}">⬡ ${score}% Confidence — ${label}</span>`;
}

// ── Markdown → HTML (minimal) ─────────────────────────────────────────────────

export function markdownToHtml(md) {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^```diff\n([\s\S]*?)```$/gm, (_, code) =>
      `<pre><code>${escapeHtml(code)}</code></pre>`)
    .replace(/^```\n?([\s\S]*?)```$/gm, (_, code) =>
      `<pre><code>${escapeHtml(code)}</code></pre>`)
    .replace(/^- \[x\] (.+)$/gm, '<div class="checklist-item"><input type="checkbox" checked disabled> $1</div>')
    .replace(/^- \[!\] (.+)$/gm, '<div class="checklist-item warn"><input type="checkbox" disabled> ⚠️ $1</div>')
    .replace(/^- \[ \] (.+)$/gm, '<div class="checklist-item"><input type="checkbox" disabled> $1</div>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/<li>(.*?)<\/li>(\n<li>)/g, '<li>$1</li>$2')
    .replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      // Basic table row
      const cells = match.slice(1,-1).split('|').map(c => c.trim());
      return '<tr>' + cells.map(c => c.match(/^[-:]+$/) ? '' : `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, s => `<table><tbody>${s}</tbody></table>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hpuilodt])/gm, '')
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

export function downloadFile(content, filename, mimeType = 'text/markdown') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function showToast(message, type = 'info') {
  // Simple toast — create, animate, remove
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 18px; border-radius: 10px;
    font-family: Inter, sans-serif; font-size: 13px; font-weight: 500;
    background: ${type === 'error' ? '#2A0F0F' : type === 'success' ? '#0F2A1F' : '#151528'};
    border: 1px solid ${type === 'error' ? '#E24B4A' : type === 'success' ? '#1D9E75' : '#7F77DD'};
    color: ${type === 'error' ? '#E24B4A' : type === 'success' ? '#1D9E75' : '#EEEDF8'};
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: toastIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    max-width: 360px;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastIn { from { opacity:0; transform: translateY(12px) scale(0.95); } to { opacity:1; transform: translateY(0) scale(1); } }
    @keyframes toastOut { from { opacity:1; } to { opacity:0; transform: translateY(8px); } }
  `;
  document.head.appendChild(style);

  setTimeout(() => {
    toast.style.animation = 'toastOut 300ms ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
