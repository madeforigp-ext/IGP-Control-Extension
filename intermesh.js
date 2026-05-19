// ─── IGP Control: Intermesh (Settings & Toggles Fix) ────────────────────────

console.log('[IGP] Intermesh Script Loaded.');

let settings = { 
  intermesh_enabled: true,
  intermesh_global_enabled: true 
};

function updateSettings() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['intermesh_enabled', 'intermesh_global_enabled'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data.intermesh_enabled !== undefined) settings.intermesh_enabled = data.intermesh_enabled;
      if (data.intermesh_global_enabled !== undefined) settings.intermesh_global_enabled = data.intermesh_global_enabled;
    });
  }
}
updateSettings();

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.intermesh_enabled) settings.intermesh_enabled = changes.intermesh_enabled.newValue;
    if (changes.intermesh_global_enabled) settings.intermesh_global_enabled = changes.intermesh_global_enabled.newValue;
  });
}

let scanBuffer = '';
let lastKeyTime = Date.now();
let isRedirected = false;

function identifyData(val) {
  val = val.trim();
  if (/^\d{4}$/.test(val)) return 'TRAY';
  if (/^12\d{6,9}$/.test(val)) return 'PKID';
  if (/^183\d+$/.test(val)) return 'OID';
  return null;
}

function identifyPrefix(val) {
  if (val === '120' || val === '121' || val === '12') return 'PKID';
  if (val === '183') return 'OID';
  return null;
}

function getTargetField(type) {
  const patterns = {
    PKID: ['packet', 'pkid', 'pkt'],
    OID:  ['order', 'oid'],
    TRAY: ['tray']
  };
  const searchFor = patterns[type] || [];
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
  
  let field = inputs.find(i => {
    const text = `${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
    return searchFor.some(p => text.includes(p));
  });

  if (!field && type === 'PKID') {
    field = document.querySelector('input[name="packetid"]');
  }
  return field;
}

function triggerSearch(field) {
  if (!field) return;
  const allButtons = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a.button'));
  const keywords = ['search', 'go', 'submit', 'find', 'ok', 'click'];
  let bestBtn = allButtons.find(b => {
    const val = (b.value || b.innerText || b.name || b.id || "").toLowerCase();
    return keywords.some(k => val.includes(k));
  });
  if (bestBtn) { bestBtn.click(); return true; }
  if (field.form) { field.form.submit(); return true; }
  return false;
}

function jumpToField(type, currentBuffer) {
  const field = getTargetField(type);
  if (field && document.activeElement !== field) {
    field.focus();
    field.value = currentBuffer;
    field.setSelectionRange(currentBuffer.length, currentBuffer.length);
    isRedirected = true;
    return true;
  }
  return false;
}

function handleFinalScan(val, type) {
  const field = getTargetField(type);
  if (field) {
    field.focus();
    field.value = val;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => triggerSearch(field), 50);
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  // Master Toggle - stop everything
  if (settings.intermesh_enabled === false) return;

  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (gap > 1000) {
    scanBuffer = '';
    isRedirected = false;
  }

  if (e.key === 'Enter') {
    const val = scanBuffer.trim();
    const type = identifyData(val);
    if (type) {
      e.preventDefault();
      e.stopImmediatePropagation();
      handleFinalScan(val, type);
    }
    scanBuffer = '';
    isRedirected = false;
    return;
  }

  if (e.key.length === 1) {
    if (isRedirected) return;

    scanBuffer += e.key;

    // Global Typing Toggle - only stop the jump/auto-detect
    if (settings.intermesh_global_enabled === false) return;

    const prefixType = identifyPrefix(scanBuffer);
    if (prefixType) {
      if (jumpToField(prefixType, scanBuffer)) {
        e.preventDefault();
      }
    }
  }
}, true);

// ─── AUTO LOGIN ───────────────────────────────────────────────────────────────

function checkAutoLogin() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['autologin_enabled', 'igp_associate', 'igp_user', 'igp_pass', 'intermesh_enabled'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data.intermesh_enabled === false) return; // Respect master toggle
      
      const isLoginPage = document.body.innerText.includes('Please enter your User Name');
      if (!isLoginPage) return;
      if (data.autologin_enabled === false) return;
      if (!data.igp_user || !data.igp_pass) return;

      const associateField = document.querySelectorAll('input[type="text"]')[0];
      const userField      = document.querySelectorAll('input[type="text"]')[1];
      const passField      = document.querySelector('input[type="password"]');
      const loginBtn       = document.querySelector('input[type="submit"], button');

      if (associateField && data.igp_associate) associateField.value = data.igp_associate;
      if (userField) userField.value = data.igp_user;
      if (passField) passField.value = data.igp_pass;
      setTimeout(() => { if (loginBtn) loginBtn.click(); }, 500);
    });
  }
}

checkAutoLogin();
