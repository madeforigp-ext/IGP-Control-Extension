// ─── IGP Control: QC Engine ──────────────────────────────────────────────────
// Optimized for performance, framework resilience, and scanner speed.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,
    TYPING_GAP_THRESHOLD: 400,
    SEARCH_DELAY: 400,
    SHIELD_TIME: 800,
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
    trackedGroups: [],
    scanBuffer: '',
    lastKeyTime: Date.now(),
    lastAutoSearchTime: 0,
    isProcessing: false,
    isRedirected: false,
    widgetExpanded: true,
    openGroupIds: [] // Track which groups are expanded inside the widget
  };

  let qcEnabled = true;

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  const initSettings = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const keys = Object.keys(state.settings);
    
    chrome.storage.local.get([...keys, 'trackedGroups', 'widgetExpanded'], (data) => {
      for (let key of keys) if (data[key] !== undefined) state.settings[key] = data[key];
      state.trackedGroups = data.trackedGroups || [];
      state.widgetExpanded = data.widgetExpanded !== false;
      qcEnabled = state.settings.qc_enabled !== false;
      processSKUs();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (let key in changes) {
        if (state.settings.hasOwnProperty(key)) {
          state.settings[key] = changes[key].newValue;
          if (key === 'qc_enabled') qcEnabled = changes[key].newValue !== false;
        }
        if (key === 'trackedGroups') {
          state.trackedGroups = changes[key].newValue || [];
          processSKUs();
        }
      }
    });

    // Global Click-to-Close Widget logic
    document.addEventListener('click', (e) => {
      if (!state.widgetExpanded) return;
      const widget = document.getElementById('igp-sku-summary');
      if (widget && !widget.contains(e.target)) {
        state.widgetExpanded = false;
        chrome.storage.local.set({ widgetExpanded: false });
        processSKUs();
      }
    });
  };
  initSettings();

  // ─── UTILS ─────────────────────────────────────────────────────────────────

  const getContext = () => {
    const url = window.location.href;
    const isQCScannerPath = url.includes('qc-panel') || url.includes('/qc/');
    const isQCPanel = url.includes('/personalization/qc-panel');
    const isSQCPanel = url.includes('/order-mgmt-panel/super-qc');
    const isIntermesh = url.includes('orders_vendor.php') || url.includes('persInfo.php');
    const isImageFeatureActive = isQCPanel || isSQCPanel || isIntermesh;
    const isJV = url.includes('joinventures.com');
    const isIGP = url.includes('indiangiftsportal.com');
    const isSupportedDomain = isJV || isIGP;

    const settings = state.settings;
    return {
      isScannerPath: isQCScannerPath,
      isImageFeatureActive,
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
      let field = allInputs.find(i => {
        const text = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.getAttribute('formcontrolname') || ''}`.toLowerCase();
        return pos.some(p => text.includes(p)) && !neg.some(n => text.includes(n));
      });
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
    let pkid = findByPattern('pkid'), tray = findByPattern('tray'), oid  = findByPattern('oid'), taskid = findByPattern('taskid');
    const mats = allInputs.filter(i => i.classList.contains('mat-input-element'));
    pkid = pkid || mats[3] || mats[0]; tray = tray || mats[1]; oid = oid || mats[2]; taskid = taskid || mats[0];
    return { pkid, tray, oid, taskid };
  };

  const forceUpdate = (el, val) => {
    if (!el) return;
    el.focus(); el.value = ''; el.select();
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
      if (!currentCtx.isActive || !currentCtx.routingEnabled) { state.isProcessing = false; return; }
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
      if (!btn) btn = btns.find(b => { const txt = (b.innerText || b.value || "").toLowerCase(); return (txt.includes('search') || txt.includes('go')) && isValid(b) && !b.disabled; });
      if (!btn) btn = btns.find(b => { const txt = (b.innerText || b.value || "").toLowerCase(); return (txt === 'go' || txt === 'search' || txt.includes('find') || txt.includes('scan packet')) && isValid(b); });
      if (btn) {
        state.lastAutoSearchTime = Date.now();
        if (btn.disabled) { btn.disabled = false; btn.removeAttribute('disabled'); }
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

  // ─── SKU TRACKING & HIGHLIGHTING (V3) ──────────────────────────────────────

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
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
        fontFamily: 'Inter, system-ui, sans-serif',
        backdropFilter: 'blur(12px)',
        minWidth: '48px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'none',
        overflow: 'hidden'
      });
      document.body.appendChild(widget);
    }
    return widget;
  };

  const processSKUs = () => {
    if (!qcEnabled || state.trackedGroups.length === 0) {
      const widget = document.getElementById('igp-sku-summary');
      if (widget) widget.style.display = 'none';
      return;
    }

    const rows = document.querySelectorAll('mat-row');
    const groupCounts = {};
    const skuCounts = {};
    let totalTrackedTasks = 0;
    
    const skuLookup = {};
    state.trackedGroups.forEach(g => {
      groupCounts[g.id] = 0;
      g.skus.forEach(s => {
        skuLookup[s.sku] = { group: g, sku: s };
        skuCounts[s.sku] = 0;
      });
    });

    rows.forEach(row => {
      const taskIdEl = row.querySelector('.task-id');
      if (!taskIdEl) return;
      const fullId = taskIdEl.textContent.trim();
      const parts = fullId.split('-');
      if (parts.length >= 3) {
        const skuVal = parts[2];
        const match = skuLookup[skuVal];
        if (match) {
          groupCounts[match.group.id]++;
          skuCounts[skuVal]++;
          totalTrackedTasks++;
          // Split Color Highlighting (v2 idea)
          taskIdEl.style.background = `linear-gradient(90deg, ${match.group.color} 50%, ${match.sku.color} 50%)`;
          taskIdEl.style.color = '#fff';
          taskIdEl.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)';
          taskIdEl.style.padding = '2px 8px';
          taskIdEl.style.borderRadius = '4px';
          taskIdEl.style.fontWeight = 'bold';
          taskIdEl.style.border = '1px solid rgba(255,255,255,0.2)';
        } else {
          taskIdEl.style.background = ''; taskIdEl.style.color = ''; taskIdEl.style.textShadow = '';
          taskIdEl.style.padding = ''; taskIdEl.style.borderRadius = ''; taskIdEl.style.fontWeight = ''; taskIdEl.style.border = '';
        }
      }
    });

    const widget = getSummaryWidget();
    widget.style.display = 'block';
    
    if (!state.widgetExpanded) {
      widget.style.width = '48px'; widget.style.height = '48px'; widget.style.padding = '0';
      widget.innerHTML = `<div id="igp-widget-toggle" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:20px;">🎯</div>`;
    } else {
      widget.style.width = 'auto'; widget.style.height = 'auto'; widget.style.padding = '12px 16px';
      const activeGroups = state.trackedGroups.filter(g => groupCounts[g.id] > 0);
      
      let html = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; gap: 40px;">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:700; color:#64748b; font-size:9px; text-transform:uppercase; letter-spacing:0.5px;">Summary</span>
            <span style="font-size:11px; font-weight:800; color:#1e293b;">Total: ${totalTrackedTasks}</span>
          </div>
          <div style="display:flex; gap: 8px; align-items: center;">
            <span id="igp-collapse-all" title="Collapse All" style="cursor:pointer; color:#94a3b8; font-size:14px;">↔️</span>
            <span id="igp-widget-toggle" style="cursor:pointer; color:#94a3b8; font-size:14px;">✕</span>
          </div>
        </div>
      `;

      if (activeGroups.length === 0) {
        html += `<div style="font-size:11px; color:#94a3b8; font-style:italic; text-align:center;">No items found</div>`;
      } else {
        html += activeGroups.map(g => {
          const isExpanded = state.openGroupIds.includes(g.id);
          return `
          <div class="igp-group-block" data-id="${g.id}" style="margin-bottom:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:20px; cursor:pointer; padding: 2px 0;">
              <span style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:8px; transition: transform 0.2s; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(90deg)'};">▲</span>
                <span style="width:10px; height:10px; border-radius:3px; background:${g.color};"></span>
                <span style="font-weight:600; font-size:13px; color:#1e293b;">${g.name}</span>
              </span>
              <span style="background:#f1f5f9; padding:2px 8px; border-radius:20px; font-weight:800; color:${g.color}; font-size:12px;">${groupCounts[g.id]}</span>
            </div>
            ${isExpanded ? `
              <div style="margin-left:22px; margin-top:4px; display:flex; flex-direction:column; gap:2px; border-left: 1px solid #f1f5f9; padding-left: 8px;">
                ${g.skus.filter(s => skuCounts[s.sku] > 0).map(s => `
                  <div style="display:flex; align-items:center; justify-content:space-between; font-size:10px; color:#64748b; gap: 15px;">
                    <span style="display:flex; align-items:center; gap:4px;">
                      <span style="width:4px; height:4px; border-radius:50%; background:${s.color};"></span>
                      <span title="${s.sku}">${s.name}</span>
                    </span>
                    <span style="font-weight:600;">${skuCounts[s.sku]}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `}).join('');
      }
      widget.innerHTML = html;

      // Event Listeners for expanded mode
      widget.querySelectorAll('.igp-group-block').forEach(el => {
        el.onclick = (e) => {
          e.stopPropagation();
          const id = parseInt(el.dataset.id);
          if (state.openGroupIds.includes(id)) state.openGroupIds = state.openGroupIds.filter(x => x !== id);
          else state.openGroupIds.push(id);
          processSKUs();
        };
      });

      document.getElementById('igp-collapse-all').onclick = (e) => {
        e.stopPropagation();
        state.openGroupIds = [];
        processSKUs();
      };
    }

    document.getElementById('igp-widget-toggle').onclick = (e) => {
      e.stopPropagation();
      state.widgetExpanded = !state.widgetExpanded;
      chrome.storage.local.set({ widgetExpanded: state.widgetExpanded });
      processSKUs();
    };
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
    if (target) { forceUpdate(target, val); triggerSearch(target); }
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
      optStrings.forEach(s => { if (targetUrl.includes(s)) targetUrl = targetUrl.split(s + '/').join('').split(s).join(''); });
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
    const now = Date.now(), gap = now - state.lastKeyTime;
    state.lastKeyTime = now;
    if (gap > CONFIG.TYPING_GAP_THRESHOLD) { state.scanBuffer = ''; state.isRedirected = false; }
    if (e.key === 'Enter') {
      if (now - state.lastAutoSearchTime < CONFIG.SHIELD_TIME) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!ctx.routingEnabled) { state.scanBuffer = ''; state.isRedirected = false; return; }
      const val = state.scanBuffer.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      let type = identify(val);
      if (type) { e.preventDefault(); e.stopImmediatePropagation(); handleAction(val, type); state.scanBuffer = ''; state.isRedirected = false; return; }
      state.scanBuffer = ''; state.isRedirected = false; return;
    }
    if (e.key.length === 1) {
      const activeTag = document.activeElement.tagName, isFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      if (isFocused && gap > 150) { state.scanBuffer = ''; state.isRedirected = false; }
      if (e.key === ' ' && state.scanBuffer.length === 0) return;
      state.scanBuffer += e.key;
      if (ctx.globalEnabled && !state.isRedirected) {
        const prefix = state.scanBuffer.toUpperCase().trim();
        if (prefix.length === 4 && /^\d{4}$/.test(prefix)) {
          const fields = findFields(), target = fields['tray'];
          if (target && document.activeElement !== target) {
            target.focus(); target.value = prefix; if (target.setSelectionRange) target.setSelectionRange(prefix.length, prefix.length);
            state.isRedirected = true; e.preventDefault(); return;
          }
        }
      }
    }
  }, true);

  // ─── AUTO LOGIN ────────────────────────────────────────────────────────────

  const checkAutoLogin = () => {
    const ctx = getContext();
    if (!ctx.isActive || !ctx.autoLoginEnabled) return;
    const emailField = document.querySelector('input[formcontrolname="email"]'), passField = document.querySelector('input[formcontrolname="password"]');
    if (emailField && passField) {
      chrome.storage.local.get(['qc_user', 'qc_pass'], (d) => {
        if (!d.qc_user || !d.qc_pass) return;
        const setValue = (el, val) => {
          if (!el || !val) return;
          el.focus(); el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        setValue(emailField, d.qc_user); setValue(passField, d.qc_pass);
        setTimeout(() => {
          const currentCtx = getContext(); if (!currentCtx.isActive || !currentCtx.autoLoginEnabled) return;
          const btn = document.querySelector('button[type="submit"]'); if (btn && btn.innerText.toLowerCase().includes('sign in')) btn.click();
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
