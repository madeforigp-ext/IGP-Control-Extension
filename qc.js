// ─── IGP Control: QC & Super QC (Final Routing Fix) ──────────────────────────

console.log('[IGP] QC Script Loaded.');

let settings = { qc_enabled: true, sqc_enabled: true };
let lastDetectionTime = 0; 
let isProcessing = false; // Flag to prevent double triggers

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
  val = (val || "").trim();
  if (/^\d{4}$/.test(val)) return 'TRAY';
  if (/^12\d{6,12}$/.test(val)) return 'PKID';
  if (/^183\d+$/.test(val)) return 'OID';
  return null;
}

function forceSetValue(el, val) {
  if (!el) return false;
  try {
    el.focus();
    el.value = '';
    el.select();
    const ok = document.execCommand('insertText', false, val);
    if (!ok) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (setter) setter.call(el, val); else el.value = val;
    }
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(n => el.dispatchEvent(new Event(n, { bubbles: true })));
    return true;
  } catch (e) { return false; }
}

function clickSearch(targetField) {
  if (isProcessing) return;
  isProcessing = true;
  
  setTimeout(() => {
    const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
    const forbidden = ['profile', 'account', 'user', 'logout', 'settings', 'menu', 'export', 'download', 'excel'];
    
    const isGood = (b) => {
      const txt = (b.innerText || b.value || b.getAttribute('aria-label') || "").toLowerCase();
      return !forbidden.some(k => txt.includes(k)) && !b.disabled && !b.classList.contains('mat-button-disabled');
    };

    // 1. Target "Scan Packet ID" or "Search"
    let btn = allButtons.find(b => {
      const txt = (b.innerText || "").toLowerCase();
      return (txt.includes('scan packet id') || txt.includes('search')) && isGood(b);
    });

    // 2. Local button
    if (!btn && targetField) {
      const container = targetField.closest('form, mat-card, mat-form-field, .form-container') || document.body;
      btn = Array.from(container.querySelectorAll('button')).find(isGood);
    }

    if (btn) {
      console.log('[IGP] Clicking:', btn.innerText || 'Submit');
      btn.click();
    } else if (targetField && targetField.form) {
      console.log('[IGP] Form submit fallback');
      targetField.form.submit();
    }
    
    isProcessing = false;
  }, 350);
}

function getFields() {
  const url = window.location.href;
  const isSQC = url.includes('super-qc');
  
  const inputs = Array.from(document.querySelectorAll('input')).filter(i => i.type !== 'hidden' && i.offsetWidth > 0);
  
  const findByText = (patterns) => {
    return inputs.find(i => {
      const text = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label') || ''}`.toLowerCase();
      return patterns.some(p => text.includes(p));
    });
  };

  // More aggressive label search for SQC
  if (isSQC) {
    const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label'));
    let pkidInput = null;
    for (let l of labels) {
      if (l.innerText.toLowerCase().includes('packet')) {
        const container = l.closest('mat-form-field, .form-group') || l.parentElement;
        pkidInput = container.querySelector('input');
        if (pkidInput) break;
      }
    }
    return {
      pkid: pkidInput || findByText(['packet', 'pkid']) || inputs[0],
      tray: findByText(['tray']),
      oid:  findByText(['order', 'oid'])
    };
  }

  const pkid = findByText(['packet', 'pkid']);
  const tray = findByText(['tray']);
  const oid  = findByText(['order', 'oid']);
  const matInputs = inputs.filter(i => i.classList.contains('mat-input-element'));
  
  return {
    tray: tray || matInputs[1],
    oid:  oid  || matInputs[2],
    pkid: pkid || matInputs[3] || matInputs[0]
  };
}

function handleScan(val, type) {
  const f = getFields();
  const target = (type === 'TRAY') ? f.tray : (type === 'OID' ? f.oid : f.pkid);

  if (target) {
    // If ALREADY focused in the correct target field, do nothing and let native Enter work
    if (document.activeElement === target) {
      console.log('[IGP] Already in target field. Letting native events handle it.');
      return;
    }

    console.log(`[IGP] Redirecting ${type} to:`, target);
    forceSetValue(target, val);
    clickSearch(target);
  } else {
    console.error('[IGP] Could not find field for:', type);
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
    // Shield against scanner-sent Enter keys
    if (now - lastDetectionTime < 600) {
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }

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
        const fields = getFields();
        const target = (type === 'PKID') ? fields.pkid : (type === 'OID' ? fields.oid : null);
        
        // If we're already in the right place, don't hijack
        if (document.activeElement === target) {
          scanBuffer = ''; // Just clear buffer, let characters flow naturally
          return;
        }

        e.preventDefault(); e.stopImmediatePropagation();
        const val = scanBuffer;
        scanBuffer = '';
        lastDetectionTime = Date.now();
        handleScan(val, type);
      }
    }
  }
}, true);
