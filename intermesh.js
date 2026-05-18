// ─── IGP Control: Intermesh ──────────────────────────────────────────────────

function identifyData(val) {
  if (/^183\d{5}$/.test(val)) return 'OID';
  if (/^121\d{5}$/.test(val)) return 'PKID';
  return null;
}

function getFields() {
  return {
    pkid: document.querySelector('input[name="packetid"]') || null,
    oid:  document.querySelectorAll('input[name="orders_id"]')[0] || null,
  };
}

function clickSearch(el) {
  const btn = el?.closest('td')?.querySelector('input[type="button"], button');
  if (btn) btn.click();
  else {
    // fallback — find search input near field
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
  }
}

// ─── GLOBAL SCANNER INTERCEPT ────────────────────────────────────────────────

let scanBuffer  = '';
let lastKeyTime = 0;
let isScanner   = false;

document.addEventListener('keydown', (e) => {
  chrome.storage.local.get(['intermesh_enabled'], (data) => {
    if (data.intermesh_enabled === false) return;

    const now = Date.now();
    const gap = now - lastKeyTime;

    if (e.key === 'Enter') {
      const val  = scanBuffer.trim();
      scanBuffer = '';
      isScanner  = false;
      const type = identifyData(val);
      if (type) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleData(val, type);
      }
      return;
    }

    if (e.key.length === 1) {
      if (gap > 1000) { scanBuffer = ''; isScanner = false; }
      if (gap < 50) {
        isScanner = true;
        e.preventDefault();
      }
      scanBuffer  += e.key;
      lastKeyTime  = now;

      if (isScanner) {
        const detectedType = identifyData(scanBuffer);
        if (detectedType) {
          const val = scanBuffer;
          scanBuffer = '';
          isScanner  = false;
          e.preventDefault();
          e.stopImmediatePropagation();
          handleData(val, detectedType);
        }
      }
    }
  });
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
