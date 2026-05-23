// ─── IGP Control: Image Closer ───────────────────────────────────────────────
// This script detects right-clicks on standalone image tabs to close them.

(function() {
  'use strict';

  const handleClose = (e) => {
    // 1. Detect if this is a standalone image tab
    // Most reliable: check the content type of the document
    const isImage = document.contentType && document.contentType.startsWith('image/');
    
    // Fallback: Check if body only contains an image
    const hasOnlyImage = document.body && 
                         document.body.children.length === 1 && 
                         (document.body.children[0].tagName === 'IMG' || document.body.children[0].tagName === 'VIDEO');

    if (isImage || hasOnlyImage) {
      // Check feature toggle
      chrome.storage.local.get(['qc_rightclick_enabled'], (data) => {
        if (data.qc_rightclick_enabled !== false) {
          e.preventDefault();
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'close-current-tab' });
        }
      });
    }
  };

  // Listen on both capture and bubble phases for maximum reliability
  window.addEventListener('contextmenu', handleClose, true);
})();
