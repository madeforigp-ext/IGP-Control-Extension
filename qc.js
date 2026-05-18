// ─── IGP Control: QC & Super QC ─────────────────────────────────────────────

function identifyData(val) {
  if (/^\d{4}$/.test(val))    return 'TRAY';
  if (/^183\d{5}$/.test(val)) return 'OID';
  if (/^121\d{5}$/.test(val)) return 'PKID';
  return null;
}

function setAngularValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearAngularValue(el) { setAngularValue(el, ''); }

function clickSearch() {
  const btn = document.querySelector('button[type="submit"]');
  if (btn) btn.click();
}

function getQCFields() {
  const inputs = document.querySelectorAll('input.mat-input-element');
  return { tray: inputs[1], oid: inputs[2], pkid: inputs[3] };
}

function getSuperQCField() {
  return document.querySelectorAll('input.mat-input-element')[1] || null;
}

function handleQC(val, type) {
  const f = getQCFields();
  if (!f.tray || !f.oid || !f.pkid) return;
  if (type === 'TRAY') {
    clearAngularValue(f.oid);
    clearAngularValue(f.pkid);
    setAngularValue(f.tray, val);
  } else if (type === 'PKID') {
    clearAngularValue(f.oid);
    setAngularValue(f.pkid, val);
  } else if (type === 'OID') {
    setAngularValue(f.oid, val);
  }
  setTimeout(() => clickSearch(), 150);
}

function handleSuperQC(val, type) {
  if (type !== 'PKID') return;
  const field = getSuperQCField();
  if (!field) return;
  setAngularValue(field, val);
  setTimeout(() => clickSearch(), 150);
}

// ─── GLOBAL SCANNER INTERCEPT ────────────────────────────────────────────────

let scanBuffer  = '';
let lastKeyTime = 0;
let isScanner   = false;

document.addEventListener('keydown', (e) => {
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
      const url = window.location.href;
      if      (url.includes('personalization/qc-panel'))  handleQC(val, type);
      else if (url.includes('order-mgmt-panel/super-qc')) handleSuperQC(val, type);
    }
    return;
  }

  if (e.key.length === 1) {
    if (gap > 1000) { scanBuffer = ''; }

    // Detect scanner — fast keystrokes
    if (gap < 100) isScanner = true;

    scanBuffer  += e.key;
    lastKeyTime  = now;

    // Auto-trigger only for OID/PKID on scanner speed (not TRAY — needs Enter)
    if (isScanner) {
      const detectedType = identifyData(scanBuffer);
      if (detectedType && detectedType !== 'TRAY') {
        const val = scanBuffer;
        scanBuffer = '';
        isScanner  = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        const url = window.location.href;
        if      (url.includes('personalization/qc-panel'))  handleQC(val, detectedType);
        else if (url.includes('order-mgmt-panel/super-qc')) handleSuperQC(val, detectedType);
      }
    }
  }

}, true);

// ─── ASSEMBLY: Ctrl+F AUTO FOCUS ─────────────────────────────────────────────

function setupAssemblyCtrlF() {
  const observer = new MutationObserver(() => {
    const assemblyInput = document.querySelector('.cdk-overlay-container input');
    if (assemblyInput && !assemblyInput.dataset.srAttached) {
      assemblyInput.dataset.srAttached = 'true';
      assemblyInput.focus();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── INIT ────────────────────────────────────────────────────────────────────

function init() {
  const url = window.location.href;
  if (url.includes('personalization/qc-panel')) {
    setupAssemblyCtrlF();
    console.log('[IGP Control] QC Panel ready');
  } else if (url.includes('order-mgmt-panel/super-qc')) {
    console.log('[IGP Control] Super QC ready');
  }
}

let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(init, 1000);
  }
}, 500);

init();
