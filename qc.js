// ─── IGP Control: Unified QC & Intermesh Engine ──────────────────────────────
// Optimized for performance, framework resilience, and scanner speed.

(function() {
  'use strict';

  const CONFIG = {
    SCANNER_GAP_THRESHOLD: 80,  // ms to qualify as scanner
    TYPING_GAP_THRESHOLD: 400,  // ms to reset buffer
    SEARCH_DELAY: 400,          // ms to allow framework state to settle
    SHIELD_TIME: 800,           // ms to block duplicate Enters
    TOAST_DURATION: 2500
  };

  let state = {
    settings: { 
      qc_enabled: true, 
      qc_rightclick_enabled: true, 
      qc_routing_enabled: true, 
      qc_global_enabled: true,
      sqc_enabled: true, 
      sqc_rightclick_enabled: true, 
      intermesh_enabled: true, 
      intermesh_global_enabled: true, 
      autologin_enabled: true 
    },
    scanBuffer: '',
    lastKeyTime: Date.now(),
    lastAutoSearchTime: 0,
    isProcessing: false,
    isRedirected: false
  };

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  const initSettings = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const keys = Object.keys(state.settings);
    chrome.storage.local.get(keys, (data) => {
      Object.assign(state.settings, data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (let key in changes) {
        if (state.settings[key] !== undefined) state.settings[key] = changes[key].newValue;
      }
    });
  };
  initSettings();

  // ─── DOM UTILS ─────────────────────────────────────────────────────────────

  const findFields = () => {
    const isSQC = window.location.href.includes('super-qc');
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetWidth > 0);
    
    const patterns = {
      pkid: { pos: ['packet', 'pkid', 'pkt', 'scan', 'packetid', 'ip', 'individual'], neg: ['task', 'assignment', 'filter'] },
      tray: { pos: ['tray'], neg: ['filter'] },
      oid:  { pos: ['order', 'oid'], neg: ['filter'] },
      taskid: { pos: ['task', 'taskid'], neg: ['filter'] }
    };

    const findByPattern = (type) => {
      const { pos, neg } = patterns[type];
      return allInputs.find(i => {
        const text = `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.getAttribute('formcontrolname') || ''}`.toLowerCase();
        return pos.some(p => text.includes(p)) && !neg.some(n => text.includes(n));
      });
    };

    let pkid = findByPattern('pkid');
    let tray = findByPattern('tray');
    let oid  = findByPattern('oid');
    let taskid = findByPattern('taskid');

    // Robust label-based search for Super QC (Angular Material)
    if (isSQC) {
      const labels = Array.from(document.querySelectorAll('label, mat-label, .mat-form-field-label, span, p, mat-placeholder'));
      const findByLabel = (type) => {
        const { pos, neg } = patterns[type];
        for (let l of labels) {
          const txt = (l.innerText || l.textContent || "").toLowerCase();
          if (pos.some(p => txt.includes(p)) && !neg.some(n => txt.includes(n))) {
            const container = l.closest('mat-form-field, .form-group, .mat-form-field-wrapper, .mat-form-field-flex') || l.parentElement;
            const input = container.querySelector('input');
            if (input) return input;
          }
        }
        return null;
      };

      if (!pkid) pkid = findByLabel('pkid');
      if (!tray) tray = findByLabel('tray');
      if (!oid)  oid  = findByLabel('oid');
      if (!taskid) taskid = findByLabel('taskid');
    }

    // Fallback for standard QC Panel
    if (!isSQC && !pkid) {
      const mats = allInputs.filter(i => i.classList.contains('mat-input-element'));
      pkid = pkid || mats[3] || mats[0];
      tray = tray || mats[1];
      oid = oid || mats[2];
      taskid = taskid || mats[0]; // Default taskid to first input if not found?
    }

    return { pkid, tray, oid, taskid };
  };

  const forceUpdate = (el, val) => {
    if (!el) return;
    el.focus();
    el.value = '';
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(evt => el.dispatchEvent(new Event(evt, { bubbles: true })));
    el.select();
    document.execCommand('insertText', false, val);
  };

  const triggerSearch = (field) => {
    if (state.isProcessing) return;
    state.isProcessing = true;
    
    setTimeout(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.button'));
      const blacklist = ['profile', 'account', 'user', 'logout', 'settings', 'export', 'download', 'excel'];
      
      const isValid = (b) => {
        const txt = (b.innerText || b.value || b.name || b.id || "").toLowerCase();
        return !blacklist.some(k => txt.includes(k)) && !b.disabled && b.offsetWidth > 0;
      };

      let btn = btns.find(b => {
        const txt = (b.innerText || b.value || "").toLowerCase();
        return (txt.includes('search') || txt.includes('scan packet id') || txt.includes('find') || txt.includes('go')) && isValid(b);
      });

      if (!btn && field) {
        const container = field.closest('form, mat-card, .search-container, .mat-form-field') || document.body;
        btn = Array.from(container.querySelectorAll('button')).find(isValid);
      }

      if (btn) {
        state.lastAutoSearchTime = Date.now();
        btn.click();
      } else if (field?.form) {
        state.lastAutoSearchTime = Date.now();
        field.form.submit();
      }
      state.isProcessing = false;
    }, CONFIG.SEARCH_DELAY);
  };

  // ─── LOGIC ─────────────────────────────────────────────────────────────────

  const identify = (val) => {
    val = val.trim().toUpperCase();
    if (/^\d{4}$/.test(val)) return 'tray';
    if (/^183\d+$/.test(val)) return 'oid';
    if (/^(12|IP)?\d{7,14}$/.test(val)) return 'pkid';
    return null;
  };

  const handleAction = (val, type, isQCAction = false) => {
    // If routing is disabled for standard QC, block everything (fill & search)
    if (isQCAction && !state.settings.qc_routing_enabled) return;
    
    const fields = findFields();
    const target = fields[type];
    if (target) {
      forceUpdate(target, val);
      triggerSearch(target);
    }
  };

  // ─── IMAGE ENHANCEMENT ─────────────────────────────────────────────────────

  document.addEventListener('contextmenu', (e) => {
    const url = window.location.href;
    const isSQC = url.includes('super-qc');
    const isQC = url.includes('qc-panel') && !isSQC;
    
    if (isSQC) {
      if (!state.settings.sqc_enabled || !state.settings.sqc_rightclick_enabled) return;
    } else if (isQC) {
      if (!state.settings.qc_enabled || !state.settings.qc_rightclick_enabled) return;
    } else {
      return;
    }

    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) {
      e.preventDefault();
      window.open(img.src, '_blank');
    }
  }, true);

  // ─── EVENT LISTENERS ───────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const url = window.location.href;
    const isSQC = url.includes('super-qc');
    const isQC = (url.includes('qc-panel') || url.includes('/qc/')) && !isSQC;
    const isIntermesh = url.includes('indiangiftsportal.com') && !isQC && !isSQC;
    
    // Strict site-specific toggle enforcement
    if (isSQC && !state.settings.sqc_enabled) return;
    if (isQC && !state.settings.qc_enabled) return;
    if (isIntermesh && !state.settings.intermesh_enabled) return;

    const now = Date.now();
    const gap = now - state.lastKeyTime;
    state.lastKeyTime = now;

    // Reset buffer if user paused
    if (gap > CONFIG.TYPING_GAP_THRESHOLD) {
      state.scanBuffer = '';
      state.isRedirected = false;
    }

    if (e.key === 'Enter') {
      // Shield against rapid scanner enters
      if (now - state.lastAutoSearchTime < CONFIG.SHIELD_TIME) {
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }

      const val = state.scanBuffer.trim();
      
      // Detection Logic: Identification on Enter is independent of the Global toggle for QC
      let type = null;
      if (isIntermesh || isSQC || isQC) {
        // If routing is disabled for standard QC, skip identification
        if (isQC && !state.settings.qc_routing_enabled) {
          type = null;
        } else {
          type = identify(val);
          // OID and PKId detection disabled for standard QC
          if (isQC && (type === 'pkid' || type === 'oid')) type = null;
        }
      }
      
      if (type) {
        e.preventDefault(); e.stopImmediatePropagation();
        handleAction(val, type, isQC);
        state.scanBuffer = '';
        state.isRedirected = false;
        return;
      }
      
      // Clear buffer on Enter even if not identified
      state.scanBuffer = '';
      state.isRedirected = false;
      return;
    }

    if (e.key.length === 1) {
      // If we already redirected this burst, let characters fall through naturally to focused field
      if (state.isRedirected) return;

      const isFocused = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
      
      // If focused and typing slow (> 100ms gap), it's a human. Let them type.
      if (isFocused && gap > 100) {
        state.scanBuffer = '';
        return;
      }

      state.scanBuffer += e.key;

      // Prefix-based Jump/Focus
      // Global Typing Detection logic
      let canJump = false;
      if (isIntermesh && state.settings.intermesh_global_enabled !== false) canJump = true;
      if (isSQC && state.settings.intermesh_global_enabled !== false) canJump = true; 
      if (isQC && state.settings.qc_global_enabled !== false) canJump = true;

      if (canJump) {
        const prefix = state.scanBuffer.toUpperCase();
        let jumpType = null;

        if (isQC) {
          // QC: All global keystrokes pass to tray
          jumpType = 'tray';
        } else {
          if (prefix === '12' || prefix === '183' || prefix === '120' || prefix === '121' || prefix === 'IP') {
            jumpType = (prefix === '183') ? 'oid' : 'pkid';
          }
        }

        if (jumpType) {
          const fields = findFields();
          const target = fields[jumpType];
          if (target && document.activeElement !== target) {
            target.focus();
            target.value = prefix;
            // Set cursor to end
            if (target.setSelectionRange) target.setSelectionRange((prefix || '').length, (prefix || '').length);
            state.isRedirected = true;
            e.preventDefault();
            return;
          }
        }
      }

      // Fast auto-submit ONLY for Tray (4 digits)
      let trayType = null;
      if (isIntermesh || isSQC) {
        trayType = identify(state.scanBuffer);
      } else if (isQC) {
        // QC: Fast auto-submit is removed to eliminate all global typing detection.
        // Trays will only route on Enter (scanners) or via the Global toggle jump above.
        trayType = null;
      }

      if (trayType === 'tray' && state.scanBuffer && state.scanBuffer.length === 4) {
        e.preventDefault(); e.stopImmediatePropagation();
        handleAction(state.scanBuffer, 'tray', isQC);
        state.scanBuffer = '';
        state.isRedirected = false;
      }
    }
  }, true);

  // ─── AUTO LOGIN (Intermesh) ────────────────────────────────────────────────

  if (window.location.href.includes('indiangiftsportal.com')) {
    const checkLogin = () => {
      if (!state.settings.intermesh_enabled || !state.settings.autologin_enabled) return;
      
      const body = document.body.innerText;
      if (!body.includes('Please enter your User Name')) return;

      if (body.toLowerCase().match(/invalid|incorrect|failed/)) {
        chrome.storage.local.set({ autologin_enabled: false });
        showToast('⛔ Auto-Login Failed. Disabled.');
        return;
      }

      chrome.storage.local.get(['igp_associate', 'igp_user', 'igp_pass'], (d) => {
        if (!d.igp_user || !d.igp_pass) return;
        
        const assoc = document.querySelector('input[name="v_name"]');
        const user  = document.querySelector('input[name="usr_name"]');
        const pass  = document.querySelector('input[name="usr_pass"]');
        
        const setValue = (el, val) => {
          if (!el || !val) return;
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (assoc) setValue(assoc, d.igp_associate);
        if (user) setValue(user, d.igp_user);
        if (pass) setValue(pass, d.igp_pass);
        
        setTimeout(() => {
          const btn = document.querySelector('input[name="Submit1"]');
          if (btn) btn.click();
        }, 800);
      });
    };
    checkLogin();
  }

  function showToast(txt) {
    const div = document.createElement('div');
    div.textContent = txt;
    Object.assign(div.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: '#c0392b', color: '#fff', padding: '15px 30px', borderRadius: '5px',
      zIndex: '2147483647', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), CONFIG.TOAST_DURATION);
  }

})();
