// sidepanel.js — main UI logic for the side panel.

let activeTabId = null;
let currentData = null; // { matched, unmatched, source, url, title }
let profileFieldsById = new Map();

const els = {
  status: document.getElementById('status'),
  matchedSection: document.getElementById('matchedSection'),
  matchedList: document.getElementById('matchedList'),
  unmatchedSection: document.getElementById('unmatchedSection'),
  unmatchedList: document.getElementById('unmatchedList'),
  fillSelectedBtn: document.getElementById('fillSelectedBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsBtn: document.getElementById('settingsBtn')
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function loadProfileFields() {
  const { profileFields } = await chrome.storage.local.get('profileFields');
  profileFieldsById = new Map((profileFields || []).map((f) => [f.id, f]));
  return profileFields || [];
}

async function fetchMatches() {
  if (activeTabId == null) return null;
  return chrome.runtime.sendMessage({ type: 'GET_MATCHES', tabId: activeTabId });
}

function renderMatchedRow(field) {
  const row = document.createElement('div');
  row.className = 'field-row' + (field.sensitive ? ' sensitive' : '');
  row.dataset.fieldId = field.fieldId;

  const checkedAttr = field.sensitive ? '' : 'checked';
  const disabledAttr = field.sensitive ? 'disabled' : '';

  row.innerHTML = `
    <div class="field-row-top">
      <input type="checkbox" class="select-box" ${checkedAttr} ${disabledAttr} />
      <div class="field-main">
        <div class="field-mapping">
          <strong>${escapeHtml(field.profileLabel)}</strong>
          <span class="arrow">→</span>
          <span>${escapeHtml(field.detectedLabel || '(unlabeled field)')}</span>
          ${field.sensitive ? '<span class="sensitive-badge">sensitive</span>' : ''}
        </div>
        <div class="field-value">${field.sensitive ? maskValue(field.value) : escapeHtml(field.value || '(empty — set this in Options)')}</div>
      </div>
      <button class="row-fill-btn">Fill</button>
    </div>
  `;

  row.querySelector('.row-fill-btn').addEventListener('click', () => {
    fillFields([{ fieldId: field.fieldId, value: field.value }]);
  });

  return row;
}

function maskValue(value) {
  if (!value) return '(empty — set this in Options)';
  const str = String(value);
  if (str.length <= 4) return '••••';
  return escapeHtml(str.slice(0, 2)) + '••••' + escapeHtml(str.slice(-2));
}

function renderUnmatchedRow(field, profileFields) {
  const row = document.createElement('div');
  row.className = 'field-row unmatched-row';

  const grouped = {};
  for (const pf of profileFields) {
    grouped[pf.category] = grouped[pf.category] || [];
    grouped[pf.category].push(pf);
  }

  const optionsHtml = Object.entries(grouped)
    .map(([category, fields]) => {
      const opts = fields.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.label)}</option>`).join('');
      return `<optgroup label="${escapeHtml(category)}">${opts}</optgroup>`;
    })
    .join('');

  row.innerHTML = `
    <div class="field-question">${escapeHtml(field.detectedLabel || '(unlabeled field)')}</div>
    <select class="link-select">
      <option value="">Link to profile field…</option>
      ${optionsHtml}
    </select>
    <div class="unmatched-actions">
      <button class="row-fill-btn link-fill-btn">Link &amp; Fill</button>
    </div>
  `;

  row.querySelector('.link-fill-btn').addEventListener('click', async () => {
    const select = row.querySelector('.link-select');
    const profileFieldId = select.value;
    if (!profileFieldId) return;
    const profileField = profileFieldsById.get(profileFieldId);
    if (!profileField) return;

    await chrome.runtime.sendMessage({
      type: 'MANUAL_MATCH',
      tabId: activeTabId,
      fieldId: field.fieldId,
      profileFieldId: profileField.id,
      profileLabel: profileField.label,
      value: profileField.value,
      sensitive: profileField.sensitive
    });

    await fillFields([{ fieldId: field.fieldId, value: profileField.value }]);
    await refresh();
  });

  return row;
}

function render() {
  els.matchedList.innerHTML = '';
  els.unmatchedList.innerHTML = '';

  if (!currentData || (!currentData.matched.length && !currentData.unmatched.length)) {
    els.status.textContent = 'No form fields detected on this page yet.';
    els.matchedSection.hidden = true;
    els.unmatchedSection.hidden = true;
    els.fillSelectedBtn.disabled = true;
    return;
  }

  els.fillSelectedBtn.disabled = false;
  const total = currentData.matched.length + currentData.unmatched.length;
  els.status.textContent = `${total} field${total === 1 ? '' : 's'} detected (${currentData.source === 'google-forms' ? 'Google Forms' : 'HTML form'}).`;

  els.matchedSection.hidden = currentData.matched.length === 0;
  currentData.matched.forEach((field) => els.matchedList.appendChild(renderMatchedRow(field)));

  els.unmatchedSection.hidden = currentData.unmatched.length === 0;
  const profileFields = Array.from(profileFieldsById.values());
  currentData.unmatched.forEach((field) => els.unmatchedList.appendChild(renderUnmatchedRow(field, profileFields)));
}

async function fillFields(items) {
  if (!items.length || activeTabId == null) return;
  await chrome.runtime.sendMessage({ type: 'FILL_REQUEST', tabId: activeTabId, items });
}

function fillSelected() {
  if (!currentData) return;
  const items = [];
  els.matchedList.querySelectorAll('.field-row').forEach((row) => {
    const checkbox = row.querySelector('.select-box');
    if (!checkbox || !checkbox.checked || checkbox.disabled) return; // sensitive rows never bulk-fill
    const field = currentData.matched.find((f) => f.fieldId === row.dataset.fieldId);
    if (field && !field.sensitive) {
      items.push({ fieldId: field.fieldId, value: field.value });
    }
  });
  fillFields(items);
}

async function refresh() {
  await loadProfileFields();
  currentData = await fetchMatches();
  render();
}

async function init() {
  activeTabId = await getActiveTabId();
  await refresh();
}

els.fillSelectedBtn.addEventListener('click', fillSelected);
els.refreshBtn.addEventListener('click', refresh);
els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'FIELDS_UPDATED' && message.tabId === activeTabId) {
    refresh();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  await refresh();
});

init();
