// Portefeuille Fidélité : cartes de fidélité synchronisées via Firebase (connexion par email).
import { firebaseConfig } from "./firebase-config.js?v=1";

const FB = "https://www.gstatic.com/firebasejs/10.12.2";
const COLORS = ["#1d4fa3", "#e8641b", "#0f7a4f", "#c81e3a", "#6b2fa8", "#f2c230", "#1b1f24", "#2a9fb5", "#ec5f95", "#8a5a2b"];
const $ = (id) => document.getElementById(id);

let fb = null;          // { auth, fs, a, db }
let user = null;
let cards = [];
let unsub = null;
let currentId = null;
let editingId = null;
let chosenColor = COLORS[0];
let wakeLock = null;
let mode = "login";     // login | signup | reset

/* ================================================================ Firebase */
async function initFirebase() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  a.languageCode = "fr";
  let db;
  try {
    // Cache local : les cartes restent disponibles sans réseau (au fond du magasin).
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  fb = { auth, fs, a, db };
  auth.onAuthStateChanged(a, onUser);
}

const cardsCol = () => fb.fs.collection(fb.db, "users", user.uid, "cartes");

function onUser(u) {
  user = u;
  $("boot").hidden = true;
  if (unsub) { unsub(); unsub = null; }
  closeAll();
  if (!u) {
    cards = [];
    $("app").hidden = true; $("auth").hidden = false;
    return;
  }
  $("auth").hidden = true; $("app").hidden = false;
  $("count").textContent = "Chargement de vos cartes…";
  unsub = fb.fs.onSnapshot(cardsCol(), { includeMetadataChanges: true }, (snap) => {
    cards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("net-status").textContent = snap.metadata.fromCache ? "Hors ligne : cartes affichées depuis la mémoire de l'appareil." : "";
    render();
  }, (err) => {
    console.error(err);
    $("count").textContent = "Impossible de charger vos cartes (" + err.code + ").";
  });
}

async function saveCard(id, data) { await fb.fs.setDoc(fb.fs.doc(cardsCol(), id), data); }
async function removeCard(id) { await fb.fs.deleteDoc(fb.fs.doc(cardsCol(), id)); }

/* ================================================================ Connexion */
const AUTH_ERRORS = {
  "auth/invalid-email": "Cette adresse email n'est pas valide.",
  "auth/missing-password": "Saisissez votre mot de passe.",
  "auth/weak-password": "Choisissez un mot de passe d'au moins 6 caractères.",
  "auth/email-already-in-use": "Un compte existe déjà avec cette adresse. Connectez-vous plutôt.",
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/wrong-password": "Email ou mot de passe incorrect.",
  "auth/user-not-found": "Aucun compte avec cette adresse. Créez-en un.",
  "auth/too-many-requests": "Trop de tentatives. Patientez quelques minutes puis réessayez.",
  "auth/network-request-failed": "Pas de connexion internet. Vérifiez votre réseau.",
  "auth/operation-not-allowed": "La connexion par email n'est pas encore activée dans Firebase (voir le README).",
};
function authMsg(text, kind) { const m = $("auth-msg"); m.textContent = text; m.className = "msg " + (kind || "err"); m.hidden = !text; }
function setMode(m) {
  mode = m;
  $("tab-login").setAttribute("aria-selected", m === "login");
  $("tab-signup").setAttribute("aria-selected", m === "signup");
  $("pw-label").hidden = m === "reset";
  $("a-pass").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("auth-submit").textContent = { login: "Se connecter", signup: "Créer mon compte", reset: "Recevoir le lien de réinitialisation" }[m];
  $("forgot").textContent = m === "reset" ? "Retour à la connexion" : "Mot de passe oublié ?";
  $("forgot").hidden = m === "signup";
  authMsg("");
}
$("tab-login").addEventListener("click", () => setMode("login"));
$("tab-signup").addEventListener("click", () => setMode("signup"));
$("forgot").addEventListener("click", () => setMode(mode === "reset" ? "login" : "reset"));
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fb) { authMsg("Connexion au service en cours, réessayez dans un instant."); return; }
  const email = $("a-email").value.trim(), pass = $("a-pass").value;
  if (!email) { authMsg("Saisissez votre adresse email."); return; }
  const btn = $("auth-submit"); btn.disabled = true; authMsg("");
  try {
    if (mode === "login") await fb.auth.signInWithEmailAndPassword(fb.a, email, pass);
    else if (mode === "signup") await fb.auth.createUserWithEmailAndPassword(fb.a, email, pass);
    else {
      await fb.auth.sendPasswordResetEmail(fb.a, email);
      authMsg("Si un compte existe pour " + email + ", un email de réinitialisation vient d'être envoyé. Pensez à regarder dans les spams.", "ok");
    }
  } catch (err) {
    authMsg(AUTH_ERRORS[err.code] || "Erreur : " + (err.code || err.message));
  }
  btn.disabled = false;
});

