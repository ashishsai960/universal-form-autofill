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

function renderFieldCard(field) {
  const card = document.createElement('div');
  card.className = 'field-card';
  card.dataset.id = field.id;

  card.innerHTML = `
    <div class="field-card-view">
      <div class="field-card-info">
        <div class="field-card-label">
          ${escapeHtml(field.label)}
          ${field.sensitive ? '<span class="field-card-badge">sensitive</span>' : ''}
        </div>
        <div class="field-card-value">${field.value ? escapeHtml(field.value) : '<em>not set</em>'}</div>
        <div class="field-card-keywords">Keywords: ${escapeHtml((field.keywords || []).join(', ')) || '—'}</div>
      </div>
      <div class="field-card-actions">
        <button class="small-btn edit-btn">Edit</button>
        <button class="small-btn danger delete-btn">Delete</button>
      </div>
    </div>
    <form class="field-edit-form" hidden>
      <div class="form-row">
        <label>Label
          <input type="text" class="edit-label" value="${escapeHtml(field.label)}" required />
        </label>
        <label>Category
          <select class="edit-category">${categoryOptionsHtml(field.category)}</select>
        </label>
      </div>
      <label>Value
        <input type="text" class="edit-value" value="${escapeHtml(field.value)}" />
      </label>
      <label>Keywords (comma-separated)
        <input type="text" class="edit-keywords" value="${escapeHtml((field.keywords || []).join(', '))}" />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" class="edit-sensitive" ${field.sensitive ? 'checked' : ''} />
        Sensitive — never include in bulk fill
      </label>
      <div class="field-card-actions">
        <button type="submit" class="small-btn">Save</button>
        <button type="button" class="small-btn cancel-btn">Cancel</button>
      </div>
    </form>
  `;

  const viewEl = card.querySelector('.field-card-view');
  const formEl = card.querySelector('.field-edit-form');

  card.querySelector('.edit-btn').addEventListener('click', () => {
    viewEl.hidden = true;
    formEl.hidden = false;
  });

  card.querySelector('.cancel-btn').addEventListener('click', () => {
    viewEl.hidden = false;
    formEl.hidden = true;
  });

  card.querySelector('.delete-btn').addEventListener('click', async () => {
    if (!confirm(`Delete "${field.label}"?`)) return;
    fields = fields.filter((f) => f.id !== field.id);
    await saveFields();
    render();
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = fields.find((f) => f.id === field.id);
    if (!target) return;
    target.label = formEl.querySelector('.edit-label').value.trim();
    target.category = formEl.querySelector('.edit-category').value;
    target.value = formEl.querySelector('.edit-value').value;
    target.keywords = parseKeywords(formEl.querySelector('.edit-keywords').value);
    target.sensitive = formEl.querySelector('.edit-sensitive').checked;
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

    group
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((field) => section.appendChild(renderFieldCard(field)));

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
