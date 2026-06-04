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
setupToggle('toggle-sku-styling', 'sku_styling_enabled');
setupToggle('toggle-sku-pending', 'sku_pending_enabled');
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

// Advanced Styling State
let currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
let styleModalTarget = null; // 'group' or 'sku'

function getStyleString(color, adv) {
  const { texture = 'solid', gloss = 50, stripes = 30, dots = 0 } = adv || {};
  let bg = `linear-gradient(90deg, ${color} 50%, ${color} 50%)`;
  let bgSize = 'auto';

  // 1. Textures
  if (texture === 'wood') {
    bg = `repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 10px), ${bg}`;
  } else if (texture === 'metal') {
    bg = `linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.1) 100%), ${bg}`;
  } else if (texture === 'carbon') {
    bg = `linear-gradient(45deg, rgba(0,0,0,0.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.2)), 
          linear-gradient(45deg, rgba(0,0,0,0.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.2)), ${bg}`;
    bgSize = '4px 4px, 4px 4px, 100% 100%';
  } else if (texture === 'honey') {
    bg = `repeating-linear-gradient(120deg, rgba(255,255,255,0.1), rgba(255,255,255,0.1) 1px, transparent 1px, transparent 10px), ${bg}`;
  } else if (texture === 'glass') {
    bg = `linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%), ${bg}`;
  }

  // 2. Effects
  if (dots > 0) {
    bg = `radial-gradient(rgba(255,255,255,${dots/100}) 1.5px, transparent 1.5px), ${bg}`;
    bgSize = bgSize === 'auto' ? '6px 6px, 100% 100%' : `6px 6px, ${bgSize}`;
  }
  if (stripes > 0) {
    bg = `repeating-linear-gradient(45deg, rgba(255,255,255,${stripes/100}), rgba(255,255,255,${stripes/100}) 4px, transparent 4px, transparent 8px), ${bg}`;
  }
  if (gloss > 0) {
    const gl = gloss / 100;
    bg = `radial-gradient(ellipse at 50% 25%, rgba(255,255,255,${gl * 0.9}) 0%, transparent 60%), 
          linear-gradient(to bottom, rgba(255,255,255,${gl * 0.3}) 0%, transparent 50%, rgba(0,0,0,${gl * 0.4}) 100%), ${bg}`;
  }

  return `background: ${bg}; background-size: ${bgSize};`;
}

// Modal Handlers
function openStyleModal(target) {
  styleModalTarget = target;
  const color = target === 'group' ? document.getElementById('group-color').value : document.getElementById('sku-color').value;
  updateModalPreview(color);
  document.getElementById('styleModalOverlay').style.display = 'flex';
}

function updateModalPreview(color) {
  const preview = document.getElementById('modalPreview');
  preview.style.cssText = getStyleString(color, currentAdvStyle);
}

// Initialize Sliders
['gloss', 'stripes', 'dots'].forEach(key => {
  const range = document.getElementById(`range-${key}`);
  const val = document.getElementById(`val-${key}`);
  range.oninput = () => {
    currentAdvStyle[key] = range.value;
    val.textContent = range.value + '%';
    const color = styleModalTarget === 'group' ? document.getElementById('group-color').value : document.getElementById('sku-color').value;
    updateModalPreview(color);
  };
});

// Texture Buttons
document.querySelectorAll('.texture-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.texture-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentAdvStyle.texture = btn.dataset.texture;
    const color = styleModalTarget === 'group' ? document.getElementById('group-color').value : document.getElementById('sku-color').value;
    updateModalPreview(color);
  };
});

document.getElementById('applyStyleBtn').onclick = () => {
  document.getElementById('styleModalOverlay').style.display = 'none';
  renderTree(); // Update tree previews
};

// Bind Modal Open Buttons
document.querySelectorAll('.open-style-btn').forEach(btn => {
  btn.onclick = (e) => {
     e.preventDefault();
     // Load existing style if editing
     if (btn.dataset.target === 'group' && editingGroupId) {
       const g = findFolder(editingGroupId);
       if (g.advStyle) Object.assign(currentAdvStyle, g.advStyle);
     } else if (btn.dataset.target === 'sku' && editingSkuIdx !== null) {
       const f = findFolder(activeParentId);
       const s = f.skus[editingSkuIdx];
       if (s.advStyle) Object.assign(currentAdvStyle, s.advStyle);
     } else {
       // Reset for new
       currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
     }
     
     // Sync sliders UI
     ['gloss', 'stripes', 'dots'].forEach(k => {
       document.getElementById(`range-${k}`).value = currentAdvStyle[k];
       document.getElementById(`val-${k}`).textContent = currentAdvStyle[k] + '%';
     });
     document.querySelectorAll('.texture-btn').forEach(b => {
       b.classList.toggle('active', b.dataset.texture === currentAdvStyle.texture);
     });

     openStyleModal(btn.dataset.target);
  };
});

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

