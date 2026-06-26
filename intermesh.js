(function() {
  'use strict';

  let attempts = 0;
  const maxAttempts = 15;

  const forceUpdate = (el, val) => {
    if (!el) return;
    el.focus(); el.value = ''; el.select();
    const ok = document.execCommand('insertText', false, val);
    if (!ok) el.value = val;
    ['input', 'change', 'blur', 'keyup', 'keydown'].forEach(evt => el.dispatchEvent(new Event(evt, { bubbles: true })));
  };

  const attemptLogin = () => {
    chrome.storage.local.get(['intermesh_creds', 'intermesh_autologin_enabled'], (data) => {
      if (data.intermesh_autologin_enabled === false) return; // Strictly respect OFF state

      const creds = data.intermesh_creds || [];
      const activeCard = creds.find(c => c.active === true);
      if (!activeCard || !activeCard.user || !activeCard.assoc || !activeCard.pass) return;

      const { user: intermesh_user, assoc: intermesh_assoc, pass: intermesh_pass } = activeCard;

      const vName = document.querySelector('input[name="v_name"], input[name="vendor_name"]');
      const usrName = document.querySelector('input[name="usr_name"], input[name="username"], input[name="user_name"]');
      const usrPass = document.querySelector('input[name="usr_pass"], input[name="password"], input[type="password"]');
      const submitBtn = document.querySelector('input[name="Submit1"], input[type="submit"], button[type="submit"]');

      if (vName && usrName && usrPass && submitBtn) {
        // Prevent infinite loop if already filled
        if (vName.value === intermesh_assoc && usrName.value === intermesh_user && usrPass.value === intermesh_pass) {
          return;
        }
        
        console.log('[IGP] Intermesh Auto-Login: Filling credentials...');
        forceUpdate(vName, intermesh_assoc);
        forceUpdate(usrName, intermesh_user);
        forceUpdate(usrPass, intermesh_pass);
        
        setTimeout(() => {
          if (!submitBtn.disabled) {
            console.log('[IGP] Intermesh Auto-Login: Clicking submit...');
            submitBtn.click();
          }
        }, 800); // Wait a bit for framework to digest the values
      } else {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(attemptLogin, 500);
        } else {
          console.warn('[IGP] Intermesh Auto-Login: Fields not found after max attempts.');
        }
      }
    });
  };

  // ─── SCANNER SYSTEM ─────────────────────────────────────────────────────────

  let scanBuffer = '';
  let lastKeyTime = Date.now();
  let isRedirected = false;
  let patternsCache = { pkid: { prefix: '1, 12', max: 8 }, oid: { prefix: '18', max: 8 } };
  let settingsCache = { intermesh_routing_enabled: true, intermesh_global_enabled: true };

  // Sync patterns and settings
  chrome.storage.local.get(['patterns', 'intermesh_routing_enabled', 'intermesh_global_enabled'], (data) => { 
    if (data.patterns) patternsCache = data.patterns;
    if (data.intermesh_routing_enabled !== undefined) settingsCache.intermesh_routing_enabled = data.intermesh_routing_enabled;
    if (data.intermesh_global_enabled !== undefined) settingsCache.intermesh_global_enabled = data.intermesh_global_enabled;
  });

  chrome.storage.onChanged.addListener((changes) => { 
    if (changes.patterns) patternsCache = changes.patterns.newValue;
    if (changes.intermesh_routing_enabled) settingsCache.intermesh_routing_enabled = changes.intermesh_routing_enabled.newValue;
    if (changes.intermesh_global_enabled) settingsCache.intermesh_global_enabled = changes.intermesh_global_enabled.newValue;
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'settings-sync') {
       settingsCache[msg.key] = msg.value;
    }
  });

  const identify = (val, patterns) => {
    val = val.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!val) return null;
    const p = patterns || patternsCache;
    for (let type in p) {
      if (type !== 'pkid' && type !== 'oid') continue; 
      const prefixes = p[type].prefix.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
      if (prefixes.some(pre => val.startsWith(pre)) && val.length <= (p[type].max || 99)) return type;
    }
    return null;
  };

  if (window.location.href.includes('admin.indiangiftsportal.com/orders_vendor.php')) {
    const bindInFieldRouting = () => {
      const fields = {
        pkid: document.querySelector('input[name="packetid"]'),
        oid: document.querySelector('input[name="orders_id"]')
      };

      Object.keys(fields).forEach(type => {
        const el = fields[type];
        if (el && !el.dataset.igpBound) {
          el.dataset.igpBound = 'true';
          el.addEventListener('input', (e) => {
            const val = el.value.trim().toUpperCase();
            if (!val) return;

            const identifiedType = identify(val, patternsCache);
            if (identifiedType && identifiedType !== type) {
              console.log(`[IGP] Cross-field routing: Moving ${val} from ${type} to ${identifiedType}`);
              const targetEl = identifiedType === 'oid' ? fields.oid : fields.pkid;
              if (targetEl) {
                el.value = ''; // Clear current
                targetEl.focus();
                targetEl.value = val;
                const len = targetEl.value.length;
                targetEl.setSelectionRange(len, len);
                targetEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          });
        }
      });
    };

    // Run binding initially and on a short interval to handle dynamic content
    bindInFieldRouting();
    setInterval(bindInFieldRouting, 2000);

    chrome.storage.local.get(['intermesh_routing_enabled'], (d) => {
      if (d.intermesh_routing_enabled === false) return;
      
      window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement.tagName;
        const isInputFocused = ['INPUT', 'TEXTAREA'].includes(activeTag);

        if (e.ctrlKey || e.altKey || e.metaKey) return;

        const now = Date.now();
        if (now - lastKeyTime > 400) { scanBuffer = ''; isRedirected = false; }
        lastKeyTime = now;

        if (e.key === 'Enter') {
          const val = scanBuffer.trim().toUpperCase();
          if (val) {
            if (settingsCache.intermesh_routing_enabled !== false) {
              const type = identify(val, patternsCache);
              if (type === 'oid' || type === 'pkid') {
                const selector = type === 'oid' ? 'input[name="orders_id"]' : 'input[name="packetid"]';
                const input = document.querySelector(selector);
                const submit = document.querySelector('input[type="submit"]');
                if (input) {
                  input.value = val;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  if (submit) submit.click();
                }
              }
            }
          }
          scanBuffer = ''; isRedirected = false;
        } else if (e.key.length === 1) {
          scanBuffer += e.key;
          
          // Global Redirect Logic
          if (!isInputFocused && !isRedirected && settingsCache.intermesh_global_enabled !== false) {
            const type = identify(scanBuffer, patternsCache);
            if (type === 'oid' || type === 'pkid') {
              const selector = type === 'oid' ? 'input[name="orders_id"]' : 'input[name="packetid"]';
              const input = document.querySelector(selector);
              if (input) {
                input.focus();
                input.value = scanBuffer;
                // Set cursor to end
                if (input.setSelectionRange) {
                  const len = input.value.length;
                  input.setSelectionRange(len, len);
                }
                isRedirected = true;
                e.preventDefault(); 
              }
            }
          }
        }
      }, true);
    });

    let numpadPlusHeld = false;
    let persBuffer = [];
    let persTimeout = null;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'NumpadAdd') { numpadPlusHeld = true; e.preventDefault(); return; }
      if (!numpadPlusHeld) return;
      const numCodes = ['Digit1','Digit2','Digit3','Digit4','Digit5','Numpad1','Numpad2','Numpad3','Numpad4','Numpad5'];
      if (!numCodes.includes(e.code)) return;
      const activeTag = document.activeElement?.tagName.toUpperCase();
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      e.preventDefault();
      chrome.storage.local.get(['intermesh_pers_enabled'], (data) => {
        if (data.intermesh_pers_enabled === false) return;
        const idx = parseInt(e.code.replace('Numpad','').replace('Digit','')) - 1;
        if (!persBuffer.includes(idx)) persBuffer.push(idx);
        if (persTimeout) clearTimeout(persTimeout);
        persTimeout = setTimeout(() => {
          const persLinks = Array.from(document.querySelectorAll('a')).filter(a => a.innerText.trim() === 'Personalized Info');
          if (persBuffer.length === 1) {
            if (persLinks[persBuffer[0]]) window.open(persLinks[persBuffer[0]].href, '_blank');
          } else {
            persBuffer.forEach(i => {
              if (persLinks[i]) window.open(persLinks[i].href, '_blank');
            });
          }
          persBuffer = [];
        }, 500);
      });
    }, true);

    window.addEventListener('keyup', (e) => {
      if (e.code === 'NumpadAdd') numpadPlusHeld = false;
    }, true);
  }

  // Run on index.php or root domain
  if (window.location.href.includes('admin.indiangiftsportal.com/index.php') || window.location.pathname === '/' || window.location.pathname === '') {
    attemptLogin();
  }
})();
