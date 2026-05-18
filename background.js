// ─── IGP Control: Background ─────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
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
