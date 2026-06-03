// ─── IGP Control: Popup Logic (v6.2 Stable) ─────────────────────────────────

const statusEl = document.getElementById('status');

function setStatus(msg, type) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (type || '');
  setTimeout(() => { statusEl.textContent = 'System Ready'; statusEl.className = 'status'; }, 3000);
}

// ─── TABS & TOGGLES ────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabEl = document.getElementById('tab-' + btn.dataset.tab);
    if (tabEl) tabEl.classList.add('active');
  });
});

// ─── SECTION SWITCHER ───────────────────────────────────────────────────────

const switchQC = document.getElementById('switch-qc');
const switchIntermesh = document.getElementById('switch-intermesh');
const qcSection = document.getElementById('qc-section');
const intermeshSection = document.getElementById('intermesh-section');

if (switchQC && switchIntermesh && qcSection && intermeshSection) {
  switchQC.onclick = () => {
    switchQC.classList.add('active');
    switchIntermesh.classList.remove('active');
    qcSection.style.display = 'block';
    intermeshSection.style.display = 'none';
  };
  switchIntermesh.onclick = () => {
    switchIntermesh.classList.add('active');
    switchQC.classList.remove('active');
    intermeshSection.style.display = 'block';
    qcSection.style.display = 'none';
  };
}

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
setupToggle('toggle-intermesh-routing', 'intermesh_routing_enabled');
setupToggle('toggle-intermesh-autologin', 'intermesh_autologin_enabled');
setupToggle('toggle-tabguard', 'tabguard_enabled');

// ─── QC CREDENTIALS ────────────────────────────────────────────────────────

chrome.storage.local.get(['qc_user', 'qc_pass'], (data) => {
  const u = document.getElementById('qc-user');
  const p = document.getElementById('qc-pass');
  if (u && data.qc_user) u.value = data.qc_user;
  if (p && data.qc_pass) p.value = data.qc_pass;
});

const saveQCCredBtn = document.getElementById('saveQCCredBtn');
if (saveQCCredBtn) {
  saveQCCredBtn.onclick = () => {
    const data = {
      qc_user: document.getElementById('qc-user').value.trim(),
      qc_pass: document.getElementById('qc-pass').value.trim()
    };
    chrome.storage.local.set(data, () => setStatus('QC credentials saved ✅', 'success'));
  };
}

// ─── INTERMESH CREDENTIALS ──────────────────────────────────────────────────

chrome.storage.local.get(['intermesh_user', 'intermesh_assoc', 'intermesh_pass'], (data) => {
  const a = document.getElementById('intermesh-assoc');
  const u = document.getElementById('intermesh-user');
  const p = document.getElementById('intermesh-pass');
  if (a && data.intermesh_assoc) a.value = data.intermesh_assoc;
  if (u && data.intermesh_user) u.value = data.intermesh_user;
  if (p && data.intermesh_pass) p.value = data.intermesh_pass;
});

const saveIntermeshBtn = document.getElementById('saveIntermeshCredBtn');
if (saveIntermeshBtn) {
  saveIntermeshBtn.onclick = () => {
    const data = {
      intermesh_assoc: document.getElementById('intermesh-assoc').value.trim(),
      intermesh_user: document.getElementById('intermesh-user').value.trim(),
      intermesh_pass: document.getElementById('intermesh-pass').value.trim()
    };
    chrome.storage.local.set(data, () => setStatus('Intermesh credentials saved ✅', 'success'));
  };
}

// ─── TABGUARD ──────────────────────────────────────────────────────────────

let protectedTitles = [];
chrome.storage.local.get(['protectedTitles'], (data) => { protectedTitles = data.protectedTitles || []; renderTabGuard(); });

const addBtn = document.getElementById('addBtn');
if (addBtn) {
  addBtn.onclick = () => {
    const val = document.getElementById('titleInput').value.trim();
    if (val && !protectedTitles.includes(val)) {
      protectedTitles.push(val);
      chrome.storage.local.set({ protectedTitles }, () => { renderTabGuard(); document.getElementById('titleInput').value = ''; });
    }
  };
}

const protectCurrentBtn = document.getElementById('protectCurrentBtn');
if (protectCurrentBtn) {
  protectCurrentBtn.onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const title = tabs[0].title;
      if (protectedTitles.includes(title)) return setStatus('Already protected.', 'error'); 
      protectedTitles.push(title);
      chrome.storage.local.set({ protectedTitles }, () => {
        renderTabGuard();
        setStatus(`Protected: ${title.slice(0, 20)}...`, 'success');
      });
    });
  };
}