/* ================================================================ Codes-barres */
function eanValid(s) {
  if (!/^\d+$/.test(s)) return false;
  const d = s.split("").map(Number), check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}
function resolveFormat(fmt, num) {
  if (fmt && fmt !== "auto") return fmt;
  if (/^\d{13}$/.test(num) && eanValid(num)) return "EAN13";
  if (/^\d{8}$/.test(num) && eanValid(num)) return "EAN8";
  return "CODE128";
}
function renderCode(box, num, fmt, big) {
  box.textContent = "";
  if (!num) { const s = document.createElement("span"); s.className = "hint"; s.textContent = "Saisissez un numéro pour voir le code."; box.appendChild(s); return; }
  const f = resolveFormat(fmt, num);
  let ok = true;
  try {
    if (f === "QR") {
      const q = window.qrcode(0, "M"); q.addData(num); q.make();
      const img = document.createElement("img"); img.className = "qr"; img.alt = "QR code";
      img.src = q.createDataURL(big ? 8 : 4, 2);
      box.appendChild(img);
    } else if (f !== "NONE") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      window.JsBarcode(svg, num, {
        format: f, displayValue: false, margin: 8, height: big ? 110 : 60, width: big ? 2.6 : 1.8,
        background: "#ffffff", lineColor: "#000000", valid: (v) => { ok = v; },
      });
      if (ok) box.appendChild(svg);
    }
  } catch (e) { ok = false; }
  if (!ok) {
    const s = document.createElement("span"); s.className = "hint bad";
    s.textContent = "Ce numéro ne correspond pas au type " + f + ". Choisissez « Automatique » ou « Code 128 ».";
    box.appendChild(s);
  }
  if (big || f === "NONE") { const n = document.createElement("div"); n.className = "code-num"; n.textContent = num; box.appendChild(n); }
}
function textOn(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#14181d" : "#ffffff";
}
const maskNum = (n) => (n.length > 4 ? "•••• " + n.slice(-4) : n);

/* ================================================================ Affichage */
function render() {
  const q = $("search").value.trim().toLowerCase();
  const sorted = cards.slice().sort((a, b) => (b.usedAt || b.createdAt || 0) - (a.usedAt || a.createdAt || 0));
  const shown = q ? sorted.filter((c) => (c.name + " " + (c.note || "")).toLowerCase().includes(q)) : sorted;
  const grid = $("grid"); grid.textContent = "";
  for (const c of shown) {
    const color = c.color || COLORS[0];
    const b = document.createElement("button"); b.type = "button"; b.className = "card";
    b.style.setProperty("--c", color); b.style.setProperty("--t", textOn(color));
    b.setAttribute("aria-label", "Afficher la carte " + c.name);
    const top = document.createElement("div"); top.className = "top";
    const nm = document.createElement("div"); nm.className = "name"; nm.textContent = c.name; top.appendChild(nm);
    if (c.note) { const nt = document.createElement("div"); nt.className = "note"; nt.textContent = c.note; top.appendChild(nt); }
    const bottom = document.createElement("div"); bottom.className = "bottom";
    const num = document.createElement("span"); num.className = "num"; num.textContent = maskNum(c.number);
    const chip = document.createElement("span"); chip.className = "chip";
    bottom.append(num, chip); b.append(top, bottom);
    b.addEventListener("click", () => openShow(c.id));
    grid.appendChild(b);
  }
  const n = cards.length;
  $("count").textContent = n === 0 ? "Vos cartes de magasin, toujours sur vous." : n + (n > 1 ? " cartes" : " carte") + " · triées par dernière utilisation";
  $("empty").hidden = n !== 0;
  $("toolbar").hidden = n < 4;
}
$("search").addEventListener("input", render);

async function openShow(id) {
  const c = cards.find((x) => x.id === id); if (!c) return;
  currentId = id;
  $("show-name").textContent = c.name;
  renderCode($("show-code"), c.number, c.format, true);
  $("show").hidden = false;
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  fb.fs.updateDoc(fb.fs.doc(cardsCol(), id), { usedAt: Date.now() }).catch(() => {});
}
function closeAll() {
  stopCamera();
  ["show", "editor", "account"].forEach((k) => { $(k).hidden = true; });
  currentId = null; editingId = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeAll));
