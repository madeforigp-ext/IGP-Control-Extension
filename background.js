// ─── IGP Control: Background ─────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-protection') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].url) return;
      
      const tab = tabs[0];
      const tabId = tab.id;
      const title = tab.title || "Untitled Tab";
      
      // Skip internal chrome pages
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        console.log('[IGP] Cannot protect internal browser pages.');
        return;
      }

      chrome.storage.local.get(['protectedTitles'], (data) => {
        let titles = data.protectedTitles || [];
        const isNowProtected = !titles.includes(title);
        
        if (isNowProtected) {
          titles.push(title);
        } else {
          titles = titles.filter(t => t !== title);
        }
        
        chrome.storage.local.set({ protectedTitles: titles }, () => {
          const msg = isNowProtected ? `🛡️ Protected: ${title}` : `🔓 Unprotected: ${title}`;
          const color = isNowProtected ? '#c0392b' : '#333';
          
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (text, bgColor) => {
              // Remove any existing toast first
              const existing = document.getElementById('igp-toast');
              if (existing) existing.remove();

              const div = document.createElement('div');
              div.id = 'igp-toast';
              div.textContent = text;
              Object.assign(div.style, {
                position: 'fixed', bottom: '50px', left: '50%', transform: 'translateX(-50%)',
                backgroundColor: bgColor, color: '#fff', padding: '12px 24px', borderRadius: '0px',
                zIndex: '2147483647', fontSize: '15px', fontWeight: 'bold', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                transition: 'all 0.4s ease', pointerEvents: 'none', fontFamily: 'Segoe UI, Tahoma, sans-serif',
                opacity: '0', border: '1px solid rgba(255,255,255,0.2)'
              });
              document.body.appendChild(div);
              
              // Fade in
              setTimeout(() => div.style.opacity = '1', 10);
              
              // Fade out and remove
              setTimeout(() => { 
                div.style.opacity = '0'; 
                div.style.bottom = '40px';
                setTimeout(() => div.remove(), 400); 
              }, 2500);
            },
            args: [msg, color]
          }).catch(err => {
            console.error('[IGP] Script injection failed:', err);
          });
        });
      });
    });
  }

  if (command === 'execute-tabguard') {
    chrome.storage.local.get(['tabguard_enabled', 'protectedTitles'], (data) => {
      if (data.tabguard_enabled === false) return;
      const protectedTitles = data.protectedTitles || [];
      if (protectedTitles.length === 0) return;

      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        tabs.forEach((tab) => {
          const isProtected = protectedTitles.some(t => tab.title && tab.title.includes(t));
          if (!isProtected) chrome.tabs.remove(tab.id);
        });
      });
    });
  }
});

// ─── TAB MANAGEMENT ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'close-current-tab' && sender.tab) {
    chrome.tabs.remove(sender.tab.id);
  }
});

let pickingState = { active: false, capturedSelector: null, capturedLabel: null };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'start-picking') {
    pickingState = { active: true, capturedSelector: null, capturedLabel: null };
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'enable-picker' });
    });
  }
  if (msg.action === 'element-picked') {
    pickingState = { active: false, capturedSelector: msg.selector, capturedLabel: msg.label };
  }
  if (msg.action === 'get-picked') {
    sendResponse(pickingState);
    pickingState = { active: false, capturedSelector: null, capturedLabel: null };
    return true;
  }
});
