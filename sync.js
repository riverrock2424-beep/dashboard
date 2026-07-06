// =============================================================
// Lightweight shared sync helper — localStorage <-> Supabase.
// Drop this on any page with:
//     <script src="sync.js" defer></script>
// (after the Supabase CDN script, before any page script that calls it)
//
// This is intentionally generic and inert by default: it does nothing
// until a page calls one of the two APIs below with the localStorage
// keys it wants synced and a row key to store them under.
//
//   window.DashSync.init(keys, appKey)
//     Original, simple API — exact key list, no auto-render hook.
//     Returns { push, collect } or null if sync isn't configured /
//     arguments are invalid (safe to ignore the result).
//
//   window.initCloudSync({ appKey, syncedKeys, syncedPrefixes, onApplied })
//     Same sync core, richer options — used by template.html:
//       - syncedKeys:     exact localStorage keys to sync (optional)
//       - syncedPrefixes: sync every key starting with any of these
//                          prefixes, including keys created later by
//                          another device (optional)
//       - onApplied:      called after a remote update is written to
//                          localStorage, so the page can re-render
//     At least one of syncedKeys / syncedPrefixes is required.
//
// Pages like gym.html / the topbar's water sync already have their own
// inline sync logic — this file exists so NEW pages can share one
// implementation instead of copy-pasting the same push/pull/subscribe
// code again.
//
// SETUP (optional — leave the placeholders to stay local-only):
//   Paste your Supabase project URL + publishable key below. Same
//   project as gym.html / topbar.js if you want everything in one
//   Supabase table (`app_state`, columns: key text primary key,
//   data jsonb, updated_at timestamptz).
// =============================================================
(function () {
  'use strict';

  const SYNC_SUPABASE_URL = 'PASTE-YOUR-SUPABASE-PROJECT-URL-HERE';
  const SYNC_SUPABASE_KEY = 'PASTE-YOUR-SUPABASE-PUBLISHABLE-KEY-HERE';

  function configured() {
    return !!window.supabase &&
      SYNC_SUPABASE_URL.indexOf('PASTE-') !== 0 &&
      SYNC_SUPABASE_KEY.indexOf('PASTE-') !== 0;
  }

  // ---- same-tab write detection ---------------------------------
  // The browser's 'storage' event only fires in OTHER tabs — a write
  // made by this tab never reaches its own 'storage' listener. Without
  // this, a page's own localStorage.setItem() wouldn't push until the
  // tab loses visibility or closes. So we patch localStorage once and
  // notify every active sync scope directly, the same way gym.html's
  // inline sync already does.
  const activeSyncScopes = [];
  let patchedStorage = false;
  function notifyKeyChanged(key) {
    activeSyncScopes.forEach((scope) => {
      try { if (scope.getKeys().indexOf(key) !== -1) scope.schedulePush(); } catch (e) {}
    });
  }
  function ensureStoragePatched() {
    if (patchedStorage) return;
    patchedStorage = true;
    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      notifyKeyChanged(k);
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      notifyKeyChanged(k);
    };
  }

  // Shared core. `getKeys()` is called fresh each time we need the current
  // set of localStorage keys this sync scope cares about (a plain array for
  // the simple API, or a live prefix-scan for the richer one — see below).
  function startSync(appKey, getKeys, onApplied) {
    if (!configured() || !appKey) return null;

    const supa = window.supabase.createClient(SYNC_SUPABASE_URL, SYNC_SUPABASE_KEY);
    let lastJson = null;
    let pushTimer = null;

    function collect() {
      const out = {};
      getKeys().forEach((k) => {
        const v = localStorage.getItem(k);
        if (v == null) return;
        try { out[k] = JSON.parse(v); } catch (e) {}
      });
      return out;
    }

    async function push() {
      const state = collect();
      const json = JSON.stringify(state);
      if (json === lastJson) return;
      try {
        const { error } = await supa
          .from('app_state')
          .upsert(
            { key: appKey, data: state, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          );
        if (!error) lastJson = json;
      } catch (e) { /* offline — retried on the next change */ }
    }

    function schedulePush() {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 400);
    }

    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return;
      let changed = false;
      // Union of what we currently track locally and what the remote row
      // actually contains — a prefix-synced key created on another device
      // won't exist locally yet, so it wouldn't show up in getKeys() until
      // after we've applied it once.
      const allKeys = new Set(getKeys().concat(Object.keys(remote)));
      allKeys.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(remote, k)) {
          const incoming = JSON.stringify(remote[k]);
          if (localStorage.getItem(k) !== incoming) {
            localStorage.setItem(k, incoming);
            changed = true;
          }
        } else if (localStorage.getItem(k) != null) {
          localStorage.removeItem(k); // deleted on another device
          changed = true;
        }
      });
      if (changed) {
        window.dispatchEvent(new CustomEvent('dash-sync-applied', { detail: { appKey } }));
        if (onApplied) { try { onApplied(); } catch (e) {} }
      }
    }

    (async function initialPull() {
      try {
        const { data, error } = await supa
          .from('app_state').select('data').eq('key', appKey).maybeSingle();
        if (!error && data && data.data) {
          lastJson = JSON.stringify(data.data);
          applyRemote(data.data);
        } else if (Object.keys(collect()).length > 0) {
          schedulePush();
        }
      } catch (e) { /* offline — local state still works */ }

      supa.channel('dash_sync_' + appKey)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastJson) return; // echo of our own push
          lastJson = incoming;
          applyRemote(payload.new.data);
        })
        .subscribe();
    })();

    ensureStoragePatched();
    activeSyncScopes.push({ getKeys, schedulePush });

    window.addEventListener('storage', schedulePush); // cross-tab writes
    document.addEventListener('visibilitychange', () => { if (document.hidden) push(); });
    window.addEventListener('beforeunload', push);

    return { push, collect };
  }

  // init(keys, appKey) — original simple API: exact key list only.
  function init(keys, appKey) {
    if (!Array.isArray(keys) || !keys.length || !appKey) return null;
    return startSync(appKey, () => keys, null);
  }

  // initCloudSync({ appKey, syncedKeys, syncedPrefixes, onApplied }) —
  // richer API used by template.html: supports prefix-based key discovery
  // and an onApplied re-render hook.
  function initCloudSync(options) {
    options = options || {};
    const appKey = options.appKey;
    const syncedKeys = Array.isArray(options.syncedKeys) ? options.syncedKeys.slice() : [];
    const syncedPrefixes = Array.isArray(options.syncedPrefixes) ? options.syncedPrefixes.slice() : [];
    const onApplied = typeof options.onApplied === 'function' ? options.onApplied : null;
    if (!appKey || (!syncedKeys.length && !syncedPrefixes.length)) return null;

    function getKeys() {
      const keys = syncedKeys.slice();
      if (syncedPrefixes.length) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && syncedPrefixes.some((p) => k.indexOf(p) === 0) && keys.indexOf(k) === -1) {
            keys.push(k);
          }
        }
      }
      return keys;
    }

    return startSync(appKey, getKeys, onApplied);
  }

  window.DashSync = { init: init, isConfigured: configured };
  window.initCloudSync = initCloudSync;
})();
