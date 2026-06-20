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
      intermesh_routing_enabled: true,
      sku_styling_enabled: true,
      sku_pending_enabled: true
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
  let globalRoutingTimeout = null;

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
    const effectiveParent = parentGroup || (node.id === 'root' ? node : null);
    if (node.skus) {
      node.skus.forEach(s => {
        if (s.sku) skus[s.sku.toUpperCase()] = { ...s, parent: effectiveParent };
      });
    }
    if (node.groups) {
      node.groups.forEach(g => {
        Object.assign(skus, flattenTree(g, g));
      });
    }
    return skus;
  };

  const getStyleString = (color, adv) => {
    const { texture = 'solid', intensity = 0 } = adv || {};
    const alpha = (intensity || 0) / 100;
    let bgImg = 'none';

    if (alpha > 0) {
      if (texture === 'wood') {
        bgImg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20'%3E%3Cpath d='M0 10 Q25 5 50 10 Q75 15 100 10' stroke='rgba(0,0,0,${0.12 * alpha})' stroke-width='1.5' fill='none'/%3E%3Cpath d='M0 16 Q25 11 50 16 Q75 21 100 16' stroke='rgba(0,0,0,${0.07 * alpha})' stroke-width='1' fill='none'/%3E%3C/svg%3E")`;
      } else if (texture === 'metal') {
        bgImg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cline x1='0' y1='40' x2='40' y2='0' stroke='rgba(255,255,255,${0.15 * alpha})' stroke-width='2'/%3E%3Cline x1='-10' y1='40' x2='30' y2='0' stroke='rgba(255,255,255,${0.07 * alpha})' stroke-width='1'/%3E%3C/svg%3E")`;
      } else if (texture === 'honey') {
        bgImg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='24'%3E%3Cpolygon points='14,2 26,8 26,16 14,22 2,16 2,8' stroke='rgba(0,0,0,${0.15 * alpha})' stroke-width='1.2' fill='none'/%3E%3C/svg%3E")`;
      } else if (texture === 'glass') {
        bgImg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='rgba(255,255,255,${0.08 * alpha})'/%3E%3Cline x1='0' y1='0' x2='60' y2='60' stroke='rgba(255,255,255,${0.2 * alpha})' stroke-width='6'/%3E%3C/svg%3E")`;
      }
    }

    return `background-image: ${bgImg}; background-color: ${color}; background-size: auto;`;
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
    el.focus();
    el.value = '';
    el.select();
    document.execCommand('insertText', false, val);
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(evt =>
      el.dispatchEvent(new Event(evt, { bubbles: true }))
    );
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
      const groupDotStyle = getStyleString(g.color || '#334155', g.advStyle || { texture: 'solid', intensity: 0 });

      html += `
        <div class="igp-tree-node" data-id="${g.id}" style="margin-bottom: 2px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; padding: 1px 0;">
            <span style="display:flex; align-items:center; gap:4px; overflow:hidden;">
              <span style="white-space:nowrap;">${prefix}${connector}</span>
              <span style="font-size:7px; color:#94a3b8; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(90deg)'};">▲</span>
              <span style="width:8px; height:8px; border-radius:2px; ${groupDotStyle} flex-shrink:0; border:1px solid rgba(0,0,0,0.05);"></span>
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
      
      const dotStyle = getStyleString(s.color || '#3498db', s.advStyle || { texture: 'solid', intensity: 0 });

      html += `
        <div class="igp-sku-node" data-sku="${s.sku}" style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#334155; padding: 4px; cursor:pointer; margin: 1px 0; transition: background 0.1s;">
          <span style="display:flex; align-items:center; gap:4px; overflow:hidden;">
            <span style="white-space:nowrap;">${prefix}${connector}</span>
            <span style="width:8px; height:8px; border-radius:50%; ${dotStyle} flex-shrink:0; border:1px solid rgba(0,0,0,0.05);"></span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;">${s.name}</span>
          </span>
          <span style="font-weight:800; color:#1e293b; background:#f1f5f9; padding:0 4px; border-radius:3px;">${skuCounts[s.sku]}</span>
        </div>
      `;
    });
    return html;
  };

  // ─── SIDEBAR & STYLING INTEGRATION ─────────────────────────────────────────

  const injectStyles = () => {
    if (document.getElementById('igp-texture-styles')) return;
    const style = document.createElement('style');
    style.id = 'igp-texture-styles';
    style.innerHTML = `
      .igp-style-glossy {
        box-shadow: inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.2) !important;
      }
      .igp-style-striped {
        background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.15), rgba(255,255,255,0.15) 10px, transparent 10px, transparent 20px) !important;
        background-blend-mode: overlay;
      }
      .igp-style-dotted {
        background-image: radial-gradient(rgba(255,255,255,0.2) 2px, transparent 2px) !important;
        background-size: 8px 8px !important;
        background-blend-mode: overlay;
      }
      .igp-sidebar-tracker-container:hover #igp-sidebar-popup { 
        visibility: visible !important; 
        opacity: 1 !important; 
        transition-delay: 0.3s; 
      }
      .igp-sidebar-tracker-container a i { color: #64748b; }
      .igp-sidebar-tracker-container:hover a i { color: var(--primary); }
      #igp-sidebar-popup::-webkit-scrollbar { width: 4px; }
      #igp-sidebar-popup::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
      .igp-sku-node:hover { background: #f1f5f9; border-radius: 4px; }
    `;
    document.head.appendChild(style);
  };

  const injectSidebarItem = () => {
    injectStyles();
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
        z-index: 99999; margin-left: 10px;
        max-height: 500px; overflow-y: auto; cursor: default;
        visibility: hidden; opacity: 0; transition: visibility 0s 0.2s, opacity 0.2s linear;
      ">
        <div style="font-size: 12px; font-weight: 600; color: #0f172a; display: inline-block; text-decoration: underline; text-decoration-color: #000000; text-decoration-thickness: 1px; text-underline-offset: 2px; margin-bottom: 8px;">
  Pending Task
</div>


        <div id="igp-sidebar-tree-root"></div>
      </div>
    `;
    menu.appendChild(li);
  };

  const processSKUs = () => {
    if (!qcEnabled) {
      const li = document.getElementById('igp-sidebar-li');
      if (li) li.style.display = 'none';
      return;
    }

    const showPending = state.settings.sku_pending_enabled !== false;
    if (showPending) {
      injectSidebarItem();
      const li = document.getElementById('igp-sidebar-li');
      if (li) li.style.display = 'block';
    } else {
      const li = document.getElementById('igp-sidebar-li');
      if (li) li.style.display = 'none';
    }

    const rows = document.querySelectorAll('mat-row');
    const counts = {};
    let grandTotal = 0;
    
    rows.forEach(row => {
      const taskIdEl = row.querySelector('.task-id');
      if (!taskIdEl) return;
      const parts = taskIdEl.textContent.trim().split('-');
      if (parts.length >= 3) {
        const skuVal = parts[2].toUpperCase();
        const match = state.skuLookup[skuVal];
        if (match) {
          counts[skuVal] = (counts[skuVal] || 0) + 1; grandTotal++;
          
          if (state.settings.sku_styling_enabled !== false) {
            const pColor = (match.parent && match.parent.color) ? match.parent.color : (state.skuTree.color || '#334155');
            const tColor = match.color || '#3498db';
            const adv = match.advStyle || { texture: 'solid', intensity: 0 };
            const style = getStyleString(tColor, adv);
            const bgImgMatch = style.match(/background-image:\s*([^;]+)/);
            const bgImg = bgImgMatch ? bgImgMatch[1] : 'none';
            
            // Layered: Parent Color (Left) + SKU Texture (Right)
            taskIdEl.setAttribute('style', `
              background-image: linear-gradient(to right, ${pColor} 50%, transparent 50%), ${bgImg} !important;
              background-color: ${tColor} !important;
              background-size: auto !important;
              color: #fff !important;
              padding: 2px 8px !important;
              border-radius: 4px !important;
              font-weight: bold !important;
              text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.5) !important;
            `);
          } else {
            // Reset to plain if disabled
            taskIdEl.style.background = '';
            taskIdEl.style.backgroundColor = '';
            taskIdEl.style.color = '';
            taskIdEl.style.padding = '';
            taskIdEl.style.borderRadius = '';
            taskIdEl.style.fontWeight = '';
            taskIdEl.style.textShadow = '';
          }
          
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

      treeContainer.querySelectorAll('.igp-sku-node').forEach(el => {
        el.onclick = (e) => {
          e.stopPropagation();
          const skuVal = el.dataset.sku;
          if (!skuVal) return;
          const fields = findFields();
          if (fields.sku) {
             console.log(`[IGP] Routing Sidebar click for SKU: ${skuVal}`);
             forceUpdate(fields.sku, skuVal);
             triggerSearch(fields.sku);
          } else {
             console.warn(`[IGP] No SKU field found to route ${skuVal}`);
          }
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

  document.addEventListener('input', (e) => {
    if (!qcEnabled) return;
    const ctx = getContext();
    if (!ctx.isActive || !ctx.isScannerPath) return;

    const target = e.target;
    if (target) {
      const f = findFields();
      if (target === f.tray) {
        const val = target.value.trim();
        if (/^\d{4}$/.test(val)) {
          console.log(`[IGP] Tray field reached 4 digits: ${val}. Triggering search...`);
          triggerSearch(target);
        }
      }
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    if (!qcEnabled || e.ctrlKey || e.altKey || e.metaKey) return;
    const ctx = getContext();
    if (!ctx.isActive || !ctx.isScannerPath) return;
    const now = Date.now(), gap = now - state.lastKeyTime;
    state.lastKeyTime = now;
    if (gap > CONFIG.TYPING_GAP_THRESHOLD) { state.scanBuffer = ''; state.isRedirected = false; }

    if (e.key === 'Enter' || !/^\d$/.test(e.key)) {
      if (globalRoutingTimeout) {
        clearTimeout(globalRoutingTimeout);
        globalRoutingTimeout = null;
      }
    }

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
      const isInputFocused = ['INPUT', 'TEXTAREA'].includes(activeTag);

      if (ctx.globalEnabled && !isInputFocused && /^\d$/.test(e.key)) {
        if (globalRoutingTimeout) {
          clearTimeout(globalRoutingTimeout);
          globalRoutingTimeout = null;
        }
        if (gap > 150) { state.scanBuffer = ''; }
        state.scanBuffer += e.key;

        globalRoutingTimeout = setTimeout(() => {
          const val = state.scanBuffer.trim().toUpperCase();
          const type = identify(val) || 'tray';
          const f = findFields(), target = f[type];
          if (target) {
            forceUpdate(target, val);
            if (type === 'tray' && /^\d{4}$/.test(val)) {
              triggerSearch(target);
            } else if (type !== 'tray') {
              triggerSearch(target);
            }
            state.isRedirected = true;
          }
          globalRoutingTimeout = null;
        }, 50);

        e.preventDefault();
        return;
      }

      if (isInputFocused && gap > 150) { state.scanBuffer = ''; state.isRedirected = false; }
      if (e.key === ' ' && state.scanBuffer.length === 0) return;
      state.scanBuffer += e.key;
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