document.querySelectorAll(".scrim").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeAll(); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

$("copy-btn").addEventListener("click", () => {
  const c = cards.find((x) => x.id === currentId); if (!c) return;
  if (navigator.clipboard) navigator.clipboard.writeText(c.number).then(() => toast("Numéro copié"), selectNum);
  else selectNum();
});
function selectNum() {
  const el = $("show-code").querySelector(".code-num"); if (!el) return;
  const r = document.createRange(); r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  toast("Numéro sélectionné");
}
$("edit-btn").addEventListener("click", () => { const id = currentId; $("show").hidden = true; openEditor(id); });

/* ================================================================ Compte */
$("account-btn").addEventListener("click", () => { $("acc-email").textContent = user?.email || ""; $("account").hidden = false; });
$("logout-btn").addEventListener("click", () => fb.auth.signOut(fb.a));
$("acc-reset").addEventListener("click", async () => {
  try { await fb.auth.sendPasswordResetEmail(fb.a, user.email); toast("Email envoyé à " + user.email); }
  catch (e) { toast("Envoi impossible, réessayez plus tard"); }
});

/* ================================================================ Édition */
function buildSwatches() {
  const wrap = $("swatches"); wrap.textContent = "";
  COLORS.forEach((col, i) => {
    const s = document.createElement("button"); s.type = "button"; s.className = "swatch"; s.id = "sw-" + i;
    s.style.setProperty("--c", col); s.setAttribute("aria-label", "Couleur " + (i + 1));
    s.setAttribute("aria-pressed", col === chosenColor ? "true" : "false");
    s.addEventListener("click", () => { chosenColor = col; buildSwatches(); });
    wrap.appendChild(s);
  });
}
function scanMsg(t, kind) { const m = $("scan-msg"); m.textContent = t; m.className = "msg" + (kind ? " " + kind : ""); }
function openEditor(id) {
  editingId = id || null;
  const c = id ? cards.find((x) => x.id === id) : null;
  $("form-title").textContent = c ? "Modifier la carte" : "Nouvelle carte";
  $("f-name").value = c ? c.name : "";
  $("f-number").value = c ? c.number : "";
  $("f-format").value = c ? (c.format || "auto") : "auto";
  $("f-note").value = c ? (c.note || "") : "";
  chosenColor = c ? (c.color || COLORS[0]) : COLORS[cards.length % COLORS.length];
  scanMsg("Visez le code-barres de la carte : le numéro se remplit tout seul.");
  $("form-err").hidden = true;
  $("delete-zone").hidden = !c; $("del-confirm").hidden = true; $("del-btn").hidden = false;
  buildSwatches(); updatePreview();
  $("editor").hidden = false;
}
function updatePreview() { renderCode($("preview"), $("f-number").value.trim(), $("f-format").value, false); }
$("f-number").addEventListener("input", updatePreview);
$("f-format").addEventListener("change", updatePreview);
$("add-btn").addEventListener("click", () => openEditor(null));
$("empty-add").addEventListener("click", () => openEditor(null));

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("f-name").value.trim(), number = $("f-number").value.trim().replace(/\s+/g, "");
  const err = $("form-err");
  if (!name || !number) { err.textContent = "Indiquez l'enseigne et le numéro de carte."; err.hidden = false; return; }
  const prev = editingId ? cards.find((x) => x.id === editingId) : null;
  const id = editingId || fb.fs.doc(cardsCol()).id;
  const data = {
    name, number, format: $("f-format").value, note: $("f-note").value.trim(), color: chosenColor,
    createdAt: prev?.createdAt || Date.now(), usedAt: prev?.usedAt || Date.now(),
  };
  // Hors ligne, l'écriture est mise en file et part au retour du réseau : on n'attend pas.
  saveCard(id, data).catch(() => toast("L'enregistrement a échoué. Vérifiez votre connexion."));
  closeAll();
  toast(prev ? "Carte modifiée" : "Carte ajoutée");
});
$("del-btn").addEventListener("click", () => { $("del-confirm").hidden = false; $("del-btn").hidden = true; });
$("del-cancel").addEventListener("click", () => { $("del-confirm").hidden = true; $("del-btn").hidden = false; });
$("del-ok").addEventListener("click", () => {
  const id = editingId;
  removeCard(id).catch(() => toast("La suppression a échoué"));
  closeAll(); toast("Carte supprimée");
});

