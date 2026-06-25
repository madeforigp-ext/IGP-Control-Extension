(function() {
  'use strict';

  const FIELDS = {
    oid:     () => document.querySelector('#mat-input-2'),
    pkid:    () => document.querySelector('#mat-input-3'),
    sku:     () => document.querySelector('#mat-input-4'),
    barcode: () => document.querySelector('#mat-input-5'),
    filter: () => {
      const labels = document.querySelectorAll('mat-label');
      const label = Array.from(labels).find(l => l.textContent.trim().toLowerCase() === 'filter');
      if (!label) return null;
      const id = label.closest('mat-form-field')?.querySelector('input');
      return id || null;
    }
  };

  const findBtn = (label) => Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase().includes(label.toLowerCase()));

  const findTrolleyBtn = () => Array.from(document.querySelectorAll('button')).find(b => {
    const t = b.innerText.trim().toLowerCase();
    return t.includes('trolley complete') || t.includes('trolley start');
  });

  let hotkeys_enabled = true;
  let hotkey_fields = { oid: 'o', pkid: 'p', sku: 'k', barcode: 'b', filter: 'l' };
  let hotkey_buttons = { search: 's', clear: 'x', trolley_complete: 't', view_trolley: 'v', assembly: 'a' };

  let lastFocusedKey = null;

  function loadConfig() {
    chrome.storage.local.get(['hotkeys_enabled', 'hotkey_fields', 'hotkey_buttons'], (data) => {
      if (data.hotkeys_enabled !== undefined) {
        hotkeys_enabled = data.hotkeys_enabled;
      } else {
        hotkeys_enabled = true;
      }
      if (data.hotkey_fields) {
        hotkey_fields = { ...hotkey_fields, ...data.hotkey_fields };
      }
      if (data.hotkey_buttons) {
        hotkey_buttons = { ...hotkey_buttons, ...data.hotkey_buttons };
      }
    });
  }

  // Load configuration initially
  loadConfig();

  // Listen for config reload messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'hotkeys-reload') {
      loadConfig();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!hotkeys_enabled) return;

    // Do not intercept if browser modifier keys are active
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const active = document.activeElement;
    const activeTagName = active ? active.tagName.toUpperCase() : '';
    const isInputOrTextAreaFocused = activeTagName === 'INPUT' || activeTagName === 'TEXTAREA';

    const keyPressed = e.key.toLowerCase();

    // Check if the key corresponds to a Type A field hotkey
    let matchedFieldKey = null;
    for (const [fieldKey, hotkey] of Object.entries(hotkey_fields)) {
      if (keyPressed === hotkey.toLowerCase()) {
        matchedFieldKey = fieldKey;
        break;
      }
    }

    if (matchedFieldKey) {
      const el = FIELDS[matchedFieldKey]();
      if (!el) return;

      const isOwnFieldFocused = (active === el);

      // Skip if input/textarea is focused, unless it is its own field
      if (isInputOrTextAreaFocused && !isOwnFieldFocused) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (isOwnFieldFocused && lastFocusedKey === matchedFieldKey) {
        // 2nd press (same key, field still focused): clear + dispatch input + click search
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        const searchBtn = findBtn('search');
        if (searchBtn) {
          searchBtn.click();
        }
      } else {
        // 1st press: focus
        el.focus();
        lastFocusedKey = matchedFieldKey;
      }
      return;
    }

    // Skip Type B button hotkeys if any input/textarea is focused
    if (isInputOrTextAreaFocused) {
      return;
    }

    // Check if the key corresponds to a Type B button hotkey or custom button
    let matchedButtonKey = null;
    let matchedCustom = null;
    for (const [btnLabel, hotkey] of Object.entries(hotkey_buttons)) {
      const hkVal = (hotkey && typeof hotkey === 'object') ? hotkey.key : hotkey;
      if (hkVal && keyPressed === hkVal.toLowerCase()) {
        matchedButtonKey = btnLabel;
        if (hotkey && typeof hotkey === 'object') {
          matchedCustom = hotkey;
        }
        break;
      }
    }

    if (matchedButtonKey) {
      e.preventDefault();
      e.stopPropagation();

      // Reset last focused field key since we triggered a button hotkey
      lastFocusedKey = null;

      if (matchedCustom) {
        if (matchedCustom.selector?.startsWith('__text__:')) {
          const text = matchedCustom.selector.replace('__text__:', '');
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === text);
          if (btn) btn.click();
        } else {
          const btn = document.querySelector(matchedCustom.selector);
          if (btn) btn.click();
        }
      } else {
        let btn;
        if (matchedButtonKey === 'trolley_complete') {
          btn = findTrolleyBtn();
        } else {
          // Translate underscores to spaces for matching (e.g. trolley_complete -> trolley complete)
          const labelToFind = matchedButtonKey.replace(/_/g, ' ');
          btn = findBtn(labelToFind);
        }

        if (btn) {
          btn.click();
        }
      }
    }
  }, true); // Capture phase to intercept reliably

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'enable-picker') {
      document.body.style.cursor = 'crosshair';
      const highlight = (e) => e.target.style.outline = '2px solid #c0392b';
      const unhighlight = (e) => e.target.style.outline = '';
      const pick = (e) => {
        e.preventDefault(); e.stopPropagation();
        const el = e.target;
        el.style.outline = '';
        document.body.style.cursor = '';
        document.removeEventListener('mouseover', highlight, true);
        document.removeEventListener('mouseout', unhighlight, true);
        document.removeEventListener('click', pick, true);
        
        let target = e.target;
        // Walk up to find button, a, or [role="button"]
        while (target && !['BUTTON','A'].includes(target.tagName) && target.getAttribute?.('role') !== 'button') {
          target = target.parentElement;
          if (!target || target === document.body) { target = e.target; break; }
        }
        const btnText = target.innerText?.trim() || target.getAttribute('aria-label') || target.getAttribute('title') || '';
        const selector = `__text__:${btnText}`; // special prefix to indicate text-based matching
        const label = btnText.slice(0, 30) || 'Custom Button';

        chrome.runtime.sendMessage({ action: 'element-picked', selector, label });
      };
      document.addEventListener('mouseover', highlight, true);
      document.addEventListener('mouseout', unhighlight, true);
      document.addEventListener('click', pick, true);
    }
  });
})();
