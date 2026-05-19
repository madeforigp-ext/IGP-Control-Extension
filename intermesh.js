// ─── IGP Control: Intermesh ──────────────────────────────────────────────────

let settings = { intermesh_enabled: true };
chrome.storage.local.get(['intermesh_enabled'], (data) => {
  if (data.intermesh_enabled !== undefined) settings.intermesh_enabled = data.intermesh_enabled;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.intermesh_enabled) settings.intermesh_enabled = changes.intermesh_enabled.newValue;
});

function identifyData(val) {
  if (/^\d{4}$/.test(val))      return 'TRAY';
  if (/^183\d{5,}$/.test(val))  return 'OID';
  if (/^121\d{5,}$/.test(val))  return 'PKID';
  return null;
}

function getFields() {
  const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
  const findBy = (txt) => inputs.find(i => 
    (i.name && i.name.toLowerCase().includes(txt)) || 
    (i.id && i.id.toLowerCase().includes(txt)) ||
    (i.placeholder && i.placeholder.toLowerCase().includes(txt))
  );

  return {
    pkid: findBy('packet') || findBy('packetid') || document.querySelector('input[name="packetid"]') || null,
    oid:  findBy('orders_id') || document.querySelectorAll('input[name="orders_id"]')[0] || null,
    tray: findBy('tray') || null
  };
}

function clickSearch(el) {
  const btn = el?.closest('td')?.querySelector('input[type="button"], button');
  if (btn) btn.click();
  else {
    const inputs = document.querySelectorAll('input[type="button"][value="search"], input[type="submit"]');
    if (inputs[0]) inputs[0].click();
  }
}

function handleData(val, type) {
  const f = getFields();
  if (type === 'PKID' && f.pkid) {
    f.pkid.value = val;
    f.pkid.focus();
    setTimeout(() => clickSearch(f.pkid), 100);
  } else if (type === 'OID' && f.oid) {
    f.oid.value = val;
    f.oid.focus();
    setTimeout(() => clickSearch(f.oid), 100);
  } else if (type === 'TRAY' && f.tray) {
    f.tray.value = val;
    f.tray.focus();
    setTimeout(() => clickSearch(f.tray), 100);
  }
}

// ─── GLOBAL SCANNER INTERCEPT ────────────────────────────────────────────────

let scanBuffer  = '';
let lastKeyTime = 0;

document.addEventListener('keydown', (e) => {
  if (settings.intermesh_enabled === false) return;

  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (e.key === 'Enter') {
    const val  = scanBuffer.trim();
    scanBuffer = '';
    const type = identifyData(val);
    if (type) {
      e.preventDefault();
      e.stopImmediatePropagation();
      handleData(val, type);
    }
    return;
  }

  if (e.key.length === 1) {
    if (gap > 200) scanBuffer = '';
    scanBuffer += e.key;

    // Fast keystroke detection (scanner)
    if (gap < 60) {
      const detectedType = identifyData(scanBuffer);
      if (detectedType && detectedType !== 'TRAY') {
        const val = scanBuffer;
        scanBuffer = '';
        e.preventDefault();
        e.stopImmediatePropagation();
        handleData(val, detectedType);
      }
    }
  }
}, true);

// ─── AUTO LOGIN ───────────────────────────────────────────────────────────────

function checkAutoLogin() {
  const isLoginPage = document.body.innerText.includes('Please enter your User Name');
  if (!isLoginPage) return;

  chrome.storage.local.get(['autologin_enabled', 'igp_associate', 'igp_user', 'igp_pass'], (data) => {
    if (data.autologin_enabled === false) return;
    if (!data.igp_user || !data.igp_pass) return;

    const associateField = document.querySelectorAll('input[type="text"]')[0];
    const userField      = document.querySelectorAll('input[type="text"]')[1];
    const passField      = document.querySelector('input[type="password"]');
    const loginBtn       = document.querySelector('input[type="submit"], button');

    if (associateField && data.igp_associate) associateField.value = data.igp_associate;
    if (userField)  userField.value  = data.igp_user;
    if (passField)  passField.value  = data.igp_pass;
    setTimeout(() => { if (loginBtn) loginBtn.click(); }, 500);
  });
}

checkAutoLogin();
console.log('[IGP Control] Intermesh ready — global scan active');
