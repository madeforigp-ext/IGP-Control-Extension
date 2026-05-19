// ─── IGP Control: QC & Super QC ─────────────────────────────────────────────

console.log('[IGP] QC Script Loaded.');

let settings = { 
  qc_enabled: true, 
  sqc_enabled: true 
};

// Robust storage access
function updateSettings() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['qc_enabled', 'sqc_enabled'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data.qc_enabled !== undefined)  settings.qc_enabled  = data.qc_enabled;
      if (data.sqc_enabled !== undefined) settings.sqc_enabled = data.sqc_enabled;
    });
  }
}
updateSettings();

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.qc_enabled)  settings.qc_enabled  = changes.qc_enabled.newValue;
    if (changes.sqc_enabled) settings.sqc_enabled = changes.sqc_enabled.newValue;
  });
}

function identifyData(val) {
  val = val.trim();
  if (/^\d{4}$/.test(val)) return 'TRAY';
  if (/^12\d{6,9}$/.test(val)) return 'PKID';
  if (/^183\d+$/.test(val)) return 'OID';
  return null;
}

function forceSetValue(el, val) {
  if (!el) return false;
  try {
    el.focus();
    // Clear existing
    el.value = '';
    // Use execCommand to simulate real typing (crucial for Angular Material validation)
    el.select();
    const ok = document.execCommand('insertText', false, val);
    
    if (!ok) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (setter) setter.call(el, val);
      else el.value = val;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  } catch (e) { return false; }
}

function clickSearch() {
  const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
  
  // 1. Look for an ENABLED search button (avoiding exports)
  let btn = allButtons.find(b => {
    const txt = (b.innerText || b.value || "").toLowerCase();
    const isSearch = txt.includes('search') || b.classList.contains('search-btn');
    const isExport = txt.includes('export') || txt.includes('download') || txt.includes('excel');
    const isDisabled = b.disabled || b.classList.contains('mat-button-disabled');
    return isSearch && !isExport && !isDisabled;
  });

  // 2. Fallback: Any ENABLED primary/submit button that isn't export
  if (!btn) {
    btn = allButtons.find(b => {
      const txt = (b.innerText || b.value || "").toLowerCase();
      const isExport = txt.includes('export') || txt.includes('download') || txt.includes('excel');
      const isSubmit = b.type === 'submit' || b.classList.contains('mat-raised-button');
      const isDisabled = b.disabled || b.classList.contains('mat-button-disabled');
      return isSubmit && !isExport && !isDisabled;
    });
  }

  if (btn) {
    console.log('[IGP] Clicking Search button:', btn);
    btn.click();
    return true;
  }

  // 3. Last Resort: Force submit the form if the button is still disabled
  console.warn('[IGP] No enabled search button found. Trying form submit.');
  const pkidField = findInput(['packet', 'pkid'], ['task']);
  if (pkidField && pkidField.form) {
    pkidField.form.submit();
    return true;
  }

  return false;
}

function findInput(patterns, antiPatterns = []) {
  const inputs = Array.from(document.querySelectorAll('input'));
  const check = (str) => str && patterns.some(p => str.toLowerCase().includes(p)) && !antiPatterns.some(ap => str.toLowerCase().includes(ap));
  for (let i of inputs) {
    const attrText = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('formcontrolname') || ''} ${i.getAttribute('aria-label') || ''}`;
    if (check(attrText)) return i;
  }
  const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label'));
  for (let l of labels) {
    if (check(l.innerText)) {
      const container = l.closest('mat-form-field, .form-group') || l.parentElement;
      const input = container.querySelector('input');
      if (input) return input;
    }
  }
  return null;
}

function getFields() {
  const pkid = findInput(['packet', 'pkid'], ['task', 'assignment', 'filter']);
  const tray = findInput(['tray'], ['filter']);
  const oid  = findInput(['order', 'oid'], ['packet', 'pkid', 'task', 'filter']);
  
  const allMat = Array.from(document.querySelectorAll('input.mat-input-element'));
  
  if (window.location.href.includes('super-qc')) {
    return {
      tray: tray || null,
      oid: oid || null,
      pkid: pkid || allMat.find(i => i.placeholder?.toLowerCase().includes('packet')) || allMat[1] || allMat[0]
    };
  }

  return { tray: tray || allMat[1], oid:  oid  || allMat[2], pkid: pkid || allMat[3] || allMat[1] };
}

function handleScan(val, type) {
  const f = getFields();
  const isSQC = window.location.href.includes('order-mgmt-panel/super-qc');
  const target = (type === 'TRAY') ? f.tray : (type === 'OID' ? f.oid : f.pkid);

  if (target) {
    if (document.activeElement === target && val.length < 8) return;
    
    // Clear other fields to avoid validation errors
    if (!isSQC) {
      if (f.tray && type !== 'TRAY') forceSetValue(f.tray, '');
      if (f.oid && type !== 'OID')   forceSetValue(f.oid, '');
      if (f.pkid && type !== 'PKID') forceSetValue(f.pkid, '');
    }

    forceSetValue(target, val);
    // Increased delay to ensure the "Search" button enables after the value is set
    setTimeout(() => clickSearch(), 300);
  }
}

let scanBuffer = '';
let lastKeyTime = Date.now();

document.addEventListener('keydown', (e) => {
  try { if (!chrome.runtime?.id) return; } catch (e) { return; }

  const url = window.location.href;
  const isQC = url.includes('personalization/qc-panel');
  const isSQC = url.includes('order-mgmt-panel/super-qc');

  if (!isQC && !isSQC) return;
  if (isQC && settings.qc_enabled === false) return;
  if (isSQC && settings.sqc_enabled === false) return;

  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (e.key === 'Enter') {
    const val = scanBuffer.trim();
    const type = identifyData(val);
    if (type) {
      e.preventDefault(); e.stopImmediatePropagation();
      handleScan(val, type);
    }
    scanBuffer = '';
    return;
  }

  if (e.key.length === 1) {
    if (gap > 1000) scanBuffer = '';
    scanBuffer += e.key;

    if (scanBuffer.length >= 8) {
      const type = identifyData(scanBuffer);
      if (type && type !== 'TRAY') {
        const val = scanBuffer;
        const isCorrect = (type === 'PKID' && document.activeElement.placeholder?.toLowerCase().includes('packet'));
        if (!isCorrect) {
          e.preventDefault(); e.stopImmediatePropagation();
          scanBuffer = '';
          handleScan(val, type);
        }
      }
    }
  }
}, true);
