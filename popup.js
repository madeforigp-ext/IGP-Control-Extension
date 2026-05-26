// ─── IGP Control: Popup Logic ────────────────────────────────────────────────

const statusEl = document.getElementById('status');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (type || '');
  setTimeout(() => { 
    statusEl.textContent = 'System Ready'; 
    statusEl.className = 'status'; 
  }, 3000);
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
  
  chrome.storage.local.get([storageKey], (data) => {
    el.checked = data[storageKey] !== false;
  });
  
  el.addEventListener('change', () => {
    chrome.storage.local.set({ [storageKey]: el.checked });
    const name = storageKey.replace('_enabled', '').replace(/_/g, ' ').toUpperCase();
    setStatus(`${name}: ${el.checked ? 'ON' : 'OFF'}`, 'success');
  });
}

setupToggle('toggle-qc',              'qc_enabled');
setupToggle('toggle-qc-rightclick',   'qc_rightclick_enabled');
setupToggle('toggle-qc-routing',      'qc_routing_enabled');
setupToggle('toggle-qc-global',       'qc_global_enabled');
setupToggle('toggle-qc-autologin',    'qc_autologin_enabled');
setupToggle('toggle-tabguard',        'tabguard_enabled');

// ─── CREDENTIALS ─────────────────────────────────────────────────────────────

chrome.storage.local.get(['qc_user', 'qc_pass'], (data) => {
  if (data.qc_user) document.getElementById('qc-user').value = data.qc_user;
  if (data.qc_pass) document.getElementById('qc-pass').value = data.qc_pass;
});

document.getElementById('saveQCCredBtn').addEventListener('click', () => {
  const data = {
    qc_user:      document.getElementById('qc-user').value.trim(),
    qc_pass:      document.getElementById('qc-pass').value.trim()
  };
  chrome.storage.local.set(data, () => setStatus('QC credentials saved ✅', 'success'));
});

// ─── TABGUARD ────────────────────────────────────────────────────────────────

let protectedTitles = [];

chrome.storage.local.get(['protectedTitles'], (data) => {
  protectedTitles = data.protectedTitles || [];
  renderList();
});

document.getElementById('addBtn').addEventListener('click', () => {
  const val = document.getElementById('titleInput').value.trim();
  if (!val) return;
  if (protectedTitles.includes(val)) return setStatus('Already in list.', 'error'); 
  protectedTitles.push(val);
  chrome.storage.local.set({ protectedTitles }, () => {
    renderList();
    document.getElementById('titleInput').value = '';
    setStatus('Added to protected list', 'success');
  });
});

document.getElementById('protectCurrentBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const title = tabs[0].title;
    if (protectedTitles.includes(title)) return setStatus('Already protected.', 'error'); 
    protectedTitles.push(title);
    chrome.storage.local.set({ protectedTitles }, () => {
      renderList();
      setStatus(`Protected: ${title.slice(0, 20)}...`, 'success');
    });
  });
});

