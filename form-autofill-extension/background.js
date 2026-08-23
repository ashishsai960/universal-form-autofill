// background.js — MV3 service worker
// Responsibilities: seed default profile, receive detected fields from content
// scripts, run the lightweight matching engine, cache per-tab results, and
// relay fill commands from the side panel back to the right tab.

const DEFAULT_PROFILE_FIELDS = [
  { category: 'identity', label: 'Full Name', keywords: ['full name', 'name', 'your name', 'fullname'] },
  { category: 'identity', label: 'First Name', keywords: ['first name', 'given name', 'fname', 'forename'] },
  { category: 'identity', label: 'Last Name', keywords: ['last name', 'surname', 'family name', 'lname'] },
  { category: 'identity', label: 'Email', keywords: ['email', 'email address', 'e-mail'] },
  { category: 'identity', label: 'Phone Number', keywords: ['phone', 'phone number', 'mobile', 'contact number', 'telephone', 'cell'] },
  { category: 'identity', label: 'Address', keywords: ['address', 'street address', 'home address', 'mailing address'] },
  { category: 'identity', label: 'City', keywords: ['city', 'town'] },
  { category: 'identity', label: 'Pincode/Zip', keywords: ['pincode', 'zip', 'zip code', 'postal code', 'postcode'] },
  { category: 'professional', label: 'LinkedIn URL', keywords: ['linkedin', 'linkedin url', 'linkedin profile'] },
  { category: 'professional', label: 'GitHub URL', keywords: ['github', 'github url', 'github profile'] },
  { category: 'professional', label: 'Portfolio URL', keywords: ['portfolio', 'website', 'portfolio url', 'personal website'] },
  { category: 'documents', label: 'Resume Link', keywords: ['resume', 'cv', 'resume link', 'resume url', 'curriculum vitae'] },
  { category: 'professional', label: 'Current Company', keywords: ['current company', 'employer', 'company name', 'organization'] },
  { category: 'professional', label: 'College/University', keywords: ['college', 'university', 'school', 'institution', 'alma mater'] },
  { category: 'professional', label: 'Bio/About Me', keywords: ['bio', 'about me', 'summary', 'about you', 'tell us about yourself'] }
].map((f, i) => ({
  id: `default-${i}`,
  category: f.category,
  label: f.label,
  value: '',
  keywords: f.keywords,
  sensitive: false
}));

// Maps common autocomplete tokens to a synthetic label used only for matching.
const AUTOCOMPLETE_HINTS = {
  name: 'full name',
  'given-name': 'first name',
  'family-name': 'last name',
  email: 'email',
  tel: 'phone number',
  'tel-national': 'phone number',
  'street-address': 'address',
  'address-line1': 'address',
  'address-level2': 'city',
  'postal-code': 'pincode zip',
  url: 'portfolio url',
  organization: 'current company'
};

// In-memory cache of per-tab detection results. Mirrored to
// chrome.storage.session so data survives a service worker restart.
const tabData = new Map();

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getProfileFields() {
  const { profileFields } = await chrome.storage.local.get('profileFields');
  return profileFields || [];
}

async function ensureProfileSeeded() {
  const { profileFields } = await chrome.storage.local.get('profileFields');
  if (!profileFields) {
    await chrome.storage.local.set({ profileFields: DEFAULT_PROFILE_FIELDS });
  }
}

// Scores one detected field against one profile field. Higher is better.
function scoreField(signals, profileField) {
  const profileLabel = normalize(profileField.label);
  const keywords = (profileField.keywords || []).map(normalize);
  let best = 0;

  for (const raw of signals) {
    const signal = normalize(raw);
    if (!signal) continue;

    if (signal === profileLabel) best = Math.max(best, 12);
    else if (signal.includes(profileLabel) || profileLabel.includes(signal)) best = Math.max(best, 7);

    for (const kw of keywords) {
      if (!kw) continue;
      if (signal === kw) best = Math.max(best, 10);
      else if (signal.includes(kw) || kw.includes(signal)) best = Math.max(best, 5);
    }
  }
  return best;
}

