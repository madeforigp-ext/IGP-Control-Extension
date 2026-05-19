// ─── IGP Control: QC & Super QC (Overwrite & Clear Fix) ─────────────────────

console.log('[IGP] QC Script Loaded.');

let settings = { qc_enabled: true, sqc_enabled: true };
let lastAutoSearchTime = 0; 
let isProcessing = false;

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
  if (/^12\d{6,12}$/.test(val)) return 'PKID';
  if (/^183\d+$/.test(val)) return 'OID';
  if (/^\d{4}$/.test(val)) return 'TRAY';
  return null;
}

function forceSetValue(el, val) {
  if (!el) return false;
  console.log(`[IGP] Overwriting field with: "${val}"`);
  try {
    el.focus();
    el.value = ''; // Explicit clear
    
    // Trigger Angular / Material validation
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(n => {
      el.dispatchEvent(new Event(n, { bubbles: true }));
    });

    // Deep set using execCommand
    el.select();
    document.execCommand('insertText', false, val);
    
    return true;
  } catch (e) { 
    return false; 
  }
}

function clickSearch(targetField) {
  if (isProcessing) return;
  isProcessing = true;
  
  setTimeout(() => {
    const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
    const forbidden = ['profile', 'account', 'user', 'logout', 'settings', 'menu', 'export', 'download', 'excel'];
    
    const isGood = (b) => {
      const txt = (b.innerText || b.value || "").toLowerCase();
      const isVisible = b.offsetWidth > 0 && b.offsetHeight > 0;
      return !forbidden.some(k => txt.includes(k)) && !b.disabled && isVisible;
    };

    let btn = allButtons.find(b => {
      const txt = (b.innerText || "").toLowerCase();
      return (txt.includes('scan packet id') || txt.includes('search')) && isGood(b);
    });

    if (!btn && targetField) {
      const container = targetField.closest('form, mat-card, .search-container') || document.body;
      btn = Array.from(container.querySelectorAll('button')).find(isGood);
    }

    if (btn) {
      console.log('[IGP] Triggering Search.');
      lastAutoSearchTime = Date.now();
      btn.click();
    } else if (targetField && targetField.form) {
      lastAutoSearchTime = Date.now();
      targetField.form.submit();
    }
    isProcessing = false;
  }, 400);
}

function getFields() {
  const isSQC = window.location.href.includes('super-qc');
  const inputs = Array.from(document.querySelectorAll('input')).filter(i => i.type !== 'hidden' && i.offsetWidth > 0);
  
  const findInput = (patterns, antiPatterns = []) => {
    return inputs.find(i => {
      const text = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.getAttribute('formcontrolname') || ''}`.toLowerCase();
      const match = patterns.some(p => text.includes(p));
      const badMatch = antiPatterns.some(ap => text.includes(ap));
      return match && !badMatch;
    });
  };

  if (isSQC) {
    const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label, span'));
    for (let l of labels) {
      const txt = l.innerText.toLowerCase();
      if ((txt.includes('packet') || txt.includes('pkid')) && !txt.includes('task')) {
        const inp = (l.closest('mat-form-field, .form-group') || l.parentElement).querySelector('input');
        if (inp) return { pkid: inp, tray: findInput(['tray']), oid: findInput(['order', 'oid']) };
      }
    }
    return { pkid: findInput(['packet', 'pkid'], ['task', 'assignment', 'filter']), tray: findInput(['tray']), oid: findInput(['order', 'oid']) };
  }

  const pkid = findInput(['packet', 'pkid', 'scan'], ['task', 'assignment', 'filter']);
  const tray = findInput(['tray'], ['filter']);
  const oid  = findInput(['order', 'oid'], ['filter']);
  const matInputs = inputs.filter(i => i.classList.contains('mat-input-element'));
  
  return {
    tray: tray || matInputs[1],
    pkid: pkid || matInputs[3] || matInputs[0],
    oid:  oid  || matInputs[2]
  };
}

function handleScan(val, type) {
  const f = getFields();
  const target = (type === 'TRAY') ? f.tray : (type === 'OID' ? f.oid : f.pkid);
  if (target) {
    // ALWAYS force set value to ensure overwrite/clear
    forceSetValue(target, val);
    clickSearch(target);
  }
}

let scanBuffer = '';
let lastKeyTime = Date.now();

document.addEventListener('keydown', (e) => {
  try { if (!chrome.runtime?.id) return; } catch (e) { return; }
  const url = window.location.href;
  if (!url.includes('qc-panel') && !url.includes('super-qc')) return;
  if (url.includes('qc-panel') && !settings.qc_enabled) return;
  if (url.includes('super-qc') && !settings.sqc_enabled) return;

  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (e.key === 'Enter') {
    if (now - lastAutoSearchTime < 800) {
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
    if (gap > 800) scanBuffer = '';
    
    // We only skip hijacking if the user is typing SLOWLY (gap > 100ms)
    // If it's a fast scanner (gap < 80ms), we MUST hijack even if focused
    // to ensure the field is cleared and not appended.
    const fields = getFields();
    const isTargetFocused = (document.activeElement === fields.pkid || document.activeElement === fields.oid || document.activeElement === fields.tray);
    
    if (isTargetFocused && gap > 100) {
      scanBuffer = ''; 
      return; 
    }

    scanBuffer += e.key;

    if (scanBuffer.length === 4) {
      const type = identifyData(scanBuffer);
      if (type === 'TRAY') {
        e.preventDefault(); e.stopImmediatePropagation();
        const val = scanBuffer;
        scanBuffer = '';
        handleScan(val, 'TRAY');
      }
    }
    else if (scanBuffer.length >= 8) {
      const type = identifyData(scanBuffer);
      if (type && type !== 'TRAY') {
        e.preventDefault(); e.stopImmediatePropagation();
        const val = scanBuffer;
        scanBuffer = '';
        handleScan(val, type);
      }
    }
  }
}, true);