function renderList() {
  const list = document.getElementById('protectedList');
  const emptyState = document.getElementById('emptyState');
  Array.from(list.querySelectorAll('.tag')).forEach(el => el.remove());
  emptyState.style.display = protectedTitles.length === 0 ? 'block' : 'none';
  protectedTitles.forEach((title, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span>${title}</span><button class="tag-remove" data-index="${index}">✕</button>`;
    list.appendChild(tag);
  });
  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.onclick = () => {
      protectedTitles.splice(parseInt(btn.dataset.index), 1);
      chrome.storage.local.set({ protectedTitles }, renderList);
    };
  });
}

// ─── SKU TRACKING (V2) ───────────────────────────────────────────────────────

let trackedGroups = [];
let activeGroupId = null;

chrome.storage.local.get(['trackedGroups'], (data) => {
  trackedGroups = data.trackedGroups || [];
  renderGroupList();
});

document.getElementById('addGroupBtn').addEventListener('click', () => {
  const name = document.getElementById('group-name').value.trim();
  const color = document.getElementById('group-color').value;
  if (!name) return setStatus('Group name required.', 'error');
  
  trackedGroups.push({ id: Date.now(), name, color, skus: [] });
  saveGroups();
  document.getElementById('group-name').value = '';
});

document.getElementById('saveSkuBtn').addEventListener('click', () => {
  const skuVal = document.getElementById('sku-input').value.trim().toUpperCase();
  const displayName = document.getElementById('sku-display-name').value.trim() || skuVal;
  const skuColor = document.getElementById('sku-color').value;
  if (!skuVal) return setStatus('SKU value required.', 'error');

  const group = trackedGroups.find(g => g.id === activeGroupId);
  if (group) {
    if (group.skus.some(s => s.sku === skuVal)) return setStatus('SKU already in group.', 'error');
    group.skus.push({ sku: skuVal, name: displayName, color: skuColor });
    saveGroups();
    cancelAddSku();
  }
});

document.getElementById('cancelSkuBtn').onclick = cancelAddSku;

function cancelAddSku() {
  activeGroupId = null;
  document.getElementById('addSkuSection').style.display = 'none';
  document.getElementById('sku-input').value = '';
  document.getElementById('sku-display-name').value = '';
}

function saveGroups() {
  chrome.storage.local.set({ trackedGroups }, renderGroupList);
}

function renderGroupList() {
  const list = document.getElementById('skuList');
  const emptyState = document.getElementById('skuEmptyState');
  
  Array.from(list.querySelectorAll('.group-item')).forEach(el => el.remove());
  emptyState.style.display = trackedGroups.length === 0 ? 'block' : 'none';

  trackedGroups.forEach((group, gIdx) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group-item';
    groupDiv.style.marginBottom = '8px';
    groupDiv.style.border = '1px solid #e2e8f0';
    groupDiv.style.borderRadius = '8px';
    groupDiv.style.overflow = 'hidden';

    groupDiv.innerHTML = `
      <div style="background: #f8fafc; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 3px; background: ${group.color};"></div>
          <strong style="font-size: 11px;">${group.name}</strong>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="btn-add-sku" data-id="${group.id}" style="border:none; background: #e2e8f0; color: #64748b; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor:pointer;">+ SKU</button>
          <button class="btn-del-group" data-idx="${gIdx}" style="border:none; background: transparent; color: #94a3b8; font-size: 12px; cursor:pointer;">✕</button>
        </div>
      </div>
      <div class="sku-sub-list" style="padding: 4px 8px; background: #fff;">
        ${group.skus.length === 0 ? '<div style="font-size:9px; color:#cbd5e1; font-style:italic; padding: 4px;">No SKUs</div>' : ''}
        ${group.skus.map((s, sIdx) => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding: 2px 4px; font-size: 10px; border-bottom: 1px solid #f8fafc;">
            <div style="display:flex; align-items:center; gap: 6px;">
              <div style="width: 6px; height: 6px; border-radius: 50%; background: ${s.color};"></div>
              <span>${s.sku}</span>
            </div>
            <button class="btn-del-sku" data-gidx="${gIdx}" data-sidx="${sIdx}" style="border:none; background:transparent; color:#cbd5e1; cursor:pointer;">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    list.appendChild(groupDiv);
  });

  // Event Listeners
  list.querySelectorAll('.btn-add-sku').forEach(btn => {
    btn.onclick = () => {
      activeGroupId = parseInt(btn.dataset.id);
      const group = trackedGroups.find(g => g.id === activeGroupId);
      document.getElementById('targetGroupName').textContent = group.name;
      document.getElementById('addSkuSection').style.display = 'block';
      document.getElementById('sku-input').focus();
    };
  });

  list.querySelectorAll('.btn-del-group').forEach(btn => {
    btn.onclick = () => {
      trackedGroups.splice(parseInt(btn.dataset.idx), 1);
      saveGroups();
    };
  });

  list.querySelectorAll('.btn-del-sku').forEach(btn => {
    btn.onclick = () => {
      const gIdx = parseInt(btn.dataset.gidx);
      const sIdx = parseInt(btn.dataset.sidx);
      trackedGroups[gIdx].skus.splice(sIdx, 1);
      saveGroups();
    };
  });
}

// ─── ACCORDIONS ──────────────────────────────────────────────────────────────

function setupAccordion(headerId, contentId, iconId) {
  const header = document.getElementById(headerId);
  const content = document.getElementById(contentId);
  const icon = document.getElementById(iconId);
  if (!header || !content) return;
  header.addEventListener('click', () => {
    const isOpen = content.style.display === 'block';
    content.style.display = isOpen ? 'none' : 'block';
    icon.textContent = isOpen ? '▼' : '▲';
    header.style.color = isOpen ? '' : 'var(--primary)';
  });
}

setupAccordion('qc-cred-accordion', 'qc-cred-content', 'qc-accordion-icon');
setupAccordion('sku-tracking-accordion', 'sku-tracking-content', 'sku-accordion-icon');

// Helper for Enter key
const bindEnter = (ids, btnId) => {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById(btnId).click(); };
  });
};
bindEnter(['qc-user', 'qc-pass'], 'saveQCCredBtn');
bindEnter(['titleInput'], 'addBtn');
bindEnter(['group-name'], 'addGroupBtn');
bindEnter(['sku-input'], 'saveSkuBtn');
