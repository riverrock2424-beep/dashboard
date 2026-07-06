// =============================================================
// Minimal passcode lock for the dashboard.
// Drop this on any page with:
//     <script src="lock.js"></script>   (NOT deferred — must run
//                                        before body paints so the
//                                        hide-until-unlocked CSS
//                                        applies with no flash)
//
// This is a soft, casual gate for a personal local dashboard — the
// passcode lives in localStorage in plain text, so anyone with file
// or browser-storage access can read it. It's meant to keep the
// dashboard from being glanced at over your shoulder, not to protect
// sensitive data.
//
// First visit: you're prompted to CHOOSE a passcode (entered twice
// to confirm) — there's no hardcoded default to forget.
// Later visits: enter that passcode to unlock. A "Forgot it? Reset"
// link clears the saved passcode and lets you set a new one — no
// need to know the old one, since forgetting it is exactly the
// scenario this exists for.
//
// Unlock state persists in localStorage (LOCK_KEY) so you're not
// re-prompted every visit. Clear that key (or use a private window)
// to re-lock without changing the passcode.
// =============================================================
(function () {
  'use strict';

  const LOCK_KEY = 'dash_unlocked_v1';
  const PASSCODE_KEY = 'dash_passcode_v1';

  function isUnlocked() {
    try { return localStorage.getItem(LOCK_KEY) === 'yes'; } catch (e) { return false; }
  }
  function getSavedPasscode() {
    try { return localStorage.getItem(PASSCODE_KEY); } catch (e) { return null; }
  }

  // Hide the page the instant we know we're not unlocked — this runs
  // synchronously in <head>, before <body> is parsed, so there's no
  // flash of unlocked content.
  const pending = !isUnlocked();
  if (pending) {
    document.documentElement.classList.add('dash-lock-pending');
    const style = document.createElement('style');
    style.id = 'dash-lock-style';
    style.textContent = `
      html.dash-lock-pending body { visibility: hidden; }
      .dash-lock-overlay {
        visibility: visible;
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        background: #050506;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .dash-lock-overlay::before {
        content: '';
        position: fixed; inset: 0; z-index: -2; pointer-events: none;
        background:
          radial-gradient(circle at 82% 14%, rgba(224, 118, 88, 0.16), transparent 45%),
          radial-gradient(circle at 18% 90%, rgba(180, 180, 200, 0.06), transparent 45%);
        filter: blur(40px);
      }
      .dash-lock-overlay::after {
        content: '';
        position: fixed; inset: 0; z-index: -1; pointer-events: none;
        background-image: radial-gradient(rgba(255,255,255,0.014) 1px, transparent 1px);
        background-size: 3px 3px;
      }
      .dash-lock-card {
        width: min(340px, 88vw);
        padding: 28px 26px;
        border-radius: 18px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        backdrop-filter: blur(24px) saturate(1.2);
        -webkit-backdrop-filter: blur(24px) saturate(1.2);
        box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        text-align: center;
      }
      .dash-lock-title {
        font-size: 11px; font-weight: 700; letter-spacing: 0.18em;
        text-transform: uppercase; color: #76746E; margin: 0 0 6px;
      }
      .dash-lock-sub {
        font-size: 12px; color: #B8B6B0; margin: 0 0 16px; line-height: 1.4;
      }
      .dash-lock-input {
        width: 100%; box-sizing: border-box;
        padding: 14px 16px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.30); color: #FAFAFA;
        font-size: 22px; letter-spacing: 0.5em; text-align: center;
        outline: none;
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
      .dash-lock-input + .dash-lock-input { margin-top: 10px; }
      .dash-lock-input:focus { border-color: rgba(255,255,255,0.30); }
      .dash-lock-err {
        margin: 10px 0 0; font-size: 12px; color: #FF6B6B; display: none;
      }
      .dash-lock-err.show { display: block; }
      .dash-lock-btn {
        width: 100%; margin-top: 14px; padding: 12px;
        border: none; border-radius: 12px;
        background: linear-gradient(180deg, #FFFFFF 0%, #E8E5DD 100%);
        color: #0A0A0B; font-weight: 700; font-size: 13px;
        font-family: inherit; cursor: pointer;
      }
      .dash-lock-reset {
        display: inline-block; margin-top: 16px;
        font-size: 11.5px; color: #76746E; text-decoration: underline;
        cursor: pointer; background: none; border: none; font-family: inherit;
      }
      .dash-lock-reset:hover { color: #FAFAFA; }
      .dash-lock-card.shake { animation: dash-lock-shake 0.32s ease; }
      @keyframes dash-lock-shake {
        0%, 100% { transform: translateX(0); }
        25%      { transform: translateX(-8px); }
        75%      { transform: translateX(8px); }
      }
    `;
    document.head.appendChild(style);
  }

  function unlock() {
    try { localStorage.setItem(LOCK_KEY, 'yes'); } catch (e) {}
    document.documentElement.classList.remove('dash-lock-pending');
    const overlay = document.getElementById('dashLockOverlay');
    if (overlay) overlay.remove();
  }

  function shakeCard(card) {
    card.classList.remove('shake');
    void card.offsetWidth; // restart the animation
    card.classList.add('shake');
  }

  // ---- Enter-passcode mode (a passcode is already saved) ----
  function renderEnterMode(overlay, savedPasscode) {
    overlay.innerHTML =
      '<form class="dash-lock-card" id="dashLockForm">' +
        '<div class="dash-lock-title">Enter passcode</div>' +
        '<input type="password" inputmode="numeric" autocomplete="off" class="dash-lock-input" id="dashLockInput" placeholder="&bull;&bull;&bull;&bull;">' +
        '<div class="dash-lock-err" id="dashLockErr">Incorrect passcode</div>' +
        '<button type="button" class="dash-lock-reset" id="dashLockResetBtn">Forgot it? Reset</button>' +
      '</form>';

    const card = overlay.querySelector('.dash-lock-card');
    const form = overlay.querySelector('#dashLockForm');
    const input = overlay.querySelector('#dashLockInput');
    const err = overlay.querySelector('#dashLockErr');
    const resetBtn = overlay.querySelector('#dashLockResetBtn');

    setTimeout(() => input.focus(), 50);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value === savedPasscode) {
        unlock();
      } else {
        err.classList.add('show');
        shakeCard(card);
        input.value = '';
        input.focus();
      }
    });

    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset your saved passcode? You\'ll set a new one right now.')) return;
      try { localStorage.removeItem(PASSCODE_KEY); } catch (e) {}
      renderCreateMode(overlay);
    });
  }

  // ---- Create-passcode mode (first run, or after a reset) ----
  function renderCreateMode(overlay) {
    overlay.innerHTML =
      '<form class="dash-lock-card" id="dashLockForm">' +
        '<div class="dash-lock-title">Choose a passcode</div>' +
        '<div class="dash-lock-sub">This gates only this browser. Remember it — there\'s no email recovery, just the reset link below.</div>' +
        '<input type="password" inputmode="numeric" autocomplete="off" class="dash-lock-input" id="dashLockNew" placeholder="New passcode">' +
        '<input type="password" inputmode="numeric" autocomplete="off" class="dash-lock-input" id="dashLockConfirm" placeholder="Confirm passcode">' +
        '<div class="dash-lock-err" id="dashLockErr">Passcodes don\'t match</div>' +
        '<button type="submit" class="dash-lock-btn">Set passcode &amp; unlock</button>' +
      '</form>';

    const card = overlay.querySelector('.dash-lock-card');
    const form = overlay.querySelector('#dashLockForm');
    const newInput = overlay.querySelector('#dashLockNew');
    const confirmInput = overlay.querySelector('#dashLockConfirm');
    const err = overlay.querySelector('#dashLockErr');

    setTimeout(() => newInput.focus(), 50);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = newInput.value;
      if (!v) { newInput.focus(); return; }
      if (v !== confirmInput.value) {
        err.classList.add('show');
        shakeCard(card);
        confirmInput.value = '';
        confirmInput.focus();
        return;
      }
      try { localStorage.setItem(PASSCODE_KEY, v); } catch (e) {}
      unlock();
    });
  }

  function showOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'dash-lock-overlay';
    overlay.id = 'dashLockOverlay';
    document.body.appendChild(overlay);

    const saved = getSavedPasscode();
    if (saved) renderEnterMode(overlay, saved);
    else renderCreateMode(overlay);
  }

  function boot() {
    if (!pending) return; // already unlocked, nothing to show
    showOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
