// options.js — FormPilot profile settings page.
// Reads/writes the `profileFields` array in chrome.storage.local. Schema is
// unchanged from earlier versions so the side panel and background matching
// engine keep working: { id, category, label, value, keywords, sensitive }.

const ICONS = {
  identity: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
  professional: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/></svg>',
  documents: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  custom: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
};

const CATEGORIES = [
  { id: 'identity', label: 'Identity' },
  { id: 'professional', label: 'Professional Links' },
  { id: 'documents', label: 'Documents' },
  { id: 'custom', label: 'Custom Fields' }
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

let fields = [];
let activeCategory = 'identity';
let searchQuery = '';
let editingFieldId = null; // null while adding a new field
let visibleSensitiveIds = new Set(); // per-session "Show" toggles, not persisted

const sidebarEl = document.getElementById('sidebar');
const categoryTitleEl = document.getElementById('categoryTitle');
const fieldGridEl = document.getElementById('fieldGrid');
const emptyStateEl = document.getElementById('emptyState');
const emptyTitleEl = document.getElementById('emptyTitle');
const emptySubtitleEl = document.getElementById('emptySubtitle');
const searchInput = document.getElementById('searchInput');
const addFieldBtn = document.getElementById('addFieldBtn');
const emptyAddBtn = document.getElementById('emptyAddBtn');

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const fieldForm = document.getElementById('fieldForm');
const fieldLabelInput = document.getElementById('fieldLabel');
const fieldValueInput = document.getElementById('fieldValue');
const fieldCategorySelect = document.getElementById('fieldCategory');
const fieldKeywordsInput = document.getElementById('fieldKeywords');
const fieldSensitiveCheckbox = document.getElementById('fieldSensitive');
const formError = document.getElementById('formError');
const cancelBtn = document.getElementById('cancelBtn');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const toastContainer = document.getElementById('toastContainer');

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

function normalize(str) {
  return (str || '').toLowerCase();
}

async function loadFields() {
  const { profileFields } = await chrome.storage.local.get('profileFields');
  fields = profileFields || [];
}

async function saveFields() {
  await chrome.storage.local.set({ profileFields: fields });
}

// ---------- Sidebar ----------

function renderSidebar() {
  sidebarEl.innerHTML = '';
  for (const cat of CATEGORIES) {
    const count = fields.filter((f) => f.category === cat.id).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-item' + (cat.id === activeCategory && !searchQuery ? ' active' : '');
    btn.dataset.category = cat.id;
    btn.innerHTML = `${ICONS[cat.id]}<span class="nav-item-label">${escapeHtml(cat.label)}</span><span class="nav-item-count">${count}</span>`;
    btn.addEventListener('click', () => {
      activeCategory = cat.id;
      searchQuery = '';
      searchInput.value = '';
      render();
    });
    sidebarEl.appendChild(btn);
  }
}

// ---------- Field grid ----------

function fieldMatchesSearch(field, query) {
  const q = normalize(query);
  if (normalize(field.label).includes(q)) return true;
  if (normalize(field.value).includes(q)) return true;
  return (field.keywords || []).some((k) => normalize(k).includes(q));
}

function renderCard(field) {
  const card = document.createElement('div');
  card.className = 'field-card';
  card.dataset.id = field.id;

  const isSensitive = !!field.sensitive;
  const isVisible = !isSensitive || visibleSensitiveIds.has(field.id);
  const hasValue = !!(field.value && field.value.trim());

  let valueHtml;
  if (!hasValue) {
    valueHtml = `<span class="value-text is-empty">Not set</span>`;
  } else if (isSensitive && !isVisible) {
    valueHtml = `<span class="value-text is-masked">••••••••</span><button type="button" class="link-btn toggle-visibility-btn">Show</button>`;
  } else {
    valueHtml = `<span class="value-text">${escapeHtml(field.value)}</span>${isSensitive ? '<button type="button" class="link-btn toggle-visibility-btn">Hide</button>' : ''}`;
  }

  card.innerHTML = `
    <div class="field-card-head">
      <h3 class="field-card-label">${escapeHtml(field.label)}</h3>
      <div class="field-card-actions">
        <button type="button" class="icon-btn edit-btn" title="Edit" aria-label="Edit ${escapeHtml(field.label)}">${ICONS.pencil}</button>
        <button type="button" class="icon-btn danger delete-btn" title="Delete" aria-label="Delete ${escapeHtml(field.label)}">${ICONS.trash}</button>
      </div>
    </div>
    <div class="field-card-badges">
      <span class="badge">${escapeHtml(CATEGORY_LABELS[field.category] || field.category)}</span>
      ${isSensitive ? `<span class="badge badge-sensitive">${ICONS.lock} Sensitive</span>` : ''}
    </div>
    <div class="field-card-value">${valueHtml}</div>
  `;

  card.querySelector('.edit-btn').addEventListener('click', () => openModal(field));
  card.querySelector('.delete-btn').addEventListener('click', () => deleteField(field));

  const toggleBtn = card.querySelector('.toggle-visibility-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (visibleSensitiveIds.has(field.id)) visibleSensitiveIds.delete(field.id);
      else visibleSensitiveIds.add(field.id);
      renderGrid();
    });
  }

  return card;
}

