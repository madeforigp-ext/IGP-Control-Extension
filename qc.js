// ─── IGP Control: Unified QC & Intermesh Engine ──────────────────────────────
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
      qc_autologin_enabled: true,
      intermesh_enabled: true, 
      intermesh_routing_enabled: true,
      intermesh_global_enabled: true, 
      autologin_enabled: true,
      pattern_pkid_prefix: '12,IP',
      pattern_pkid_len: 14,
      pattern_oid_prefix: '183',
      pattern_oid_len: 10
    },
    scanBuffer: '',
    lastKeyTime: Date.now(),
    lastAutoSearchTime: 0,
    isProcessing: false,
    isRedirected: false
  };

  // High-performance local toggles for instant keydown response
  let intermeshEnabled = true;
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
      intermeshEnabled = state.settings.intermesh_enabled !== false;
      qcEnabled = state.settings.qc_enabled !== false;
    });

    // Lively Sync
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (let key in changes) {
        if (state.settings.hasOwnProperty(key)) {
          state.settings[key] = changes[key].newValue;
          if (key === 'intermesh_enabled') intermeshEnabled = changes[key].newValue !== false;
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
    const isIGP = url.includes('indiangiftsportal.com') && !isQC;
    
    const settings = state.settings;
    return {
      isQC,
      isIGP,
      isActive: isQC ? (settings.qc_enabled !== false) : (isIGP ? (settings.intermesh_enabled !== false) : false),
      routingEnabled: isQC ? (settings.qc_routing_enabled !== false) : (isIGP ? (settings.intermesh_routing_enabled !== false) : false),
      globalEnabled: isQC ? (settings.qc_global_enabled !== false) : (isIGP ? (settings.intermesh_global_enabled !== false) : false),
      autoLoginEnabled: isQC ? (settings.qc_autologin_enabled !== false) : (isIGP ? (settings.autologin_enabled !== false) : false)
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

    // Intermesh Specific Fallbacks
    if (!pkid) pkid = document.querySelector('input[name="packetid"]');
    if (!oid) oid = document.querySelector('input[name="orderid"], input[name="order_id"], input[name="v_oid"]');

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

      const container = field?.closest('form, mat-card, .search-container, .mat-form-field, table, td') || document.body;
      const btns = Array.from(container.querySelectorAll('button, input[type="button"], input[type="submit"], a.button'));
      const blacklist = ['profile', 'account', 'user', 'logout', 'settings', 'export', 'download', 'excel'];
      
      const isValid = (b) => {
        const txt = (b.innerText || b.value || b.name || b.id || "").toLowerCase();
        return !blacklist.some(k => txt.includes(k)) && !b.disabled && b.offsetWidth > 0;
      };

      let btn = btns.find(b => {
        const txt = (b.innerText || b.value || "").toLowerCase();
        return (txt === 'go' || txt === 'search' || txt.includes('find') || txt.includes('scan packet')) && isValid(b);
      });

      if (!btn) {
        btn = btns.find(b => {
          const txt = (b.innerText || b.value || "").toLowerCase();
          return (txt.includes('search') || txt.includes('go')) && isValid(b);
        });
      }

      if (btn) {
        state.lastAutoSearchTime = Date.now();
        btn.click();
      } else if (field?.form) {
        state.lastAutoSearchTime = Date.now();
        field.form.submit();
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  // ─── DYNAMIC LOGIC ─────────────────────────────────────────────────────────

  const identify = (val) => {
    // Strictly clean: only alphanumeric characters are allowed as per patterns
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    
    // Tray is usually 4 digits
    if (/^\d{4}$/.test(val)) return 'tray';

    // OID Patterns (Priority over generic digits)
    const oidPrefixes = state.settings.pattern_oid_prefix.split(',').map(p => p.trim().toUpperCase());
    const oidMax = state.settings.pattern_oid_len;
    if (oidPrefixes.some(p => val.startsWith(p)) && val.length <= oidMax) return 'oid';

    // PKID Patterns
    const pkPrefixes = state.settings.pattern_pkid_prefix.split(',').map(p => p.trim().toUpperCase());
    const pkMax = state.settings.pattern_pkid_len;
    if (pkPrefixes.some(p => val.startsWith(p)) && val.length <= pkMax) return 'pkid';
    
    // Generic PKID fallback
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
    const ctx = getContext();
    if (!ctx.isQC || !ctx.isActive || state.settings.qc_rightclick_enabled === false) return;

    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) {
      e.preventDefault();
      window.open(img.src, '_blank');
    }
  }, true);

  // ─── EVENT LISTENERS ───────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    // Master Toggle Check (Instant response)
    const url = window.location.href;
    if (url.includes('indiangiftsportal.com')) {
       if (url.includes('admin.joinventures.com') || url.includes('qc-panel') || url.includes('/qc/')) {
          if (!qcEnabled) return;
       } else if (!intermeshEnabled) {
          return;
       }
    }

    const ctx = getContext();
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

      if (!ctx.routingEnabled || ctx.isIGP) return; // Skip routing for IGP

      const val = state.scanBuffer.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      let type = identify(val);
      
      if (ctx.isQC && (type === 'pkid' || type === 'oid')) type = null;
      
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
      
      // If focused, only allow jump if it's a fast scanner or a deliberate prefix
      if (isFocused && gap > 150) {
         // Reset buffer if focused and typing slowly (manual entry in field)
         state.scanBuffer = '';
         state.isRedirected = false;
      }

      if (e.key === ' ' && state.scanBuffer.length === 0) return;

      state.scanBuffer += e.key;

      if (ctx.globalEnabled && !state.isRedirected) {
        const prefix = state.scanBuffer.toUpperCase().trim();
        if (prefix.length === 0) return;
        
        let jumpType = null;
        if (ctx.isQC) {
          jumpType = 'tray';
        } else {
          const pkPrefixes = state.settings.pattern_pkid_prefix.split(',').map(p => p.trim().toUpperCase());
          const oidPrefixes = state.settings.pattern_oid_prefix.split(',').map(p => p.trim().toUpperCase());
          
          // Check for exact prefix match
          if (pkPrefixes.includes(prefix)) jumpType = 'pkid';
          else if (oidPrefixes.includes(prefix)) jumpType = 'oid';
          
          // Check for partial prefix match (ambiguity handling)
          if (!jumpType) {
            const pkMatch = pkPrefixes.some(p => p.startsWith(prefix) && p !== prefix);
            const oidMatch = oidPrefixes.some(p => p.startsWith(prefix) && p !== prefix);
            if (pkMatch || oidMatch) return; // Wait for more characters
          }
        }

        if (jumpType) {
          const fields = findFields();
          const target = fields[jumpType];
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

      if (ctx.isIGP && ctx.routingEnabled && !state.isRedirected) {
        // Scan Routing scrapped for Intermesh
        return;
      }
    }
  }, true);

  // ─── AUTO LOGIN ────────────────────────────────────────────────────────────

  const checkAutoLogin = () => {
    const ctx = getContext();
    if (!ctx.isActive || !ctx.autoLoginEnabled) return;

    if (ctx.isIGP) {
      const body = document.body.innerText;
      if (!body.includes('Please enter your User Name')) return;

      if (body.toLowerCase().match(/invalid|incorrect|failed/)) {
        chrome.storage.local.set({ autologin_enabled: false });
        showToast('⛔ Auto-Login Failed. Disabled.');
        return;
      }

      chrome.storage.local.get(['igp_associate', 'igp_user', 'igp_pass'], (d) => {
        if (!d.igp_user || !d.igp_pass) return;
        
        const assoc = document.querySelector('input[name="v_name"]');
        const user  = document.querySelector('input[name="usr_name"]');
        const pass  = document.querySelector('input[name="usr_pass"]');
        
        const setValue = (el, val) => {
          if (!el || !val) return;
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (assoc) setValue(assoc, d.igp_associate);
        if (user) setValue(user, d.igp_user);
        if (pass) setValue(pass, d.igp_pass);
        
        setTimeout(() => {
          const currentCtx = getContext();
          if (!currentCtx.isActive || !currentCtx.autoLoginEnabled) return;
          const btn = document.querySelector('input[name="Submit1"]');
          if (btn) btn.click();
        }, 800);
      });
    }

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

  // Run auto-login
  if (window.location.href.includes('admin.joinventures.com')) {
    const loginObserver = new MutationObserver(() => checkAutoLogin());
    loginObserver.observe(document.body, { childList: true, subtree: true });
  }
  checkAutoLogin();

  function showToast(txt) {
    const div = document.createElement('div');
    div.textContent = txt;
    Object.assign(div.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: '#c0392b', color: '#fff', padding: '15px 30px', borderRadius: '5px',
      zIndex: '2147483647', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), CONFIG.TOAST_DURATION);
  }

})();
