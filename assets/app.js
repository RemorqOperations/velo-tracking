(() => {
  const cfg = window.APP_CONFIG;

  const elCounter = document.getElementById("counter");
  const elStatus = document.getElementById("status");

  const elLogin = document.getElementById("login");
  const elPin = document.getElementById("pin");
  const btnSaveUser = document.getElementById("btnSaveUser");

  const btnScan = document.getElementById("btnScan");
  const overlay = document.getElementById("scannerOverlay");
  const btnClose = document.getElementById("btnClose");

  const btnHistory = document.getElementById("btnHistory");
  const historyOverlay = document.getElementById("historyOverlay");
  const btnCloseHistory = document.getElementById("btnCloseHistory");
  const historyDate = document.getElementById("historyDate");
  const btnLoadHistory = document.getElementById("btnLoadHistory");
  const historyList = document.getElementById("historyList");

  // ---- helpers
  function vibrate() {
    if (navigator.vibrate) navigator.vibrate([80]);
  }

  function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function showScanner() { overlay.classList.remove("hidden"); }
  function hideScanner() { overlay.classList.add("hidden"); }

  function loadUser() {
    const u = JSON.parse(localStorage.getItem("user") || "{}");
    if (u.login) elLogin.value = u.login;
    if (u.pin) elPin.value = u.pin;
    return u;
  }

  function saveUserLocal(login, pin) {
    localStorage.setItem("user", JSON.stringify({ login, pin }));
  }

  async function apiGet(params) {
    const url = new URL(cfg.apiUrl);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: "GET" });
    return await res.json();
  }

  async function apiPost(payload) {
    const res = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  }

  // ---- login validation (bloque le scan tant que pas validé)
  async function validateUser() {
    const login = elLogin.value.trim();
    const pin = elPin.value.trim();

    if (!login || !pin) {
      elStatus.textContent = "Login et PIN requis";
      btnScan.disabled = true;
      vibrate();
      return false;
    }

    elStatus.textContent = "Validation…";
    try {
      const data = await apiGet({ op: "validate", login, pin });
      if (data.ok) {
        saveUserLocal(login, pin);
        btnScan.disabled = false;
        elStatus.textContent = "Accès autorisé ✅";
        return true;
      }
      btnScan.disabled = true;
      elStatus.textContent = "Login/PIN incorrect ❌";
      vibrate();
      return false;
    } catch {
      btnScan.disabled = true;
      elStatus.textContent = "Erreur réseau ❌";
      return false;
    }
  }

  // ---- counter & history
  async function refreshCounter() {
    try {
      const data = await apiGet({ op: "count", date: todayISO(), source: cfg.source });
      if (data.ok) elCounter.textContent = String(data.count || 0);
    } catch {}
  }

  async function loadHistory() {
    const d = historyDate.value || todayISO();
    historyList.innerHTML = "Chargement…";
    try {
      const data = await apiGet({ op: "history", date: d, source: cfg.source });
      if (!data.ok) { historyList.textContent = "Erreur historique"; return; }
      if (!data.rows.length) { historyList.textContent = "Aucun scan"; return; }

      historyList.innerHTML = data.rows.map(r => {
        const idShort = (r.velo_id || "").slice(0, 14);
        const pb = r.probleme ? ` • ${r.probleme}` : "";
        return `<div class="item">
          <div class="t">${r.time}</div>
          <div class="m">${idShort}</div>
          <div class="s">${r.action}${pb}</div>
        </div>`;
      }).join("");
    } catch {
      historyList.textContent = "Erreur réseau";
    }
  }

  // ---- scanner: 2 scans -> 2 vibrations -> fermeture
  let html5QrCode = null;
  let scanCount = 0;
  let lastText = "";

  async function stopScanner() {
    if (!html5QrCode) return;
    try { await html5QrCode.stop(); } catch {}
    try { await html5QrCode.clear(); } catch {}
    html5QrCode = null;
  }

  async function openScanner() {
    // refuse si pas validé
    if (btnScan.disabled) {
      elStatus.textContent = "Valide ton login/PIN";
      vibrate();
      return;
    }

    scanCount = 0;
    lastText = "";
    showScanner();
    elStatus.textContent = "Scan…";

    html5QrCode = new Html5Qrcode("qr");
    const config = { fps: 12, qrbox: { width: 280, height: 280 } };

    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        scanCount++;
        lastText = decodedText;

        // vibration à CHAQUE scan
        vibrate();

        const u = loadUser();
        const payload = {
          velo_id: decodedText,
          action: cfg.action,
          probleme: "",
          utilisateur: u.login || "unknown",
          role: cfg.role,
          source: cfg.source,
          login: u.login || "",
          pin: u.pin || ""
        };

        try {
          const r = await apiPost(payload);
          if (r.ok) elStatus.textContent = r.deduped ? "Confirmé ✅" : "Enregistré ✅";
          else elStatus.textContent = "Refus ❌ " + (r.error || "");
        } catch {
          elStatus.textContent = "Erreur réseau ❌";
        }

        // au 2e scan: fermer caméra
        if (scanCount >= 2) {
          await stopScanner();
          hideScanner();
          await refreshCounter();
          elStatus.textContent = "Terminé ✅";
        }
      },
      () => {}
    );
  }

  // ---- UI wiring
  btnSaveUser?.addEventListener("click", validateUser);

  // si l’utilisateur tape pin/login puis Enter, valide
  elPin?.addEventListener("keydown", (e) => { if (e.key === "Enter") validateUser(); });

  btnScan?.addEventListener("click", openScanner);

  btnClose?.addEventListener("click", async () => {
    await stopScanner();
    hideScanner();
    elStatus.textContent = "Prêt";
  });

  btnHistory?.addEventListener("click", () => {
    historyOverlay.classList.remove("hidden");
    historyDate.value = todayISO();
    loadHistory();
  });

  btnCloseHistory?.addEventListener("click", () => {
    historyOverlay.classList.add("hidden");
  });

  btnLoadHistory?.addEventListener("click", loadHistory);

  // ---- init
  btnScan.disabled = true;
  loadUser();
  refreshCounter();

  // auto-validate si user déjà enregistré
  if (elLogin.value.trim() && elPin.value.trim()) {
    validateUser();
  } else {
    elStatus.textContent = "Entrer login + PIN";
  }
})();