function renderTabGuard() {
  const list = document.getElementById('protectedList');
  if (!list) return;
  list.innerHTML = protectedTitles.length === 0 ? '<div class="empty-state">No tabs protected</div>' : '';
  protectedTitles.forEach((t, i) => {
    const div = document.createElement('div'); div.className = 'tag';
    div.innerHTML = `<span>${t}</span><button class="tag-remove">✕</button>`;
    div.querySelector('button').onclick = () => { protectedTitles.splice(i, 1); chrome.storage.local.set({ protectedTitles }, renderTabGuard); };
    list.appendChild(div);
  });
}

// ─── SKU TRACKING (v6 Drag & Drop) ──────────────────────────────────────────

let skuTree = { id: 'root', name: 'Home', color: '#334155', groups: [], skus: [] };
let expandedFolders = new Set(['root']);
let movingItem = null;
let draggedItem = null;
let editingGroupId = null;
let editingSkuIdx = null;
let activeParentId = 'root';
let searchTerm = '';

chrome.storage.local.get(['skuTree', 'expandedFolders'], (data) => {
  if (data.skuTree) skuTree = data.skuTree;
  if (data.expandedFolders) expandedFolders = new Set(data.expandedFolders);
  renderTree();
});

const searchInput = document.getElementById('sku-search');
if (searchInput) {
  searchInput.oninput = (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTree();
  };
}

