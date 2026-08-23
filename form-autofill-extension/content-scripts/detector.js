// detector.js — generic HTML form field detection.
// Runs on every page except docs.google.com/forms (handled by google-forms.js).
// Finds input/textarea/select elements, works out the best human-readable
// label for each, and reports the list to the background service worker.

(() => {
  if (location.hostname === 'docs.google.com' && location.pathname.startsWith('/forms/')) {
    return; // google-forms.js owns this surface
  }

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
  let fieldCounter = 0;

  function resolveLabelFor(el) {
    if (el.id) {
      const escaped = CSS.escape(el.id);
      const label = document.querySelector(`label[for="${escaped}"]`);
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    return null;
  }

  function resolveParentLabel(el) {
    const label = el.closest('label');
    if (label && label.textContent.trim()) return label.textContent.trim();
    return null;
  }

  function resolveAriaLabelledBy(el) {
    const ref = el.getAttribute('aria-labelledby');
    if (!ref) return null;
    const text = ref
      .split(/\s+/)
      .map((id) => {
        const node = document.getElementById(id);
        return node ? node.textContent.trim() : '';
      })
      .filter(Boolean)
      .join(' ');
    return text || null;
  }

  function findPrecedingText(el) {
    let node = el.previousSibling;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent.trim().slice(0, 120);
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim()) {
        return node.textContent.trim().slice(0, 120);
      }
      node = node.previousSibling;
    }
    // Climb a few ancestor levels looking for a preceding heading/text block.
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      const sibling = parent.previousElementSibling;
      if (sibling && sibling.textContent.trim()) {
        return sibling.textContent.trim().slice(0, 120);
      }
      parent = parent.parentElement;
      depth++;
    }
    return '';
  }

  function getFieldLabel(el) {
    return (
      resolveLabelFor(el) ||
      resolveParentLabel(el) ||
      el.getAttribute('aria-label') ||
      resolveAriaLabelledBy(el) ||
      el.getAttribute('placeholder') ||
      findPrecedingText(el) ||
      ''
    );
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || 'text').toLowerCase())) return false;
    return true;
  }

  function scanFields() {
    const registry = window.__autofillRegistry;
    registry.clear();

    const nodeList = document.querySelectorAll('input, textarea, select');
    const fields = [];

    nodeList.forEach((el) => {
      if (!isFillable(el)) return;

      const id = `f-${fieldCounter++}`;
      const tagName = el.tagName.toLowerCase();
      const type = tagName === 'input' ? (el.type || 'text').toLowerCase() : tagName;

      registry.set(id, { source: 'generic', element: el, tagName, type });

      fields.push({
        id,
        source: 'generic',
        label: getFieldLabel(el),
        name: el.name || '',
        htmlId: el.id || '',
        type,
        autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.getAttribute('placeholder') || ''
      });
    });

    if (fields.length > 0) {
      chrome.runtime.sendMessage({
        type: 'FIELDS_DETECTED',
        source: 'generic',
        fields,
        url: location.href,
        title: document.title
      });
    }
  }

  // Debounced re-scan so bursts of DOM mutations (SPA renders) only trigger
  // one rescan instead of one per mutation.
  let rescanTimer = null;
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scanFields, 400);
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => m.addedNodes.length > 0 || m.removedNodes.length > 0);
    if (relevant) scheduleRescan();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  scanFields();
})();
