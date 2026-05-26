// ─── IGP Control: QC Engine ──────────────────────────────────────────────────
// Optimized for performance, framework resilience, and scanner speed.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,  // ms to qualify as scanner
    TYPING_GAP_THRESHOLD: 400,  // ms to reset buffer
    SEARCH_DELAY: 400,          // ms to allow framework state to settle
    SHIELD_TIME: 800,           // ms to block duplicate Enters
    TOAST_DURATION: 2500,
    SKU_REFRESH_INTERVAL: 2000
  };

  let state = {
    settings: { 
      qc_enabled: true, 
      qc_rightclick_enabled: true, 
      qc_routing_enabled: true, 
      qc_global_enabled: true,
      qc_autologin_enabled: true
    },
    trackedSKUs: [],
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
    chrome.storage.local.get([...keys, 'trackedSKUs'], (data) => {
      for (let key of keys) {
        if (data[key] !== undefined) state.settings[key] = data[key];
      }
      state.trackedSKUs = data.trackedSKUs || [];
      qcEnabled = state.settings.qc_enabled !== false;
      processSKUs();
    });

    // Lively Sync
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (let key in changes) {
        if (state.settings.hasOwnProperty(key)) {
          state.settings[key] = changes[key].newValue;
          if (key === 'qc_enabled') qcEnabled = changes[key].newValue !== false;
        }
        if (key === 'trackedSKUs') {
          state.trackedSKUs = changes[key].newValue || [];
          processSKUs();
        }
      }
    });
  };
  initSettings();

  // ─── UTILS ─────────────────────────────────────────────────────────────────

  const getContext = () => {
    const url = window.location.href;
    
    // 1. Scanner & Routing (Strictly restricted to prevent "bugging out" other panels)
    const isQCScannerPath = url.includes('qc-panel') || url.includes('/qc/');
    
    // 2. Image Feature (Designated Global Panels)
    const isQCPanel = url.includes('/personalization/qc-panel');
    const isSQCPanel = url.includes('/order-mgmt-panel/super-qc');
    const isIntermesh = url.includes('orders_vendor.php') || url.includes('persInfo.php');
    const isImageFeatureActive = isQCPanel || isSQCPanel || isIntermesh;
    
    // 3. Domain Check for Auto-Login
    const isJV = url.includes('joinventures.com');
    const isIGP = url.includes('indiangiftsportal.com');
    const isSupportedDomain = isJV || isIGP;

    const settings = state.settings;
    return {
      isScannerPath: isQCScannerPath,
      isImageFeatureActive,
      isJV,
      isSupportedDomain,
      isActive: isSupportedDomain && (settings.qc_enabled !== false),
      routingEnabled: isQCScannerPath && (settings.qc_routing_enabled !== false),
      globalEnabled: isQCScannerPath && (settings.qc_global_enabled !== false),
      autoLoginEnabled: isJV && (settings.qc_autologin_enabled !== false)
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

      const container = field?.closest('form, mat-card, .search-container, table, td, .container, .main') || document.body;
      const btns = Array.from(container.querySelectorAll('button, input[type="button"], input[type="submit"], a.button'));
      const blacklist = ['profile', 'account', 'user', 'logout', 'settings', 'export', 'download', 'excel'];
      
      const isValid = (b) => {
        const txt = (b.innerText || b.value || b.name || b.id || "").toLowerCase();
        return !blacklist.some(k => txt.includes(k)) && b.offsetWidth > 0;
      };

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
        state.lastAutoSearchTime = Date.now();
        const enterEvt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
        field.dispatchEvent(new KeyboardEvent('keydown', enterEvt));
        field.dispatchEvent(new KeyboardEvent('keypress', enterEvt));
        field.dispatchEvent(new KeyboardEvent('keyup', enterEvt));
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  // ─── SKU TRACKING & HIGHLIGHTING ───────────────────────────────────────────

  const getSummaryWidget = () => {
    let widget = document.getElementById('igp-sku-summary');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'igp-sku-summary';
      Object.assign(widget.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '2147483647',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '10px 16px',
        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '13px',
        color: '#1e293b',
        display: 'none',
        flexDirection: 'column',
        gap: '6px',
        backdropFilter: 'blur(8px)',
        minWidth: '140px'
      });
      document.body.appendChild(widget);
    }
    return widget;
  };

  const processSKUs = () => {
    if (!qcEnabled) {
      const widget = document.getElementById('igp-sku-summary');
      if (widget) widget.style.display = 'none';
      return;
    }

    const rows = document.querySelectorAll('mat-row');
    const counts = {};
    state.trackedSKUs.forEach(s => counts[s.sku] = 0);

    rows.forEach(row => {
      const taskIdEl = row.querySelector('.task-id');
      if (!taskIdEl) return;

      const fullId = taskIdEl.textContent.trim();
      const parts = fullId.split('-');
      if (parts.length >= 3) {
        const sku = parts[2];
        const tracked = state.trackedSKUs.find(s => s.sku === sku);
        if (tracked) {
          counts[sku]++;
          taskIdEl.style.backgroundColor = tracked.color;
          taskIdEl.style.color = '#fff';
          taskIdEl.style.padding = '2px 6px';
          taskIdEl.style.borderRadius = '4px';
          taskIdEl.style.fontWeight = 'bold';
        } else {
          taskIdEl.style.backgroundColor = '';
          taskIdEl.style.color = '';
          taskIdEl.style.padding = '';
          taskIdEl.style.borderRadius = '';
          taskIdEl.style.fontWeight = '';
        }
      }
    });

    const widget = getSummaryWidget();
    const activeTracked = state.trackedSKUs.filter(s => counts[s.sku] > 0);
    
    if (activeTracked.length > 0) {
      widget.style.display = 'flex';
      widget.innerHTML = `
        <div style="font-weight: 700; color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-bottom: 2px;">Tracked Items</div>
        ${activeTracked.map(s => `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${s.color};"></span>
              <span style="font-weight: 500;">${s.name}</span>
            </span>
            <span style="background: #f1f5f9; padding: 2px 8px; border-radius: 20px; font-weight: 700; color: ${s.color}; min-width: 24px; text-align: center;">${counts[s.sku]}</span>
          </div>
        `).join('')}
      `;
    } else {
      widget.style.display = 'none';
    }
  };

  // ─── DYNAMIC LOGIC ─────────────────────────────────────────────────────────

  const identify = (val) => {
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    if (/^\d{4}$/.test(val)) return 'tray';
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
    if (!qcEnabled) return;
    
    const ctx = getContext();
    if (!ctx.isActive || !ctx.isImageFeatureActive || state.settings.qc_rightclick_enabled === false) return;

    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) {
      e.preventDefault();
      let targetUrl = img.src;
      const optStrings = ['f_auto,q_auto,t_pnopt3prodlp', 'f_auto,q_auto,t_pnopt4prodlp'];
      
      optStrings.forEach(s => {
        if (targetUrl.includes(s)) {
          targetUrl = targetUrl.split(s + '/').join('').split(s).join('');
        }
      });
      
      targetUrl = targetUrl.replace(/([^:])\/\//g, '$1/');
      window.open(targetUrl + '#igp-qc', '_blank');
    }
  }, true);

  // ─── EVENT LISTENERS ───────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (!qcEnabled) return;

    const ctx = getContext();
    if (!ctx.isActive || !ctx.isScannerPath) return;

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

      if (!ctx.routingEnabled) {
        state.scanBuffer = '';
        state.isRedirected = false;
        return;
      }

      const val = state.scanBuffer.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      let type = identify(val);
      
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

      if (ctx.globalEnabled && !state.isRedirected) {
        const prefix = state.scanBuffer.toUpperCase().trim();
        if (prefix.length === 0) return;
        
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
  };

  const currentHost = window.location.hostname;
  if (currentHost.includes('joinventures.com') || currentHost.includes('indiangiftsportal.com')) {
    const observer = new MutationObserver((mutations) => {
      checkAutoLogin();
      const hasNewRows = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeName === 'MAT-ROW' || (n.querySelectorAll && n.querySelectorAll('mat-row').length > 0)));
      if (hasNewRows) processSKUs();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    processSKUs();
    setInterval(processSKUs, CONFIG.SKU_REFRESH_INTERVAL);
  }
  checkAutoLogin();

})();
