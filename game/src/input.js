// DUSTLINE — keyboard + mouse input with pointer lock. No input, no game.
export function createInput(canvas, callbacks) {
  const keys = new Set();
  const state = { keys, firing: false, ads: false, lookX: 0, lookY: 0, locked: false };
  let lookDX = 0, lookDY = 0;
  function onKey(e, down) {
    if (e.repeat) return;
    if (down) keys.add(e.code); else keys.delete(e.code);
    if (callbacks.onKey) callbacks.onKey(e.code, down);
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    onKey(e, true);
  });
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    lookDX += e.movementX || 0;
    lookDY += e.movementY || 0;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.ads = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.ads = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (callbacks.onLock) callbacks.onLock(state.locked);
  });
  return {
    state,
    takeLook() { const x = lookDX, y = lookDY; lookDX = 0; lookDY = 0; return { x, y }; },
    requestLock() { try { canvas.requestPointerLock(); } catch { /* headless */ } },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
  };
}