function findFolder(id, node = skuTree) {
  if (!id || !node) return null;
  if (node.id === id) return node;
  for (const g of (node.groups || [])) {
    const found = findFolder(id, g);
    if (found) return found;
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
  if (isRoot) {
    // Root just renders its children
    if (node.groups) node.groups.forEach((g, i) => renderNode(g, container, 1, [i === node.groups.length - 1 && (!node.skus || node.skus.length === 0)]));
    if (node.skus) node.skus.forEach((s, i) => renderNode({ ...s, type: 'sku', _parentId: 'root', _index: i }, container, 1, [i === node.skus.length - 1]));
    return;
  }

  const isSku = node.type === 'sku' || !!node.sku;

  // Search Logic
  if (searchTerm) {
    if (isSku) {
      if (!node.name.toLowerCase().includes(searchTerm) && !node.sku.toLowerCase().includes(searchTerm)) return;
    } else {
      if (!checkMatchRecursive(node)) return;
    }
  }

  const isExpanded = searchTerm ? true : expandedFolders.has(node.id);
  const row = document.createElement('div');
  row.className = 'tree-row' + (isSku ? ' sku-row' : '');

  // Color dot
  const dot = document.createElement('div');
  dot.className = 'color-dot';
  dot.style.cssText += getStyleString(node.color || (isSku ? '#3498db' : '#334155'), node.advStyle);
  row.appendChild(dot);

  // Text
  const text = document.createElement('span');
  text.className = 'node-text';
  text.textContent = isSku ? `${node.name} (${node.sku})` : node.name;
  if (!isSku) text.style.fontWeight = '700';
  row.appendChild(text);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (isSku) {
    actions.innerHTML = `
      <button class="t-btn btn-edit-s" title="Edit">✏️</button>
      <button class="t-btn btn-move-s" title="Move">📦</button>
      <button class="t-btn btn-del-s" title="Delete">✕</button>
    `;
  } else {
    actions.innerHTML = `
      <button class="t-btn btn-add" title="Add SKU">+</button>
      <button class="t-btn btn-edit" title="Edit">✏️</button>
      <button class="t-btn btn-move" title="Move">📦</button>
      <button class="t-btn btn-del" title="Delete">✕</button>
    `;
  }
  row.appendChild(actions);

  // Click & Drag logic
  if (!isSku) {
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      if (movingItem) {
        executeDrop(node.id);
      } else {
        if (isExpanded) expandedFolders.delete(node.id);
        else expandedFolders.add(node.id);
        saveTree();
      }
    };
    row.querySelector('.btn-add').onclick = (e) => { e.stopPropagation(); startAddSku(node.id); };
    row.querySelector('.btn-edit').onclick = (e) => { e.stopPropagation(); startEditGroup(node.id); };
    row.querySelector('.btn-move').onclick = (e) => { e.stopPropagation(); startMove('folder', node.id); };
    row.querySelector('.btn-del').onclick = (e) => { 
      e.stopPropagation(); 
      if (confirm(`Delete folder "${node.name}" and contents?`)) { removeFolder(skuTree, node.id); saveTree(); }
    };
  } else {
    // Sku specific actions
    const idx = node._index; 
    row.onclick = (e) => {
       if (movingItem && !e.target.closest('button')) {
          // If we click a SKU while moving, treat it as clicking its parent folder
          executeDrop(node._parentId);
       }
    };
    row.querySelector('.btn-edit-s').onclick = (e) => { e.stopPropagation(); startEditSku(node._parentId, node._index); };
    row.querySelector('.btn-move-s').onclick = (e) => { e.stopPropagation(); startMove('sku', node.sku, node._parentId, node._index); };
    row.querySelector('.btn-del-s').onclick = (e) => { 
      e.stopPropagation(); 
      const parent = findFolder(node._parentId);
      if (parent) { parent.skus.splice(node._index, 1); saveTree(); }
    };
  }

  container.appendChild(row);

  if (!isSku && (isExpanded || isRoot)) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'igp-children';
    container.appendChild(childrenContainer);

    const groups = node.groups || [];
    const skus = node.skus || [];
    
    groups.forEach((g, i) => {
      const isLast = (i === groups.length - 1) && (skus.length === 0);
      renderNode(g, childrenContainer, depth + 1, [...isLastArray, isLast]);
    });

    skus.forEach((s, i) => {
      const isLast = i === skus.length - 1;
      renderNode({ ...s, type: 'sku', _parentId: node.id, _index: i }, childrenContainer, depth + 1, [...isLastArray, isLast]);
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

  // Cancel move if dropped on itself or its own parent
  if (itemToMove.id === targetFolderId || (itemToMove.type === 'sku' && itemToMove.parentId === targetFolderId)) {
      movingItem = null; draggedItem = null; setStatus('MOVE CANCELLED', ''); renderTree(); return;
  }

  const targetFolder = findFolder(targetFolderId);
  if (!targetFolder) return;

  if (!targetFolder.groups) targetFolder.groups = [];
  if (!targetFolder.skus) targetFolder.skus = [];

  if (itemToMove.type === 'folder') {
     if (isDescendant(itemToMove.id, targetFolderId)) {
        setStatus('CANT MOVE PARENT INTO CHILD', 'error');
        movingItem = null; draggedItem = null; renderTree(); return;
     }
     const item = removeFolder(skuTree, itemToMove.id);
     if (item) targetFolder.groups.push(item);
  } else {
     const sourceFolder = findFolder(itemToMove.parentId);
     if (sourceFolder && sourceFolder.skus) {
       let sIdx = itemToMove.index;
       if (sourceFolder.skus[sIdx]?.sku !== itemToMove.id) {
           sIdx = sourceFolder.skus.findIndex(s => s.sku === itemToMove.id);
       }
       if (sIdx !== -1) {
         const item = sourceFolder.skus.splice(sIdx, 1)[0];
         targetFolder.skus.push(item);
       }
     }
  }
  movingItem = null; draggedItem = null; saveTree(); setStatus('ITEM RE-ATTACHED', 'success');
}

function isDescendant(parentId, targetId) {
  const p = findFolder(parentId);
  if (!p) return false;
  return !!findFolder(targetId, p);
}

function removeFolder(root, id) {
  if (!root || !root.groups) return null;
  for (let i = 0; i < root.groups.length; i++) {
    if (root.groups[i].id === id) return root.groups.splice(i, 1)[0];
    const f = removeFolder(root.groups[i], id); 
    if (f) return f;
  }
  return null;
}

// ─── FORMS ───────────────────────────────────────────────────────────────────

function startAddSku(parentId) {
  activeParentId = parentId; editingSkuIdx = null;
  currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 }; // Reset for new
  const s = document.getElementById('addSkuSection');
  if (s) s.style.display = 'block';
  document.querySelectorAll('.curr-folder-name').forEach(el => el.textContent = findFolder(parentId).name);
  
  // Clear inputs
  document.getElementById('sku-input').value = '';
  document.getElementById('sku-display-name').value = '';
  document.getElementById('sku-custom-note').value = '';
  document.getElementById('sku-color').value = '#3498db';
  document.getElementById('sku-color-hex').value = '#3498DB';

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
  
  // Load advanced style
  if (g.advStyle) currentAdvStyle = { ...g.advStyle };
  else currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };

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

  // Load advanced style
  if (s.advStyle) currentAdvStyle = { ...s.advStyle };
  else currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };

  const sSect = document.getElementById('addSkuSection');
  if (sSect) sSect.style.display = 'block';
  document.getElementById('skuSectionAction').textContent = 'Edit SKU';
}

