// ─── IGP Control: Popup ──────────────────────────────────────────────────────

const status = document.getElementById('status');

function setStatus(msg, type) {
  status.textContent = msg;
  status.className = 'status ' + (type || '');
  setTimeout(() => { status.textContent = 'Ready.'; status.className = 'status'; }, 3000);
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
  chrome.storage.local.get([storageKey], (data) => {
    el.checked = data[storageKey] !== false;
  });
  el.addEventListener('change', () => {
    chrome.storage.local.set({ [storageKey]: el.checked });
    setStatus(`${storageKey.replace('_enabled','').toUpperCase()} ${el.checked ? 'ON' : 'OFF'}`, 'success');
  });
}

setupToggle('toggle-qc',        'qc_enabled');
setupToggle('toggle-sqc',       'sqc_enabled');
setupToggle('toggle-intermesh', 'intermesh_enabled');
setupToggle('toggle-tabguard',  'tabguard_enabled');

// ─── CREDENTIALS ─────────────────────────────────────────────────────────────

chrome.storage.local.get(['igp_associate', 'igp_user', 'igp_pass'], (data) => {
  if (data.igp_associate) document.getElementById('associate').value = data.igp_associate;
  if (data.igp_user)      document.getElementById('user').value      = data.igp_user;
  if (data.igp_pass)      document.getElementById('pass').value      = data.igp_pass;
});

document.getElementById('saveCredBtn').addEventListener('click', () => {
  chrome.storage.local.set({
    igp_associate: document.getElementById('associate').value.trim(),
    igp_user:      document.getElementById('user').value.trim(),
    igp_pass:      document.getElementById('pass').value.trim()
  }, () => setStatus('Credentials saved ✅', 'success'));
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
  if (protectedTitles.includes(val)) { setStatus('Already in list.', 'error'); return; }
  protectedTitles.push(val);
  saveTitles(); renderList();
  document.getElementById('titleInput').value = '';
});

document.getElementById('titleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('addBtn').click();
});

document.getElementById('protectCurrentBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const title = tabs[0].title;
    if (protectedTitles.includes(title)) { setStatus('Already protected.', 'error'); return; }
    protectedTitles.push(title);
    saveTitles(); renderList();
    setStatus(`Protected: ${title.slice(0, 25)}...`, 'success');
  });
});

function renderList() {
  const list = document.getElementById('protectedList');
  Array.from(list.querySelectorAll('.tag')).forEach(el => el.remove());
  document.getElementById('emptyState').style.display = protectedTitles.length === 0 ? 'block' : 'none';
  protectedTitles.forEach((title, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span title="${title}">${title}</span><button class="tag-remove" data-index="${index}">✕</button>`;
    list.appendChild(tag);
  });
  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      protectedTitles.splice(parseInt(btn.dataset.index), 1);
      saveTitles(); renderList();
    });
  });
}

function saveTitles() {
  chrome.storage.local.set({ protectedTitles });
}