function buildSignals(field) {
  const signals = [field.label, field.name, field.htmlId, field.placeholder];
  if (field.autocomplete && AUTOCOMPLETE_HINTS[field.autocomplete]) {
    signals.push(AUTOCOMPLETE_HINTS[field.autocomplete]);
  }
  return signals.filter(Boolean);
}

const MATCH_THRESHOLD = 5;

function matchFields(detectedFields, profileFields) {
  const matched = [];
  const unmatched = [];

  for (const field of detectedFields) {
    const signals = buildSignals(field);
    let bestField = null;
    let bestScore = 0;

    for (const profileField of profileFields) {
      const s = scoreField(signals, profileField);
      if (s > bestScore) {
        bestScore = s;
        bestField = profileField;
      }
    }

    if (bestField && bestScore >= MATCH_THRESHOLD) {
      matched.push({
        fieldId: field.id,
        source: field.source,
        detectedLabel: field.label,
        options: field.options || null,
        profileFieldId: bestField.id,
        profileLabel: bestField.label,
        value: bestField.value,
        sensitive: !!bestField.sensitive,
        confidence: bestScore
      });
    } else {
      unmatched.push({
        fieldId: field.id,
        source: field.source,
        detectedLabel: field.label,
        options: field.options || null
      });
    }
  }

  return { matched, unmatched };
}

async function persistTabData(tabId, data) {
  tabData.set(tabId, data);
  await chrome.storage.session.set({ [`tab_${tabId}`]: data });
}

async function loadTabData(tabId) {
  if (tabData.has(tabId)) return tabData.get(tabId);
  const key = `tab_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  if (stored[key]) {
    tabData.set(tabId, stored[key]);
    return stored[key];
  }
  return null;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureProfileSeeded();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureProfileSeeded();
});

// Clear stale results when a tab navigates, so the side panel doesn't show
// fields from the page the user just left.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabData.delete(tabId);
    chrome.storage.session.remove(`tab_${tabId}`);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabData.delete(tabId);
  chrome.storage.session.remove(`tab_${tabId}`);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'FIELDS_DETECTED') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return false;

    (async () => {
      const profileFields = await getProfileFields();
      const { matched, unmatched } = matchFields(message.fields || [], profileFields);
      const data = {
        source: message.source,
        url: message.url,
        title: message.title,
        matched,
        unmatched,
        detectedAt: Date.now()
      };
      await persistTabData(tabId, data);
      // Let an open side panel know fresh data is available.
      chrome.runtime.sendMessage({ type: 'FIELDS_UPDATED', tabId }).catch(() => {});
    })();
    return false;
  }

  if (message.type === 'GET_MATCHES') {
    (async () => {
      const data = await loadTabData(message.tabId);
      sendResponse(data);
    })();
    return true; // async response
  }

  if (message.type === 'MANUAL_MATCH') {
    (async () => {
      const data = await loadTabData(message.tabId);
      if (!data) return sendResponse({ ok: false });
      const idx = data.unmatched.findIndex((f) => f.fieldId === message.fieldId);
      if (idx === -1) return sendResponse({ ok: false });
      const [field] = data.unmatched.splice(idx, 1);
      data.matched.push({
        fieldId: field.fieldId,
        source: field.source,
        detectedLabel: field.detectedLabel,
        options: field.options || null,
        profileFieldId: message.profileFieldId,
        profileLabel: message.profileLabel,
        value: message.value,
        sensitive: !!message.sensitive,
        confidence: 0
      });
      await persistTabData(message.tabId, data);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'FILL_REQUEST') {
    chrome.tabs.sendMessage(message.tabId, { type: 'PERFORM_FILL', items: message.items }).catch(() => {});
    return false;
  }

  return false;
});