const btnGrpSimple = document.getElementById('addGroupBtnSimple');
if (btnGrpSimple) btnGrpSimple.onclick = handleGroupUpsert;
const btnGrp = document.getElementById('addGroupBtn');
if (btnGrp) btnGrp.onclick = handleGroupUpsert;

function handleGroupUpsert() {
  const name = document.getElementById('group-name').value.trim();
  const colorPicker = document.getElementById('group-color').value;
  const colorHex = document.getElementById('group-color-hex').value.trim();
  const color = /^#[0-9A-F]{6}$/i.test(colorHex) ? colorHex : colorPicker;

  if (!name) return;
  if (editingGroupId) {
    const g = findFolder(editingGroupId); 
    g.name = name; 
    g.color = color; 
    g.advStyle = { ...currentAdvStyle };
    cancelGroupEdit();
  } else {
    const p = findFolder(activeParentId) || skuTree;
    p.groups.push({ id: 'f'+Date.now(), name, color, advStyle: { ...currentAdvStyle }, groups: [], skus: [] });
    document.getElementById('group-name').value = '';
    currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
  }
  saveTree();
}

const saveSkuBtn = document.getElementById('saveSkuBtn');
if (saveSkuBtn) {
  saveSkuBtn.onclick = () => {
    const sku = document.getElementById('sku-input').value.trim().toUpperCase();
    const name = document.getElementById('sku-display-name').value.trim() || sku;
    const note = document.getElementById('sku-custom-note').value.trim();
    const colorPicker = document.getElementById('sku-color').value;
    const colorHex = document.getElementById('sku-color-hex').value.trim();
    const color = /^#[0-9A-F]{6}$/i.test(colorHex) ? colorHex : colorPicker;

    if (!sku) return;
    const f = findFolder(activeParentId);
    const advStyle = { ...currentAdvStyle };
    if (editingSkuIdx !== null) {
      f.skus[editingSkuIdx] = { sku, name, color, note, advStyle };
    } else {
      f.skus.push({ sku, name, color, note, advStyle });
    }
    cancelAddSku(); saveTree();
    currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
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
  currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
}

const cancelSkuBtn = document.getElementById('cancelSkuBtn');
if (cancelSkuBtn) cancelSkuBtn.onclick = cancelAddSku;
function cancelAddSku() { 
  editingSkuIdx = null; 
  const sect = document.getElementById('addSkuSection');
  if (sect) sect.style.display = 'none'; 
  document.getElementById('skuSectionAction').textContent = 'Add SKU';
  currentAdvStyle = { texture: 'solid', gloss: 0, stripes: 0, dots: 0 };
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
