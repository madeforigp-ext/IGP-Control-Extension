// ─── IGP Control: Intermesh ──────────────────────────────────────────────────

let autologinEnabled = true;
let globalEnabled = true;
let pattern_pkid_prefix = '12,IP';
let pattern_pkid_len    = 14;
let pattern_oid_prefix  = '183';
let pattern_oid_len     = 10;

// Load initial state
chrome.storage.local.get([
  'intermesh_enabled', 'intermesh_global_enabled', 'autologin_enabled',
  'pattern_pkid_prefix', 'pattern_pkid_len', 'pattern_oid_prefix', 'pattern_oid_len'
], (data) => {
  const master = data.intermesh_enabled !== false;
  autologinEnabled = master && data.autologin_enabled !== false;
  globalEnabled    = master && data.intermesh_global_enabled !== false;
  
  if (data.pattern_pkid_prefix) pattern_pkid_prefix = data.pattern_pkid_prefix;
  if (data.pattern_pkid_len)    pattern_pkid_len    = data.pattern_pkid_len;
  if (data.pattern_oid_prefix)  pattern_oid_prefix  = data.pattern_oid_prefix;
  if (data.pattern_oid_len)     pattern_oid_len     = data.pattern_oid_len;
});

// Live toggle update
chrome.storage.onChanged.addListener((changes) => {
  chrome.storage.local.get(['intermesh_enabled', 'intermesh_global_enabled', 'autologin_enabled'], (data) => {
    const master = data.intermesh_enabled !== false;
    autologinEnabled = master && data.autologin_enabled !== false;
    globalEnabled    = master && data.intermesh_global_enabled !== false;
  });

  if (changes.pattern_pkid_prefix) pattern_pkid_prefix = changes.pattern_pkid_prefix.newValue;
  if (changes.pattern_pkid_len)    pattern_pkid_len    = changes.pattern_pkid_len.newValue;
  if (changes.pattern_oid_prefix)  pattern_oid_prefix  = changes.pattern_oid_prefix.newValue;
  if (changes.pattern_oid_len)     pattern_oid_len     = changes.pattern_oid_len.newValue;
});

// ─── CORE ────────────────────────────────────────────────────────────────────

function identifyPrefix(val) {
  val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!val) return null;

  const pkPrefixes = pattern_pkid_prefix.split(',').map(p => p.trim().toUpperCase());
  const oidPrefixes = pattern_oid_prefix.split(',').map(p => p.trim().toUpperCase());

  if (pkPrefixes.includes(val)) return 'PKID';
  if (oidPrefixes.includes(val)) return 'OID';

  return null;
}

function getTargetField(type) {
  const patterns = {
    PKID: ['packet', 'pkid', 'pkt', 'ip', 'individual'],
    OID:  ['order', 'oid']
  };
  const searchFor = patterns[type] || [];
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(i => i.offsetWidth > 0);
  
  let field = inputs.find(i => {
    const text = `${i.name} ${i.id} ${i.placeholder}`.toLowerCase();
    return searchFor.some(p => text.includes(p));
  });

  if (!field) {
    const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label, span, p'));
    for (let l of labels) {
      const txt = (l.innerText || l.textContent || "").toLowerCase();
      if (searchFor.some(p => txt.includes(p))) {
        const container = l.closest('mat-form-field, .form-group, .mat-form-field-wrapper, .mat-form-field-flex') || l.parentElement;
        field = container.querySelector('input');
        if (field) break;
      }
    }
  }

  if (!field && type === 'PKID') {
    field = document.querySelector('input[name="packetid"]');
  }
  return field;
}

function jumpToField(type, currentBuffer) {
  const field = getTargetField(type);
  if (field && document.activeElement !== field) {
    field.focus();
    field.value = currentBuffer;
    if (field.setSelectionRange) field.setSelectionRange(currentBuffer.length, currentBuffer.length);
    return true;
  }
  return false;
}

// ─── GLOBAL KEY DETECTION (FIELD JUMPING) ───────────────────────────────────

let scanBuffer  = '';
let lastKeyTime = 0;
let isRedirected = false;

window.addEventListener('keydown', (e) => {
  if (!globalEnabled) return;

  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (gap > 1000) {
    scanBuffer = '';
    isRedirected = false;
  }

  if (e.key === 'Enter') {
    console.log('[IGP] Enter detected. Routing is SCRAPPED for Intermesh.');
    scanBuffer = '';
    isRedirected = false;
    return;
  }

  if (e.key.length === 1) {
    if (isRedirected) return;
    scanBuffer += e.key;

    const prefixType = identifyPrefix(scanBuffer);
    if (prefixType) {
      console.log('[IGP] Prefix detected:', prefixType, '- Jumping to field.');
      if (jumpToField(prefixType, scanBuffer)) {
        isRedirected = true;
        e.preventDefault();
      }
    }
  }
}, true);

// ─── AUTO LOGIN ───────────────────────────────────────────────────────────────

function checkAutoLogin() {
  if (!document.body.innerText.includes('Please enter your User Name')) return;
  if (!autologinEnabled) return;

  chrome.storage.local.get(['igp_associate', 'igp_user', 'igp_pass'], (data) => {
    if (!data.igp_user || !data.igp_pass) return;
    const fields = document.querySelectorAll('input[type="text"]');
    if (fields[0] && data.igp_associate) fields[0].value = data.igp_associate;
    if (fields[1]) fields[1].value = data.igp_user;
    const pass = document.querySelector('input[type="password"]');
    if (pass) pass.value = data.igp_pass;
    setTimeout(() => {
      const btn = document.querySelector('input[type="submit"], button');
      if (btn) btn.click();
    }, 500);
  });
}

checkAutoLogin();
console.log('[IGP Control] Intermesh ready (Global Detection Only)');
