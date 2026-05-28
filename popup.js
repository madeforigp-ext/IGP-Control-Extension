// ─── IGP Control: Popup Logic (v6 Drag & Drop Tree) ─────────────────────────

const statusEl = document.getElementById('status');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (type || '');
  setTimeout(() => { statusEl.textContent = 'System Ready'; statusEl.className = 'status'; }, 3000);
}

// ─── TABS ────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── TOGGLES ─────────────────────────────────────────────────────────────────

function setupToggle(id, storageKey) {
  const el = document.getElementById(id);
  if (!el) return;
  chrome.storage.local.get([storageKey], (data) => { el.checked = data[storageKey] !== false; });
  el.addEventListener('change', () => {
    chrome.storage.local.set({ [storageKey]: el.checked });
    setStatus(`${storageKey.replace('_enabled','').toUpperCase()} UPDATED`, 'success');
  });
}
setupToggle('toggle-qc', 'qc_enabled');
setupToggle('toggle-qc-rightclick', 'qc_rightclick_enabled');
setupToggle('toggle-qc-routing', 'qc_routing_enabled');
setupToggle('toggle-qc-global', 'qc_global_enabled');
setupToggle('toggle-qc-autologin', 'qc_autologin_enabled');
setupToggle('toggle-qc-paste', 'qc_paste_routing_enabled');
setupToggle('toggle-tabguard', 'tabguard_enabled');

// ─── SKU TRACKING (v6 Drag & Drop) ───────────────────────────────────────────

let skuTree = { id: 'root', name: 'Home', color: '#334155', groups: [], skus: [] };
let expandedFolders = new Set(['root']);
let editingGroupId = null;
let editingSkuIdx = null;
let activeParentId = 'root';
let draggedItem = null; // { type: 'folder'|'sku', id: string, parentId: string, index: number }

chrome.storage.local.get(['skuTree', 'expandedFolders'], (data) => {
  if (data.skuTree) skuTree = data.skuTree;
  if (data.expandedFolders) expandedFolders = new Set(data.expandedFolders);
  renderTree();
});

function save() {
  chrome.storage.local.get(['patterns'], (data) => {
    chrome.storage.local.set({ skuTree, expandedFolders: Array.from(expandedFolders) }, () => {
      renderTree();
      // HARD SYNC
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'sku-sync', data: skuTree, patterns: data.patterns }).catch(() => {});
        });
      });
    });
  });
}

function findFolder(id, root = skuTree) {
  if (root.id === id) return root;
  if (root.groups) {
    for (let g of root.groups) {
      const f = findFolder(id, g); if (f) return f;
    }
  }
  return null;
}

function renderTree() {
  const list = document.getElementById('skuList');
  list.innerHTML = '';
  renderNode(skuTree, list, 0, []);
}

