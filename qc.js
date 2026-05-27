// ─── IGP Control: QC Engine (v4.1 Optimized) ────────────────────────────────
// Refactored for performance (low CPU) and stability.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,
    TYPING_GAP_THRESHOLD: 400,
    SEARCH_DELAY: 400,
    SHIELD_TIME: 800,
    SKU_REFRESH_INTERVAL: 2000,
    DEBOUNCE_WAIT: 300 // ms to wait before re-processing after DOM change
  };

  let state = {
    settings: { 
      qc_enabled: true, 
      qc_rightclick_enabled: true, 
      qc_routing_enabled: true, 
      qc_global_enabled: true,
      qc_autologin_enabled: true
    },
    skuTree: { id: 'root', name: 'Home', groups: [], skus: [] },
    skuLookup: {}, // Cached flat map
    widgetExpanded: true,
    openGroupIds: [],
    scanBuffer: '',
    lastKeyTime: Date.now(),
    lastAutoSearchTime: 0,
    isProcessing: false,
    isRedirected: false
  };

  let qcEnabled = true;
  let processTimer = null;

  // ─── UTILS ─────────────────────────────────────────────────────────────────

  const debounce = (func, wait) => {
    return (...args) => {
      clearTimeout(processTimer);
      processTimer = setTimeout(() => func.apply(this, args), wait);
    };
  };

  const flattenTree = (node, parentGroup = null) => {
    let skus = {};
    if (node.skus) {
      node.skus.forEach(s => {
        skus[s.sku] = { ...s, parent: parentGroup };
      });
    }
    if (node.groups) {
      node.groups.forEach(g => {
        Object.assign(skus, flattenTree(g, g));
      });
    }
    return skus;
  };

  const getContext = () => {
    const url = window.location.href;
    const isQCScannerPath = url.includes('qc-panel') || url.includes('/qc/');
    const isImageFeatureActive = url.includes('/personalization/qc-panel') || url.includes('/super-qc') || url.includes('orders_vendor.php') || url.includes('persInfo.php');
    const isJV = url.includes('joinventures.com'), isIGP = url.includes('indiangiftsportal.com');
    const settings = state.settings;
    return {
      isScannerPath: isQCScannerPath,
      isImageFeatureActive,
      isActive: (isJV || isIGP) && (settings.qc_enabled !== false),
      routingEnabled: isQCScannerPath && (settings.qc_routing_enabled !== false),
      globalEnabled: isQCScannerPath && (settings.qc_global_enabled !== false),
      autoLoginEnabled: isJV && (settings.qc_autologin_enabled !== false)
    };
  };

  const findFields = () => {
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetWidth > 0);
    const mats = allInputs.filter(i => i.classList.contains('mat-input-element'));
    return { 
      pkid: allInputs.find(i => i.id?.includes('packet') || i.placeholder?.toLowerCase().includes('packet')) || mats[3] || mats[0],
      tray: allInputs.find(i => i.id?.includes('tray') || i.placeholder?.toLowerCase().includes('tray')) || mats[1],
      oid:  mats[2], taskid: mats[0] 
    };
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
      const enterEvt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      field.dispatchEvent(new KeyboardEvent('keydown', enterEvt));
      const container = field?.closest('form, mat-card, .search-container') || document.body;
      const btn = Array.from(container.querySelectorAll('button')).find(b => {
        const t = (b.innerText || "").toLowerCase();
        return (t === 'go' || t === 'search' || t.includes('find')) && !b.disabled;
      });
      if (btn) {
        state.lastAutoSearchTime = Date.now();
        btn.click();
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  const identify = (val) => {
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    if (/^\d{4}$/.test(val)) return 'tray';
    if (/^\d{7,14}$/.test(val)) return 'pkid';
    return null;
  };

  // ─── SKU ENGINE (Optimized) ────────────────────────────────────────────────

  const countTree = (node, skuCounts) => {
    let folderTotal = 0;
    node.skus.forEach(s => folderTotal += (skuCounts[s.sku] || 0));
    node.groups.forEach(g => folderTotal += countTree(g, skuCounts));
    node._total = folderTotal;
    return folderTotal;
  };

  const getSummaryWidget = () => {
    let widget = document.getElementById('igp-sku-summary');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'igp-sku-summary';
      Object.assign(widget.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
        backgroundColor: 'rgba(255, 255, 255, 0.98)', border: '1px solid #e2e8f0', borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontFamily: 'Inter, sans-serif',
        backdropFilter: 'blur(12px)', transition: 'all 0.2s', display: 'none', overflow: 'hidden'
      });
      document.body.appendChild(widget);
    }
    return widget;
  };

  const renderTreeNodes = (node, skuCounts) => {
    if (node._total === 0) return '';
    let html = '';
    const groups = node.groups.filter(g => g._total > 0);
    const skus = node.skus.filter(s => (skuCounts[s.sku] || 0) > 0);

    groups.forEach(g => {
      const isExpanded = state.openGroupIds.includes(g.id);
      html += `
        <div class="igp-tree-node" data-id="${g.id}" style="margin-bottom: 4px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:15px; cursor:pointer; padding: 2px 0;">
            <span style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:7px; color:#94a3b8; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(90deg)'};">▲</span>
              <span style="width:8px; height:8px; border-radius:2px; background:${g.color};"></span>
              <span style="font-weight:600; font-size:12px; color:#1e293b;">${g.name}</span>
            </span>
            <span style="font-size:10px; font-weight:800; color:${g.color};">${g._total}</span>
          </div>
          ${isExpanded ? `
            <div style="margin-left: 8px; padding-left: 10px; border-left: 1px solid #e2e8f0; margin-top: 4px;">
              ${renderTreeNodes(g, skuCounts)}
            </div>
          ` : ''}
        </div>
      `;
    });

    skus.forEach(s => {
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:10px; color:#64748b; padding: 1px 0;">
          <span style="display:flex; align-items:center; gap:4px;">
            <span style="width:4px; height:4px; border-radius:50%; background:${s.color};"></span>
            <span>${s.name}</span>
          </span>
          <span style="font-weight:600;">${skuCounts[s.sku]}</span>
        </div>
      `;
    });
    return html;
  };

  const processSKUs = () => {
    if (!qcEnabled) {
      const w = document.getElementById('igp-sku-summary');
      if (w) w.style.display = 'none';
      return;
    }

    const rows = document.querySelectorAll('mat-row');
    if (rows.length === 0) return;

    const counts = {};
    let grandTotal = 0;

    rows.forEach(row => {
      const taskIdEl = row.querySelector('.task-id');
      if (!taskIdEl) return;
      const parts = taskIdEl.textContent.trim().split('-');
      if (parts.length >= 3) {
        const skuVal = parts[2];
        const match = state.skuLookup[skuVal];
        if (match) {
          counts[skuVal] = (counts[skuVal] || 0) + 1;
          grandTotal++;
          taskIdEl.style.background = `linear-gradient(90deg, ${match.parent?.color || '#333'} 50%, ${match.color} 50%)`;
          taskIdEl.style.color = '#fff'; taskIdEl.style.padding = '2px 8px'; taskIdEl.style.borderRadius = '4px';
          taskIdEl.style.fontWeight = 'bold'; taskIdEl.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)';
          
          if (match.note) {
            const cell = row.querySelector('.mat-column-text');
            if (cell && cell.textContent.trim() === '-') cell.textContent = match.note;
          }
        }
      }
    });

    countTree(state.skuTree, counts);

    const widget = getSummaryWidget();
    widget.style.display = 'block';
    
    if (!state.widgetExpanded) {
      widget.style.width = '48px'; widget.style.height = '48px'; widget.style.padding = '0';
      widget.innerHTML = `<div id="igp-widget-toggle" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:20px;">🎯</div>`;
    } else {
      widget.style.width = '200px'; widget.style.padding = '12px';
      widget.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
          <span style="font-size:11px; font-weight:800; color:#1e293b;">TRACKER v4 (${grandTotal})</span>
          <div style="display:flex; gap:8px;">
            <span id="igp-collapse-all" title="Collapse All" style="cursor:pointer; color:#94a3b8; font-size:12px;">↔️</span>
            <span id="igp-widget-toggle" style="cursor:pointer; color:#94a3b8; font-size:12px;">✕</span>
          </div>
        </div>
        <div style="max-height:300px; overflow-y:auto; padding-right:4px;">
          ${renderTreeNodes(state.skuTree, counts)}
        </div>
      `;

      widget.querySelectorAll('.igp-tree-node').forEach(el => {
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
        state.openGroupIds = (state.openGroupIds.length > 0) ? [] : Array.from(widget.querySelectorAll('.igp-tree-node')).map(el => parseInt(el.dataset.id));
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

  const debouncedProcess = debounce(processSKUs, CONFIG.DEBOUNCE_WAIT);

  // ─── SETTINGS & SYNC ───────────────────────────────────────────────────────

  const initSettings = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.get([...Object.keys(state.settings), 'skuTree', 'widgetExpanded'], (data) => {
      for (let k in state.settings) if (data[k] !== undefined) state.settings[k] = data[k];
      if (data.skuTree) {
        state.skuTree = data.skuTree;
        state.skuLookup = flattenTree(state.skuTree);
      }
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
        if (key === 'skuTree') {
          state.skuTree = changes[key].newValue || { id: 'root', groups: [], skus: [] };
          state.skuLookup = flattenTree(state.skuTree);
          processSKUs();
        }
      }
    });

    // GUARANTEED SYNC: Listen for direct messages from popup
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'sku-sync') {
        state.skuTree = msg.data;
        state.skuLookup = flattenTree(state.skuTree);
        processSKUs();
      }
    });

    document.addEventListener('click', (e) => {
      if (!state.widgetExpanded) return;
      const w = document.getElementById('igp-sku-summary');
      if (w && !w.contains(e.target)) {
        state.widgetExpanded = false;
        chrome.storage.local.set({ widgetExpanded: false });
        processSKUs();
      }
    });
  };
  initSettings();

  // ─── LOGIN & IMAGE ─────────────────────────────────────────────────────────

  const checkAutoLogin = () => {
    const ctx = getContext();
    if (!ctx.isActive || !ctx.autoLoginEnabled) return;
    const emailField = document.querySelector('input[formcontrolname="email"]'), passField = document.querySelector('input[formcontrolname="password"]');
    if (emailField && passField) {
      chrome.storage.local.get(['qc_user', 'qc_pass'], (d) => {
        if (!d.qc_user || !d.qc_pass) return;
        const setVal = (el, val) => {
          if (!el || !val) return;
          el.focus(); el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setVal(emailField, d.qc_user); setVal(passField, d.qc_pass);
        setTimeout(() => {
          const c = getContext(); if (!c.isActive || !c.autoLoginEnabled) return;
          const b = document.querySelector('button[type="submit"]'); if (b && b.innerText.toLowerCase().includes('sign in')) b.click();
        }, 800);
      });
    }
  };

  document.addEventListener('contextmenu', (e) => {
    if (!qcEnabled) return;
    const ctx = getContext();
    if (!ctx.isActive || !ctx.isImageFeatureActive || state.settings.qc_rightclick_enabled === false) return;
    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) {
      e.preventDefault();
      let url = img.src;
      const opts = ['f_auto,q_auto,t_pnopt3prodlp', 'f_auto,q_auto,t_pnopt4prodlp'];
      opts.forEach(s => { if (url.includes(s)) url = url.split(s + '/').join('').split(s).join(''); });
      url = url.replace(/([^:])\/\//g, '$1/');
      window.open(url + '#igp-qc', '_blank');
    }
  }, true);

  // ─── SCANNER ROUTING ───────────────────────────────────────────────────────

  window.addEventListener('keydown', (e) => {
    if (!qcEnabled || e.ctrlKey || e.altKey || e.metaKey) return;
    const ctx = getContext();
    if (!ctx.isActive || !ctx.isScannerPath) return;

    const now = Date.now(), gap = now - state.lastKeyTime;
    state.lastKeyTime = now;

    if (gap > CONFIG.TYPING_GAP_THRESHOLD) { state.scanBuffer = ''; state.isRedirected = false; }

    if (e.key === 'Enter') {
      if (now - state.lastAutoSearchTime < CONFIG.SHIELD_TIME) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!ctx.routingEnabled) { state.scanBuffer = ''; state.isRedirected = false; return; }
      const val = state.scanBuffer.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const type = identify(val);
      if (type) {
        e.preventDefault(); e.stopImmediatePropagation();
        const fields = findFields();
        const target = fields[type];
        if (target) { forceUpdate(target, val); triggerSearch(target); }
        state.scanBuffer = ''; state.isRedirected = false; return;
      }
      state.scanBuffer = ''; state.isRedirected = false;
    } else if (e.key.length === 1) {
      const activeTag = document.activeElement.tagName;
      if ((activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') && gap > 150) {
         state.scanBuffer = ''; state.isRedirected = false;
      }
      if (e.key === ' ' && state.scanBuffer.length === 0) return;
      state.scanBuffer += e.key;

      if (ctx.globalEnabled && !state.isRedirected) {
        const prefix = state.scanBuffer.toUpperCase().trim();
        if (prefix.length === 4 && /^\d{4}$/.test(prefix)) {
          const fields = findFields(), target = fields['tray'];
          if (target && document.activeElement !== target) {
            target.focus(); target.value = prefix;
            if (target.setSelectionRange) target.setSelectionRange(prefix.length, prefix.length);
            state.isRedirected = true; e.preventDefault();
          }
        }
      }
    }
  }, true);

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  const obs = new MutationObserver((mutations) => {
    checkAutoLogin();
    const hasNewContent = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeName === 'MAT-ROW' || (n.querySelectorAll && n.querySelectorAll('mat-row').length > 0)));
    if (hasNewContent) debouncedProcess();
  });
  
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(debouncedProcess, CONFIG.SKU_REFRESH_INTERVAL);
  checkAutoLogin();
  debouncedProcess();

})();
