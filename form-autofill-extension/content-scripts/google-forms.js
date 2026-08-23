// google-forms.js — Google Forms specific field detection.
// Google Forms doesn't use <label>/<form> semantics; each question is a
// div[role="listitem"] with a custom heading and custom input widgets, so it
// needs its own adapter instead of the generic detector.

(() => {
  let fieldCounter = 0;

  function isRequired(container, heading) {
    // Google Forms marks required questions with an asterisk, usually in a
    // span carrying aria-label="Required question" near the heading.
    if (container.querySelector('[aria-label="Required question"]')) return true;
    const headingText = heading ? heading.textContent : '';
    return /\*\s*$/.test(headingText.trim());
  }

  function getQuestionText(container) {
    const heading = container.querySelector('div[role="heading"]');
    if (!heading) return '';
    // Strip a trailing "*" required marker from the visible text.
    return heading.textContent.replace(/\*\s*$/, '').trim();
  }

  function collectOptionTexts(container, roleSelector) {
    return Array.from(container.querySelectorAll(roleSelector)).map((opt) =>
      (opt.getAttribute('aria-label') || opt.textContent || '').trim()
    );
  }

  function detectFieldType(container) {
    if (container.querySelector('div[role="radio"]')) return 'radio';
    if (container.querySelector('div[role="checkbox"]')) return 'checkbox';
    if (container.querySelector('div[role="listbox"]')) return 'dropdown';
    if (container.querySelector('textarea')) return 'textarea';
    if (container.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type])')) {
      return 'text';
    }
    return null;
  }

  function scanFields() {
    const registry = window.__autofillRegistry;
    registry.clear();

    const containers = document.querySelectorAll('div[role="listitem"]');
    const fields = [];

    containers.forEach((container) => {
      const heading = container.querySelector('div[role="heading"]');
      const type = detectFieldType(container);
      if (!type) return; // section headers / plain text blocks, nothing to fill

      const id = `gf-${fieldCounter++}`;
      let options = null;
      if (type === 'radio') options = collectOptionTexts(container, 'div[role="radio"]');
      if (type === 'checkbox') options = collectOptionTexts(container, 'div[role="checkbox"]');
      if (type === 'dropdown') options = collectOptionTexts(container, 'div[role="option"]');

      registry.set(id, { source: 'google-forms', container, type });

      fields.push({
        id,
        source: 'google-forms',
        label: getQuestionText(container),
        type,
        required: isRequired(container, heading),
        options
      });
    });

    if (fields.length > 0) {
      chrome.runtime.sendMessage({
        type: 'FIELDS_DETECTED',
        source: 'google-forms',
        fields,
        url: location.href,
        title: document.title
      });
    }
  }

  let rescanTimer = null;
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scanFields, 400);
  }

  // Multi-page Google Forms swap question content in place, so keep watching.
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => m.addedNodes.length > 0 || m.removedNodes.length > 0);
    if (relevant) scheduleRescan();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  scanFields();
})();
