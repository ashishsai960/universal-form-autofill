// options.js — profile management page (add / edit / delete profile fields).

const CATEGORY_ORDER = ['identity', 'professional', 'documents', 'custom'];
const CATEGORY_LABELS = {
  identity: 'Identity',
  professional: 'Professional',
  documents: 'Documents',
  custom: 'Custom'
};

let fields = [];

const fieldGroupsEl = document.getElementById('fieldGroups');
const addForm = document.getElementById('addForm');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function parseKeywords(str) {
  return (str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadFields() {
  const { profileFields } = await chrome.storage.local.get('profileFields');
  fields = profileFields || [];
}

async function saveFields() {
  await chrome.storage.local.set({ profileFields: fields });
}

function categoryOptionsHtml(selected) {
  return CATEGORY_ORDER.map(
    (c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`
  ).join('');
}

// Debounces value autosave per field so fast typing doesn't hammer storage.
const saveTimers = new Map();
function scheduleSave(fieldId) {
  clearTimeout(saveTimers.get(fieldId));
  saveTimers.set(
    fieldId,
    setTimeout(() => saveFields(), 400)
  );
}

function renderFieldCard(field) {
  const card = document.createElement('div');
  card.className = 'field-card';
  card.dataset.id = field.id;

  card.innerHTML = `
    <div class="field-row-main">
      <label class="field-label" for="value-${field.id}">
        ${escapeHtml(field.label)}
        ${field.sensitive ? '<span class="field-card-badge">sensitive</span>' : ''}
      </label>
      <input type="text" id="value-${field.id}" class="value-input" value="${escapeHtml(field.value)}" placeholder="Enter value…" />
      <button type="button" class="small-btn advanced-toggle" title="Advanced options">⋯</button>
    </div>
    <div class="field-advanced" hidden>
      <div class="form-row">
        <label>Label
          <input type="text" class="edit-label" value="${escapeHtml(field.label)}" required />
        </label>
        <label>Category
          <select class="edit-category">${categoryOptionsHtml(field.category)}</select>
        </label>
      </div>
      <label>Keywords (comma-separated, used for matching)
        <input type="text" class="edit-keywords" value="${escapeHtml((field.keywords || []).join(', '))}" />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" class="edit-sensitive" ${field.sensitive ? 'checked' : ''} />
        Sensitive — never include in bulk fill
      </label>
      <div class="field-card-actions">
        <button type="button" class="small-btn danger delete-btn">Delete field</button>
      </div>
    </div>
  `;

  const valueInput = card.querySelector('.value-input');
  const advancedPanel = card.querySelector('.field-advanced');
  const labelInput = card.querySelector('.edit-label');
  const categorySelect = card.querySelector('.edit-category');
  const keywordsInput = card.querySelector('.edit-keywords');
  const sensitiveCheckbox = card.querySelector('.edit-sensitive');

  valueInput.addEventListener('input', () => {
    field.value = valueInput.value;
    scheduleSave(field.id);
  });

  card.querySelector('.advanced-toggle').addEventListener('click', () => {
    advancedPanel.hidden = !advancedPanel.hidden;
  });

  labelInput.addEventListener('input', () => {
    field.label = labelInput.value;
    scheduleSave(field.id);
  });
  categorySelect.addEventListener('change', async () => {
    field.category = categorySelect.value;
    await saveFields();
    render();
  });
  keywordsInput.addEventListener('input', () => {
    field.keywords = parseKeywords(keywordsInput.value);
    scheduleSave(field.id);
  });
  sensitiveCheckbox.addEventListener('change', async () => {
    field.sensitive = sensitiveCheckbox.checked;
    await saveFields();
    render();
  });

  card.querySelector('.delete-btn').addEventListener('click', async () => {
    if (!confirm(`Delete "${field.label}"?`)) return;
    fields = fields.filter((f) => f.id !== field.id);
    await saveFields();
    render();
  });

  return card;
}

function render() {
  fieldGroupsEl.innerHTML = '';

  if (fields.length === 0) {
    fieldGroupsEl.innerHTML = '<p class="empty-note">No profile fields yet. Add one above.</p>';
    return;
  }

  const byCategory = {};
  for (const f of fields) {
    byCategory[f.category] = byCategory[f.category] || [];
    byCategory[f.category].push(f);
  }

  const categories = [...CATEGORY_ORDER, ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c))];

  for (const category of categories) {
    const group = byCategory[category];
    if (!group || group.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'category-group';
    section.innerHTML = `<h2>${escapeHtml(CATEGORY_LABELS[category] || category)}</h2>`;

    group.forEach((field) => section.appendChild(renderFieldCard(field)));

    fieldGroupsEl.appendChild(section);
  }
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = document.getElementById('newLabel').value.trim();
  if (!label) return;

  const newField = {
    id: crypto.randomUUID(),
    category: document.getElementById('newCategory').value,
    label,
    value: document.getElementById('newValue').value,
    keywords: parseKeywords(document.getElementById('newKeywords').value),
    sensitive: document.getElementById('newSensitive').checked
  };

  fields.push(newField);
  await saveFields();
  addForm.reset();
  render();
});

(async function init() {
  await loadFields();
  render();
})();
