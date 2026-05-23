// ─── IGP Control: QC Engine ──────────────────────────────────────────────────
// Optimized for performance, framework resilience, and scanner speed.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,  // ms to qualify as scanner
    TYPING_GAP_THRESHOLD: 400,  // ms to reset buffer
    SEARCH_DELAY: 400,          // ms to allow framework state to settle
    SHIELD_TIME: 800,           // ms to block duplicate Enters
    TOAST_DURATION: 2500
  };

  let state = {
    settings: { 
      qc_enabled: true, 
      qc_rightclick_enabled: true, 
      qc_routing_enabled: true, 
      qc_global_enabled: true,
      qc_autologin_enabled: true
    },
    scanBuffer: '',
    lastKeyTime: Date.now(),
    lastAutoSearchTime: 0,
    isProcessing: false,
    isRedirected: false
  };

  // High-performance local toggles for instant keydown response
  let qcEnabled = true;

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  const initSettings = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const keys = Object.keys(state.settings);
    
    // Initial Load
    chrome.storage.local.get(keys, (data) => {
      for (let key of keys) {
        if (data[key] !== undefined) state.settings[key] = data[key];
      }
      qcEnabled = state.settings.qc_enabled !== false;
    });

    // Lively Sync
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (let key in changes) {
        if (state.settings.hasOwnProperty(key)) {
          state.settings[key] = changes[key].newValue;
          if (key === 'qc_enabled') qcEnabled = changes[key].newValue !== false;
        }
      }
    });
  };
  initSettings();

  // ─── UTILS ─────────────────────────────────────────────────────────────────

  const getContext = () => {
    const url = window.location.href;
    const isQC = url.includes('qc-panel') || url.includes('/qc/') || url.includes('admin.joinventures.com');
    
    const settings = state.settings;
    return {
      isQC,
      isActive: isQC && (settings.qc_enabled !== false),
      routingEnabled: isQC && (settings.qc_routing_enabled !== false),
      globalEnabled: isQC && (settings.qc_global_enabled !== false),
      autoLoginEnabled: isQC && (settings.qc_autologin_enabled !== false)
    };
  };

  const findFields = () => {
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetWidth > 0);
    
    const patterns = {
      pkid: { pos: ['packet', 'pkid', 'pkt', 'scan', 'packetid', 'ip', 'individual'], neg: ['task', 'assignment', 'filter'] },
      tray: { pos: ['tray'], neg: ['filter'] },
      oid:  { pos: ['order', 'oid'], neg: ['filter'] },
      taskid: { pos: ['task', 'taskid'], neg: ['filter'] }
    };

    const findByPattern = (type) => {
      const { pos, neg } = patterns[type];
      // 1. Search attributes
      let field = allInputs.find(i => {
        const text = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.getAttribute('formcontrolname') || ''}`.toLowerCase();
        return pos.some(p => text.includes(p)) && !neg.some(n => text.includes(n));
      });

      // 2. Search labels/nearby text
      if (!field) {
        const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label, span, p'));
        for (let l of labels) {
          const txt = (l.innerText || l.textContent || "").toLowerCase();
          if (pos.some(p => txt.includes(p)) && !neg.some(n => txt.includes(n))) {
            const container = l.closest('mat-form-field, .form-group, .mat-form-field-wrapper, .mat-form-field-flex, td') || l.parentElement;
            if (container) {
              field = container.querySelector('input:not([type="hidden"])');
              if (field && field.offsetWidth > 0) break;
            }
          }
        }
      }
      return field;
    };

    let pkid = findByPattern('pkid');
    let tray = findByPattern('tray');
    let oid  = findByPattern('oid');
    let taskid = findByPattern('taskid');

    // Fallback for standard QC Panel
    const mats = allInputs.filter(i => i.classList.contains('mat-input-element'));
    pkid = pkid || mats[3] || mats[0];
    tray = tray || mats[1];
    oid = oid || mats[2];
    taskid = taskid || mats[0];

    return { pkid, tray, oid, taskid };
  };

  const forceUpdate = (el, val) => {
    if (!el) return;
    el.focus();
    el.value = '';
    el.select();
    document.execCommand('insertText', false, val);
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(evt => el.dispatchEvent(new Event(evt, { bubbles: true })));
  };

  const triggerSearch = (field) => {
    if (state.isProcessing) return;
    
    const ctx = getContext();
    if (!ctx.isActive || !ctx.routingEnabled) return;

    state.isProcessing = true;
    
    setTimeout(() => {
      const currentCtx = getContext();
      if (!currentCtx.isActive || !currentCtx.routingEnabled) {
        state.isProcessing = false;
        return;
      }

      // 1. Find a suitable container to search for buttons
      // Removed mat-form-field from closest as it's too narrow
      const container = field?.closest('form, mat-card, .search-container, table, td, .container, .main') || document.body;
      const btns = Array.from(container.querySelectorAll('button, input[type="button"], input[type="submit"], a.button'));
      const blacklist = ['profile', 'account', 'user', 'logout', 'settings', 'export', 'download', 'excel'];
      
      const isValid = (b) => {
        const txt = (b.innerText || b.value || b.name || b.id || "").toLowerCase();
        // Allow disabled buttons for discovery (we'll try to enable them)
        return !blacklist.some(k => txt.includes(k)) && b.offsetWidth > 0;
      };

      // Prioritize enabled buttons first
      let btn = btns.find(b => {
        const txt = (b.innerText || b.value || "").toLowerCase();
        return (txt === 'go' || txt === 'search' || txt.includes('find') || txt.includes('scan packet')) && isValid(b) && !b.disabled;
      });

      if (!btn) {
        btn = btns.find(b => {
          const txt = (b.innerText || b.value || "").toLowerCase();
          return (txt.includes('search') || txt.includes('go')) && isValid(b) && !b.disabled;
        });
      }

      // Fallback to disabled buttons if no enabled ones found
      if (!btn) {
        btn = btns.find(b => {
          const txt = (b.innerText || b.value || "").toLowerCase();
          return (txt === 'go' || txt === 'search' || txt.includes('find') || txt.includes('scan packet')) && isValid(b);
        });
      }

      if (btn) {
        state.lastAutoSearchTime = Date.now();
        if (btn.disabled) {
          btn.disabled = false;
          btn.removeAttribute('disabled');
        }
        btn.click();
      } else {
        // Framework-safe fallback: Trigger Enter key instead of form.submit() to avoid page reloads
        state.lastAutoSearchTime = Date.now();
        const enterEvt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
        field.dispatchEvent(new KeyboardEvent('keydown', enterEvt));
        field.dispatchEvent(new KeyboardEvent('keypress', enterEvt));
        field.dispatchEvent(new KeyboardEvent('keyup', enterEvt));
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  // ─── DYNAMIC LOGIC ─────────────────────────────────────────────────────────

  const identify = (val) => {
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    
    // Tray is usually 4 digits
    if (/^\d{4}$/.test(val)) return 'tray';

    // Generic PKID fallback for QC
    if (/^\d{7,14}$/.test(val)) return 'pkid';

    return null;
  };

  const handleAction = (val, type) => {
    const fields = findFields();
    const target = fields[type];
    if (target) {
      forceUpdate(target, val);
      triggerSearch(target);
    }
  };

  // ─── IMAGE ENHANCEMENT ─────────────────────────────────────────────────────

  document.addEventListener('contextmenu', (e) => {
    // Strict Toggle Check
    if (!qcEnabled) return;
    
    const ctx = getContext();
    if (!ctx.isActive || state.settings.qc_rightclick_enabled === false) return;

    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) {
      e.preventDefault();
      window.open(img.src, '_blank');
    }
  }, true);

  // ─── EVENT LISTENERS ───────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    // Master Toggle Check
    if (!qcEnabled) return;

    const ctx = getContext();
    // Entire feature set depends on isActive (which checks qc_enabled)
    if (!ctx.isActive) return;

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const now = Date.now();
    const gap = now - state.lastKeyTime;
    state.lastKeyTime = now;

    if (gap > CONFIG.TYPING_GAP_THRESHOLD) {
      state.scanBuffer = '';
      state.isRedirected = false;
    }

    if (e.key === 'Enter') {
      if (now - state.lastAutoSearchTime < CONFIG.SHIELD_TIME) {
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }

      // Strict Routing Toggle Check
      if (!ctx.routingEnabled) {
        state.scanBuffer = '';
        state.isRedirected = false;
        return;
      }

      const val = state.scanBuffer.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      let type = identify(val);
      
      // In QC, we only route Enter if it's a identified type (like tray or generic pkid)
      if (type) {
        e.preventDefault(); e.stopImmediatePropagation();
        handleAction(val, type);
        state.scanBuffer = '';
        state.isRedirected = false;
        return;
      }
      
      state.scanBuffer = '';
      state.isRedirected = false;
      return;
    }

    if (e.key.length === 1) {
      const activeTag = document.activeElement.tagName;
      const isFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      
      if (isFocused && gap > 150) {
         state.scanBuffer = '';
         state.isRedirected = false;
      }

      if (e.key === ' ' && state.scanBuffer.length === 0) return;

      state.scanBuffer += e.key;

      // Global Type Detection (Global Jump) - Strict Toggle Check
      if (ctx.globalEnabled && !state.isRedirected) {
        const prefix = state.scanBuffer.toUpperCase().trim();
        if (prefix.length === 0) return;
        
        // QC Global jump is usually for Tray (start typing 4 digits)
        if (prefix.length === 4 && /^\d{4}$/.test(prefix)) {
          const fields = findFields();
          const target = fields['tray'];
          if (target && document.activeElement !== target) {
            target.focus();
            target.value = prefix;
            if (target.setSelectionRange) target.setSelectionRange(prefix.length, prefix.length);
            state.isRedirected = true;
            e.preventDefault();
            return;
          }
        }
      }
    }
  }, true);

  // ─── AUTO LOGIN ────────────────────────────────────────────────────────────

  const checkAutoLogin = () => {
    const ctx = getContext();
    if (!ctx.isActive || !ctx.autoLoginEnabled) return;

    if (ctx.isQC) {
      const emailField = document.querySelector('input[formcontrolname="email"]');
      const passField = document.querySelector('input[formcontrolname="password"]');
      
      if (emailField && passField) {
        chrome.storage.local.get(['qc_user', 'qc_pass'], (d) => {
          if (!d.qc_user || !d.qc_pass) return;

          const setValue = (el, val) => {
            if (!el || !val) return;
            el.focus();
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          };

          setValue(emailField, d.qc_user);
          setValue(passField, d.qc_pass);
          
          setTimeout(() => {
            const currentCtx = getContext();
            if (!currentCtx.isActive || !currentCtx.autoLoginEnabled) return;
            const btn = document.querySelector('button[type="submit"]');
            if (btn && btn.innerText.toLowerCase().includes('sign in')) {
              btn.click();
            }
          }, 800);
        });
      }
    }
  };

  if (window.location.href.includes('admin.joinventures.com')) {
    const loginObserver = new MutationObserver(() => checkAutoLogin());
    loginObserver.observe(document.body, { childList: true, subtree: true });
  }
  checkAutoLogin();

})();
