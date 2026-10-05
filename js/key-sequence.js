"use strict";

(() => {
  function create(sequence, timeoutMs) {
    const secret = String(sequence || '').toLowerCase();
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    let matched = 0;
    let lastKeyAt = null;
    let unlocked = false;

    return {
      push(key, now = Date.now(), modifiers = {}) {
        if (unlocked) return false;
        if (modifiers.ctrlKey || modifiers.altKey || modifiers.metaKey || modifiers.isComposing || typeof key !== 'string' || key.length !== 1) {
          matched = 0;
          lastKeyAt = null;
          return false;
        }
        if (lastKeyAt !== null && (now < lastKeyAt || now - lastKeyAt > timeout)) matched = 0;
        lastKeyAt = now;
        const character = key.toLowerCase();
        if (character === secret[matched]) matched++;
        else matched = character === secret[0] ? 1 : 0;
        if (matched !== secret.length) return false;
        unlocked = true;
        matched = 0;
        return true;
      },
      isUnlocked() { return unlocked; },
    };
  }

  window.MineKeySequence = { create };
})();