function renderNode(node, container, depth, isLastArray) {
  const isRoot = node.id === 'root';
  const isExpanded = expandedFolders.has(node.id);

  const row = document.createElement('div');
  row.className = 'tree-row' + (isRoot ? ' root-row' : '');
  row.style.padding = '4px 0';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '4px';
  row.style.cursor = 'pointer';
  row.draggable = !isRoot;
  row.dataset.id = node.id;
  row.dataset.type = 'folder';

  // Tree Graphics (Recursive Lines)
  let prefix = '';
  for (let i = 0; i < depth - 1; i++) {
     prefix += `<span style="font-family:monospace; color:#e2e8f0; width:12px; display:inline-block;">${isLastArray[i] ? '&nbsp;' : '│'}</span>&nbsp;&nbsp;`;
  }
  const connector = isRoot ? '' : `<span style="font-family:monospace; color:#cbd5e1;">${isLastArray[depth-1] ? '└─' : '├─'}</span> `;

  row.innerHTML = `
    <div style="white-space:nowrap; display:flex; align-items:center;">${prefix}${connector}</div>
    <div style="width: 12px; height: 12px; border-radius: 3px; background: ${node.color}; flex-shrink:0; margin-right:4px;"></div>
    <span style="font-size: 11px; font-weight: ${isRoot ? '800' : '600'}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${isRoot ? '🏠 Home' : node.name}</span>
    <div class="row-actions" style="display: flex; gap: 4px; opacity: 0.4;">
       <button class="t-btn btn-add" title="Add SKU">+</button>
       ${!isRoot ? `<button class="t-btn btn-edit">✏️</button><button class="t-btn btn-del">✕</button>` : ''}
    </div>
  `;

  // Folder Expand/Collapse
  row.onclick = (e) => {
    if (e.target.closest('button')) return;
    if (isExpanded) expandedFolders.delete(node.id);
    else expandedFolders.add(node.id);
    save();
  };

  // Drag Events
  row.ondragstart = (e) => {
    draggedItem = { type: 'folder', id: node.id, parentId: null };
    row.style.opacity = '0.4';
    e.dataTransfer.setData('text/plain', node.id);
  };
  row.ondragend = () => { row.style.opacity = '1'; draggedItem = null; };
  
  row.ondragover = (e) => { e.preventDefault(); row.style.background = '#f1f5f9'; };
  row.ondragleave = () => { row.style.background = 'transparent'; };
  row.ondrop = (e) => {
    e.preventDefault();
    row.style.background = 'transparent';
    executeDrop(node.id);
  };

  // Actions
  row.querySelector('.btn-add').onclick = () => startAddSku(node.id);
  if (!isRoot) {
    row.querySelector('.btn-edit').onclick = () => startEditGroup(node.id);
    row.querySelector('.btn-del').onclick = () => {
      if (confirm(`Delete folder "${node.name}" and contents?`)) { removeFolder(skuTree, node.id); save(); }
    };
  }

  container.appendChild(row);

  if (isExpanded || isRoot) {
    const groups = node.groups || [];
    const skus = node.skus || [];
    
    groups.forEach((g, i) => {
      const isLast = (i === groups.length - 1) && (skus.length === 0);
      renderNode(g, container, depth + 1, [...isLastArray, isLast]);
    });

    skus.forEach((s, i) => {
      const isLast = i === skus.length - 1;
      const skuRow = document.createElement('div');
      skuRow.className = 'tree-row sku-row';
      skuRow.draggable = true;
      skuRow.style.padding = '2px 0';
      skuRow.style.display = 'flex';
      skuRow.style.alignItems = 'center';
      skuRow.style.gap = '4px';

      let sPrefix = '';
      for (let j = 0; j < depth; j++) {
         sPrefix += `<span style="font-family:monospace; color:#e2e8f0; width:12px; display:inline-block;">${isLastArray[j] ? '&nbsp;' : '│'}</span>&nbsp;&nbsp;`;
      }
      const sConnector = `<span style="font-family:monospace; color:#cbd5e1;">${isLast ? '└─' : '├─'}</span> `;

      skuRow.innerHTML = `
        <div style="white-space:nowrap; display:flex; align-items:center;">${sPrefix}${sConnector}</div>
        <div style="width: 6px; height: 6px; border-radius: 50%; background: ${s.color}; flex-shrink:0; margin-right:4px;"></div>
        <span style="font-size: 10px; color: #64748b; flex: 1;">${s.name}</span>
        <div class="row-actions" style="display: flex; gap: 4px; opacity: 0.4;">
           <button class="t-btn btn-edit-s">✏️</button><button class="t-btn btn-del-s">✕</button>
        </div>
      `;

      skuRow.ondragstart = (e) => {
        draggedItem = { type: 'sku', id: s.sku, parentId: node.id, index: i };
        skuRow.style.opacity = '0.4';
      };
      skuRow.ondragend = () => { skuRow.style.opacity = '1'; draggedItem = null; };

      skuRow.querySelector('.btn-edit-s').onclick = () => startEditSku(node.id, i);
      skuRow.querySelector('.btn-del-s').onclick = () => { skus.splice(i, 1); save(); };

      container.appendChild(skuRow);
    });
  }
}

