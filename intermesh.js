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
    chrome.storage.local.get(['intermesh_user', 'intermesh_assoc', 'intermesh_pass', 'intermesh_autologin_enabled'], (data) => {
      if (data.intermesh_autologin_enabled === false) return; // Strictly respect OFF state

      const { intermesh_user, intermesh_assoc, intermesh_pass } = data;
      if (!intermesh_user || !intermesh_assoc || !intermesh_pass) return;

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

  // Run on index.php or root domain
  if (window.location.href.includes('admin.indiangiftsportal.com/index.php') || window.location.pathname === '/' || window.location.pathname === '') {
    attemptLogin();
  }
})();
