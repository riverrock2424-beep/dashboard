// =============================================================
// Persistent dashboard top bar.
// Drop this on any page with:
//     <script src="topbar.js" defer></script>
// It self-injects HTML + CSS, reads progress from the same
// localStorage keys the dashboard's pages already use (goals on
// index.html, workout-done on gym.html, po_water_v1 on water.html),
// and a water "+1" button writes to localStorage and (if configured)
// pushes a merged update to a Supabase row so the new bottle appears
// on every device within ~1 second.
// =============================================================
(function () {
  'use strict';

  // -------- Supabase config (optional — leave placeholders for local-only) --------
  const TOPBAR_SUPABASE_URL = 'PASTE-YOUR-SUPABASE-PROJECT-URL-HERE';
  const TOPBAR_SUPABASE_KEY = 'PASTE-YOUR-SUPABASE-PUBLISHABLE-KEY-HERE';

  // -------- CSS --------
  const css = `
.topbar {
  position: sticky; top: 0; z-index: 40;
  display: flex; gap: 6px;
  padding: max(10px, env(safe-area-inset-top)) 14px 10px;
  /* Fully opaque so each page's body background can't bleed through
     and tint the bar a different color. Matches the dashboard's base
     dark background so the bar feels continuous with the page chrome. */
  background: #0a0a0b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  /* Pills no longer shrink to fit — instead the bar scrolls horizontally
     so nothing (like the water ml count) ever gets clipped on a narrow
     phone. touch-action must be set here explicitly: the global mobile
     lockdown below restricts <html> to pan-y (vertical-only, to block
     pinch-zoom), which would otherwise block the horizontal swipe too. */
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  touch-action: pan-x;
  scroll-snap-type: x proximity;
}
.topbar::-webkit-scrollbar { display: none; }
.topbar-pill {
  flex: 0 0 auto; min-width: 116px;
  scroll-snap-align: start;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 11px;
  text-decoration: none;
  color: #FAFAFA;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, border-color 0.15s;
}
.topbar-pill:hover { background: rgba(255, 255, 255, 0.07); border-color: rgba(255, 255, 255, 0.10); }
.topbar-pill-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #6ee7b7; flex-shrink: 0;
}
.topbar-pill.warn .topbar-pill-dot { background: #fbbf24; }
.topbar-pill.miss .topbar-pill-dot {
  background: #ff8a8a;
  animation: topbar-miss-pulse 1.6s ease-in-out infinite;
}
@keyframes topbar-miss-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  50%      { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
}
.topbar-pill-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}
.topbar-pill-count {
  margin-left: auto;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px; font-weight: 700;
  color: #FAFAFA;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.topbar-water-wrap {
  flex: 0 0 auto; min-width: 148px;
  scroll-snap-align: start;
  display: flex;
}
.topbar-water-pill {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: rgba(125, 211, 252, 0.07);
  border: 1px solid rgba(125, 211, 252, 0.14);
  border-right: none;
  border-radius: 11px 0 0 11px;
  text-decoration: none;
  color: #FAFAFA;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.topbar-water-pill:hover { background: rgba(125, 211, 252, 0.12); }
.topbar-water-pill .topbar-pill-dot { background: #7DD3FC; }
.topbar-water-add {
  flex: 0 0 auto;
  width: 38px;
  border: 1px solid rgba(125, 211, 252, 0.14);
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.22), rgba(110, 231, 183, 0.22));
  color: #FFFFFF;
  font-family: inherit; font-size: 17px; font-weight: 700;
  cursor: pointer;
  border-radius: 0 11px 11px 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, transform 0.10s;
}
.topbar-water-add:hover {
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.34), rgba(110, 231, 183, 0.34));
}
.topbar-water-add:active { transform: scale(0.94); }
.topbar-water-add.flash {
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.65), rgba(110, 231, 183, 0.65));
}

@media (max-width: 480px) {
  .topbar { padding-left: 10px; padding-right: 10px; gap: 4px; }
  .topbar-pill, .topbar-water-pill { padding: 7px 9px; gap: 5px; }
  .topbar-pill-label { font-size: 9px; letter-spacing: 0.10em; }
  .topbar-pill-count { font-size: 11px; }
  .topbar-water-add { width: 32px; font-size: 16px; }
}

/* === Global mobile lockdown ===
   1) Hide the right-side scrollbar on phones (iOS uses overlay scrollbars anyway).
   2) Stop iOS auto-text-size-adjust.
   3) touch-action: pan-y prevents pinch-zoom while still allowing vertical scroll.
   4) overscroll-behavior on every common modal class stops scroll chaining —
      scrolling inside a settings popup won't drag the page behind it.
   5) When body has .topbar-modal-open, the page can't scroll at all (locked).
*/
html, body {
  -webkit-text-size-adjust: 100%;
}
@media (max-width: 768px) {
  html { touch-action: pan-y; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html, body { scrollbar-width: none; -ms-overflow-style: none; }
}
.modal-bg, .modal, .po-modal-bg, .po-modal, .wt-overlay, .wt-viewer {
  overscroll-behavior: contain;
}
body.topbar-modal-open {
  overflow: hidden;
  touch-action: none;
}
/* On phones, blow the modals up to full screen and let them be the only
   scrolling element. Way less "is this scrolling the page or the modal?"
   confusion. */
@media (max-width: 480px) {
  .modal-bg, .po-modal-bg {
    padding: 0 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .modal, .po-modal {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    height: 100vh !important;
    border-radius: 0 !important;
    padding-top: max(20px, env(safe-area-inset-top)) !important;
    padding-bottom: max(28px, env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
}
`;

  // -------- HTML --------
  const html = `
<header class="topbar" id="topbar" role="navigation" aria-label="Quick stats">
  <a href="main.html" class="topbar-pill" id="topbarGoals">
    <span class="topbar-pill-dot"></span>
    <span class="topbar-pill-label">TASKS</span>
    <span class="topbar-pill-count" id="topbarGoalsCount">0/0</span>
  </a>
  <a href="gym.html" class="topbar-pill" id="topbarGym">
    <span class="topbar-pill-dot"></span>
    <span class="topbar-pill-label">GYM</span>
    <span class="topbar-pill-count" id="topbarGymCount">0/0</span>
  </a>
  <a href="meditation.html" class="topbar-pill" id="topbarMeditate">
    <span class="topbar-pill-dot"></span>
    <span class="topbar-pill-label">MEDITATE</span>
    <span class="topbar-pill-count" id="topbarMeditateCount">0/0</span>
  </a>
  <div class="topbar-water-wrap">
    <a href="health.html" class="topbar-water-pill" id="topbarWater">
      <span class="topbar-pill-dot"></span>
      <span class="topbar-pill-label">WATER</span>
      <span class="topbar-pill-count" id="topbarWaterCount">0/0</span>
    </a>
    <button class="topbar-water-add" id="topbarWaterAdd" aria-label="Log one drink" type="button">+</button>
  </div>
</header>
`;

  function injectStyleAndHTML() {
    if (document.getElementById('topbar')) return; // already injected
    const style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    document.body.insertBefore(wrap.firstChild, document.body.firstChild);
  }

  // -------- Active-date helpers --------
  // Goals roll over at 6 AM (matches index.html's getActiveDateString()).
  function activeDateKey() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  // Gym + water roll over at midnight (matches gym.html/water.html's own date keys).
  function calendarDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // -------- Read progress from localStorage --------
  function getGoalsProgress() {
    const key = 'goals:' + activeDateKey();
    let goals = [];
    try { goals = JSON.parse(localStorage.getItem(key)) || []; } catch (e) {}
    const total = Array.isArray(goals) ? goals.length : 0;
    const done = total ? goals.filter(g => g && g.done).length : 0;
    return { done, total };
  }

  // Gym progress is "did you mark today's workout done" — gym.html has no
  // fixed daily set target, so this mirrors its own Mark-workout-done toggle.
  function getGymProgress() {
    let doneDays = {};
    try { doneDays = JSON.parse(localStorage.getItem('po_coach_workout_done')) || {}; } catch (e) {}
    const done = doneDays[calendarDateKey()] ? 1 : 0;
    return { done, total: 1 };
  }

  // Meditate progress is "did you complete a session today" — mirrors the
  // gym pill's shape ({done:0|1, total:1}), reading meditation.html's own
  // medi:log (plain calendar-day keys, same as gym/water).
  function getMeditationProgress() {
    let log = {};
    try { log = JSON.parse(localStorage.getItem('medi:log')) || {}; } catch (e) {}
    const entry = log[calendarDateKey()];
    const done = (entry && entry.count > 0) ? 1 : 0;
    return { done, total: 1 };
  }

  // Mirrors water.html's computeTargetMl() so the pill's target matches
  // what the Water page itself shows — same gym weight/activity + weather
  // inputs, in ml (water.html is ml-only, no bottle/glass/oz to convert).
  function getWaterProgress() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state) return { done: 0, total: 0 };
    const todayKey = calendarDateKey();
    const taps = (state.logs || {})[todayKey] || 0;
    const doneMl = taps * (state.mlIncrement || 100);
    const p = state.profile || { weightKg: 75 };

    let gymWeightKg = null;
    try {
      const entries = JSON.parse(localStorage.getItem('po_coach_weights'));
      if (Array.isArray(entries) && entries.length) {
        entries.sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
        const last = entries[entries.length - 1];
        if (last && last.weight != null) {
          const coach = JSON.parse(localStorage.getItem('po_coach_v1')) || {};
          gymWeightKg = coach.units === 'lb' ? last.weight / 2.20462 : last.weight;
        }
      }
    } catch (e) {}

    let gymActivity = null;
    try {
      const doneDays = JSON.parse(localStorage.getItem('po_coach_workout_done'));
      if (doneDays && typeof doneDays === 'object') {
        gymActivity = 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          if (doneDays[k]) gymActivity++;
        }
      }
    } catch (e) {}

    let weatherTempC = null;
    try {
      const w = JSON.parse(localStorage.getItem('po_water_weather_v1'));
      if (w && w.tempC != null && (Date.now() - w.fetchedAt) < 45 * 60 * 1000) weatherTempC = w.tempC;
    } catch (e) {}

    const wKg = gymWeightKg != null ? gymWeightKg : (state.weightUnit === 'lb' ? (p.weightKg || 0) / 2.20462 : (p.weightKg || 0));
    const activityHrs = gymActivity != null ? gymActivity : (p.activityHrsPerWeek || 0);
    const base = wKg * 35;
    const exercise = activityHrs / 7 * 500;
    const weather = (weatherTempC != null && weatherTempC > 20) ? Math.min(1000, (weatherTempC - 20) * 40) : 0;
    let adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    const totalMl = base + exercise + weather + adjust;
    return { done: doneMl, total: Math.max(1, Math.round(totalMl)) };
  }

  // Compact ml formatter for the topbar pill's tight space (e.g. "1.2L").
  function fmtMlCompact(ml) {
    if (ml >= 1000) return (ml / 1000).toFixed(1) + 'L';
    return Math.round(ml) + 'ml';
  }

  function classifyStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    // Past 6pm and still under half — flag as missed
    const h = new Date().getHours();
    if (h >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }

  function setPillStatus(pillEl, status) {
    pillEl.classList.remove('good', 'warn', 'miss');
    if (status === 'warn' || status === 'miss') pillEl.classList.add(status);
  }

  function render() {
    const goalsEl = document.getElementById('topbarGoals');
    const gymEl = document.getElementById('topbarGym');
    const meditateEl = document.getElementById('topbarMeditate');
    const waterEl = document.getElementById('topbarWater');
    if (!goalsEl) return; // not injected yet

    const g = getGoalsProgress();
    const gym = getGymProgress();
    const medi = getMeditationProgress();
    const w = getWaterProgress();

    document.getElementById('topbarGoalsCount').textContent =
      g.total ? g.done + '/' + g.total : '0/0';
    document.getElementById('topbarGymCount').textContent =
      gym.done + '/' + gym.total;
    document.getElementById('topbarMeditateCount').textContent =
      medi.done + '/' + medi.total;
    document.getElementById('topbarWaterCount').textContent =
      w.total ? fmtMlCompact(w.done) + '/' + fmtMlCompact(w.total) : '0/0';

    setPillStatus(goalsEl, classifyStatus(g.done, g.total));
    setPillStatus(gymEl, classifyStatus(gym.done, gym.total));
    setPillStatus(meditateEl, classifyStatus(medi.done, medi.total));
    setPillStatus(waterEl, classifyStatus(w.done, w.total));
  }

  // -------- Water +1 (works from any page) --------
  function defaultWaterState() {
    return {
      mlIncrement: 100, weightUnit: 'kg',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      logs: {}
    };
  }

  async function pushWaterMergedToSupabase(localWater) {
    if (!window.supabase || !TOPBAR_SUPABASE_URL || !TOPBAR_SUPABASE_KEY) return;
    if (TOPBAR_SUPABASE_URL.indexOf('PASTE-') === 0) return;

    try {
      const supa = window.supabase.createClient(TOPBAR_SUPABASE_URL, TOPBAR_SUPABASE_KEY);
      const { data } = await supa
        .from('app_state').select('data').eq('key', 'health').maybeSingle();
      const current = (data && data.data) || {};
      const merged = Object.assign({}, current, { po_water_v1: localWater });
      await supa.from('app_state').upsert(
        { key: 'health', data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    } catch (e) { /* offline — local change will sync next time it's online */ }
  }

  function addWater() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state || typeof state !== 'object') state = defaultWaterState();
    state.logs = state.logs || {};
    const k = calendarDateKey();
    state.logs[k] = (state.logs[k] || 0) + 1;
    try { localStorage.setItem('po_water_v1', JSON.stringify(state)); } catch (e) {}
    render();

    const btn = document.getElementById('topbarWaterAdd');
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 220);
    }

    pushWaterMergedToSupabase(state);
  }

  // -------- Mobile lockdown helpers --------
  // Belt-and-suspenders zoom prevention — iOS Safari sometimes ignores
  // user-scalable=no, so we also kill the gesture events directly.
  function blockGesture(e) { e.preventDefault(); }
  function lockGestures() {
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });
    // Kill iOS double-tap-to-zoom — but only for a genuine double-tap on
    // roughly the same spot. Checking time alone (as this used to) means
    // ANY two taps anywhere on the page within 300ms — e.g. tapping
    // "Close" on a modal then tapping a button elsewhere right after —
    // gets the second tap's default action (and its click) silently
    // swallowed. Requiring the taps to also be close together in
    // position is the standard double-tap heuristic and avoids that.
    let lastTouch = 0, lastX = 0, lastY = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      const touch = e.changedTouches && e.changedTouches[0];
      const x = touch ? touch.clientX : 0;
      const y = touch ? touch.clientY : 0;
      const closeInTime = (now - lastTouch) <= 300;
      const closeInSpace = Math.abs(x - lastX) < 30 && Math.abs(y - lastY) < 30;
      if (closeInTime && closeInSpace) e.preventDefault();
      lastTouch = now; lastX = x; lastY = y;
    }, { passive: false });
  }

  // Watch every known modal-bg / overlay class — when any one of them
  // gets `.show` or `.is-open`, lock the body scroll. When the last
  // one closes, unlock.
  function startModalLock() {
    const MODAL_SELECTORS = [
      '.modal-bg', '.po-modal-bg', '.wt-overlay', '.wt-viewer', '.wt-cam'
    ];
    function anyOpen() {
      for (const sel of MODAL_SELECTORS) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.classList.contains('show') || el.classList.contains('is-open')) {
            return true;
          }
        }
      }
      return false;
    }
    function sync() {
      document.body.classList.toggle('topbar-modal-open', anyOpen());
    }
    const observer = new MutationObserver(sync);
    // Observe class changes anywhere in body — modal toggles are rare so
    // a global subtree observer is cheap.
    observer.observe(document.body, {
      attributes: true, attributeFilter: ['class'], subtree: true
    });
    sync();
  }

  // -------- Boot --------
  function boot() {
    injectStyleAndHTML();
    const btn = document.getElementById('topbarWaterAdd');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); addWater(); });
    render();
    lockGestures();
    startModalLock();

    // Re-render when localStorage changes from another tab/window OR when
    // the page becomes visible (sync may have pulled in the background).
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // Periodic refresh so counts stay current after midnight/6am rollovers etc.
    setInterval(render, 30 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