/* ================================================================ Scan */
const ZX_TO_FMT = { EAN_13: "EAN13", EAN_8: "EAN8", CODE_128: "CODE128", CODE_39: "CODE39", UPC_A: "UPC", ITF: "ITF", QR_CODE: "QR" };
const NATIVE_TO_FMT = { ean_13: "EAN13", ean_8: "EAN8", code_128: "CODE128", code_39: "CODE39", upc_a: "UPC", itf: "ITF", qr_code: "QR" };
let nativeDetector = null;
async function getNativeDetector() {
  if (nativeDetector !== null) return nativeDetector;
  nativeDetector = false;
  try {
    if ("BarcodeDetector" in window) {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.length) nativeDetector = new window.BarcodeDetector({ formats: supported });
    }
  } catch (e) {}
  return nativeDetector;
}
let zxReader = null;
function zxDecodeCanvas(cv) {
  const Z = window.ZXing; if (!Z) throw new Error("nolib");
  if (!zxReader) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.CODE_128,
      Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
    zxReader = new Z.MultiFormatReader(); zxReader.setHints(hints);
  }
  const W = cv.width, H = cv.height;
  const px = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const lum = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
  const res = zxReader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, W, H))));
  return { text: res.getText(), format: ZX_TO_FMT[Z.BarcodeFormat[res.getBarcodeFormat()]] || "CODE128" };
}
function drawTo(src, sw, sh, maxSide, rotate, crop) {
  const [cx, cy, cw, ch] = crop || [0, 0, sw, sh];
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  const cv = document.createElement("canvas");
  cv.width = rotate ? h : w; cv.height = rotate ? w : h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (rotate) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
  return cv;
}
function useResult(r) {
  $("f-number").value = r.text;
  $("f-format").value = r.format;
  updatePreview();
  scanMsg("Code lu : " + r.text, "ok");
  if (navigator.vibrate) navigator.vibrate(60);
}

// Photo
$("f-photo").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  if (!file) return;
  stopCamera();
  scanMsg("Lecture du code…");
  try {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url);
    const det = await getNativeDetector();
    if (det) {
      const found = await det.detect(img).catch(() => []);
      if (found.length) return useResult({ text: found[0].rawValue, format: NATIVE_TO_FMT[found[0].format] || "CODE128" });
    }
    for (const side of [1400, 900, 2200]) for (const rot of [false, true]) {
      try { return useResult(zxDecodeCanvas(drawTo(img, img.naturalWidth, img.naturalHeight, side, rot))); } catch (er) {}
    }
    throw new Error("notfound");
  } catch (ex) {
    scanMsg("Aucun code trouvé. Reprenez la photo bien à plat, de près et sans reflet, ou saisissez le numéro.", "err");
  }
});

// Caméra en direct
let stream = null, scanTimer = null;
$("cam-btn").addEventListener("click", startCamera);
$("cam-stop").addEventListener("click", () => { stopCamera(); scanMsg("Caméra arrêtée."); });
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { scanMsg("La caméra n'est pas disponible sur ce navigateur. Utilisez « Depuis une photo ».", "err"); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    scanMsg("Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur, ou utilisez « Depuis une photo ».", "err");
    return;
  }
  const v = $("cam-video"); v.srcObject = stream; await v.play().catch(() => {});
  $("cam").hidden = false; $("cam-btn").hidden = true;
  scanMsg("Placez le code-barres dans le cadre.");
  const det = await getNativeDetector();
  const tick = async () => {
    if (!stream) return;
    if (v.readyState >= 2 && v.videoWidth) {
      try {
        let r = null;
        if (det) {
          const found = await det.detect(v);
          if (found.length) r = { text: found[0].rawValue, format: NATIVE_TO_FMT[found[0].format] || "CODE128" };
        } else {
          const W = v.videoWidth, H = v.videoHeight;
          r = zxDecodeCanvas(drawTo(v, W, H, 1000, false, [0, Math.round(H * 0.2), W, Math.round(H * 0.6)]));
        }
        if (r) { stopCamera(); useResult(r); return; }
      } catch (e) {}
    }
    scanTimer = setTimeout(tick, 180);
  };
  tick();
}
function stopCamera() {
  clearTimeout(scanTimer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const v = $("cam-video"); if (v) v.srcObject = null;
  $("cam").hidden = true; $("cam-btn").hidden = false;
}

/* ================================================================ Divers */
let toastT = null;
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2400); }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

setMode("login");
initFirebase().catch((e) => {
  console.error(e);
  $("boot").hidden = true; $("auth").hidden = false;
  authMsg("Impossible de joindre le service de connexion. Vérifiez votre connexion internet puis rechargez la page.");
});