function saveTree() {
  chrome.storage.local.get(['patterns'], (data) => {
    chrome.storage.local.set({ skuTree, expandedFolders: Array.from(expandedFolders) }, () => {
      renderTree();
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

function checkMatchRecursive(node) {
  if (!searchTerm) return true;
  if (node.name.toLowerCase().includes(searchTerm)) return true;
  if (node.skus && node.skus.some(s => s.name.toLowerCase().includes(searchTerm) || s.sku.toLowerCase().includes(searchTerm))) return true;
  if (node.groups && node.groups.some(g => checkMatchRecursive(g))) return true;
  return false;
}

function renderTree() {
  const list = document.getElementById('skuList');
  if (!list) return;
  list.innerHTML = '';
  renderNode(skuTree, list, 0, []);
}

function renderNode(node, container, depth, isLastArray) {
  const isRoot = node.id === 'root';
  
  // Search Logic: Check if this node or any children match
  let hasMatch = false;
  if (searchTerm) {
    const nameMatch = node.name.toLowerCase().includes(searchTerm);
    const skuMatch = node.skus && node.skus.some(s => s.name.toLowerCase().includes(searchTerm) || s.sku.toLowerCase().includes(searchTerm));
    const groupMatch = node.groups && node.groups.some(g => checkMatchRecursive(g));
    hasMatch = nameMatch || skuMatch || groupMatch;
    if (!hasMatch && !isRoot) return; // Hide if no match in this branch
  }

  const isExpanded = searchTerm ? true : expandedFolders.has(node.id); // Force expand if searching

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

  let prefix = '';
  for (let i = 0; i < depth - 1; i++) {
     prefix += `<span style="font-family:monospace; color:#e2e8f0; width:12px; display:inline-block;">${isLastArray[i] ? '&nbsp;' : '│'}</span>&nbsp;&nbsp;`;
  }
  const connector = isRoot ? '' : `<span style="font-family:monospace; color:#cbd5e1;">${isLastArray[depth-1] ? '└─' : '├─'}</span> `;

  row.innerHTML = `
    <div style="white-space:nowrap; display:flex; align-items:center;">${prefix}${connector}</div>
    <div style="width: 12px; height: 12px; border-radius: 3px; background: ${node.color || '#334155'}; flex-shrink:0; margin-right:4px;"></div>
    <span style="font-size: 11px; font-weight: ${isRoot ? '800' : '600'}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${isRoot ? '🏠 Home' : node.name}</span>
    <div class="row-actions" style="display: flex; gap: 4px; opacity: 0.4;">
       <button class="t-btn btn-add" title="Add SKU">+</button>
       ${!isRoot ? `<button class="t-btn btn-edit" title="Edit">✏️</button><button class="t-btn btn-move" title="Move">📦</button><button class="t-btn btn-del" title="Delete">✕</button>` : ''}
    </div>
  `;

  row.onclick = (e) => {
    if (e.target.closest('button')) return;
    if (isExpanded) expandedFolders.delete(node.id);
    else expandedFolders.add(node.id);
    saveTree();
  };

  row.ondragstart = (e) => {
    draggedItem = { type: 'folder', id: node.id, parentId: null };
    row.style.opacity = '0.4';
    e.dataTransfer.setData('text/plain', node.id);
  };
  row.ondragend = () => { row.style.opacity = '1'; draggedItem = null; };
  row.ondragover = (e) => { e.preventDefault(); row.style.background = '#f1f5f9'; };
  row.ondragleave = () => { row.style.background = 'transparent'; };
  row.ondrop = (e) => { e.preventDefault(); row.style.background = 'transparent'; executeDrop(node.id); };

  if (movingItem && movingItem.id !== node.id) {
     const moveHere = document.createElement('button');
     moveHere.textContent = 'MOVE HERE';
     moveHere.style.fontSize = '8px'; moveHere.style.background = '#10b981'; moveHere.style.color = '#fff';
     moveHere.style.border = 'none'; moveHere.style.borderRadius = '3px';
     moveHere.onclick = (e) => { e.stopPropagation(); executeDrop(node.id); };
     row.querySelector('.row-actions').prepend(moveHere);
  }

  row.querySelector('.btn-add').onclick = (e) => { e.stopPropagation(); startAddSku(node.id); };
  if (!isRoot) {
    row.querySelector('.btn-edit').onclick = (e) => { e.stopPropagation(); startEditGroup(node.id); };
    row.querySelector('.btn-move').onclick = (e) => { e.stopPropagation(); startMove('folder', node.id); };
    row.querySelector('.btn-del').onclick = (e) => { 
      e.stopPropagation(); 
      if (confirm(`Delete folder "${node.name}" and contents?`)) { removeFolder(skuTree, node.id); saveTree(); }
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
      // Filter SKUs
      if (searchTerm && !s.name.toLowerCase().includes(searchTerm) && !s.sku.toLowerCase().includes(searchTerm) && !node.name.toLowerCase().includes(searchTerm)) return;

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
        <span style="font-size: 10px; color: #64748b; flex: 1;">${s.name} <span style="opacity:0.6">(${s.sku})</span></span>
        <div class="row-actions" style="display: flex; gap: 4px; opacity: 0.4;">
           <button class="t-btn btn-edit-s" title="Edit">✏️</button>
           <button class="t-btn btn-move-s" title="Move">📦</button>
           <button class="t-btn btn-del-s" title="Delete">✕</button>
        </div>
      `;

      skuRow.ondragstart = () => { draggedItem = { type: 'sku', id: s.sku, parentId: node.id, index: i }; skuRow.style.opacity = '0.4'; };
      skuRow.ondragend = () => { skuRow.style.opacity = '1'; draggedItem = null; };

      skuRow.querySelector('.btn-edit-s').onclick = () => startEditSku(node.id, i);
      skuRow.querySelector('.btn-move-s').onclick = () => startMove('sku', s.sku, node.id, i);
      skuRow.querySelector('.btn-del-s').onclick = () => { skus.splice(i, 1); saveTree(); };
      container.appendChild(skuRow);
    });
  }
}

// ─── MOVE SYSTEM ─────────────────────────────────────────────────────────────

function startMove(type, id, parentId, index) {
  movingItem = { type, id, parentId, index };
  setStatus('SELECT TARGET FOLDER', 'success');
  renderTree();
}

function executeDrop(targetFolderId) {
  const itemToMove = draggedItem || movingItem;
  if (!itemToMove) return;
  if (itemToMove.id === targetFolderId) return; 

  const targetFolder = findFolder(targetFolderId);
  
  if (itemToMove.type === 'folder') {
     if (isDescendant(itemToMove.id, targetFolderId)) {
        setStatus('CANT MOVE PARENT INTO CHILD', 'error'); return;
     }
     const item = removeFolder(skuTree, itemToMove.id);
     if (item) targetFolder.groups.push(item);
  } else {
     const sourceFolder = findFolder(itemToMove.parentId);
     const item = sourceFolder.skus.splice(itemToMove.index, 1)[0];
     targetFolder.skus.push(item);
  }
  movingItem = null; draggedItem = null; saveTree(); setStatus('ITEM RE-ATTACHED', 'success');
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
  const s = document.getElementById('addSkuSection');
  if (s) s.style.display = 'block';
  document.querySelectorAll('.curr-folder-name').forEach(el => el.textContent = findFolder(parentId).name);
  const inp = document.getElementById('sku-input');
  if (inp) inp.focus();
}

function startEditGroup(id) {
  const g = findFolder(id); editingGroupId = id;
  const gn = document.getElementById('group-name');
  const gc = document.getElementById('group-color');
  const gch = document.getElementById('group-color-hex');
  if (gn) gn.value = g.name;
  if (gc) gc.value = g.color;
  if (gch) gch.value = g.color.toUpperCase();
  document.getElementById('groupSectionTitle').textContent = 'Edit Folder';
  document.getElementById('addGroupBtnSimple').style.display = 'none';
  document.getElementById('groupEditActions').style.display = 'flex';
}

function startEditSku(parentId, idx) {
  const f = findFolder(parentId); const s = f.skus[idx];
  activeParentId = parentId; editingSkuIdx = idx;
  const si = document.getElementById('sku-input');
  if (si) si.value = s.sku;
  const sdn = document.getElementById('sku-display-name');
  if (sdn) sdn.value = s.name;
  const scn = document.getElementById('sku-custom-note');
  if (scn) scn.value = s.note || '';
  const sc = document.getElementById('sku-color');
  if (sc) sc.value = s.color;
  const sch = document.getElementById('sku-color-hex');
  if (sch) sch.value = s.color.toUpperCase();
  const sSect = document.getElementById('addSkuSection');
  if (sSect) sSect.style.display = 'block';
}

const btnGrpSimple = document.getElementById('addGroupBtnSimple');
if (btnGrpSimple) btnGrpSimple.onclick = handleGroupUpsert;
const btnGrp = document.getElementById('addGroupBtn');
if (btnGrp) btnGrp.onclick = handleGroupUpsert;

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
  saveTree();
}

const saveSkuBtn = document.getElementById('saveSkuBtn');
if (saveSkuBtn) {
  saveSkuBtn.onclick = () => {
    const sku = document.getElementById('sku-input').value.trim().toUpperCase();
    const name = document.getElementById('sku-display-name').value.trim() || sku;
    const note = document.getElementById('sku-custom-note').value.trim();
    const color = document.getElementById('sku-color').value;
    if (!sku) return;
    const f = findFolder(activeParentId);
    if (editingSkuIdx !== null) f.skus[editingSkuIdx] = { sku, name, color, note };
    else f.skus.push({ sku, name, color, note });
    cancelAddSku(); saveTree();
  };
}

const cancelGrpBtn = document.getElementById('cancelGroupEditBtn');
if (cancelGrpBtn) cancelGrpBtn.onclick = cancelGroupEdit;
function cancelGroupEdit() {
  editingGroupId = null; 
  const title = document.getElementById('groupSectionTitle');
  if (title) title.textContent = 'New Folder';
  const simpleBtn = document.getElementById('addGroupBtnSimple');
  if (simpleBtn) simpleBtn.style.display = 'block';
  const acts = document.getElementById('groupEditActions');
  if (acts) acts.style.display = 'none';
  const name = document.getElementById('group-name');
  if (name) name.value = '';
}

const cancelSkuBtn = document.getElementById('cancelSkuBtn');
if (cancelSkuBtn) cancelSkuBtn.onclick = cancelAddSku;
function cancelAddSku() { 
  editingSkuIdx = null; 
  const sect = document.getElementById('addSkuSection');
  if (sect) sect.style.display = 'none'; 
}

// ─── PATTERNS ────────────────────────────────────────────────────────────────

const PATTERN_FIELDS = ['pkid', 'oid', 'sku', 'barcode'];

function loadPatterns() {
  chrome.storage.local.get(['patterns'], (data) => {
    const defaults = {
      pkid: { prefix: '1, 12', max: 8 },
      oid: { prefix: '18', max: 8 },
      sku: { prefix: 'JVS', max: 10 },
      barcode: { prefix: 'HLSDP', max: 20 }
    };
    const p = { ...defaults, ...(data.patterns || {}) };
    PATTERN_FIELDS.forEach(f => {
      const prefEl = document.getElementById(`p-${f}-prefix`);
      const maxEl = document.getElementById(`p-${f}-max`);
      if (prefEl && p[f]) prefEl.value = p[f].prefix;
      if (maxEl && p[f]) maxEl.value = p[f].max;
    });
  });
}
loadPatterns();

const savePatBtn = document.getElementById('savePatternsBtn');
if (savePatBtn) {
  savePatBtn.onclick = () => {
    const p = {};
    PATTERN_FIELDS.forEach(f => {
      p[f] = {
        prefix: document.getElementById(`p-${f}-prefix`).value.trim(),
        max: parseInt(document.getElementById(`p-${f}-max`).value) || 0
      };
    });
    chrome.storage.local.set({ patterns: p }, () => {
      setStatus('PATTERNS SAVED', 'success');
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: 'sku-sync', patterns: p }).catch(() => {}));
      });
    });
  };
}

// ─── SCRAPER ─────────────────────────────────────────────────────────────────

const scrapeBtn = document.getElementById('scrapeTasksBtn');
if (scrapeBtn) {
  scrapeBtn.onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'scrape-tasks' }, (response) => {
          if (chrome.runtime.lastError) {
            setStatus('SCRAPE FAILED: PAGE NOT READY', 'error');
          } else if (response && response.count > 0) {
            setStatus(`SCRAPED ${response.count} NEW SKUS`, 'success');
          } else {
            setStatus('NO NEW SKUS FOUND', '');
          }
        });
      }
    });
  };
}


// ─── ACCORDIONS & UTILS ──────────────────────────────────────────────────────

function setupAccordion(hId, cId, iId) {
  const h = document.getElementById(hId), c = document.getElementById(cId), i = document.getElementById(iId);
  if (!h || !c) return;
  h.onclick = () => { 
    const open = c.style.display === 'block'; 
    c.style.display = open ? 'none' : 'block'; 
    if (i) i.textContent = open ? '▼' : '▲'; 
    h.style.color = open ? '' : 'var(--primary)'; 
  };
}

setupAccordion('qc-cred-accordion', 'qc-cred-content', 'qc-accordion-icon');
setupAccordion('intermesh-cred-accordion', 'intermesh-cred-content', 'intermesh-accordion-icon');
setupAccordion('sku-tracking-accordion', 'sku-tracking-content', 'sku-accordion-icon');
setupAccordion('patterns-accordion', 'patterns-content', 'patterns-accordion-icon');
setupAccordion('data-management-accordion', 'data-management-content', 'data-accordion-icon');

// ─── DATA MANAGEMENT (Export/Import) ────────────────────────────────────────

const exportBtn = document.getElementById('exportDataBtn');
if (exportBtn) {
  exportBtn.onclick = () => {
    chrome.storage.local.get(['skuTree', 'patterns', 'expandedFolders'], (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `igp_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('DATA EXPORTED ✅', 'success');
    });
  };
}

const importBtn = document.getElementById('importDataBtn');
const importFile = document.getElementById('importFile');
if (importBtn && importFile) {
  importBtn.onclick = () => importFile.click();
  importFile.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.skuTree) {
          chrome.storage.local.set(data, () => {
            skuTree = data.skuTree;
            if (data.expandedFolders) expandedFolders = new Set(data.expandedFolders);
            renderTree();
            loadPatterns(); 
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'sku-sync', data: data.skuTree, patterns: data.patterns }).catch(() => {});
              });
            });
            setStatus('DATA IMPORTED ✅', 'success');
          });
        } else { setStatus('INVALID BACKUP FILE', 'error'); }
      } catch (err) { setStatus('IMPORT FAILED', 'error'); }
    };
    reader.readAsText(file);
    importFile.value = '';
  };
}

function setupColorSync(cId, hId) {
  const c = document.getElementById(cId), h = document.getElementById(hId);
  if (c && h) { 
    c.oninput = () => h.value = c.value.toUpperCase(); 
    h.oninput = () => { if (/^#[0-9A-F]{6}$/i.test(h.value)) c.value = h.value; }; 
  }
}
setupColorSync('group-color', 'group-color-hex');
setupColorSync('sku-color', 'sku-color-hex');

const bindEnter = (ids, bId) => ids.forEach(id => { 
  const el = document.getElementById(id); 
  if (el) el.onkeydown = (e) => { 
    if (e.key === 'Enter') {
      const btn = document.getElementById(bId);
      if (btn) btn.click(); 
    }
  }; 
});
bindEnter(['qc-user', 'qc-pass'], 'saveQCCredBtn');
bindEnter(['intermesh-assoc', 'intermesh-user', 'intermesh-pass'], 'saveIntermeshCredBtn');
bindEnter(['titleInput'], 'addBtn');
bindEnter(['group-name'], 'addGroupBtnSimple');
bindEnter(['sku-input', 'sku-display-name', 'sku-custom-note'], 'saveSkuBtn');
