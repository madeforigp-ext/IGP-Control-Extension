// ─── IGP Control: QC & Super QC ─────────────────────────────────────────────

let settings = { qc_enabled: true, sqc_enabled: true };
chrome.storage.local.get(['qc_enabled', 'sqc_enabled'], (data) => {
  if (data.qc_enabled !== undefined)  settings.qc_enabled  = data.qc_enabled;
  if (data.sqc_enabled !== undefined) settings.sqc_enabled = data.sqc_enabled;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.qc_enabled)  settings.qc_enabled  = changes.qc_enabled.newValue;
  if (changes.sqc_enabled) settings.sqc_enabled = changes.sqc_enabled.newValue;
});

/**
 * RELAXED IDENTIFICATION
 */
function identifyData(val) {
  val = val.trim();
  if (/^\d{4}$/.test(val)) return 'TRAY';
  
  // Specific IGP patterns
  if (/^183\d+$/.test(val)) return 'OID';
  if (/^121\d+$/.test(val)) return 'PKID';
  
  // Generic fallbacks for long numbers
  if (/^\d{7,10}$/.test(val)) return 'PKID'; // Most PKIDs/OIDs are 8 digits
  if (/^\d{11,15}$/.test(val)) return 'PKID'; // Longer variants
  
  return null;
}

function forceSetValue(el, val) {
  if (!el) return false;
  try {
    el.focus();
    el.value = '';
    
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (setter) setter.call(el, val);
    else el.value = val;

    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Low-level inject
    el.select();
    document.execCommand('insertText', false, val);

    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  } catch (e) {
    return false;
  }
}

function clickSearch() {
  const btn = document.querySelector('button[type="submit"], button.mat-raised-button[color="primary"], .search-btn');
  if (btn) { btn.click(); return true; }
  return false;
}

/**
 * TARGETED FIELD SEARCH
 * Specifically looking for Packet/PKID while avoiding Task ID
 */
function findField(includePatterns, excludePatterns = []) {
  const inputs = Array.from(document.querySelectorAll('input'));
  
  // Helper to check if a string matches any pattern
  const matches = (str, patterns) => str && patterns.some(p => str.toLowerCase().includes(p.toLowerCase()));

  for (let i of inputs) {
    const id = i.id || '';
    const name = i.name || '';
    const placeholder = i.placeholder || '';
    const aria = i.getAttribute('aria-label') || '';
    const formControl = i.getAttribute('formcontrolname') || '';

    const allText = `${id} ${name} ${placeholder} ${aria} ${formControl}`.toLowerCase();

    if (matches(allText, includePatterns)) {
      if (!matches(allText, excludePatterns)) {
        return i;
      }
    }
  }

  // Fallback: search by label
  const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label'));
  for (let l of labels) {
    const txt = l.innerText.toLowerCase();
    if (matches(txt, includePatterns) && !matches(txt, excludePatterns)) {
      const container = l.closest('mat-form-field, .form-group');
      if (container) {
        const input = container.querySelector('input');
        if (input) return input;
      }
    }
  }

  return null;
}

function getAllFields() {
  // Try to find PKID while explicitly excluding "task"
  const pkid = findField(['packet', 'pkid', 'pkt'], ['task', 'assignment']);
  const tray = findField(['tray']);
  const oid  = findField(['order', 'oid'], ['packet', 'pkid', 'task']);
  
  const all = Array.from(document.querySelectorAll('input.mat-input-element'));
  
  // On the QC panel, if we can't find by name, the indices are usually:
  // [0] = Filter/Search
  // [1] = Tray
  // [2] = Order ID
  // [3] = Packet ID
  // If "Task ID" is appearing, it might be shifting things.
  
  return {
    tray: tray || all[1],
    oid:  oid  || all[2],
    pkid: pkid || all[3] || all[1] // all[1] fallback for Super QC
  };
}

function showFeedback(msg, color = '#c0392b') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; background: ${color}; color: white;
    padding: 10px 20px; border-radius: 5px; font-family: monospace; font-size: 12px;
    z-index: 100000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: opacity 0.5s;
    border-left: 5px solid rgba(255,255,255,0.3);
  `;
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 3000);
}

function handleScan(val, type) {
  const url = window.location.href;
  const isQC = url.includes('personalization/qc-panel');
  const isSQC = url.includes('order-mgmt-panel/super-qc');
  
  if (isQC && !settings.qc_enabled) return;
  if (isSQC && !settings.sqc_enabled) return;

  const f = getAllFields();
  const target = (type === 'TRAY') ? f.tray : (type === 'OID' ? f.oid : f.pkid);

  if (target) {
    if (!isSQC) {
      if (f.tray) forceSetValue(f.tray, type === 'TRAY' ? val : '');
      if (f.oid)  forceSetValue(f.oid,  type === 'OID'  ? val : '');
      if (f.pkid) forceSetValue(f.pkid, type === 'PKID' ? val : '');
    } else {
      forceSetValue(target, val);
    }

    showFeedback(`✅ ${type} -> ${target.placeholder || target.name || 'Input'}`, '#27ae60');
    setTimeout(() => clickSearch(), 150);
  } else {
    showFeedback(`❌ NO FIELD FOR: ${type}`, '#c0392b');
  }
}

// ─── SCANNER CORE ────────────────────────────────────────────────────────────

let scanBuffer  = '';
let lastKeyTime = 0;

document.addEventListener('keydown', (e) => {
  const now = Date.now();
  const gap = now - lastKeyTime;
  lastKeyTime = now;

  if (e.key === 'Enter') {
    const val = scanBuffer.trim();
    if (val.length >= 4) {
      const type = identifyData(val);
      if (type) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleScan(val, type);
      } else {
        showFeedback(`❓ UNKNOWN: "${val}"`, '#e67e22');
      }
    }
    scanBuffer = '';
    return;
  }

  if (e.key.length === 1) {
    if (gap > 250) scanBuffer = '';
    scanBuffer += e.key;

    if (gap < 80 && scanBuffer.length >= 7) {
      const type = identifyData(scanBuffer);
      if (type && type !== 'TRAY') {
        const val = scanBuffer;
        scanBuffer = '';
        e.preventDefault();
        e.stopImmediatePropagation();
        handleScan(val, type);
      }
    }
  }
}, true);

console.log('[IGP Control] Running - Field Fix Active');