// ─── DRAG & DROP LOGIC ───────────────────────────────────────────────────────

function executeDrop(targetFolderId) {
  if (!draggedItem) return;
  if (draggedItem.id === targetFolderId) return; // Cant drop on self

  const targetFolder = findFolder(targetFolderId);
  
  if (draggedItem.type === 'folder') {
     // Prevent dropping parent into child (recursion death)
     if (isDescendant(draggedItem.id, targetFolderId)) {
        setStatus('CANT MOVE PARENT INTO CHILD', 'error');
        return;
     }
     const item = removeFolder(skuTree, draggedItem.id);
     if (item) targetFolder.groups.push(item);
  } else {
     const sourceFolder = findFolder(draggedItem.parentId);
     const item = sourceFolder.skus.splice(draggedItem.index, 1)[0];
     targetFolder.skus.push(item);
  }
  save();
  setStatus('ITEM RE-ATTACHED', 'success');
}

function isDescendant(parentId, targetId) {
  const p = findFolder(parentId);
  return !!findFolder(targetId, p && p !== targetId ? p : null);
}

function removeFolder(root, id) {
  for (let i = 0; i < root.groups.length; i++) {
    if (root.groups[i].id === id) return root.groups.splice(i, 1)[0];
    const f = removeFolder(root.groups[i], id); if (f) return f;
  }
  return null;
}

// ─── FORMS ───────────────────────────────────────────────────────────────────

function startAddSku(parentId) {
  activeParentId = parentId; editingSkuIdx = null;
  document.getElementById('addSkuSection').style.display = 'block';
  document.querySelectorAll('.curr-folder-name').forEach(el => el.textContent = findFolder(parentId).name);
  document.getElementById('sku-input').focus();
}

function startEditGroup(id) {
  const g = findFolder(id); editingGroupId = id;
  document.getElementById('group-name').value = g.name;
  document.getElementById('group-color').value = g.color;
  document.getElementById('group-color-hex').value = g.color.toUpperCase();
  document.getElementById('groupSectionTitle').textContent = 'Edit Folder';
  document.getElementById('addGroupBtnSimple').style.display = 'none';
  document.getElementById('groupEditActions').style.display = 'flex';
}

function startEditSku(parentId, idx) {
  const f = findFolder(parentId); const s = f.skus[idx];
  activeParentId = parentId; editingSkuIdx = idx;
  document.getElementById('sku-input').value = s.sku;
  document.getElementById('sku-display-name').value = s.name;
  document.getElementById('sku-custom-note').value = s.note || '';
  document.getElementById('sku-color').value = s.color;
  document.getElementById('sku-color-hex').value = s.color.toUpperCase();
  document.getElementById('addSkuSection').style.display = 'block';
}

document.getElementById('addGroupBtnSimple').onclick = handleGroupUpsert;
document.getElementById('addGroupBtn').onclick = handleGroupUpsert;
function handleGroupUpsert() {
  const name = document.getElementById('group-name').value.trim();
  const color = document.getElementById('group-color').value;
  if (!name) return;
  if (editingGroupId) {
    const g = findFolder(editingGroupId); g.name = name; g.color = color;
    cancelGroupEdit();
  } else {
    const p = findFolder(activeParentId) || skuTree;
    p.groups.push({ id: 'f'+Date.now(), name, color, groups: [], skus: [] });
    document.getElementById('group-name').value = '';
  }
  save();
}

document.getElementById('saveSkuBtn').onclick = () => {
  const sku = document.getElementById('sku-input').value.trim().toUpperCase();
  const name = document.getElementById('sku-display-name').value.trim() || sku;
  const note = document.getElementById('sku-custom-note').value.trim();
  const color = document.getElementById('sku-color').value;
  if (!sku) return;
  const f = findFolder(activeParentId);
  if (editingSkuIdx !== null) f.skus[editingSkuIdx] = { sku, name, color, note };
  else f.skus.push({ sku, name, color, note });
  cancelAddSku(); save();
};

