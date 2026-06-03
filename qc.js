// ─── IGP Control: QC Engine (v6.4 Stable) ────────────────────────────────────
// Sidebar Integration: "Task Tracker" integrated into native sidebar.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,
    TYPING_GAP_THRESHOLD: 400,
    SEARCH_DELAY: 400,
    SHIELD_TIME: 800,
    SKU_REFRESH_INTERVAL: 2000,
    DEBOUNCE_WAIT: 300
  };

  let state = {
    settings: { 
      qc_enabled: true, 
      qc_rightclick_enabled: true, 
      qc_routing_enabled: true, 
      qc_global_enabled: true,
      qc_autologin_enabled: true,
      qc_paste_routing_enabled: true,
      intermesh_routing_enabled: true
    },
    patterns: {
      pkid: { prefix: '1, 12', max: 8 },
      oid: { prefix: '18', max: 8 },
      sku: { prefix: 'JVS', max: 10 },
      barcode: { prefix: 'HLSDP', max: 12 }
    },
    skuTree: { id: 'root', name: 'Home', groups: [], skus: [] },
    skuLookup: {}, 
    openGroupIds: ['root'], 
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
    if (!node) return skus;
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
    const isIntermeshOrderPath = url.includes('orders_vendor.php');
    const isImageFeatureActive = url.includes('/personalization/qc-panel') || url.includes('/super-qc') || isIntermeshOrderPath || url.includes('persInfo.php');
    const isJV = url.includes('joinventures.com'), isIGP = url.includes('indiangiftsportal.com');
    const settings = state.settings;
    return {
      isQCPath: isQCScannerPath,
      isIntermeshPath: isIntermeshOrderPath,
      isScannerPath: isQCScannerPath || isIntermeshOrderPath,
      isImageFeatureActive,
      isActive: (isJV || isIGP) && (settings.qc_enabled !== false),
      routingEnabled: (isQCScannerPath && settings.qc_routing_enabled !== false) || (isIntermeshOrderPath && settings.intermesh_routing_enabled !== false),
      globalEnabled: isQCScannerPath && (settings.qc_global_enabled !== false),
      autoLoginEnabled: (isJV || isIGP) && (settings.qc_autologin_enabled !== false)
    };
  };

  const findFields = () => {
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetWidth > 0);
    const mats = allInputs.filter(i => i.classList.contains('mat-input-element'));
    const findByLabel = (text) => {
        const cleanTarget = text.replace(/[^\w]/g, '').toLowerCase();
        return allInputs.find(i => {
            const container = i.closest('.mat-form-field, .mat-form-field-infix');
            if (!container) return false;
            const label = container.querySelector('mat-label, label');
            if (!label) return false;
            const cleanLabel = label.textContent.replace(/[^\w]/g, '').toLowerCase();
            return cleanLabel.includes(cleanTarget);
        });
    };
    return { 
      pkid: findByLabel('packet id') || allInputs.find(i => i.name === 'packetid' || i.id?.includes('packet') || i.placeholder?.toLowerCase().includes('packet')) || mats[3] || mats[0],
      tray: findByLabel('tray') || allInputs.find(i => i.id?.includes('tray') || i.placeholder?.toLowerCase().includes('tray')) || mats[1],
      oid:  findByLabel('order id') || allInputs.find(i => i.name === 'orders_id' || i.id?.includes('order')) || mats[2], 
      sku:  findByLabel('sku') || mats[0],
      barcode: findByLabel('barcode') || findByLabel('external') || findByLabel('hlsdp') || allInputs.find(i => i.id === 'mat-input-5' || i.getAttribute('aria-label')?.toLowerCase().includes('barcode') || i.name?.toLowerCase().includes('barcode') || i.placeholder?.toLowerCase().includes('barcode'))
    };
  };

  const forceUpdate = (el, val) => {
    if (!el) return;
    el.focus(); el.value = ''; el.select();
    const ok = document.execCommand('insertText', false, val);
    if (!ok) el.value = val;
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
      
      const findBtn = (container) => {
        if (!container) return null;
        return Array.from(container.querySelectorAll('button, [role="button"], mat-icon-button, input[type="image"], input[type="submit"]')).find(b => {
          const t = (b.innerText || b.value || b.getAttribute('alt') || b.getAttribute('aria-label') || "").toLowerCase();
          return (t === 'go' || t.includes('search') || t.includes('find') || b.type === 'submit' || b.type === 'image') && !b.disabled && b.offsetWidth > 0;
        });
      };

      // Progressively widen the search container: td -> tr -> form -> body
      let btn = findBtn(field?.closest('td'));
      if (!btn) btn = findBtn(field?.closest('tr'));
      if (!btn) btn = findBtn(field?.closest('form, mat-card, .search-container'));
      if (!btn) btn = findBtn(document.body);

      if (btn) {
        console.log(`[IGP] Clicking search button: ${btn.value || btn.innerText || btn.getAttribute('alt') || 'SUBMIT'}`);
        state.lastAutoSearchTime = Date.now();
        btn.click();
      } else {
        console.warn(`[IGP] No search button found for ${field.id || field.name || 'field'}`);
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  const identify = (val) => {
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    if (/^\d{4}$/.test(val)) return 'tray';
    const p = state.patterns;
    for (let type in p) {
      const prefixes = p[type].prefix.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
      if (prefixes.some(pre => val.startsWith(pre)) && val.length <= (p[type].max || 99)) return type;
    }
    return null;
  };

  const scrapePageTasks = () => {
    const rows = document.querySelectorAll('mat-row');
    let addedCount = 0;
    const currentSkus = new Set(Object.keys(state.skuLookup));
    const newSkus = [];
    rows.forEach(row => {
      const taskIdEl = row.querySelector('.task-id');
      if (!taskIdEl) return;
      const parts = taskIdEl.textContent.trim().split('-');
      if (parts.length < 3) return;
      const skuVal = parts[2];
      if (currentSkus.has(skuVal)) return;
      let skuName = skuVal;
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('example-detail-row')) {
        const labels = Array.from(detailRow.querySelectorAll('.code-title'));
        const nameLabel = labels.find(l => l.textContent.includes('SKU Name'));
        if (nameLabel && nameLabel.nextElementSibling) skuName = nameLabel.nextElementSibling.textContent.trim();
      }
      if (skuName === skuVal) {
        const cells = Array.from(row.querySelectorAll('mat-cell'));
        const nameCell = cells.find(c => c.classList.contains('mat-column-sku_name') || c.classList.contains('mat-column-product_name') || c.classList.contains('mat-column-product') || c.classList.contains('mat-column-name'));
        if (nameCell) skuName = nameCell.textContent.trim();
      }
      if (!currentSkus.has(skuVal)) {
        newSkus.push({ sku: skuVal, name: skuName, color: '#3498db', note: '' });
        currentSkus.add(skuVal); addedCount++;
      }
    });
    if (newSkus.length > 0) {
      state.skuTree.skus.push(...newSkus);
      chrome.storage.local.set({ skuTree: state.skuTree }, () => {
        state.skuLookup = flattenTree(state.skuTree);
        processSKUs();
        chrome.runtime.sendMessage({ action: 'sku-sync', data: state.skuTree }).catch(() => {});
      });
    }
    return { count: addedCount };
  };

  const handleAutoLogin = () => {
    const ctx = getContext();
    if (!ctx.autoLoginEnabled) return;

    chrome.storage.local.get(['qc_user', 'qc_pass'], (data) => {
      if (!data.qc_user || !data.qc_pass) return;

      const attempt = () => {
        if (state.isProcessing) return;
        const user = document.querySelector('input[formcontrolname="email"], input[name="email"], input[type="email"], input#email');
        const pass = document.querySelector('input[formcontrolname="password"], input[name="password"], input[type="password"], input#password');
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.innerText || "").toLowerCase();
          return (t.includes('sign in') || t.includes('login') || b.type === 'submit') && b.offsetWidth > 0;
        });

        if (user && pass && btn) {
          if (user.value === data.qc_user && pass.value === data.qc_pass) return;
          state.isProcessing = true;
          console.log('[IGP] Auto-Login: Filling credentials...');
          forceUpdate(user, data.qc_user);
          forceUpdate(pass, data.qc_pass);
          setTimeout(() => {
            if (!btn.disabled) {
              console.log('[IGP] Auto-Login: Clicking button...');
              btn.click();
            }
            state.isProcessing = false;
          }, 1000);
        }
      };
      
      attempt();
      const loginInt = setInterval(attempt, 3000);
      setTimeout(() => clearInterval(loginInt), 15000);
    });
  };

  // ─── SKU ENGINE (v6 Stable Tree) ───────────────────────────────────────────

  const countTree = (node, skuCounts) => {
    let folderTotal = 0;
    if (node.skus) node.skus.forEach(s => folderTotal += (skuCounts[s.sku] || 0));
    if (node.groups) node.groups.forEach(g => folderTotal += countTree(g, skuCounts));
    node._total = folderTotal;
    return folderTotal;
  };

  const renderTreeNodes = (node, skuCounts, depth = 0, isLastArray = []) => {
    let html = '';
    const groups = node.groups || [];
    const skus = (node.skus || []).filter(s => (skuCounts[s.sku] || 0) > 0);

    if (depth === 0 && groups.length === 0 && skus.length === 0) {
       for (let skuVal in skuCounts) {
         if (skuCounts[skuVal] > 0) skus.push({ sku: skuVal, name: skuVal, color: '#3498db' });
       }
    }

    groups.forEach((g, i) => {
      if ((g._total || 0) === 0) return;
      const isExpanded = state.openGroupIds.includes(String(g.id));
      const isLast = (i === groups.length - 1) && (skus.length === 0);
      let prefix = '';
      for (let j = 0; j < depth; j++) prefix += `<span style="font-family:monospace; color:#cbd5e1; width:10px; display:inline-block;">${isLastArray[j] ? '&nbsp;' : '│'}</span>&nbsp;`;
      const connector = `<span style="font-family:monospace; color:#cbd5e1;">${isLast ? '└─' : '├─'}</span>`;

      html += `
        <div class="igp-tree-node" data-id="${g.id}" style="margin-bottom: 2px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; padding: 1px 0;">
            <span style="display:flex; align-items:center; gap:4px; overflow:hidden;">
              <span style="white-space:nowrap;">${prefix}${connector}</span>
              <span style="font-size:7px; color:#94a3b8; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(90deg)'};">▲</span>
              <span style="width:7px; height:7px; border-radius:2px; background:${g.color || '#334155'}; flex-shrink:0;"></span>
              <span style="font-weight:600; font-size:11px; color:#1e293b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${g.name}</span>
            </span>
            <span style="font-size:10px; font-weight:800; color:${g.color || '#334155'};">${g._total}</span>
          </div>
          ${isExpanded ? `<div class="igp-children">${renderTreeNodes(g, skuCounts, depth + 1, [...isLastArray, isLast])}</div>` : ''}
        </div>
      `;
    });

    skus.forEach((s, i) => {
      const isLast = i === skus.length - 1;
      let prefix = '';
      for (let j = 0; j < depth; j++) prefix += `<span style="font-family:monospace; color:#cbd5e1; width:10px; display:inline-block;">${isLastArray[j] ? '&nbsp;' : '│'}</span>&nbsp;`;
      const connector = `<span style="font-family:monospace; color:#cbd5e1;">${isLast ? '└─' : '├─'}</span>`;
      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#334155; padding: 2px 0;">
          <span style="display:flex; align-items:center; gap:4px; overflow:hidden;">
            <span style="white-space:nowrap;">${prefix}${connector}</span>
            <span style="width:4px; height:4px; border-radius:50%; background:${s.color || '#3498db'}; flex-shrink:0;"></span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;">${s.name}</span>
          </span>
          <span style="font-weight:800; color:#1e293b; background:#f1f5f9; padding:0 4px; border-radius:3px;">${skuCounts[s.sku]}</span>
        </div>
      `;
    });
    return html;
  };

  // ─── SIDEBAR INTEGRATION ───────────────────────────────────────────────────

  const injectSidebarItem = () => {
    const menu = document.getElementById('menu');
    if (!menu || document.getElementById('igp-sidebar-li')) return;

    const li = document.createElement('li');
    li.id = 'igp-sidebar-li';
    li.className = 'ng-star-inserted igp-sidebar-tracker-container';
    li.style.position = 'relative';

    li.innerHTML = `
      <a class="ai-icon ng-star-inserted" href="javascript:void(0)" style="cursor:default;">
        <i class="material-icons-outlined">track_changes</i>
        <span class="nav-text" id="igp-sidebar-label">Task Tracker</span>
      </a>
      <div id="igp-sidebar-popup" style="
        position: absolute; left: 100%; top: 0; min-width: 260px; 
        background: #FFFFFF; border: 1px solid #e2e8f0; border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); padding: 12px;
        display: none; z-index: 99999; margin-left: 10px;
        max-height: 500px; overflow-y: auto; cursor: default;
      ">
        <div style="font-size: 12px; font-weight: 600; color: #0f172a; display: inline-block; text-decoration: underline; text-decoration-color: #000000; text-decoration-thickness: 1px; text-underline-offset: 2px; margin-bottom: 8px;">
  Pending Task
</div>


        <div id="igp-sidebar-tree-root"></div>
      </div>
    `;
	//font-weight: 900;
    // CSS for Hover
    const style = document.createElement('style');
    style.innerHTML = `
      .igp-sidebar-tracker-container:hover #igp-sidebar-popup { display: block !important; }
      .igp-sidebar-tracker-container a i { color: #64748b; }
      .igp-sidebar-tracker-container:hover a i { color: var(--primary); }
      #igp-sidebar-popup::-webkit-scrollbar { width: 4px; }
      #igp-sidebar-popup::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
    `;
    document.head.appendChild(style);
    menu.appendChild(li);
  };

  const processSKUs = () => {
    if (!qcEnabled) {
      const li = document.getElementById('igp-sidebar-li');
      if (li) li.style.display = 'none';
      return;
    }

    injectSidebarItem();
    const li = document.getElementById('igp-sidebar-li');
    if (li) li.style.display = 'block';

    const rows = document.querySelectorAll('mat-row');
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
          counts[skuVal] = (counts[skuVal] || 0) + 1; grandTotal++;
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
    
    // Update Sidebar Label
    const label = document.getElementById('igp-sidebar-label');
    if (label) label.textContent = `Task Tracker (${grandTotal})`;

    // Update Sidebar Tree
    const treeContainer = document.getElementById('igp-sidebar-tree-root');
    if (treeContainer) {
      treeContainer.innerHTML = grandTotal > 0 ? renderTreeNodes(state.skuTree, counts) : '<div style="font-size:10px; color:#94a3b8; text-align:center; padding:10px;">No matches on page</div>';
      
      treeContainer.querySelectorAll('.igp-tree-node').forEach(el => {
        el.onclick = (e) => {
          e.stopPropagation();
          const id = String(el.dataset.id);
          if (state.openGroupIds.includes(id)) state.openGroupIds = state.openGroupIds.filter(x => x !== id);
          else state.openGroupIds.push(id);
          processSKUs();
        };
      });
    }
  };

  const debouncedProcess = debounce(processSKUs, CONFIG.DEBOUNCE_WAIT);

  // ─── INITIALIZATION & SYNC ──────────────────────────────────────────────────

  const initSettings = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    chrome.storage.local.get([...Object.keys(state.settings), 'skuTree', 'patterns', 'qc_user', 'qc_pass'], (data) => {
      for (let k in state.settings) if (data[k] !== undefined) state.settings[k] = data[k];
      if (data.skuTree) { state.skuTree = data.skuTree; state.skuLookup = flattenTree(state.skuTree); }
      if (data.patterns) state.patterns = { ...state.patterns, ...data.patterns };
      qcEnabled = state.settings.qc_enabled !== false;
      processSKUs();
      handleAutoLogin();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let refresh = false;
      for (let key in changes) {
        if (state.settings.hasOwnProperty(key)) { state.settings[key] = changes[key].newValue; refresh = true; }
        if (key === 'skuTree') {
          state.skuTree = changes[key].newValue || { id: 'root', name: 'Home', groups: [], skus: [] };
          state.skuLookup = flattenTree(state.skuTree); refresh = true;
        }
        if (key === 'patterns') { state.patterns = { ...state.patterns, ...(changes[key].newValue || {}) }; refresh = true; }
        if (key === 'qc_user' || key === 'qc_pass') { handleAutoLogin(); }
      }
      if (refresh) processSKUs();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'sku-sync') {
        if (msg.data) { state.skuTree = msg.data; state.skuLookup = flattenTree(state.skuTree); }
        if (msg.patterns) state.patterns = { ...state.patterns, ...msg.patterns };
        processSKUs();
      } else if (msg.action === 'scrape-tasks') {
        sendResponse(scrapePageTasks());
        return true;
      }
    });
  };

  // ─── GLOBAL LISTENERS ──────────────────────────────────────────────────────

  document.addEventListener('paste', (e) => {
    if (!qcEnabled) return;
    const ctx = getContext();
    if (!ctx.isActive) return;

    let pasteAllowed = false;
    if (ctx.isQCPath && state.settings.qc_paste_routing_enabled !== false) pasteAllowed = true;
    if (ctx.isIntermeshPath && state.settings.intermesh_routing_enabled !== false) pasteAllowed = true;
    
    if (!pasteAllowed) return;

    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (!pasted) return;
    const val = pasted.trim().toUpperCase(), type = identify(val);
    if (type) {
      const f = findFields(), target = f[type];
      console.log(`[IGP] Paste detected: Type=${type}, FoundTarget=${!!target}`);
      if (target) { e.preventDefault(); forceUpdate(target, val); triggerSearch(target); }
    }
  });

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
      if (type && type !== 'barcode') {
        e.preventDefault(); e.stopImmediatePropagation();
        const f = findFields(), target = f[type];
        if (target) {
          forceUpdate(target, val);
          triggerSearch(target);
        }
      }
      state.scanBuffer = ''; state.isRedirected = false;
    } else if (e.key.length === 1) {
      const activeTag = document.activeElement.tagName;
      if ((activeTag === 'INPUT' || activeTag === 'TEXTAREA') && gap > 150) { state.scanBuffer = ''; state.isRedirected = false; }
      if (e.key === ' ' && state.scanBuffer.length === 0) return;
      state.scanBuffer += e.key;
      if (ctx.globalEnabled && !state.isRedirected && state.scanBuffer.length === 4 && /^\d{4}$/.test(state.scanBuffer)) {
          const f = findFields(), target = f['tray'];
          if (target && document.activeElement !== target) {
            target.focus(); target.value = state.scanBuffer;
            if (target.setSelectionRange) target.setSelectionRange(4, 4);
            state.isRedirected = true; e.preventDefault();
          }
      }
    }
  }, true);

  const obs = new MutationObserver((mutations) => {
    const hasNew = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeName === 'MAT-ROW' || (n.querySelectorAll && n.querySelectorAll('mat-row').length > 0)));
    if (hasNew) debouncedProcess();
  });
  
  obs.observe(document.body, { childList: true, subtree: true });
  setInterval(debouncedProcess, CONFIG.SKU_REFRESH_INTERVAL);
  initSettings();

})();
