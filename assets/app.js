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

  // ---- storage user
  function loadUser() {
    const u = JSON.parse(localStorage.getItem("user") || "{}");
    if (u.login) elLogin.value = u.login;
    if (u.pin) elPin.value = u.pin;
  }
  function saveUser() {
    const u = { login: elLogin.value.trim(), pin: elPin.value.trim() };
    localStorage.setItem("user", JSON.stringify(u));
    elStatus.textContent = "Utilisateur enregistré";
  }

  // ---- date helpers
  function todayISO() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  // ---- api helpers
  async function apiGet(params) {
    const url = new URL(cfg.apiUrl);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: "GET" });
    return await res.json();
  }

  async function apiPost(payload) {
    const res = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script friendly
      body: JSON.stringify(payload)
    });
    return await res.json();
  }

  // ---- counter
  async function refreshCounter() {
    try {
      const data = await apiGet({ op: "count", date: todayISO(), source: cfg.source });
      if (data.ok) elCounter.textContent = String(data.count || 0);
    } catch {
      // ignore
    }
  }

  // ---- history
  async function loadHistory() {
    const d = historyDate.value || todayISO();
    historyList.innerHTML = "Chargement…";
    try {
      const data = await apiGet({ op: "history", date: d, source: cfg.source });
      if (!data.ok) {
        historyList.textContent = "Erreur historique";
        return;
      }
      if (!data.rows.length) {
        historyList.textContent = "Aucun scan";
        return;
      }
      historyList.innerHTML = data.rows.map(r => {
        const idShort = (r.velo_id || "").slice(0, 12);
        const pb = r.probleme ? ` • ${r.probleme}` : "";
        return `<div class="item"><div class="t">${r.time}</div><div class="m">${idShort}</div><div class="s">${r.action}${pb}</div></div>`;
      }).join("");
    } catch {
      historyList.textContent = "Erreur réseau";
    }
  }

  // ---- scanner
  let html5QrCode = null;
  let scanCount = 0;
  let lastVelo = "";

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate(100);
  }

  function showScanner() {
    overlay.classList.remove("hidden");
  }

  function hideScanner() {
    overlay.classList.add("hidden");
  }

  async function stopScanner() {
    if (!html5QrCode) return;
    try {
      await html5QrCode.stop();
      await html5QrCode.clear();
    } catch {}
    html5QrCode = null;
  }

  async function openScanner() {
    scanCount = 0;
    lastVelo = "";

    showScanner();
    elStatus.textContent = "Scan en cours…";

    html5QrCode = new Html5Qrcode("qr");

    const config = { fps: 12, qrbox: { width: 280, height: 280 } };

    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        scanCount++;
        lastVelo = decodedText;

        // 1) vibration à chaque scan
        vibrate();

        // 2) envoyer au sheet
        const u = JSON.parse(localStorage.getItem("user") || "{}");
        const payload = {
          velo_id: decodedText,
          action: cfg.action,
          probleme: "",
          utilisateur: (u.login || "unknown"),
          role: cfg.role,
          source: cfg.source,
          login: u.login || "",
          pin: u.pin || ""
        };

        try {
          const r = await apiPost(payload);
          if (r.ok) {
            elStatus.textContent = r.deduped ? "Scan confirmé (déjà loggé)" : "Scan enregistré";
          } else {
            elStatus.textContent = "Erreur: " + (r.error || "API");
          }
        } catch {
          elStatus.textContent = "Erreur réseau";
        }

        // 3) au 2e scan -> fermer
        if (scanCount >= 2) {
          await stopScanner();
          hideScanner();
          await refreshCounter();
          elStatus.textContent = "Terminé ✅";
        }
      },
      () => {
        // on ignore les erreurs de lecture
      }
    );
  }

  // ---- wiring
  btnSaveUser?.addEventListener("click", saveUser);

  btnScan?.addEventListener("click", async () => {
    // si user non renseigné => on force
    const u = { login: elLogin.value.trim(), pin: elPin.value.trim() };
    localStorage.setItem("user", JSON.stringify(u));
    await openScanner();
  });

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
  loadUser();
  refreshCounter();
})();