document.getElementById('cancelGroupEditBtn').onclick = cancelGroupEdit;
function cancelGroupEdit() {
  editingGroupId = null; document.getElementById('groupSectionTitle').textContent = 'New Folder';
  document.getElementById('addGroupBtnSimple').style.display = 'block';
  document.getElementById('groupEditActions').style.display = 'none';
  document.getElementById('group-name').value = '';
}

document.getElementById('cancelSkuBtn').onclick = cancelAddSku;
function cancelAddSku() { editingSkuIdx = null; document.getElementById('addSkuSection').style.display = 'none'; }

// ─── TABGUARD & ACCORDIONS ───────────────────────────────────────────────────

function setupAccordion(hId, cId, iId) {
  const h = document.getElementById(hId), c = document.getElementById(cId), i = document.getElementById(iId);
  if (!h || !c) return;
  h.onclick = () => { const open = c.style.display === 'block'; c.style.display = open ? 'none' : 'block'; i.textContent = open ? '▼' : '▲'; h.style.color = open ? '' : 'var(--primary)'; };
}
setupAccordion('qc-cred-accordion', 'qc-cred-content', 'qc-accordion-icon');
setupAccordion('sku-tracking-accordion', 'sku-tracking-content', 'sku-accordion-icon');
setupAccordion('patterns-accordion', 'patterns-content', 'patterns-accordion-icon');

const PATTERN_FIELDS = ['pkid', 'oid', 'sku'];

function loadPatterns() {
  chrome.storage.local.get(['patterns'], (data) => {
    const p = data.patterns || {
      pkid: { prefix: '1, 12', max: 8 },
      oid: { prefix: '18', max: 8 },
      sku: { prefix: 'JVS', max: 10 }
    };
    PATTERN_FIELDS.forEach(f => {
      document.getElementById(`p-${f}-prefix`).value = p[f].prefix;
      document.getElementById(`p-${f}-max`).value = p[f].max;
    });
  });
}
loadPatterns();

document.getElementById('savePatternsBtn').onclick = () => {
  const p = {};
  PATTERN_FIELDS.forEach(f => {
    p[f] = {
      prefix: document.getElementById(`p-${f}-prefix`).value.trim(),
      max: parseInt(document.getElementById(`p-${f}-max`).value) || 0
    };
  });
  chrome.storage.local.set({ patterns: p }, () => {
    setStatus('PATTERNS SAVED', 'success');
  });
};

function setupColorSync(cId, hId) {
  const c = document.getElementById(cId), h = document.getElementById(hId);
  if (c && h) { 
    c.oninput = () => h.value = c.value.toUpperCase(); 
    h.oninput = () => { if (/^#[0-9A-F]{6}$/i.test(h.value)) c.value = h.value; }; 
  }
}
setupColorSync('group-color', 'group-color-hex');
setupColorSync('sku-color', 'sku-color-hex');

const bindEnter = (ids, bId) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById(bId).click(); }; });
bindEnter(['qc-user', 'qc-pass'], 'saveQCCredBtn');
bindEnter(['titleInput'], 'addBtn');
bindEnter(['group-name'], 'addGroupBtnSimple');
bindEnter(['sku-input', 'sku-display-name', 'sku-custom-note'], 'saveSkuBtn');

// ─── SCRAPER ─────────────────────────────────────────────────────────────────

document.getElementById('scrapeTasksBtn').onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'scrape-tasks' }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus('SCRAPE FAILED: PAGE NOT READY', 'error');
        } else if (response && response.count > 0) {
          setStatus(`SCRAPED ${response.count} NEW SKUS`, 'success');
          // Tree will be updated via sku-sync message back from content script
        } else {
          setStatus('NO NEW SKUS FOUND', '');
        }
      });
    }
  });
};
