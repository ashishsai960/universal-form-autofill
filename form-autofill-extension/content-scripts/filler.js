// filler.js — shared fill logic used on both generic pages and Google Forms.
// Loaded before detector.js / google-forms.js in every content script bundle.
// Reads the field registry those scripts populate on window.__autofillRegistry
// and performs the actual DOM writes when the side panel asks for a fill.

(() => {
  if (window.__autofillFillerInstalled) return;
  window.__autofillFillerInstalled = true;

  // Registry is a Map<fieldId, entry>. detector.js / google-forms.js own it.
  window.__autofillRegistry = window.__autofillRegistry || new Map();

  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set;

  // Sets a value the way a real user would type it, so React/Vue-style
  // controlled inputs (which listen at the prototype level) pick it up.
  function setNativeValue(el, value) {
    const setter = el.tagName === 'TEXTAREA' ? nativeTextareaSetter : nativeInputSetter;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function flash(el) {
    if (!el || !el.style) return;
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #4f7cff';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 900);
  }

  function fireClick(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function fillGenericEntry(entry, value) {
    const el = entry.element;
    if (!el || !document.contains(el)) return false;

    if (entry.tagName === 'select') {
      const options = Array.from(el.options);
      const exact = options.find((o) => o.value === value || o.textContent.trim() === value);
      if (exact) {
        el.value = exact.value;
      } else {
        const fuzzy = options.find((o) => o.textContent.trim().toLowerCase().includes(String(value).toLowerCase()));
        if (fuzzy) el.value = fuzzy.value;
        else return false;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el);
      return true;
    }

    if (entry.type === 'checkbox' || entry.type === 'radio') {
      const truthy = !['', 'false', 'no', '0'].includes(String(value).trim().toLowerCase());
      if (truthy && !el.checked) fireClick(el);
      flash(el);
      return true;
    }

    setNativeValue(el, value);
    flash(el);
    return true;
  }

  function fillGoogleFormsEntry(entry, value) {
    const container = entry.container;
    if (!container || !document.contains(container)) return false;

    if (entry.type === 'text') {
      const input = container.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type])');
      if (!input) return false;
      setNativeValue(input, value);
      flash(input);
      return true;
    }

    if (entry.type === 'textarea') {
      const textarea = container.querySelector('textarea');
      if (!textarea) return false;
      setNativeValue(textarea, value);
      flash(textarea);
      return true;
    }

    if (entry.type === 'radio' || entry.type === 'checkbox') {
      const roleSelector = entry.type === 'radio' ? 'div[role="radio"]' : 'div[role="checkbox"]';
      const options = Array.from(container.querySelectorAll(roleSelector));
      const target = options.find((opt) => {
        const label = (opt.getAttribute('aria-label') || opt.textContent || '').trim().toLowerCase();
        return label === String(value).trim().toLowerCase() || label.includes(String(value).trim().toLowerCase());
      });
      if (!target) return false;
      fireClick(target);
      flash(target);
      return true;
    }

    if (entry.type === 'dropdown') {
      const listbox = container.querySelector('div[role="listbox"]');
      if (!listbox) return false;
      fireClick(listbox);
      // Google Forms renders options asynchronously into an overlay after the
      // listbox is opened, so give it a beat before searching for the match.
      setTimeout(() => {
        const options = Array.from(document.querySelectorAll('div[role="option"]'));
        const target = options.find((opt) => (opt.textContent || '').trim().toLowerCase() === String(value).trim().toLowerCase());
        if (target) {
          fireClick(target);
          flash(listbox);
        }
      }, 150);
      return true;
    }

    return false;
  }

  function performFill(items) {
    for (const item of items) {
      const entry = window.__autofillRegistry.get(item.fieldId);
      if (!entry) continue;
      if (entry.source === 'google-forms') fillGoogleFormsEntry(entry, item.value);
      else fillGenericEntry(entry, item.value);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'PERFORM_FILL' && Array.isArray(message.items)) {
      performFill(message.items);
    }
  });
})();
