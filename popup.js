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

// Controls Tab Toggles
setupToggle('toggle-qc',              'qc_enabled');
setupToggle('toggle-qc-rightclick',   'qc_rightclick_enabled');
setupToggle('toggle-qc-routing',      'qc_routing_enabled');
setupToggle('toggle-qc-global',       'qc_global_enabled');
setupToggle('toggle-qc-autologin',    'qc_autologin_enabled');

// TabGuard Tab Toggles
setupToggle('toggle-tabguard',        'tabguard_enabled');

// ─── CREDENTIALS ─────────────────────────────────────────────────────────────

// Load existing credentials
chrome.storage.local.get(['qc_user', 'qc_pass'], (data) => {
  if (data.qc_user) document.getElementById('qc-user').value = data.qc_user;
  if (data.qc_pass) document.getElementById('qc-pass').value = data.qc_pass;
});

// Save QC Credentials
document.getElementById('saveQCCredBtn').addEventListener('click', () => {
  const data = {
    qc_user:      document.getElementById('qc-user').value.trim(),
    qc_pass:      document.getElementById('qc-pass').value.trim()
  };
  chrome.storage.local.set(data, () => setStatus('QC credentials saved ✅', 'success'));
});

// Add Enter key support for inputs
const bindEnter = (ids, btnId) => {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById(btnId).click();
      });
    }
  });
};

bindEnter(['qc-user', 'qc-pass'], 'saveQCCredBtn');
bindEnter(['titleInput'], 'addBtn');

// ─── TABGUARD ────────────────────────────────────────────────────────────────

let protectedTitles = [];

chrome.storage.local.get(['protectedTitles'], (data) => {
  protectedTitles = data.protectedTitles || [];
  renderList();
});

document.getElementById('addBtn').addEventListener('click', () => {
  const val = document.getElementById('titleInput').value.trim();
  if (!val) return;
  if (protectedTitles.includes(val)) { 
    setStatus('Already in list.', 'error'); 
    return; 
  }
  protectedTitles.push(val);
  saveTitles(); 
  renderList();
  document.getElementById('titleInput').value = '';
  setStatus('Added to protected list', 'success');
});

document.getElementById('protectCurrentBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const title = tabs[0].title;
    if (protectedTitles.includes(title)) { 
      setStatus('Already protected.', 'error'); 
      return; 
    }
    protectedTitles.push(title);
    saveTitles(); 
    renderList();
    setStatus(`Protected: ${title.slice(0, 20)}...`, 'success');
  });
});

function renderList() {
  const list = document.getElementById('protectedList');
  const emptyState = document.getElementById('emptyState');
  
  // Clear existing tags
  Array.from(list.querySelectorAll('.tag')).forEach(el => el.remove());
  
  emptyState.style.display = protectedTitles.length === 0 ? 'block' : 'none';
  
  protectedTitles.forEach((title, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
      <span title="${title}">${title}</span>
      <button class="tag-remove" data-index="${index}">✕</button>
    `;
    list.appendChild(tag);
  });
  
  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      protectedTitles.splice(idx, 1);
      saveTitles(); 
      renderList();
      setStatus('Removed from list', 'success');
    });
  });
}

function saveTitles() {
  chrome.storage.local.set({ protectedTitles });
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

// ─── SKU TRACKING ────────────────────────────────────────────────────────────

let trackedSKUs = [];

chrome.storage.local.get(['trackedSKUs'], (data) => {
  trackedSKUs = data.trackedSKUs || [];
  renderSkuList();
});

document.getElementById('addSkuBtn').addEventListener('click', () => {
  const sku = document.getElementById('sku-input').value.trim().toUpperCase();
  const name = document.getElementById('sku-name').value.trim();
  const color = document.getElementById('sku-color').value;
  
  if (!sku || !name) {
    setStatus('SKU and Name are required.', 'error');
    return;
  }
  
  if (trackedSKUs.some(item => item.sku === sku)) {
    setStatus('SKU already tracked.', 'error');
    return;
  }
  
  trackedSKUs.push({ sku, name, color });
  chrome.storage.local.set({ trackedSKUs }, () => {
    renderSkuList();
    document.getElementById('sku-input').value = '';
    document.getElementById('sku-name').value = '';
    setStatus('SKU added to tracking', 'success');
  });
});

function renderSkuList() {
  const list = document.getElementById('skuList');
  const emptyState = document.getElementById('skuEmptyState');
  
  Array.from(list.querySelectorAll('.tag')).forEach(el => el.remove());
  emptyState.style.display = trackedSKUs.length === 0 ? 'block' : 'none';
  
  trackedSKUs.forEach((item, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.style.borderLeft = `4px solid ${item.color}`;
    tag.innerHTML = `
      <span title="${item.sku}: ${item.name}"><strong>${item.name}</strong> (${item.sku})</span>
      <button class="tag-remove" data-index="${index}">✕</button>
    `;
    list.appendChild(tag);
  });
  
  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      trackedSKUs.splice(idx, 1);
      chrome.storage.local.set({ trackedSKUs }, () => {
        renderSkuList();
        setStatus('SKU removed', 'success');
      });
    });
  });
}

bindEnter(['sku-input', 'sku-name'], 'addSkuBtn');
