// ═══════════════════════════════════════════════════════════════
// bd.js — Firebase Realtime Database — Manutenção LAMIC
// Usa Firebase Compat (script clássico, sem ES modules)
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDMEnXlz_dCU8TSfBoRMTAL76wA7rQ1g-s",
  authDomain: "manutecao-51789.firebaseapp.com",
  databaseURL: "https://manutecao-51789-default-rtdb.firebaseio.com",
  projectId: "manutecao-51789",
  storageBucket: "manutecao-51789.firebasestorage.app",
  messagingSenderId: "1033148839621",
  appId: "1:1033148839621:web:72636b0f3c11599ed7a2ac"
};

firebase.initializeApp(firebaseConfig);
const _db = firebase.database();

// ── Detecção de conectividade ─────────────────────────────────

// Monitora o estado de conexão com o Firebase em tempo real.
// window._dbConnected: true = online, false = offline
window._dbConnected = false;
_db.ref('.info/connected').on('value', snap => {
  window._dbConnected = !!snap.val();
  if (typeof window._onDbConnectionChange === 'function') {
    window._onDbConnectionChange(window._dbConnected);
  }
});

// ── Helpers internos ──────────────────────────────────────────

function _hasContent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value).some(v =>
      Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined
    );
  }
  return true;
}

// ── API pública ───────────────────────────────────────────────

async function dbSave(path, data, guardEmpty = true) {
  if (guardEmpty && !_hasContent(data)) {
    console.warn(`[bd.js] dbSave("${path}"): dado vazio ignorado — banco protegido.`);
    return;
  }
  try {
    await _db.ref(path).set(data);
  } catch (err) {
    console.error(`[bd.js] dbSave("${path}") falhou:`, err);
  }
}

async function dbLoad(path) {
  try {
    const snap = await _db.ref(path).once('value');
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    console.error(`[bd.js] dbLoad("${path}") falhou:`, err);
    return null;
  }
}

function dbListen(path, callback) {
  const r = _db.ref(path);
  r.on('value',
    snap => callback(snap.exists() ? snap.val() : null),
    err  => console.error(`[bd.js] dbListen("${path}") erro:`, err)
  );
  return () => r.off('value');
}

window.dbSave   = dbSave;
window.dbLoad   = dbLoad;
window.dbListen = dbListen;

// Sinaliza que o Firebase SDK está inicializado (não significa que há conexão)
if (typeof window._dbReadyResolve === 'function') {
  window._dbReadyResolve();
}