function renderGrid() {
  const query = searchQuery.trim();
  const list = query
    ? fields.filter((f) => fieldMatchesSearch(f, query))
    : fields.filter((f) => f.category === activeCategory);

  categoryTitleEl.textContent = query ? `Search results for "${query}"` : CATEGORY_LABELS[activeCategory];

  fieldGridEl.innerHTML = '';

  if (list.length === 0) {
    fieldGridEl.hidden = true;
    emptyStateEl.hidden = false;
    if (query) {
      emptyTitleEl.textContent = 'No matching fields';
      emptySubtitleEl.textContent = `Nothing matches "${query}". Try a different search term.`;
      emptyAddBtn.hidden = true;
    } else {
      emptyTitleEl.textContent = `No ${CATEGORY_LABELS[activeCategory].toLowerCase()} fields yet`;
      emptySubtitleEl.textContent = 'Add your first field to start auto-filling forms.';
      emptyAddBtn.hidden = false;
    }
    return;
  }

  fieldGridEl.hidden = false;
  emptyStateEl.hidden = true;
  list.forEach((field) => fieldGridEl.appendChild(renderCard(field)));
}

function render() {
  renderSidebar();
  renderGrid();
}

// ---------- Add / Edit modal ----------

function populateCategorySelect() {
  fieldCategorySelect.innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
}

function openModal(field) {
  editingFieldId = field ? field.id : null;
  modalTitle.textContent = field ? 'Edit Field' : 'Add Field';
  fieldLabelInput.value = field ? field.label : '';
  fieldValueInput.value = field ? field.value : '';
  fieldCategorySelect.value = field ? field.category : (searchQuery ? 'custom' : activeCategory);
  fieldKeywordsInput.value = field ? (field.keywords || []).join(', ') : '';
  fieldSensitiveCheckbox.checked = field ? !!field.sensitive : false;
  formError.hidden = true;

  modalOverlay.hidden = false;
  requestAnimationFrame(() => modalOverlay.classList.add('open'));
  fieldLabelInput.focus();
}

function closeModal() {
  modalOverlay.classList.remove('open');
  setTimeout(() => {
    modalOverlay.hidden = true;
  }, 180);
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const label = fieldLabelInput.value.trim();
  const value = fieldValueInput.value.trim();

  if (!label || !value) {
    formError.hidden = false;
    return;
  }
  formError.hidden = true;

  const payload = {
    label,
    value,
    category: fieldCategorySelect.value,
    keywords: parseKeywords(fieldKeywordsInput.value),
    sensitive: fieldSensitiveCheckbox.checked
  };

  if (editingFieldId) {
    const target = fields.find((f) => f.id === editingFieldId);
    Object.assign(target, payload);
  } else {
    fields.push({ id: crypto.randomUUID(), ...payload });
  }

  await saveFields();
  closeModal();
  activeCategory = payload.category;
  render();
  showToast('Field saved');
}

async function deleteField(field) {
  if (!confirm(`Delete "${field.label}"? This can't be undone.`)) return;
  fields = fields.filter((f) => f.id !== field.id);
  await saveFields();
  render();
  showToast('Field deleted', 'danger');
}

// ---------- Toasts ----------

function showToast(message, variant = 'success') {
  const el = document.createElement('div');
  el.className = `toast${variant === 'danger' ? ' toast-danger' : ''}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2400);
}

// ---------- Wiring ----------

addFieldBtn.addEventListener('click', () => openModal(null));
emptyAddBtn.addEventListener('click', () => openModal(null));
cancelBtn.addEventListener('click', closeModal);
modalCloseBtn.addEventListener('click', closeModal);
fieldForm.addEventListener('submit', handleFormSubmit);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  render();
});

(async function init() {
  populateCategorySelect();
  await loadFields();
  render();
})();
