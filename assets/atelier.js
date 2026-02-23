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

  const choiceHint = document.getElementById("choiceHint");

  let selected = { mode: "", probleme: "" }; // mode: PROBLEME|ENTREE|SORTIE
  let html5QrCode = null;
  let scanCount = 0;

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

  function updateChoiceHint() {
    if (selected.mode === "ENTREE") choiceHint.textContent = "Mode : Entrée";
    else if (selected.mode === "SORTIE") choiceHint.textContent = "Mode : Sortie";
    else if (selected.mode === "PROBLEME") choiceHint.textContent = `Problème : ${selected.probleme || "—"}`;
    else choiceHint.textContent = "Choisir puis scanner";
  }

  function setActiveChip(btn) {
    document.querySelectorAll(".chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }

  function bindChips() {
    document.querySelectorAll("[data-prob]").forEach(btn => {
      btn.addEventListener("click", () => {
        selected.mode = "PROBLEME";
        selected.probleme = btn.getAttribute("data-prob");
        setActiveChip(btn);
        updateChoiceHint();
      });
    });

    document.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        selected.mode = btn.getAttribute("data-action"); // ENTREE or SORTIE
        selected.probleme = "";
        setActiveChip(btn);
        updateChoiceHint();
      });
    });
  }

  function hasValidChoice() {
    if (selected.mode === "ENTREE" || selected.mode === "SORTIE") return true;
    if (selected.mode === "PROBLEME" && selected.probleme) return true;
    return false;
  }

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

  async function stopScanner() {
    if (!html5QrCode) return;
    try { await html5QrCode.stop(); } catch {}
    try { await html5QrCode.clear(); } catch {}
    html5QrCode = null;
  }

  function buildPayload(decodedText) {
    const u = loadUser();
    let action = "PROBLEME";
    let probleme = "";

    if (selected.mode === "ENTREE") action = "ENTREE";
    else if (selected.mode === "SORTIE") action = "SORTIE";
    else { action = "PROBLEME"; probleme = selected.probleme; }

    return {
      velo_id: decodedText,
      action,
      probleme,
      utilisateur: u.login || "unknown",
      role: "RESPONSABLE_ATELIER",
      source: cfg.source,
      login: u.login || "",
      pin: u.pin || ""
    };
  }

  async function openScanner() {
    if (btnScan.disabled) {
      elStatus.textContent = "Valide ton login/PIN";
      vibrate();
      return;
    }
    if (!hasValidChoice()) {
      elStatus.textContent = "Choisir HS / Manque / Grosse / Entrée / Sortie";
      vibrate();
      return;
    }

    scanCount = 0;
    showScanner();
    elStatus.textContent = "Scan…";

    html5QrCode = new Html5Qrcode("qr");
    const config = { fps: 12, qrbox: { width: 280, height: 280 } };

    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        scanCount++;
        vibrate();

        try {
          const r = await apiPost(buildPayload(decodedText));
          if (r.ok) elStatus.textContent = r.deduped ? "Confirmé ✅" : "Enregistré ✅";
          else elStatus.textContent = "Refus ❌ " + (r.error || "");
        } catch {
          elStatus.textContent = "Erreur réseau ❌";
        }

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

  // wiring
  btnSaveUser?.addEventListener("click", validateUser);
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

  // init
  btnScan.disabled = true;
  loadUser();
  bindChips();
  refreshCounter();
  updateChoiceHint();

  // auto-validate si déjà enregistré
  if (elLogin.value.trim() && elPin.value.trim()) {
    validateUser();
  } else {
    elStatus.textContent = "Entrer login + PIN";
  }
})();
