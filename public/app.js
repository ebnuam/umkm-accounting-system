(() => {
  "use strict";

  const MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];

  const CATEGORY_LABELS = {
    raw_material: "Bahan Baku (1104)",
    finished_good: "Barang Jadi (1105)",
    wip: "Barang Dalam Proses (1106)",
    equipment: "Peralatan & Aset Tetap",
    service: "Jasa / Layanan Non-Stok"
  };

  const BUSINESS_SECTOR_LABELS = {
    general: "SEMUA USAHA",
    trading: "DAGANG",
    service: "JASA",
    manufacturing: "MANUFAKTUR"
  };

  const MOVEMENT_LABELS = {
    opening: "Saldo Awal",
    purchase: "Pembelian",
    sale: "Penjualan (HPP)",
    opname_in: "Opname (+)",
    opname_out: "Opname (-)",
    usage_out: "Pemakaian Bahan",
    production_in: "Hasil Produksi",
    void_reversal: "Void / Pembalik"
  };

  const PARTY_TYPE_LABELS = {
    customer: "Pelanggan",
    supplier: "Pemasok",
    both: "Pelanggan & Pemasok"
  };

  const PAGE_TITLES = {
    overview: "Dashboard",
    setup: "Persiapan Usaha",
    sales: "Penjualan",
    purchases: "Pembelian",
    cashbank: "Kas & Bank",
    inventory: "Persediaan & Produksi",
    masterdata: "Master Barang & Relasi",
    ledger: "Buku Besar & COA",
    monthend: "Proses Akhir Bulan",
    statements: "Laporan Keuangan",
    settings: "Pengaturan"
  };

  const FLYOUT_MENUS = {
    ledger: {
      title: "Buku Besar & Akuntansi",
      items: [
        { label: "Jurnal Umum", hint: "Daftar & Input", action: () => { ledgerSection = "journal"; formOpen.journal = false; navigate("ledger"); } },
        { label: "+ Buat Jurnal Umum", hint: "Formulir", action: () => { ledgerSection = "journal"; formOpen.journal = true; navigate("ledger"); } },
        { label: "Daftar Akun (COA)", hint: "Kelola Akun", action: () => { ledgerSection = "accounts"; formOpen.coa = false; navigate("ledger"); } },
        { label: "Buku Besar (Mutasi)", hint: "Per Akun", action: () => { ledgerSection = "ledger"; navigate("ledger"); } },
        { label: "Neraca Saldo", hint: "Trial Balance", action: () => { ledgerSection = "trial"; navigate("ledger"); } },
        { label: "Proses Akhir Bulan", hint: "Opname & Tutup", action: () => navigate("monthend") },
        { label: "Audit Trail", hint: "Log Sistem", ownerOnly: true, action: () => { ledgerSection = "audit"; navigate("ledger"); } }
      ]
    },
    cashbank: {
      title: "Kas & Bank",
      items: [
        { label: "Mutasi Kas & Bank", hint: "Daftar", action: () => { formOpen.cashbank = false; navigate("cashbank"); } },
        { label: "+ Transaksi Kas / Bank", hint: "Formulir", action: () => { formOpen.cashbank = true; navigate("cashbank"); } },
        { label: "Terima Piutang", hint: "Pelunasan AR", action: () => { pendingCashbankPrefill = { type: "collect_receivable" }; formOpen.cashbank = true; navigate("cashbank"); } },
        { label: "Bayar Utang", hint: "Pelunasan AP", action: () => { pendingCashbankPrefill = { type: "pay_payable" }; formOpen.cashbank = true; navigate("cashbank"); } }
      ]
    },
    sales: {
      title: "Penjualan & Piutang",
      items: [
        { label: "Daftar Penjualan", hint: "Semua Faktur", action: () => { formOpen.sales = false; opSubTab.sales = "list"; navigate("sales"); } },
        { label: "+ Faktur Penjualan Baru", hint: "Formulir", action: () => { formOpen.sales = true; navigate("sales"); } },
        { label: "Faktur Piutang Terbuka", hint: "Tagihan", action: () => { formOpen.sales = false; opSubTab.sales = "open"; navigate("sales"); } },
        { label: "Penerimaan Penjualan", hint: "Kas/Bank", action: () => { pendingCashbankPrefill = { type: "collect_receivable" }; formOpen.cashbank = true; navigate("cashbank"); } },
        { label: "Pelanggan", hint: "Relasi", action: () => { masterSection = "parties"; formOpen.party = false; navigate("masterdata"); } }
      ]
    },
    purchases: {
      title: "Pembelian & Utang",
      items: [
        { label: "Daftar Pembelian", hint: "Semua Faktur", action: () => { formOpen.purchases = false; opSubTab.purchases = "list"; navigate("purchases"); } },
        { label: "+ Faktur Pembelian Baru", hint: "Formulir", action: () => { formOpen.purchases = true; navigate("purchases"); } },
        { label: "Faktur Utang Terbuka", hint: "Kewajiban", action: () => { formOpen.purchases = false; opSubTab.purchases = "open"; navigate("purchases"); } },
        { label: "Pembayaran Pembelian", hint: "Kas/Bank", action: () => { pendingCashbankPrefill = { type: "pay_payable" }; formOpen.cashbank = true; navigate("cashbank"); } },
        { label: "Pemasok", hint: "Relasi", action: () => { masterSection = "parties"; formOpen.party = false; navigate("masterdata"); } }
      ]
    },
    inventory: {
      title: "Persediaan & Manufaktur",
      items: [
        { label: "Kartu Stok & Nilai Persediaan", hint: "Moving Avg", action: () => { formOpen.inventory = false; navigate("inventory"); } },
        { label: "+ Produksi BOM / Mutasi", hint: "Manufaktur", action: () => { formOpen.inventory = true; navigate("inventory"); } },
        { label: "Barang & Jasa", hint: "Master Item", action: () => { masterSection = "items"; formOpen.item = false; navigate("masterdata"); } },
        { label: "Penyesuaian Persediaan / Opname", hint: "Akhir Bulan", action: () => navigate("monthend") }
      ]
    }
  };

  const TRANSACTION_LABELS = {
    capital: { label: "Setoran modal", defaultDescription: "Setoran modal pemilik" },
    cash_sale: { label: "Penjualan tunai (Kas)", defaultDescription: "Penjualan barang/jasa tunai" },
    bank_sale: { label: "Penjualan transfer (Bank)", defaultDescription: "Penjualan barang/jasa via bank" },
    credit_sale: { label: "Penjualan kredit (Piutang)", defaultDescription: "Penjualan kredit kepada pelanggan" },
    inventory_cash: { label: "Pembelian barang / jasa tunai", defaultDescription: "Pembelian persediaan / jasa tunai" },
    inventory_credit: { label: "Pembelian barang / jasa kredit", defaultDescription: "Pembelian persediaan / jasa kredit" },
    equipment_cash: { label: "Pembelian aset tetap tunai", defaultDescription: "Pembelian peralatan / aset tetap" },
    equipment_credit: { label: "Pembelian aset tetap kredit", defaultDescription: "Pembelian peralatan / aset tetap kredit" },
    collect_receivable: { label: "Penerimaan piutang faktur", defaultDescription: "Pelunasan piutang pelanggan" },
    pay_payable: { label: "Pembayaran utang faktur", defaultDescription: "Pelunasan utang kepada pemasok" },
    cash_expense: { label: "Pembayaran beban operasional", defaultDescription: "Pembayaran beban operasional" },
    drawing: { label: "Prive pemilik", defaultDescription: "Pengambilan kas oleh pemilik" },
    production_run: { label: "Produksi manufaktur (BOM + BTKL + BOP)", defaultDescription: "Proses produksi manufaktur" },
    general_journal: { label: "Jurnal umum manual", defaultDescription: "Pencatatan jurnal umum" }
  };

  const OPERATION_MODULES = {
    sales: {
      title: "Penjualan",
      description: "Faktur penjualan barang (potong stok & HPP) maupun jasa (4102) secara tunai, bank, atau kredit.",
      formTitle: "Faktur Penjualan",
      listTitle: "Daftar Faktur Penjualan",
      partyLabel: "Pelanggan",
      allowedTypes: ["cash_sale", "bank_sale", "credit_sale"],
      submitLabel: "Simpan Faktur Penjualan"
    },
    purchases: {
      title: "Pembelian",
      description: "Faktur pembelian bahan baku, WIP, barang jadi, aset tetap, atau jasa subkontraktor.",
      formTitle: "Faktur Pembelian",
      listTitle: "Daftar Pembelian",
      partyLabel: "Pemasok",
      allowedTypes: ["inventory_cash", "inventory_credit", "equipment_cash", "equipment_credit"],
      submitLabel: "Simpan Faktur Pembelian"
    },
    cashbank: {
      title: "Kas & Bank",
      description: "Penerimaan piutang, pembayaran utang, modal, prive, dan pembayaran beban operasional.",
      formTitle: "Bukti Kas / Bank",
      listTitle: "Mutasi Kas & Bank",
      partyLabel: "Pelanggan / Pemasok",
      allowedTypes: ["collect_receivable", "pay_payable", "cash_expense", "capital", "drawing"],
      submitLabel: "Simpan Transaksi Kas/Bank"
    }
  };

  let currentView = "overview";
  let openTabs = [{ view: "overview", title: "Dashboard", closable: false }];
  let activeFlyout = null;
  let setupStep = 1;
  let trialMode = "adjusted";
  let ledgerSection = "journal";
  let masterSection = "items";
  let reportFilter = "all";
  let selectedLedgerAccount = "1101";
  let selectedInventoryItemId = "";
  let opSearch = { sales: "", purchases: "", cashbank: "" };
  let opSubTab = { sales: "list", purchases: "list", cashbank: "list" };
  let formOpen = {
    sales: false,
    purchases: false,
    cashbank: false,
    journal: false,
    coa: false,
    item: false,
    party: false,
    inventory: false
  };
  let journalSearch = "";
  let coaSearch = "";
  let coaGroupFilter = "all";
  let masterSearch = "";
  let masterCategoryFilter = "all";
  let pendingCashbankPrefill = null;
  let authTab = "login";
  let authSessionState = { authenticated: false, needsBootstrap: false, publicRegistrationEnabled: true };
  let currentUser = null;
  let currentRole = "staff";
  let memberships = [];
  let activeTenantId = "";
  let businessMembers = [];

  let workspace = null;
  let statements = null;
  let trialBalanceUnadjusted = null;
  let trialBalanceAdjusted = null;

  const app = document.getElementById("app");
  const pageTitle = document.getElementById("pageTitle");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  const menuButton = document.getElementById("menuButton");
  const railFlyout = document.getElementById("railFlyout");
  const openTabsBar = document.getElementById("openTabsBar");

  function periodFrom(value) {
    const safe = /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "") ? value : "2026-09";
    const [year, month] = safe.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      value: safe,
      start: `${safe}-01`,
      end: `${safe}-${String(lastDay).padStart(2, "0")}`,
      label: `${MONTHS[month - 1]} ${year}`,
      endLabel: `${lastDay} ${MONTHS[month - 1]} ${year}`
    };
  }

  function activePeriodInfo() {
    return periodFrom(workspace?.profile?.activePeriod || "2026-09");
  }

  function isActivePeriodClosed() {
    const p = activePeriodInfo().value;
    return Boolean(workspace?.periods?.some((item) => item.period === p && item.status === "closed"));
  }

  function accountMap() {
    return Object.fromEntries((workspace?.accounts || []).map((a) => [a.code, a]));
  }

  function setSyncStatus(status, detail = "") {
    const title = document.getElementById("syncTitle");
    const text = document.getElementById("syncDetail");
    const dot = document.getElementById("syncDot");
    if (!title || !text || !dot) return;
    const labels = {
      loading: "Memuat",
      saving: "Menyimpan",
      saved: "Tersinkronisasi",
      error: "Gagal"
    };
    title.textContent = labels[status] || labels.loading;
    text.textContent = detail || (status === "saved" ? (currentUser?.email || "Aktif") : "Periksa koneksi");
    dot.className = `local-dot ${status}`;
  }

  function renderOpenTabsBar() {
    if (!openTabsBar) return;
    if (!authSessionState.authenticated || !workspace) {
      openTabsBar.style.display = "none";
      return;
    }
    openTabsBar.style.display = "flex";
    openTabsBar.innerHTML = openTabs
      .map((t) => `<div class="mdi-tab ${t.view === currentView ? "active" : ""}" data-tab-view="${t.view}">
        <span>${escapeHtml(t.title)}</span>
        ${t.closable ? `<button type="button" class="mdi-close" data-close-tab="${t.view}" aria-label="Tutup tab">×</button>` : ""}
      </div>`)
      .join("");
  }

  function syncShell() {
    const switchWrap = document.getElementById("businessSwitchWrap");
    const switcher = document.getElementById("businessSwitcher");
    const roleBadge = document.getElementById("roleBadge");
    const demoRoleBtn = document.getElementById("demoRoleBtn");
    const demoNotice = document.getElementById("demoNoticeBanner");
    const logoutBtn = document.getElementById("logoutButton");
    const resetBtn = document.getElementById("resetButton");

    if (!authSessionState.authenticated || !workspace) {
      if (switchWrap) switchWrap.style.display = "none";
      if (demoRoleBtn) demoRoleBtn.style.display = "none";
      if (demoNotice) {
        if (authSessionState.demoMode) {
          demoNotice.style.display = "flex";
          demoNotice.innerHTML = "<span><strong>MODE DEMO PUBLIK — DATA SIMULASI</strong> · Seluruh angka adalah simulasi usaha Aneka Snack dan tidak memakai data produksi.</span>";
        } else {
          demoNotice.style.display = "none";
        }
      }
      if (logoutBtn) logoutBtn.style.display = "none";
      if (resetBtn) resetBtn.style.display = "none";
      document.getElementById("periodLabel").textContent = "Perlu Masuk";
      document.getElementById("brandName").textContent = authSessionState.demoMode ? "Aneka Snack Demo" : "NeracaKita";
      document.getElementById("businessEyebrow").textContent = authSessionState.demoMode ? "LIVE DEMO" : "AKSES TERAUTENTIKASI";
      renderOpenTabsBar();
      return;
    }

    const isDemoSandbox = String(activeTenantId || "").startsWith("demo-");
    if (switchWrap) switchWrap.style.display = "flex";
    if (logoutBtn) logoutBtn.style.display = "";
    if (resetBtn) {
      resetBtn.style.display = currentRole === "owner" ? "" : "none";
      resetBtn.textContent = isDemoSandbox ? "Reset Demo" : "Reset Contoh";
    }
    if (demoRoleBtn) {
      if (authSessionState.demoMode && isDemoSandbox) {
        demoRoleBtn.style.display = "";
        demoRoleBtn.textContent = currentRole === "owner" ? "Uji Staff" : "Jadi Owner";
      } else {
        demoRoleBtn.style.display = "none";
      }
    }
    if (demoNotice) {
      if (authSessionState.demoMode || isDemoSandbox) {
        demoNotice.style.display = "flex";
        demoNotice.innerHTML = `<span><strong>DATA SIMULASI</strong> · Sandbox <code>${escapeHtml(activeTenantId.slice(0, 14))}</code> (${currentRole === "owner" ? "Owner: akses penuh" : "Staff: tutup periode & pengaturan terkunci"})</span>`;
      } else {
        demoNotice.style.display = "none";
      }
    }
    if (switcher) {
      switcher.innerHTML = memberships
        .map((m) => `<option value="${escapeHtml(m.tenantId)}" ${m.tenantId === activeTenantId ? "selected" : ""}>${escapeHtml(m.businessName)} (${m.role === "owner" ? "Owner" : "Staff"})</option>`)
        .join("");
    }
    if (roleBadge) {
      roleBadge.textContent = currentRole === "owner" ? "Owner" : "Staff";
      roleBadge.className = `type-pill ${currentRole === "owner" ? "posted" : "adjustment"}`;
    }

    const p = activePeriodInfo();
    const sectorLabel = BUSINESS_SECTOR_LABELS[workspace.profile.businessSector || "general"] || "SEMUA USAHA";
    document.getElementById("periodLabel").textContent = isActivePeriodClosed() ? `${p.label} (Tutup)` : p.label;
    document.getElementById("brandName").textContent = workspace.profile.businessName;
    document.getElementById("businessEyebrow").textContent = `${sectorLabel}`;
    renderOpenTabsBar();
  }

  function applyServerPayload(payload) {
    authSessionState.authenticated = true;
    currentUser = payload.user || currentUser;
    currentRole = payload.role || currentRole || "staff";
    if (Array.isArray(payload.memberships)) memberships = payload.memberships;
    activeTenantId = payload.activeTenantId || payload.workspace?.profile?.tenantId || activeTenantId;
    workspace = payload.workspace;
    statements = payload.statements;
    trialBalanceUnadjusted = payload.trialBalanceUnadjusted;
    trialBalanceAdjusted = payload.trialBalanceAdjusted;
    syncShell();
  }

  async function apiRequest(url, options = {}) {
    setSyncStatus("saving", "Validasi server");
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      setSyncStatus("error", payload.error || "Gagal");
      if (response.status === 401 && !url.startsWith("/api/auth/")) {
        await loadWorkspace();
      }
      throw new Error(payload.error || "Permintaan gagal diproses.");
    }
    applyServerPayload(payload);
    setSyncStatus("saved");
    return payload;
  }

  async function authJsonRequest(url, body) {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Permintaan autentikasi gagal.");
    return payload;
  }

  async function loadBusinessMembers() {
    if (currentRole !== "owner") {
      businessMembers = [];
      return;
    }
    const response = await fetch("/api/auth/members", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    businessMembers = Array.isArray(payload.members) ? payload.members : [];
  }

  function renderAuthView() {
    if (authSessionState.needsBootstrap && authTab !== "login") authTab = "bootstrap";
    else if (!authSessionState.needsBootstrap && authTab === "bootstrap") {
      authTab = "login";
    }
    pageTitle.textContent = "Masuk Akun";
    const tabs = [];
    if (authSessionState.needsBootstrap) {
      tabs.push(`<button type="button" class="module-tab ${authTab === "bootstrap" ? "active" : ""}" data-auth-tab="bootstrap">Setup Owner Pertama</button>`);
    }
    tabs.push(`<button type="button" class="module-tab ${authTab === "login" ? "active" : ""}" data-auth-tab="login">Masuk</button>`);
    if (!authSessionState.needsBootstrap && authSessionState.publicRegistrationEnabled) {
      tabs.push(`<button type="button" class="module-tab ${authTab === "register" ? "active" : ""}" data-auth-tab="register">Daftar Bisnis Baru</button>`);
    }

    let formHtml = "";
    if (authTab === "bootstrap") {
      formHtml = `<form id="bootstrapForm"><div class="form-grid">
        <div class="form-field full"><label for="bootToken">Token Setup Server (BOOTSTRAP_SETUP_TOKEN)</label><input id="bootToken" name="bootstrapToken" type="password" required placeholder="Token minimal 16 karakter" /></div>
        <div class="form-field full"><label for="bootName">Nama Lengkap Owner</label><input id="bootName" name="fullName" required maxlength="80" /></div>
        <div class="form-field full"><label for="bootEmail">Email Owner</label><input id="bootEmail" name="email" type="email" required /></div>
        <div class="form-field full"><label for="bootPassword">Kata Sandi</label><input id="bootPassword" name="password" type="password" minlength="8" required placeholder="Minimal 8 karakter" /></div>
        <div class="form-field"><label for="bootBusiness">Nama Usaha</label><input id="bootBusiness" name="businessName" required maxlength="80" /></div>
        <div class="form-field"><label for="bootCity">Kota</label><input id="bootCity" name="city" value="Indonesia" maxlength="80" /></div>
        <div class="form-field full"><label><input type="checkbox" name="seedDemo" checked /> Isi contoh data awal UMKM</label></div>
      </div><div class="form-actions"><button class="button primary" type="submit">Buat Akun Owner Pertama</button></div></form>`;
    } else if (authTab === "register") {
      formHtml = `<form id="registerForm"><div class="form-grid">
        <div class="form-field full"><label for="regName">Nama Lengkap</label><input id="regName" name="fullName" required maxlength="80" /></div>
        <div class="form-field full"><label for="regEmail">Email</label><input id="regEmail" name="email" type="email" required /></div>
        <div class="form-field full"><label for="regPassword">Kata Sandi</label><input id="regPassword" name="password" type="password" minlength="8" required placeholder="Minimal 8 karakter" /></div>
        <div class="form-field"><label for="regBusiness">Nama Bisnis Pertama</label><input id="regBusiness" name="businessName" required maxlength="80" /></div>
        <div class="form-field"><label for="regCity">Kota</label><input id="regCity" name="city" value="Indonesia" maxlength="80" /></div>
        <div class="form-field full"><label><input type="checkbox" name="seedDemo" checked /> Mulai dengan data contoh</label></div>
      </div><div class="form-actions"><button class="button primary" type="submit">Daftar &amp; Buat Bisnis</button></div></form>`;
    } else {
      formHtml = `<form id="loginForm"><div class="form-grid">
        <div class="form-field full"><label for="loginEmail">Email</label><input id="loginEmail" name="email" type="email" required autocomplete="email" /></div>
        <div class="form-field full"><label for="loginPassword">Kata Sandi</label><input id="loginPassword" name="password" type="password" required autocomplete="current-password" /></div>
      </div><div class="form-actions"><button class="button primary" type="submit">Masuk ke Pembukuan</button></div></form>`;
    }

    const demoBoxHtml = authSessionState.demoMode
      ? `<div class="demo-card-box">
          <h4>Akses Cepat Live Demo — Aneka Snack (Sandbox Terisolasi)</h4>
          <p>Uji pembukuan Dagang, Jasa &amp; Manufaktur langsung tanpa registrasi:</p>
          <div class="demo-actions-row">
            <button type="button" class="button primary" id="demoStartOwnerBtn">Masuk sebagai Owner</button>
            <button type="button" class="button secondary" id="demoStartStaffBtn">Masuk sebagai Staff</button>
          </div>
        </div>`
      : "";

    app.innerHTML = `<div class="auth-wrap"><section class="panel"><div class="panel-head"><div><h3>Masuk ke NeracaKita</h3><p>Sistem Akuntansi Double-Entry Multi-Bisnis</p></div></div><div class="panel-body">${demoBoxHtml}<div class="auth-tabs">${tabs.join("")}</div>${formHtml}</div></section></div>`;

    document.getElementById("demoStartOwnerBtn")?.addEventListener("click", async () => {
      try {
        await authJsonRequest("/api/auth/demo-start", { role: "owner" });
        currentView = "overview";
        showToast("Sandbox demo (Owner) siap digunakan.");
        await loadWorkspace();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("demoStartStaffBtn")?.addEventListener("click", async () => {
      try {
        await authJsonRequest("/api/auth/demo-start", { role: "staff" });
        currentView = "overview";
        showToast("Sandbox demo (Staff) siap digunakan.");
        await loadWorkspace();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        authTab = btn.dataset.authTab;
        renderAuthView();
      });
    });

    document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await authJsonRequest("/api/auth/login", {
          email: fd.get("email"),
          password: fd.get("password")
        });
        showToast("Berhasil masuk.");
        await loadWorkspace();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await authJsonRequest("/api/auth/register", {
          fullName: fd.get("fullName"),
          email: fd.get("email"),
          password: fd.get("password"),
          businessName: fd.get("businessName"),
          city: fd.get("city"),
          seedDemo: fd.get("seedDemo") === "on"
        });
        showToast("Akun & bisnis berhasil dibuat.");
        await loadWorkspace();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("bootstrapForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await authJsonRequest("/api/auth/bootstrap", {
          bootstrapToken: fd.get("bootstrapToken"),
          fullName: fd.get("fullName"),
          email: fd.get("email"),
          password: fd.get("password"),
          businessName: fd.get("businessName"),
          city: fd.get("city"),
          seedDemo: fd.get("seedDemo") === "on"
        });
        showToast("Akun Owner pertama berhasil dibuat.");
        await loadWorkspace();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  async function loadWorkspace() {
    setSyncStatus("loading", "Memeriksa sesi");
    try {
      const sessionRes = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionPayload = await sessionRes.json();
      if (!sessionRes.ok) throw new Error(sessionPayload.error || "Gagal memeriksa sesi");

      authSessionState = {
        authenticated: Boolean(sessionPayload.authenticated),
        needsBootstrap: Boolean(sessionPayload.needsBootstrap),
        publicRegistrationEnabled: sessionPayload.publicRegistrationEnabled !== false,
        demoMode: Boolean(sessionPayload.demoMode)
      };

      if (!sessionPayload.authenticated) {
        workspace = null;
        statements = null;
        trialBalanceUnadjusted = null;
        trialBalanceAdjusted = null;
        currentUser = null;
        memberships = [];
        activeTenantId = "";
        businessMembers = [];
        syncShell();
        setSyncStatus("saved", "Perlu masuk");
        renderAuthView();
        return;
      }

      currentUser = sessionPayload.user || null;
      currentRole = sessionPayload.role || "staff";
      memberships = Array.isArray(sessionPayload.memberships) ? sessionPayload.memberships : [];
      activeTenantId = sessionPayload.activeTenantId || "";

      const response = await fetch("/api/accounting/workspace", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        authSessionState.authenticated = false;
        workspace = null;
        syncShell();
        renderAuthView();
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Gagal memuat workspace");
      applyServerPayload(payload);
      if (currentRole === "owner") await loadBusinessMembers();
      setSyncStatus("saved");
      render();
    } catch (error) {
      setSyncStatus("error", error.message || "Gagal memuat workspace");
      app.innerHTML = `<section class="panel"><div class="panel-body"><p class="empty-state"><strong>Gagal memuat data</strong>${escapeHtml(error.message)}</p></div></section>`;
    }
  }

  function money(value, dashZero = false) {
    const number = Math.round(Number(value) || 0);
    if (dashZero && number === 0) return "—";
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(number);
  }

  function compactMoney(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000000) return `Rp${(number / 1000000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
    return money(number);
  }

  function qtyFmt(value) {
    const num = Number(value) || 0;
    return Number.isInteger(num) ? String(num) : num.toLocaleString("id-ID", { maximumFractionDigits: 3 });
  }

  function shortDate(date) {
    if (!date) return "—";
    const [year, month, day] = date.split("-");
    return `${day}/${month}/${year.slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  function showToast(message, kind = "success") {
    const region = document.getElementById("toastRegion");
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " error" : ""}`;
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function inActivePeriod(entry) {
    const p = activePeriodInfo();
    return entry.date >= p.start && entry.date <= p.end;
  }

  function canVoidEntry(entry) {
    if (!entry || entry.status !== "posted" || entry.source === "reversal") return false;
    const periodRec = workspace?.periods?.find((p) => p.period === entry.period);
    return !periodRec || periodRec.status === "open";
  }

  function statusBadge(entry) {
    if (entry.status === "voided") return `<span class="type-pill voided">Voided</span>`;
    if (entry.source === "reversal") return `<span class="type-pill reversal">Reversal</span>`;
    if (entry.source === "opname") return `<span class="type-pill opname">Opname</span>`;
    if (entry.source === "closing") return `<span class="type-pill closing">Penutup</span>`;
    if (entry.source === "adjustment") return `<span class="type-pill adjustment">Penyesuaian</span>`;
    return `<span class="type-pill posted">Posted</span>`;
  }

  function voidButtonHtml(entry) {
    return canVoidEntry(entry)
      ? `<button type="button" class="button small secondary void-entry" data-id="${entry.id}" title="Batalkan dengan jurnal pembalik">Void</button>`
      : "";
  }

  function closeFlyout() {
    activeFlyout = null;
    if (railFlyout) {
      railFlyout.classList.remove("open");
      railFlyout.setAttribute("aria-hidden", "true");
    }
  }

  function openFlyout(key) {
    const def = FLYOUT_MENUS[key];
    if (!def || !railFlyout) return;
    if (activeFlyout === key) {
      closeFlyout();
      return;
    }
    activeFlyout = key;
    const items = def.items.filter((it) => !it.ownerOnly || currentRole === "owner");
    railFlyout.innerHTML = `<div class="flyout-title">${escapeHtml(def.title)}</div>` +
      items.map((it, idx) => `<button type="button" class="flyout-item" data-fly-idx="${idx}"><span>${escapeHtml(it.label)}</span><small>${escapeHtml(it.hint || "")}</small></button>`).join("");
    railFlyout.classList.add("open");
    railFlyout.setAttribute("aria-hidden", "false");
    railFlyout.querySelectorAll("[data-fly-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chosen = items[Number(btn.dataset.flyIdx)];
        closeFlyout();
        if (chosen) chosen.action();
      });
    });
  }

  function navigate(view) {
    closeFlyout();
    if (!authSessionState.authenticated || !workspace) {
      closeMenu();
      renderAuthView();
      return;
    }
    if (!PAGE_TITLES[view]) return;
    if (!openTabs.some((t) => t.view === view)) {
      openTabs.push({ view, title: PAGE_TITLES[view], closable: view !== "overview" });
    }
    currentView = view;
    pageTitle.textContent = PAGE_TITLES[view];
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    closeMenu();
    renderOpenTabsBar();
    render();
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeOpenTab(view) {
    if (view === "overview") return;
    const idx = openTabs.findIndex((t) => t.view === view);
    if (idx === -1) return;
    openTabs.splice(idx, 1);
    if (currentView === view) {
      const next = openTabs[Math.max(0, idx - 1)] || openTabs[0];
      navigate(next.view);
    } else {
      renderOpenTabsBar();
    }
  }

  function openMenu() {
    sidebar.classList.add("open");
    backdrop.classList.add("open");
    menuButton.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  function render() {
    if (!authSessionState.authenticated || !workspace || !statements) {
      renderAuthView();
      return;
    }
    const views = {
      overview: renderOverview,
      setup: renderSetupWizard,
      sales: () => renderOperationalPage("sales"),
      purchases: () => renderOperationalPage("purchases"),
      cashbank: () => renderOperationalPage("cashbank"),
      inventory: renderInventory,
      masterdata: renderMasterData,
      ledger: renderLedgerModule,
      monthend: renderMonthEnd,
      statements: renderStatements,
      settings: renderSettings
    };
    app.innerHTML = views[currentView]();
    bindViewEvents();
  }

  function heading(title, description, action = "") {
    return `<div class="section-heading"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ""}</div>${action}</div>`;
  }

  function equationHtml(fin) {
    const right = fin.totalLiabilities + fin.totalEquity;
    const balanced = fin.isBalanced;
    return `<div class="equation-box ${balanced ? "good" : "bad"}">
      <div class="equation-item"><span>Total Aset</span><strong>${money(fin.totalAssets)}</strong></div>
      <div class="equation-symbol">=</div>
      <div class="equation-item"><span>Liabilitas</span><strong>${money(fin.totalLiabilities)}</strong></div>
      <div class="equation-symbol">+</div>
      <div class="equation-item"><span>Ekuitas</span><strong>${money(right - fin.totalLiabilities)}</strong></div>
    </div>`;
  }

  function openInvoicesFor(kind = null) {
    return workspace.invoices
      .filter((inv) => (!kind || inv.kind === kind) && (inv.status === "open" || inv.status === "partial"))
      .sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));
  }

  function renderSvgColumnChart(revenue, cogs, opex, netIncome) {
    const bars = [
      { label: "Pendapatan", val: Math.max(0, revenue), color: "#0f766e" },
      { label: "HPP", val: Math.max(0, cogs), color: "#d97706" },
      { label: "Beban Ops", val: Math.max(0, opex), color: "#64748b" },
      { label: "Laba Bersih", val: Math.max(0, netIncome), color: netIncome >= 0 ? "#15803d" : "#b91c1c" }
    ];
    const maxVal = Math.max(...bars.map((b) => b.val), 1);
    const chartH = 110;
    const baseY = 124;
    return `<svg class="svg-chart" viewBox="0 0 340 155" role="img" aria-label="Grafik Laba Rugi Periode">
      <line x1="20" y1="14" x2="326" y2="14" stroke="#e2e8f0" stroke-dasharray="3 3" />
      <line x1="20" y1="69" x2="326" y2="69" stroke="#e2e8f0" stroke-dasharray="3 3" />
      <line x1="20" y1="${baseY}" x2="326" y2="${baseY}" stroke="#cbd5e1" stroke-width="1.2" />
      ${bars.map((b, i) => {
        const h = Math.max(3, Math.round((b.val / maxVal) * chartH));
        const x = 36 + i * 74;
        const y = baseY - h;
        return `<g>
          <rect x="${x}" y="${y}" width="38" height="${h}" rx="2" fill="${b.color}"><title>${b.label}: ${money(b.val)}</title></rect>
          <text x="${x + 19}" y="${y - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#334155">${compactMoney(b.val).replace("Rp", "")}</text>
          <text x="${x + 19}" y="142" text-anchor="middle" font-size="10" fill="#64748b">${b.label}</text>
        </g>`;
      }).join("")}
    </svg>`;
  }

  function renderOverview() {
    const fin = statements;
    const p = activePeriodInfo();
    const recent = workspace.journalEntries
      .filter((e) => inActivePeriod(e) && e.source === "transaction")
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6);
    const invTotal = (fin.cumulativeBalances["1104"] || 0) + (fin.cumulativeBalances["1105"] || 0) + (fin.cumulativeBalances["1106"] || 0);
    const cashVal = fin.cumulativeBalances["1101"] || 0;
    const bankVal = fin.cumulativeBalances["1102"] || 0;
    const cashBankTotal = cashVal + bankVal;
    const openReceivables = openInvoicesFor("receivable");
    const openPayables = openInvoicesFor("payable");

    const setupChecks = [
      { label: "Info & Sektor", ok: Boolean(workspace.profile?.businessName && workspace.profile?.businessSector) },
      { label: "Daftar Akun", ok: workspace.accounts.filter((a) => a.active).length >= 10 },
      { label: "Kas/Bank & Relasi", ok: workspace.parties.length > 0 && (cashBankTotal > 0 || (fin.cumulativeBalances["3101"] || 0) !== 0) },
      { label: "Barang & Jasa", ok: workspace.items.length > 0 }
    ];
    const doneCount = setupChecks.filter((s) => s.ok).length;
    const grossMargin = fin.revenue > 0 ? `${Math.round((fin.grossProfit / fin.revenue) * 100)}%` : "0%";

    return `<div class="page-stack">
      <div class="erp-toolbar">
        <div class="erp-toolbar-left">
          <button type="button" class="button primary" id="dashNewSaleBtn">+ Faktur Penjualan</button>
          <button type="button" class="button secondary" id="dashNewPurchaseBtn">+ Faktur Pembelian</button>
          <button type="button" class="button secondary" id="dashNewJournalBtn">+ Jurnal Umum</button>
          <button type="button" class="button secondary" data-go="cashbank">Kas &amp; Bank</button>
        </div>
        <div class="erp-toolbar-right">
          <button type="button" class="button secondary" data-go="statements">Daftar Laporan</button>
          <button type="button" class="button secondary" data-go="monthend">Proses Akhir Bulan</button>
        </div>
      </div>

      <div class="setup-strip">
        <div class="setup-strip-steps">
          <strong>Persiapan Data Usaha (${doneCount}/4):</strong>
          ${setupChecks.map((c, idx) => `<span class="setup-check-item ${c.ok ? "done" : ""}">${c.ok ? "✓" : `${idx + 1}.`} ${c.label}</span>`).join("")}
        </div>
        <button type="button" class="button small secondary" data-go="setup">Buka Persiapan Usaha</button>
      </div>

      <div class="kpi-strip">
        <div class="kpi-cell accent"><span>Penjualan (${p.label})</span><strong>${compactMoney(fin.revenue)}</strong></div>
        <div class="kpi-cell good"><span>Laba Bersih</span><strong>${compactMoney(fin.netIncome)}</strong></div>
        <div class="kpi-cell"><span>Kas &amp; Bank</span><strong>${compactMoney(cashBankTotal)}</strong></div>
        <div class="kpi-cell"><span>Persediaan (1104–1106)</span><strong>${compactMoney(invTotal)}</strong></div>
        <div class="kpi-cell"><span>Piutang (${openReceivables.length} faktur)</span><strong>${compactMoney(fin.cumulativeBalances["1103"] || 0)}</strong></div>
        <div class="kpi-cell"><span>Total Liabilitas (${openPayables.length} utang)</span><strong>${compactMoney(fin.totalLiabilities)}</strong></div>
      </div>

      <div class="dash-grid">
        <section class="widget">
          <div class="widget-head"><h3>Laba / Rugi (${p.label})</h3><span class="type-pill posted">Margin Kotor ${grossMargin}</span></div>
          <div class="widget-body">
            ${renderSvgColumnChart(fin.revenue, fin.cogs, fin.operatingExpenses, fin.netIncome)}
            <div class="mini-list" style="margin-top:8px">
              <div class="mini-row"><span>Laba Kotor</span><strong>${money(fin.grossProfit)}</strong></div>
              <div class="mini-row"><span>Laba Bersih Periode</span><strong>${money(fin.netIncome)}</strong></div>
            </div>
          </div>
        </section>

        <section class="widget">
          <div class="widget-head"><h3>Kas, Bank &amp; Persediaan</h3><button class="button small secondary" data-go="inventory">Kartu Stok</button></div>
          <div class="widget-body">
            <div class="mini-list">
              <div class="mini-row"><span>1101 · Kas Tunai</span><strong>${money(cashVal)}</strong></div>
              <div class="mini-row"><span>1102 · Kas Bank / Rekening</span><strong>${money(bankVal)}</strong></div>
              <div class="mini-row"><span>1104 · Bahan Baku</span><strong>${money(fin.cumulativeBalances["1104"] || 0)}</strong></div>
              <div class="mini-row"><span>1106 · WIP Produksi</span><strong>${money(fin.cumulativeBalances["1106"] || 0)}</strong></div>
              <div class="mini-row"><span>1105 · Barang Jadi</span><strong>${money(fin.cumulativeBalances["1105"] || 0)}</strong></div>
            </div>
          </div>
        </section>

        <section class="widget">
          <div class="widget-head"><h3>Neraca Ringkas</h3><span class="status-pill ${fin.isBalanced ? "good" : "bad"}">${fin.isBalanced ? "Seimbang" : "Selisih"}</span></div>
          <div class="widget-body">
            ${equationHtml(fin)}
            <div class="mini-list" style="margin-top:10px">
              <div class="mini-row"><span>Modal Awal Periode</span><strong>${money(fin.openingCapital)}</strong></div>
              <div class="mini-row"><span>Modal Akhir Periode</span><strong>${money(fin.endingCapital)}</strong></div>
              <div class="mini-row"><span>Status Periode ${p.value}</span><strong>${isActivePeriodClosed() ? "Ditutup" : "Terbuka"}</strong></div>
            </div>
          </div>
        </section>
      </div>

      <div class="dash-grid two-col">
        <section class="widget">
          <div class="widget-head"><h3>Piutang Usaha Belum Lunas (${openReceivables.length})</h3><button class="button small secondary" data-go="sales">Lihat Penjualan</button></div>
          <div class="table-wrap"><table><thead><tr><th>No. Faktur</th><th>Pelanggan</th><th>Tgl</th><th class="num">Sisa</th><th class="num">Aksi</th></tr></thead><tbody>
            ${openReceivables.length ? openReceivables.slice(0, 5).map((inv) => `<tr>
              <td><span class="document-id">${escapeHtml(inv.invoiceNumber)}</span></td>
              <td>${escapeHtml(inv.partyName)}</td>
              <td>${shortDate(inv.date)}</td>
              <td class="num"><strong>${money(inv.remainingAmount)}</strong></td>
              <td class="num"><button type="button" class="button small secondary quick-settle-btn" data-kind="receivable" data-party="${inv.partyId}" data-invoice="${inv.id}" data-amount="${inv.remainingAmount}">Terima</button></td>
            </tr>`).join("") : `<tr><td colspan="5" class="empty-state">Tidak ada piutang terbuka.</td></tr>`}
          </tbody></table></div>
        </section>

        <section class="widget">
          <div class="widget-head"><h3>Utang Usaha Belum Lunas (${openPayables.length})</h3><button class="button small secondary" data-go="purchases">Lihat Pembelian</button></div>
          <div class="table-wrap"><table><thead><tr><th>No. Faktur</th><th>Pemasok</th><th>Tgl</th><th class="num">Sisa</th><th class="num">Aksi</th></tr></thead><tbody>
            ${openPayables.length ? openPayables.slice(0, 5).map((inv) => `<tr>
              <td><span class="document-id">${escapeHtml(inv.invoiceNumber)}</span></td>
              <td>${escapeHtml(inv.partyName)}</td>
              <td>${shortDate(inv.date)}</td>
              <td class="num"><strong>${money(inv.remainingAmount)}</strong></td>
              <td class="num"><button type="button" class="button small secondary quick-settle-btn" data-kind="payable" data-party="${inv.partyId}" data-invoice="${inv.id}" data-amount="${inv.remainingAmount}">Bayar</button></td>
            </tr>`).join("") : `<tr><td colspan="5" class="empty-state">Tidak ada utang terbuka.</td></tr>`}
          </tbody></table></div>
        </section>
      </div>

      <section class="widget">
        <div class="widget-head"><h3>Aktivitas Transaksi Terbaru (${p.label})</h3><button class="button small secondary" data-go="ledger">Buku Besar</button></div>
        <div class="table-wrap"><table><thead><tr><th>No. Dokumen</th><th>Tanggal</th><th>Keterangan</th><th>Status</th><th class="num">Nilai</th><th class="num">Detail</th></tr></thead><tbody>
          ${recent.length ? recent.map((entry) => `<tr class="${entry.status === "voided" ? "row-voided" : ""}">
            <td><span class="document-id">${escapeHtml(entry.documentNumber)}</span></td>
            <td>${shortDate(entry.date)}</td>
            <td><span class="account-name">${escapeHtml(entry.description)}</span></td>
            <td>${statusBadge(entry)}</td>
            <td class="num">${money(entry.amount)}</td>
            <td class="num"><button type="button" class="button small secondary view-journal" data-id="${entry.id}">Jurnal</button></td>
          </tr>`).join("") : `<tr><td colspan="6" class="empty-state">Belum ada transaksi pada ${p.label}.</td></tr>`}
        </tbody></table></div>
      </section>
    </div>`;
  }

  function renderSetupWizard() {
    const p = activePeriodInfo();
    const isOwner = currentRole === "owner";
    const steps = [
      { n: 1, label: "Informasi Perusahaan" },
      { n: 2, label: "Daftar Akun (COA)" },
      { n: 3, label: "Kas/Bank & Relasi" },
      { n: 4, label: "Barang, Jasa & Stok Awal" }
    ];

    let stepBody = "";
    if (setupStep === 1) {
      stepBody = `<section class="doc-sheet">
        <div class="doc-sheet-head"><h3>1. Informasi Perusahaan &amp; Sektor Usaha</h3></div>
        <form id="wizardProfileForm"><div class="doc-sheet-body"><div class="form-grid">
          <div class="form-field"><label for="wizBizName">Nama Usaha / Perusahaan</label><input id="wizBizName" name="businessName" value="${escapeHtml(workspace.profile.businessName)}" maxlength="80" required ${isOwner ? "" : "disabled"} /></div>
          <div class="form-field"><label for="wizBizSector">Sektor Usaha</label><select id="wizBizSector" name="businessSector" ${isOwner ? "" : "disabled"}><option value="general" ${(workspace.profile.businessSector || "general") === "general" ? "selected" : ""}>Semua Usaha (Dagang, Jasa &amp; Manufaktur)</option><option value="trading" ${workspace.profile.businessSector === "trading" ? "selected" : ""}>Usaha Dagang</option><option value="service" ${workspace.profile.businessSector === "service" ? "selected" : ""}>Usaha Jasa / Layanan</option><option value="manufacturing" ${workspace.profile.businessSector === "manufacturing" ? "selected" : ""}>Manufaktur / Produksi</option></select></div>
          <div class="form-field"><label for="wizBizCity">Kota / Lokasi</label><input id="wizBizCity" name="city" value="${escapeHtml(workspace.profile.city || "")}" maxlength="80" ${isOwner ? "" : "disabled"} /></div>
          <div class="form-field"><label for="wizPeriod">Periode Pembukuan Aktif</label><input id="wizPeriod" name="activePeriod" type="month" value="${workspace.profile.activePeriod}" required ${isOwner ? "" : "disabled"} /></div>
        </div></div>
        <div class="doc-sheet-footer"><span class="muted">${isOwner ? "Hanya Owner yang dapat menyimpan profil." : "Mode Staff: hanya-baca."}</span><div class="report-actions">${isOwner ? `<button class="button primary" type="submit">Simpan &amp; Lanjut →</button>` : `<button class="button primary" type="button" data-wiz-step="2">Lanjut →</button>`}</div></div></form>
      </section>`;
    } else if (setupStep === 2) {
      const sampleCodes = ["1101", "1102", "1103", "1104", "1105", "1106", "2101", "2102", "3101", "4101", "4102", "5101", "5106", "5107", "5108"];
      const keyAccounts = workspace.accounts.filter((a) => sampleCodes.includes(a.code));
      stepBody = `<div class="dash-grid two-col">
        <section class="panel"><div class="panel-head"><h3>2. Struktur Daftar Akun (${workspace.accounts.length} akun SAK EMKM)</h3></div>
          <div class="table-wrap"><table><thead><tr><th>Kode</th><th>Nama Akun Inti</th><th>Sifat</th></tr></thead><tbody>
            ${keyAccounts.map((a) => `<tr><td class="account-code">${a.code}</td><td>${escapeHtml(a.name)}</td><td><span class="type-pill ${a.nature === "real" ? "posted" : "adjustment"}">${a.nature === "real" ? "Riil" : "Nominal"}</span></td></tr>`).join("")}
          </tbody></table></div>
        </section>
        <section class="panel"><div class="panel-head"><h3>Tambah Akun Khusus (Opsional)</h3></div><div class="panel-body">
          ${isOwner ? `<form id="wizardAccountForm"><div class="form-grid">
            <div class="form-field"><label for="wizAccCode">Kode Akun</label><input id="wizAccCode" name="code" pattern="[1-9][0-9]{3,5}" maxlength="6" placeholder="1108 / 4105" required /></div>
            <div class="form-field"><label for="wizAccName">Nama Akun</label><input id="wizAccName" name="name" maxlength="60" placeholder="Bank BCA Operasional" required /></div>
            <div class="form-field"><label for="wizAccGroup">Kelompok</label><select id="wizAccGroup" name="group"><option value="asset">Aset</option><option value="liability">Liabilitas</option><option value="equity">Ekuitas</option><option value="revenue">Pendapatan</option><option value="expense">HPP / Beban</option></select></div>
            <div class="form-field"><label for="wizAccCat">Sub-Kategori</label><input id="wizAccCat" name="category" maxlength="40" placeholder="Opsional" /></div>
          </div><div class="form-actions"><button class="button secondary" type="submit">+ Tambah Akun COA</button></div></form>` : `<p class="muted">Dikelola oleh Owner.</p>`}
          <div class="form-actions" style="justify-content:space-between;margin-top:16px">
            <button class="button secondary" type="button" data-wiz-step="1">← Kembali</button>
            <button class="button primary" type="button" data-wiz-step="3">Lanjut →</button>
          </div>
        </div></section>
      </div>`;
    } else if (setupStep === 3) {
      stepBody = `<div class="dash-grid two-col">
        <section class="panel"><div class="panel-head"><h3>Saldo Awal Kas &amp; Bank</h3><span class="muted">Kas: ${money(statements.cumulativeBalances["1101"] || 0)} · Bank: ${money(statements.cumulativeBalances["1102"] || 0)}</span></div>
          <div class="panel-body"><form id="wizardOpeningCashForm"><div class="form-grid">
            <div class="form-field"><label for="wizCashDate">Tanggal</label><input id="wizCashDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.start}" required /></div>
            <div class="form-field"><label for="wizCashAcc">Akun Tujuan</label><select id="wizCashAcc" name="cashAccountCode"><option value="1101">1101 · Kas Tunai</option><option value="1102">1102 · Bank / Rekening</option></select></div>
            <div class="form-field full"><label for="wizCashAmount">Nominal Setoran Modal (Rp)</label><input id="wizCashAmount" name="amount" type="number" min="1" step="1" placeholder="5000000" required /></div>
            <div class="form-field full"><label for="wizCashDesc">Keterangan</label><input id="wizCashDesc" name="description" value="Setoran modal awal usaha" maxlength="120" required /></div>
          </div><div class="form-actions"><button class="button primary" type="submit">Posting Setoran Awal</button></div></form></div>
        </section>
        <section class="panel"><div class="panel-head"><h3>Pelanggan &amp; Pemasok (${workspace.parties.length})</h3></div>
          <div class="panel-body"><form id="wizardPartyForm"><div class="form-grid">
            <div class="form-field full"><label for="wizPartyName">Nama Pelanggan / Pemasok</label><input id="wizPartyName" name="name" maxlength="70" required /></div>
            <div class="form-field"><label for="wizPartyType">Peran</label><select id="wizPartyType" name="type"><option value="customer">Pelanggan</option><option value="supplier">Pemasok</option><option value="both">Keduanya</option></select></div>
            <div class="form-field"><label for="wizPartyPhone">Telepon</label><input id="wizPartyPhone" name="phone" maxlength="30" /></div>
          </div><div class="form-actions"><button class="button secondary" type="submit">+ Tambah Relasi</button></div></form>
          <div class="form-actions" style="justify-content:space-between;margin-top:16px">
            <button class="button secondary" type="button" data-wiz-step="2">← Kembali</button>
            <button class="button primary" type="button" data-wiz-step="4">Lanjut →</button>
          </div></div>
        </section>
      </div>`;
    } else {
      stepBody = `<div class="split-layout">
        <section class="panel"><div class="panel-head"><h3>Tambah Barang / Jasa &amp; Harga Default</h3></div>
          <div class="panel-body"><form id="wizardItemForm"><div class="form-grid">
            <div class="form-field full"><label for="wizItemName">Nama Barang / Jasa</label><input id="wizItemName" name="name" maxlength="70" required /></div>
            <div class="form-field"><label for="wizItemCat">Kategori</label><select id="wizItemCat" name="category"><option value="finished_good">Barang Jadi (1105)</option><option value="raw_material">Bahan Baku (1104)</option><option value="wip">WIP Produksi (1106)</option><option value="service">Jasa / Layanan (4102)</option><option value="equipment">Peralatan / Aset Tetap</option></select></div>
            <div class="form-field"><label for="wizItemUnit">Satuan</label><input id="wizItemUnit" name="unit" placeholder="pcs / kg / jam" maxlength="25" required /></div>
            <div class="form-field"><label for="wizSalePrice">Harga Jual Default (Rp)</label><input id="wizSalePrice" name="defaultSalePrice" type="number" min="0" step="1" value="0" /></div>
            <div class="form-field"><label for="wizBuyCost">Harga Beli Default (Rp)</label><input id="wizBuyCost" name="defaultPurchaseCost" type="number" min="0" step="1" value="0" /></div>
            <div class="form-field"><label for="wizOpenQty">Stok Awal Qty</label><input id="wizOpenQty" name="openingQuantity" type="number" min="0" step="any" value="0" /></div>
            <div class="form-field"><label for="wizOpenVal">Nilai Stok Awal (Rp)</label><input id="wizOpenVal" name="openingTotalCost" type="number" min="0" step="1" value="0" /></div>
          </div><div class="form-actions"><button class="button primary" type="submit">+ Simpan Item</button></div></form></div>
        </section>
        <section class="panel"><div class="panel-head"><h3>Daftar Barang &amp; Jasa (${workspace.items.length})</h3><div class="report-actions"><button class="button small secondary" type="button" data-wiz-step="3">← Kembali</button><button class="button small primary" type="button" data-go="overview">Selesai</button></div></div>
          <div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kategori</th><th class="num">Harga Jual</th><th class="num">Stok</th><th class="num">Moving Avg</th></tr></thead><tbody>
            ${workspace.items.map((item) => `<tr><td class="account-name">${escapeHtml(item.name)}</td><td>${CATEGORY_LABELS[item.category]}</td><td class="num">${money(item.defaultSalePrice || 0)}</td><td class="num">${item.trackInventory ? `${qtyFmt(item.quantityOnHand)} ${escapeHtml(item.unit)}` : "Non-stok"}</td><td class="num">${item.trackInventory ? money(item.movingAverageCost) : "—"}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
      </div>`;
    }

    return `<div class="page-stack">
      ${heading("Persiapan Data Awal Perusahaan", "Konfigurasi perusahaan, daftar akun (COA), saldo awal kas/bank, relasi, dan barang/jasa.")}
      <div class="wizard-steps" role="tablist">
        ${steps.map((s) => `<button type="button" class="wizard-step ${setupStep === s.n ? "active" : ""}" data-wiz-step="${s.n}"><span class="wizard-num">${s.n}</span><span>${s.label}</span></button>`).join("")}
      </div>
      ${stepBody}
    </div>`;
  }

  function renderOperationalPage(moduleKey) {
    const mod = OPERATION_MODULES[moduleKey];
    const p = activePeriodInfo();
    const closed = isActivePeriodClosed();

    if (formOpen[moduleKey]) {
      const activeItems = workspace.items.filter((i) => i.active);
      const activeParties = workspace.parties.filter((party) => party.active);
      const itemField = ["sales", "purchases"].includes(moduleKey)
        ? `<div class="form-field" id="itemSelectWrap">
            <label for="transactionItem">${moduleKey === "sales" ? "Barang / Jasa" : "Barang / Bahan / Jasa"}</label>
            <select id="transactionItem" name="itemId">
              <option value="">-- Pilih item --</option>
              ${activeItems.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${CATEGORY_LABELS[item.category]}${item.trackInventory ? ` (${qtyFmt(item.quantityOnHand)} ${escapeHtml(item.unit)})` : ""}</option>`).join("")}
            </select>
          </div>
          <div class="form-field" id="qtyWrap">
            <label for="transactionQty">Kuantitas</label>
            <input id="transactionQty" name="quantity" type="number" min="0.001" step="any" placeholder="1" />
            <small id="itemStockHint">Harga default &amp; moving avg muncul otomatis.</small>
          </div>`
        : "";
      const cashAccountField = ["cashbank", "purchases"].includes(moduleKey)
        ? `<div class="form-field" id="cashAccountWrap">
            <label for="cashAccount">Akun Kas / Bank</label>
            <select id="cashAccount" name="cashAccountCode" ${closed ? "disabled" : ""}>
              <option value="1101">1101 · Kas Tunai</option>
              <option value="1102">1102 · Bank / Rekening</option>
            </select>
          </div>`
        : "";
      const sectorAccountField = moduleKey === "sales"
        ? `<div class="form-field" id="revenueAccountWrap">
            <label for="revenueAccount">Akun Pendapatan (opsional)</label>
            <select id="revenueAccount" name="revenueAccountCode">
              <option value="">-- Otomatis (4101 Barang / 4102 Jasa) --</option>
              ${workspace.accounts.filter((a) => a.active && a.group === "revenue" && a.normal === "credit").map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}
            </select>
          </div>`
        : moduleKey === "purchases"
          ? `<div class="form-field" id="assetAccountWrap" style="display:none">
              <label for="assetAccount">Akun Aset Tujuan</label>
              <select id="assetAccount" name="assetAccountCode">
                ${workspace.accounts.filter((a) => a.active && a.group === "asset" && (a.code.startsWith("12") || a.code === "1107")).map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}
              </select>
            </div>`
          : "";
      const invoiceField = moduleKey === "cashbank"
        ? `<div class="form-field full" id="invoiceWrap" style="display:none">
            <label for="transactionInvoice">Faktur Asal (Piutang / Utang)</label>
            <select id="transactionInvoice" name="invoiceId"></select>
          </div>`
        : "";
      const extraField = moduleKey === "cashbank"
        ? `<div class="form-field" id="expenseAccountWrap" style="display:none">
            <label for="expenseAccount">Akun Beban</label>
            <select id="expenseAccount" name="expenseAccountCode">
              ${workspace.accounts.filter((a) => a.active && a.group === "expense" && !["5101", "5106", "5107"].includes(a.code)).map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}
            </select>
          </div>`
        : "";

      return `<div class="page-stack">
        ${closed ? `<section class="panel"><div class="panel-body"><strong>Periode ${p.label} sudah ditutup.</strong> Posting baru dinonaktifkan.</div></section>` : ""}
        <section class="doc-sheet">
          <div class="doc-sheet-head">
            <div><h3>${mod.formTitle} (Baru)</h3><span class="muted">${mod.description}</span></div>
            <button type="button" class="button secondary" id="closeOpFormBtn">← Kembali ke Daftar</button>
          </div>
          <form id="transactionForm" data-module="${moduleKey}">
            <div class="doc-sheet-body">
              <div class="form-grid three">
                <div class="form-field"><label for="transactionDate">Tanggal</label><input id="transactionDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.end}" required ${closed ? "disabled" : ""} /></div>
                <div class="form-field"><label for="transactionType">Jenis Transaksi</label><select id="transactionType" name="type" ${closed ? "disabled" : ""}>${mod.allowedTypes.map((t) => `<option value="${t}">${TRANSACTION_LABELS[t].label}</option>`).join("")}</select></div>
                <div class="form-field" id="partyWrap"><label for="transactionParty">${mod.partyLabel}</label><select id="transactionParty" name="partyId" ${closed ? "disabled" : ""}><option value="">-- Pilih pihak --</option>${activeParties.map((party) => `<option value="${party.id}">${escapeHtml(party.name)} (${PARTY_TYPE_LABELS[party.type]})</option>`).join("")}</select></div>
              </div>
              <div class="form-grid three">
                ${itemField}
                ${cashAccountField}
                ${sectorAccountField}
                ${extraField}
                <div class="form-field"><label for="transactionAmount">Total Nilai Transaksi (Rp)</label><input id="transactionAmount" name="amount" inputmode="numeric" type="number" min="1" step="1" placeholder="500000" required ${closed ? "disabled" : ""} /></div>
                ${invoiceField}
                <div class="form-field full"><label for="transactionDescription">Keterangan / Memo</label><input id="transactionDescription" name="description" value="${TRANSACTION_LABELS[mod.allowedTypes[0]].defaultDescription}" maxlength="120" required ${closed ? "disabled" : ""} /></div>
              </div>
              <div id="transactionPreview" class="entry-preview"></div>
            </div>
            <div class="doc-sheet-footer">
              <button type="button" class="button secondary" id="cancelOpFormBtn">Batal</button>
              <button class="button primary" type="submit" ${closed ? "disabled" : ""}>${mod.submitLabel}</button>
            </div>
          </form>
        </section>
      </div>`;
    }

    const rows = workspace.journalEntries
      .filter((entry) => inActivePeriod(entry) && (mod.allowedTypes.includes(entry.type) || (entry.source === "reversal" && entry.reversesEntryId)))
      .filter((entry) => {
        if (entry.source !== "reversal") return true;
        const orig = workspace.journalEntries.find((x) => x.id === entry.reversesEntryId);
        return orig && mod.allowedTypes.includes(orig.type);
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    const subledgerKind = moduleKey === "sales" ? "receivable" : moduleKey === "purchases" ? "payable" : null;
    const openInvs = subledgerKind ? openInvoicesFor(subledgerKind) : [];
    const showingOpen = subledgerKind && opSubTab[moduleKey] === "open";
    const q = (opSearch[moduleKey] || "").trim().toLowerCase();

    return `<div class="page-stack">
      ${closed ? `<section class="panel"><div class="panel-body"><strong>Periode ${p.label} sudah ditutup.</strong> Ubah periode aktif di Pengaturan untuk transaksi bulan baru.</div></section>` : ""}
      <div class="erp-toolbar">
        <div class="erp-toolbar-left">
          <button type="button" class="button primary" id="openOpFormBtn" ${closed ? "disabled" : ""}>+ Buat ${mod.formTitle}</button>
          ${subledgerKind ? `<div class="tabs">
            <button type="button" class="tab ${!showingOpen ? "active" : ""}" data-op-tab="list">Daftar Dokumen (${rows.length})</button>
            <button type="button" class="tab ${showingOpen ? "active" : ""}" data-op-tab="open">${subledgerKind === "receivable" ? "Piutang Terbuka" : "Utang Terbuka"} (${openInvs.length})</button>
          </div>` : ""}
        </div>
        <div class="erp-toolbar-right">
          <div class="filter-row">
            <input id="opSearchInput" type="search" value="${escapeHtml(opSearch[moduleKey] || "")}" placeholder="Cari nomor bukti, pihak, item..." />
          </div>
        </div>
      </div>

      ${showingOpen ? `
        <section class="panel">
          <div class="table-wrap"><table><thead><tr><th>No. Faktur</th><th>Tanggal</th><th>${mod.partyLabel}</th><th class="num">Total Faktur</th><th class="num">Sisa Tagihan</th><th class="num">Aksi</th></tr></thead>
          <tbody id="opTableBody">${openInvs.length ? openInvs.map((inv) => {
            const sKey = `${inv.invoiceNumber} ${inv.partyName}`.toLowerCase();
            return `<tr data-search="${escapeHtml(sKey)}" style="${!q || sKey.includes(q) ? "" : "display:none"}">
              <td><span class="document-id">${escapeHtml(inv.invoiceNumber)}</span></td>
              <td>${shortDate(inv.date)}</td>
              <td class="account-name">${escapeHtml(inv.partyName)}</td>
              <td class="num">${money(inv.totalAmount)}</td>
              <td class="num"><strong>${money(inv.remainingAmount)}</strong></td>
              <td class="num"><button type="button" class="button small primary quick-settle-btn" data-kind="${inv.kind}" data-party="${inv.partyId}" data-invoice="${inv.id}" data-amount="${inv.remainingAmount}">${inv.kind === "receivable" ? "Terima Pelunasan" : "Bayar Utang"}</button></td>
            </tr>`;
          }).join("") : `<tr><td colspan="6" class="empty-state">Semua tagihan lunas.</td></tr>`}</tbody></table></div>
        </section>
      ` : `
        <section class="panel">
          <div class="table-wrap"><table><thead><tr><th>No. Dokumen</th><th>Tanggal</th><th>Keterangan</th><th>Barang / Pihak</th><th>Status</th><th class="num">Nilai</th><th class="num">Aksi</th></tr></thead>
          <tbody id="opTableBody">${rows.length ? rows.map((entry) => {
            const sKey = `${entry.documentNumber} ${entry.description} ${entry.itemName || ""} ${entry.partyName || ""}`.toLowerCase();
            return `<tr class="${entry.status === "voided" ? "row-voided" : ""}" data-search="${escapeHtml(sKey)}" style="${!q || sKey.includes(q) ? "" : "display:none"}">
              <td><span class="document-id">${escapeHtml(entry.documentNumber)}</span></td>
              <td>${shortDate(entry.date)}</td>
              <td><span class="account-name">${escapeHtml(entry.description)}</span></td>
              <td>${escapeHtml([entry.itemName, entry.partyName].filter(Boolean).join(" · ") || "—")}</td>
              <td>${statusBadge(entry)}</td>
              <td class="num"><strong>${money(entry.amount)}</strong></td>
              <td class="num"><button type="button" class="button small secondary view-journal" data-id="${entry.id}">Jurnal</button> ${voidButtonHtml(entry)}</td>
            </tr>`;
          }).join("") : `<tr><td colspan="7" class="empty-state"><strong>Belum ada dokumen pada ${p.label}</strong>Klik "+ Buat ${mod.formTitle}" untuk mencatat transaksi.</td></tr>`}</tbody></table></div>
        </section>
      `}
    </div>`;
  }

  function renderInventory() {
    const rawItems = workspace.items.filter((i) => i.category === "raw_material");
    const wipItems = workspace.items.filter((i) => i.category === "wip");
    const finItems = workspace.items.filter((i) => i.category === "finished_good");
    const stockItems = [...rawItems, ...wipItems, ...finItems];
    const sourceItems = [...rawItems, ...wipItems].filter((i) => i.active);
    const targetProdItems = [...wipItems, ...finItems].filter((i) => i.active);
    const rawTotal = rawItems.reduce((s, i) => s + i.totalInventoryValue, 0);
    const wipTotal = wipItems.reduce((s, i) => s + i.totalInventoryValue, 0);
    const finTotal = finItems.reduce((s, i) => s + i.totalInventoryValue, 0);
    const movements = workspace.inventoryMovements
      .filter((m) => !selectedInventoryItemId || m.itemId === selectedInventoryItemId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const itemById = Object.fromEntries(workspace.items.map((i) => [i.id, i]));
    const p = activePeriodInfo();
    const closed = isActivePeriodClosed();

    if (formOpen.inventory) {
      return `<div class="page-stack">
        <section class="doc-sheet">
          <div class="doc-sheet-head">
            <div><h3>Produksi Manufaktur (BOM + BTKL + BOP) &amp; Pemakaian Bahan</h3></div>
            <button type="button" class="button secondary" id="closeInvFormBtn">← Kembali ke Kartu Stok</button>
          </div>
          <form id="productionForm"><div class="doc-sheet-body"><div class="form-grid">
            <div class="form-field"><label for="prodDate">Tanggal</label><input id="prodDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.end}" required ${closed ? "disabled" : ""} /></div>
            <div class="form-field"><label for="prodMode">Mode Mutasi</label><select id="prodMode" name="type" ${closed ? "disabled" : ""}><option value="production_run">Produksi Manufaktur (BOM + BTKL + BOP)</option><option value="material_usage">Pemakaian Langsung ke HPP (1104 → 5101)</option></select></div>
            <div class="form-field"><label for="prodSource">Bahan Baku / WIP #1</label><select id="prodSource" name="sourceItemId" required ${closed ? "disabled" : ""}>${sourceItems.map((i) => `<option value="${i.id}">${escapeHtml(i.name)} (${qtyFmt(i.quantityOnHand)} ${escapeHtml(i.unit)})</option>`).join("")}</select></div>
            <div class="form-field"><label for="prodSourceQty">Qty Bahan #1</label><input id="prodSourceQty" name="sourceQuantity" type="number" min="0.001" step="any" required ${closed ? "disabled" : ""} /></div>
            <div class="form-field prod-mfg-only"><label for="prodSource2">Bahan Baku / WIP #2 (opsional)</label><select id="prodSource2" name="sourceItem2Id" ${closed ? "disabled" : ""}><option value="">-- Tidak ada --</option>${sourceItems.map((i) => `<option value="${i.id}">${escapeHtml(i.name)} (${qtyFmt(i.quantityOnHand)} ${escapeHtml(i.unit)})</option>`).join("")}</select></div>
            <div class="form-field prod-mfg-only"><label for="prodSource2Qty">Qty Bahan #2</label><input id="prodSource2Qty" name="sourceQuantity2" type="number" min="0" step="any" value="0" ${closed ? "disabled" : ""} /></div>
            <div class="form-field prod-mfg-only"><label for="prodTarget">Hasil Produksi (Barang Jadi / WIP)</label><select id="prodTarget" name="targetItemId" ${closed ? "disabled" : ""}>${targetProdItems.map((i) => `<option value="${i.id}">${escapeHtml(i.name)} · ${CATEGORY_LABELS[i.category]}</option>`).join("")}</select></div>
            <div class="form-field prod-mfg-only"><label for="prodTargetQty">Qty Hasil Dihasilkan</label><input id="prodTargetQty" name="targetQuantity" type="number" min="0.001" step="any" ${closed ? "disabled" : ""} /></div>
            <div class="form-field prod-mfg-only"><label for="prodLabor">Biaya Tenaga Kerja Langsung (BTKL)</label><input id="prodLabor" name="directLaborCost" type="number" min="0" step="1" value="0" ${closed ? "disabled" : ""} /></div>
            <div class="form-field prod-mfg-only"><label for="prodOverhead">Biaya Overhead Pabrik (BOP)</label><input id="prodOverhead" name="overheadCost" type="number" min="0" step="1" value="0" ${closed ? "disabled" : ""} /></div>
            <div class="form-field full prod-mfg-only"><label for="prodCostCredit">Akun Sumber BTKL &amp; BOP</label><select id="prodCostCredit" name="costCreditAccountCode" ${closed ? "disabled" : ""}><option value="2102">2102 · Utang Beban</option><option value="2105">2105 · Utang Gaji &amp; Pajak</option><option value="1101">1101 · Kas</option><option value="1102">1102 · Bank</option><option value="5109">5109 · Alokasi BTKL</option><option value="5110">5110 · Alokasi BOP</option></select></div>
            <div class="form-field full"><label for="prodDesc">Keterangan / Batch</label><input id="prodDesc" name="description" placeholder="Produksi harian batch 1" maxlength="100" ${closed ? "disabled" : ""} /></div>
          </div></div>
          <div class="doc-sheet-footer"><button type="button" class="button secondary" id="cancelInvFormBtn">Batal</button><button class="button primary" type="submit" ${closed || !sourceItems.length ? "disabled" : ""}>Posting Produksi / Mutasi</button></div></form>
        </section>
      </div>`;
    }

    return `<div class="page-stack">
      <div class="erp-toolbar">
        <div class="erp-toolbar-left">
          <button type="button" class="button primary" id="openInvFormBtn" ${closed || !sourceItems.length ? "disabled" : ""}>+ Produksi / Mutasi Bahan</button>
          <button type="button" class="button secondary" data-go="monthend">Stock Opname</button>
          <button type="button" class="button secondary" data-go="masterdata">Master Barang</button>
        </div>
        <div class="erp-toolbar-right">
          <div class="filter-row"><select id="inventoryFilter"><option value="">Semua Barang Persediaan</option>${stockItems.map((i) => `<option value="${i.id}" ${i.id === selectedInventoryItemId ? "selected" : ""}>${escapeHtml(i.name)}</option>`).join("")}</select></div>
        </div>
      </div>

      <div class="stock-grid four">
        <article class="stock-card"><span>Bahan Baku (1104)</span><strong>${money(rawTotal)}</strong></article>
        <article class="stock-card"><span>WIP Produksi (1106)</span><strong>${money(wipTotal)}</strong></article>
        <article class="stock-card"><span>Barang Jadi (1105)</span><strong>${money(finTotal)}</strong></article>
        <article class="stock-card"><span>HPP &amp; Beban Pokok</span><strong>${money(statements.cogs)}</strong></article>
      </div>

      <section class="panel">
        <div class="panel-head"><h3>Saldo &amp; Harga Pokok Moving Average</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nama Barang</th><th>Kategori</th><th class="num">Qty Tersedia</th><th>Satuan</th><th class="num">Moving Avg</th><th class="num">Total Nilai</th></tr></thead>
          <tbody>${stockItems.length ? stockItems.map((item) => `<tr>
            <td class="account-name">${escapeHtml(item.name)}</td>
            <td>${CATEGORY_LABELS[item.category]}</td>
            <td class="num"><strong>${qtyFmt(item.quantityOnHand)}</strong></td>
            <td>${escapeHtml(item.unit)}</td>
            <td class="num">${money(item.movingAverageCost)}</td>
            <td class="num"><strong>${money(item.totalInventoryValue)}</strong></td>
          </tr>`).join("") : `<tr><td colspan="6" class="empty-state">Belum ada barang persediaan.</td></tr>`}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Kartu Mutasi Stok</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Dokumen</th><th>Tanggal</th><th>Barang &amp; Mutasi</th><th class="num">Qty</th><th class="num">Nilai</th><th class="num">Saldo Qty</th><th class="num">Saldo Nilai</th></tr></thead>
          <tbody>${movements.length ? movements.map((m) => {
            const itm = itemById[m.itemId];
            return `<tr>
              <td><span class="document-id">${escapeHtml(m.referenceDoc)}</span></td>
              <td>${shortDate(m.date)}</td>
              <td><span class="account-name">${escapeHtml(itm?.name || m.itemId)}</span><span class="party-name">${MOVEMENT_LABELS[m.type] || m.type}</span></td>
              <td class="num">${m.quantityDelta > 0 ? `+${qtyFmt(m.quantityDelta)}` : qtyFmt(m.quantityDelta)}</td>
              <td class="num">${money(m.totalCost)}</td>
              <td class="num">${qtyFmt(m.balanceQtyAfter)}</td>
              <td class="num"><strong>${money(m.balanceValueAfter)}</strong></td>
            </tr>`;
          }).join("") : `<tr><td colspan="7" class="empty-state">Belum ada mutasi stok.</td></tr>`}</tbody>
        </table></div>
      </section>
    </div>`;
  }

  function renderMasterData() {
    const rows = [...workspace.items].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const parties = [...workspace.parties].sort((a, b) => a.name.localeCompare(b.name));
    const openByParty = {};
    for (const inv of workspace.invoices) {
      if (inv.status === "open" || inv.status === "partial") {
        openByParty[inv.partyId] = (openByParty[inv.partyId] || 0) + inv.remainingAmount;
      }
    }

    const tabsHtml = `<div class="module-tabs" role="tablist">
      <button class="module-tab ${masterSection === "items" ? "active" : ""}" data-master-section="items">Barang &amp; Jasa (${rows.length})</button>
      <button class="module-tab ${masterSection === "parties" ? "active" : ""}" data-master-section="parties">Pelanggan &amp; Pemasok (${parties.length})</button>
    </div>`;

    if (masterSection === "items") {
      if (formOpen.item) {
        return `<div class="page-stack">${tabsHtml}
          <section class="doc-sheet">
            <div class="doc-sheet-head"><h3>Tambah Barang / Layanan Jasa Baru</h3><button type="button" class="button secondary" id="closeMasterFormBtn">← Kembali ke Daftar</button></div>
            <form id="itemForm"><div class="doc-sheet-body"><div class="form-grid">
              <div class="form-field full"><label for="itemName">Nama Barang / Layanan Jasa</label><input id="itemName" name="name" maxlength="70" required /></div>
              <div class="form-field"><label for="itemCategory">Kategori</label><select id="itemCategory" name="category"><option value="finished_good">Barang Jadi (1105)</option><option value="raw_material">Bahan Baku (1104)</option><option value="wip">Barang Dalam Proses / WIP (1106)</option><option value="service">Jasa / Layanan (4102)</option><option value="equipment">Peralatan / Aset Tetap</option></select></div>
              <div class="form-field"><label for="itemUnit">Satuan</label><input id="itemUnit" name="unit" placeholder="kg / pcs / paket / jam" maxlength="25" required /></div>
              <div class="form-field"><label for="itemSalePrice">Harga Jual Default (Rp)</label><input id="itemSalePrice" name="defaultSalePrice" type="number" min="0" step="1" value="0" /></div>
              <div class="form-field"><label for="itemPurchaseCost">Harga Beli Default (Rp)</label><input id="itemPurchaseCost" name="defaultPurchaseCost" type="number" min="0" step="1" value="0" /></div>
              <div class="form-field"><label for="itemRevAccount">Akun Pendapatan (opsional)</label><select id="itemRevAccount" name="revenueAccountCode"><option value="">-- Otomatis sesuai kategori --</option>${workspace.accounts.filter((a) => a.active && a.group === "revenue" && a.normal === "credit").map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}</select></div>
              <div class="form-field"><label for="itemCogsAccount">Akun HPP / Beban (opsional)</label><select id="itemCogsAccount" name="cogsAccountCode"><option value="">-- Otomatis sesuai kategori --</option>${workspace.accounts.filter((a) => a.active && a.group === "expense").map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}</select></div>
              <div class="form-field"><label for="itemOpeningQty">Stok Awal Qty (opsional)</label><input id="itemOpeningQty" name="openingQuantity" type="number" min="0" step="any" value="0" /></div>
              <div class="form-field"><label for="itemOpeningVal">Nilai Stok Awal Rp (opsional)</label><input id="itemOpeningVal" name="openingTotalCost" type="number" min="0" step="1" value="0" /></div>
            </div></div><div class="doc-sheet-footer"><button type="button" class="button secondary" id="cancelMasterFormBtn">Batal</button><button class="button primary" type="submit">Simpan Item</button></div></form>
          </section>
        </div>`;
      }

      return `<div class="page-stack">${tabsHtml}
        <div class="erp-toolbar">
          <div class="erp-toolbar-left"><button type="button" class="button primary" id="openItemFormBtn">+ Tambah Barang / Jasa</button></div>
          <div class="erp-toolbar-right"><div class="filter-row">
            <input id="masterSearchInput" type="search" value="${escapeHtml(masterSearch)}" placeholder="Cari nama atau satuan..." />
            <select id="masterCategoryFilter"><option value="all" ${masterCategoryFilter === "all" ? "selected" : ""}>Semua Kategori</option><option value="finished_good" ${masterCategoryFilter === "finished_good" ? "selected" : ""}>Barang Jadi</option><option value="raw_material" ${masterCategoryFilter === "raw_material" ? "selected" : ""}>Bahan Baku</option><option value="wip" ${masterCategoryFilter === "wip" ? "selected" : ""}>WIP Produksi</option><option value="service" ${masterCategoryFilter === "service" ? "selected" : ""}>Jasa / Layanan</option><option value="equipment" ${masterCategoryFilter === "equipment" ? "selected" : ""}>Peralatan</option></select>
          </div></div>
        </div>
        <section class="panel"><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kategori</th><th>Satuan</th><th class="num">Harga Jual</th><th class="num">Harga Beli</th><th class="num">Stok</th><th class="num">Moving Avg</th><th>Status</th><th class="num">Aksi</th></tr></thead><tbody id="masterItemsBody">
          ${rows.map((item) => {
            const searchKey = `${item.name} ${item.unit} ${CATEGORY_LABELS[item.category]}`.toLowerCase();
            const visible = (!masterSearch || searchKey.includes(masterSearch.toLowerCase())) && (masterCategoryFilter === "all" || item.category === masterCategoryFilter);
            return `<tr data-search="${escapeHtml(searchKey)}" data-category="${item.category}" style="${visible ? "" : "display:none"}"><td class="account-name">${escapeHtml(item.name)}</td><td>${CATEGORY_LABELS[item.category]}</td><td>${escapeHtml(item.unit)}</td><td class="num">${money(item.defaultSalePrice || 0)}</td><td class="num">${money(item.defaultPurchaseCost || 0)}</td><td class="num">${item.trackInventory ? qtyFmt(item.quantityOnHand) : "—"}</td><td class="num">${item.trackInventory ? money(item.movingAverageCost) : "—"}</td><td><span class="type-pill ${item.active ? "posted" : ""}">${item.active ? "Aktif" : "Nonaktif"}</span></td><td class="num"><button class="button secondary small toggle-item" data-id="${item.id}">${item.active ? "Nonaktifkan" : "Aktifkan"}</button></td></tr>`;
          }).join("")}
        </tbody></table></div></section>
      </div>`;
    }

    if (formOpen.party) {
      return `<div class="page-stack">${tabsHtml}
        <section class="doc-sheet">
          <div class="doc-sheet-head"><h3>Tambah Pelanggan / Pemasok</h3><button type="button" class="button secondary" id="closeMasterFormBtn">← Kembali ke Daftar</button></div>
          <form id="partyForm"><div class="doc-sheet-body"><div class="form-grid">
            <div class="form-field full"><label for="partyName">Nama Pihak</label><input id="partyName" name="name" maxlength="70" required /></div>
            <div class="form-field"><label for="partyType">Peran</label><select id="partyType" name="type"><option value="customer">Pelanggan</option><option value="supplier">Pemasok</option><option value="both">Keduanya</option></select></div>
            <div class="form-field"><label for="partyPhone">Telepon (opsional)</label><input id="partyPhone" name="phone" maxlength="30" /></div>
          </div></div><div class="doc-sheet-footer"><button type="button" class="button secondary" id="cancelMasterFormBtn">Batal</button><button class="button primary" type="submit">Simpan Pihak</button></div></form>
        </section>
      </div>`;
    }

    return `<div class="page-stack">${tabsHtml}
      <div class="erp-toolbar">
        <div class="erp-toolbar-left"><button type="button" class="button primary" id="openPartyFormBtn">+ Tambah Pelanggan / Pemasok</button></div>
      </div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Peran</th><th class="num">Tagihan Terbuka</th><th>Status</th></tr></thead><tbody>
        ${parties.map((party) => `<tr><td class="account-name">${escapeHtml(party.name)}</td><td>${PARTY_TYPE_LABELS[party.type]}</td><td class="num">${money(openByParty[party.id] || 0, true)}</td><td><span class="type-pill posted">Aktif</span></td></tr>`).join("")}
      </tbody></table></div></section>
    </div>`;
  }

  function renderLedgerModule() {
    const p = activePeriodInfo();
    const accMap = accountMap();
    const periodEntries = workspace.journalEntries
      .filter(inActivePeriod)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

    let bodyHtml = "";
    if (ledgerSection === "journal") {
      const closed = isActivePeriodClosed();
      if (formOpen.journal) {
        const controlCodes = new Set(["3999", "1103", "1104", "1105", "1106", "2101"]);
        const activeAccounts = workspace.accounts.filter((a) => a.active && !controlCodes.has(a.code));
        const accOpts = activeAccounts
          .map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`)
          .join("");
        bodyHtml = `<section class="doc-sheet">
          <div class="doc-sheet-head"><div><h3>Jurnal Umum (Manual Double-Entry)</h3></div><button type="button" class="button secondary" id="closeJournalFormBtn">← Kembali ke Daftar</button></div>
          <form id="generalJournalForm"><div class="doc-sheet-body">
            <div class="form-grid">
              <div class="form-field"><label for="gjDate">Tanggal</label><input id="gjDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.end}" required ${closed ? "disabled" : ""} /></div>
              <div class="form-field"><label for="gjDesc">Keterangan Jurnal</label><input id="gjDesc" name="description" maxlength="120" placeholder="Bayar gaji / Terima pinjaman / Sewa" required ${closed ? "disabled" : ""} /></div>
            </div>
            <div class="doc-line-grid"><div class="table-wrap"><table><thead><tr><th>Akun</th><th class="num">Debit (Rp)</th><th class="num">Kredit (Rp)</th><th>Memo</th></tr></thead><tbody id="gjLinesBody">
              ${[0, 1].map((idx) => `<tr class="gj-row">
                <td><select class="gj-acc" required ${closed ? "disabled" : ""}>${accOpts}</select></td>
                <td class="num"><input class="gj-debit" type="number" min="0" step="1" value="${idx === 0 ? "100000" : "0"}" ${closed ? "disabled" : ""} /></td>
                <td class="num"><input class="gj-credit" type="number" min="0" step="1" value="${idx === 1 ? "100000" : "0"}" ${closed ? "disabled" : ""} /></td>
                <td><input class="gj-memo" maxlength="80" placeholder="Opsional" ${closed ? "disabled" : ""} /></td>
              </tr>`).join("")}
            </tbody></table></div></div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <button type="button" class="button secondary small" id="gjAddRowBtn" ${closed ? "disabled" : ""}>+ Tambah Baris</button>
              <span id="gjBalanceHint" class="status-pill good">Seimbang: Rp100.000</span>
            </div>
          </div><div class="doc-sheet-footer"><button type="button" class="button secondary" id="cancelJournalFormBtn">Batal</button><button class="button primary" type="submit" ${closed ? "disabled" : ""}>Posting Jurnal Umum</button></div></form>
        </section>`;
      } else {
        const sum = periodEntries.reduce((acc, e) => {
          e.lines.forEach((l) => { acc.debit += l.debit; acc.credit += l.credit; });
          return acc;
        }, { debit: 0, credit: 0 });
        const balanced = sum.debit === sum.credit;
        bodyHtml = `<div class="erp-toolbar">
          <div class="erp-toolbar-left"><button type="button" class="button primary" id="openJournalFormBtn" ${closed ? "disabled" : ""}>+ Buat Jurnal Umum</button></div>
          <div class="erp-toolbar-right"><div class="filter-row"><input id="journalSearchInput" type="search" value="${escapeHtml(journalSearch)}" placeholder="Cari nomor dokumen, akun, atau keterangan..." /></div></div>
        </div>
        <section class="panel"><div class="table-wrap"><table>
          <thead><tr><th>Tanggal</th><th>Dokumen &amp; Keterangan</th><th>Akun</th><th class="num">Debit</th><th class="num">Kredit</th><th>Aksi</th></tr></thead>
          <tbody id="journalEntriesBody">${periodEntries.length ? periodEntries.map((entry) => {
            const entrySearch = `${entry.documentNumber} ${entry.description} ${entry.partyName || ""} ${entry.itemName || ""} ${entry.lines.map((l) => `${l.accountCode} ${accMap[l.accountCode]?.name || ""}`).join(" ")}`.toLowerCase();
            const visible = !journalSearch || entrySearch.includes(journalSearch.toLowerCase());
            return entry.lines.map((line, idx) => `<tr class="${entry.status === "voided" ? "row-voided" : ""}" data-search="${escapeHtml(entrySearch)}" style="${visible ? "" : "display:none"}">
              ${idx === 0 ? `<td rowspan="${entry.lines.length}">${shortDate(entry.date)}</td><td rowspan="${entry.lines.length}"><span class="document-id">${escapeHtml(entry.documentNumber)}</span> <span class="account-name">${escapeHtml(entry.description)}</span> ${statusBadge(entry)}</td>` : ""}
              <td class="${line.credit ? "journal-credit" : ""}"><span class="account-code">${line.accountCode}</span><span class="account-name">${escapeHtml(accMap[line.accountCode]?.name || line.accountCode)}</span></td>
              <td class="num">${money(line.debit, true)}</td><td class="num">${money(line.credit, true)}</td>
              ${idx === 0 ? `<td rowspan="${entry.lines.length}">${voidButtonHtml(entry)}</td>` : ""}
            </tr>`).join("");
          }).join("") : `<tr><td colspan="6" class="empty-state">Belum ada jurnal pada periode ${p.label}.</td></tr>`}
          <tr class="total-row"><td colspan="3">Total Periode ${p.label}</td><td class="num">${money(sum.debit)}</td><td class="num">${money(sum.credit)}</td><td></td></tr>
          <tr class="balance-row"><td colspan="6">${balanced ? "Status: Balance (Debit = Kredit)" : "Selisih"}</td></tr></tbody>
        </table></div></section>`;
      }
    } else if (ledgerSection === "ledger") {
      const acc = accMap[selectedLedgerAccount] || workspace.accounts[0];
      const priorEntries = workspace.journalEntries.filter((e) => e.date < p.start);
      let opening = 0;
      priorEntries.forEach((e) => e.lines.filter((l) => l.accountCode === acc.code).forEach((l) => { opening += l.debit - l.credit; }));
      let running = opening;
      const movements = periodEntries.flatMap((e) => e.lines.filter((l) => l.accountCode === acc.code).map((l) => ({ ...l, date: e.date, doc: e.documentNumber, desc: e.description, status: e.status })));
      bodyHtml = `<section class="panel">
        <div class="panel-head">
          <div><h3>${acc.code} · ${escapeHtml(acc.name)}</h3><p>Akun ${acc.nature === "real" ? "Riil" : "Nominal"} · Saldo Awal ${p.label}: <strong>${money(Math.abs(opening))} ${opening >= 0 ? "D" : "K"}</strong></p></div>
          <div class="filter-row"><select id="ledgerAccount">${workspace.accounts.map((a) => `<option value="${a.code}" ${a.code === acc.code ? "selected" : ""}>${a.code} · ${escapeHtml(a.name)}</option>`).join("")}</select></div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Dokumen &amp; Keterangan</th><th class="num">Debit</th><th class="num">Kredit</th><th class="num">Saldo Berjalan</th></tr></thead>
          <tbody>
            <tr><td>${shortDate(p.start)}</td><td><em>Saldo awal terbawa dari periode sebelumnya</em></td><td class="num">—</td><td class="num">—</td><td class="num"><strong>${money(Math.abs(opening))} ${opening >= 0 ? "D" : "K"}</strong></td></tr>
            ${movements.map((m) => {
              running += m.debit - m.credit;
              return `<tr class="${m.status === "voided" ? "row-voided" : ""}"><td>${shortDate(m.date)}</td><td><span class="document-id">${escapeHtml(m.doc)}</span> <span class="account-name">${escapeHtml(m.desc)}</span></td><td class="num">${money(m.debit, true)}</td><td class="num">${money(m.credit, true)}</td><td class="num"><strong>${money(Math.abs(running))} ${running >= 0 ? "D" : "K"}</strong></td></tr>`;
            }).join("")}
          </tbody>
        </table></div>
      </section>`;
    } else if (ledgerSection === "trial") {
      const adjusted = trialMode === "adjusted";
      const tb = adjusted ? trialBalanceAdjusted : trialBalanceUnadjusted;
      bodyHtml = `<div class="tabs" role="tablist">
        <button class="tab ${!adjusted ? "active" : ""}" data-trial="unadjusted">Sebelum Penyesuaian</button>
        <button class="tab ${adjusted ? "active" : ""}" data-trial="adjusted">Setelah Penyesuaian</button>
      </div>
      <section class="report-paper">
        <div class="report-heading">
          <strong>${escapeHtml(workspace.profile.businessName).toUpperCase()}</strong>
          <h3>${adjusted ? "NERACA SALDO SETELAH PENYESUAIAN" : "NERACA SALDO"}</h3>
          <p>Per ${p.endLabel}</p>
        </div>
        <div class="table-wrap"><table class="academic-table">
          <thead><tr><th>No. Akun</th><th>Nama Akun</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead>
          <tbody>${tb.rows.map((r) => `<tr><td class="account-code">${r.accountCode}</td><td><span class="account-name">${escapeHtml(r.accountName)}</span></td><td class="num">${money(r.debit, true)}</td><td class="num">${money(r.credit, true)}</td></tr>`).join("")}
          <tr class="academic-grand-total"><td colspan="2">Jumlah</td><td class="num">${money(tb.totalDebit)}</td><td class="num">${money(tb.totalCredit)}</td></tr></tbody>
        </table></div>
        <div class="report-status ${tb.isBalanced ? "good" : "bad"}">${tb.isBalanced ? "Debit = Kredit" : "Tidak seimbang"}</div>
      </section>`;
    } else if (ledgerSection === "accounts") {
      const isOwner = currentRole === "owner";
      if (isOwner && formOpen.coa) {
        bodyHtml = `<section class="doc-sheet">
          <div class="doc-sheet-head"><h3>Tambah Akun Baru (Daftar Akun / COA)</h3><button type="button" class="button secondary" id="closeCoaFormBtn">← Kembali ke Daftar Akun</button></div>
          <form id="createAccountForm"><div class="doc-sheet-body"><div class="form-grid">
            <div class="form-field"><label for="accCode">Kode Akun (4–6 digit)</label><input id="accCode" name="code" pattern="[1-9][0-9]{3,5}" maxlength="6" placeholder="1205 / 4105 / 5120" required /></div>
            <div class="form-field"><label for="accName">Nama Akun</label><input id="accName" name="name" maxlength="60" placeholder="Beban Riset & Kemasan" required /></div>
            <div class="form-field"><label for="accGroup">Kelompok Akun</label><select id="accGroup" name="group"><option value="asset">Aset (Riil, Debit)</option><option value="contra_asset">Kontra Aset (Riil, Kredit)</option><option value="liability">Liabilitas / Utang (Riil, Kredit)</option><option value="equity">Ekuitas / Modal (Riil, Kredit)</option><option value="drawing">Prive (Nominal, Debit)</option><option value="revenue">Pendapatan (Nominal, Kredit)</option><option value="expense">HPP / Biaya / Beban (Nominal, Debit)</option></select></div>
            <div class="form-field"><label for="accCategory">Sub-Kategori (opsional)</label><input id="accCategory" name="category" maxlength="40" placeholder="Otomatis jika kosong" /></div>
          </div></div><div class="doc-sheet-footer"><button type="button" class="button secondary" id="cancelCoaFormBtn">Batal</button><button class="button primary" type="submit">Simpan Akun COA</button></div></form>
        </section>`;
      } else {
        bodyHtml = `<div class="erp-toolbar">
          <div class="erp-toolbar-left">${isOwner ? `<button type="button" class="button primary" id="openCoaFormBtn">+ Tambah Akun COA</button>` : `<span class="muted">Daftar Akun (${workspace.accounts.length} akun)</span>`}</div>
          <div class="erp-toolbar-right"><div class="filter-row">
            <input id="coaSearchInput" type="search" value="${escapeHtml(coaSearch)}" placeholder="Cari kode, nama akun, kategori..." />
            <select id="coaGroupFilter"><option value="all" ${coaGroupFilter === "all" ? "selected" : ""}>Semua Kelompok</option><option value="asset" ${coaGroupFilter === "asset" ? "selected" : ""}>Aset</option><option value="liability" ${coaGroupFilter === "liability" ? "selected" : ""}>Liabilitas</option><option value="equity" ${coaGroupFilter === "equity" ? "selected" : ""}>Ekuitas</option><option value="revenue" ${coaGroupFilter === "revenue" ? "selected" : ""}>Pendapatan</option><option value="expense" ${coaGroupFilter === "expense" ? "selected" : ""}>HPP &amp; Beban</option></select>
          </div></div>
        </div>
        <section class="panel"><div class="table-wrap"><table>
          <thead><tr><th>Kode</th><th>Nama Akun</th><th>Kategori</th><th>Sifat</th><th>Normal</th><th>Status</th><th class="num">Saldo Kumulatif</th>${isOwner ? "<th class='num'>Aksi</th>" : ""}</tr></thead>
          <tbody id="coaTableBody">${workspace.accounts.map((a) => {
            const raw = statements.cumulativeBalances[a.code] || 0;
            const display = a.normal === "debit" ? raw : -raw;
            const searchKey = `${a.code} ${a.name} ${a.category}`.toLowerCase();
            const groupNorm = a.group === "contra_asset" ? "asset" : a.group === "drawing" ? "equity" : a.group;
            const visible = (!coaSearch || searchKey.includes(coaSearch.toLowerCase())) && (coaGroupFilter === "all" || groupNorm === coaGroupFilter);
            return `<tr data-search="${escapeHtml(searchKey)}" data-group="${groupNorm}" style="${visible ? "" : "display:none"}"><td class="account-code">${a.code}</td><td class="account-name">${escapeHtml(a.name)}</td><td>${escapeHtml(a.category)}</td><td><span class="type-pill ${a.nature === "real" ? "posted" : "adjustment"}">${a.nature === "real" ? "Riil" : "Nominal"}</span></td><td>${a.normal === "debit" ? "D" : "K"}</td><td><span class="type-pill ${a.active ? "posted" : ""}">${a.active ? "Aktif" : "Nonaktif"}</span></td><td class="num">${money(display, true)}</td>${isOwner ? `<td class="num"><button type="button" class="button secondary small toggle-account-btn" data-code="${escapeHtml(a.code)}">${a.active ? "Nonaktifkan" : "Aktifkan"}</button></td>` : ""}</tr>`;
          }).join("")}</tbody>
        </table></div></section>`;
      }
    } else {
      const logs = [...workspace.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
      bodyHtml = currentRole !== "owner"
        ? `<section class="panel"><div class="panel-body"><p class="empty-state"><strong>Akses Terbatas</strong>Log Audit Trail hanya dapat dilihat oleh Owner.</p></div></section>`
        : `<section class="panel"><div class="panel-head"><h3>Audit Trail (${logs.length} log terbaru)</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Aksi</th><th>Entitas</th><th>Ringkasan</th></tr></thead>
        <tbody>${logs.map((l) => `<tr><td>${escapeHtml(l.createdAt.slice(0, 19).replace("T", " "))}</td><td><span class="document-id">${escapeHtml(l.action)}</span></td><td>${escapeHtml(l.entityType)}</td><td>${escapeHtml(l.summary)}</td></tr>`).join("")}</tbody>
      </table></div></section>`;
    }

    return `<div class="page-stack">
      <div class="module-tabs" role="tablist">
        <button class="module-tab ${ledgerSection === "journal" ? "active" : ""}" data-ledger-section="journal">Jurnal Umum</button>
        <button class="module-tab ${ledgerSection === "ledger" ? "active" : ""}" data-ledger-section="ledger">Buku Besar</button>
        <button class="module-tab ${ledgerSection === "trial" ? "active" : ""}" data-ledger-section="trial">Neraca Saldo</button>
        <button class="module-tab ${ledgerSection === "accounts" ? "active" : ""}" data-ledger-section="accounts">Daftar Akun (COA)</button>
        ${currentRole === "owner" ? `<button class="module-tab ${ledgerSection === "audit" ? "active" : ""}" data-ledger-section="audit">Audit Trail</button>` : ""}
      </div>
      ${bodyHtml}
    </div>`;
  }

  function renderMonthEnd() {
    const p = activePeriodInfo();
    const closed = isActivePeriodClosed();
    const stockItems = workspace.items.filter((i) => i.trackInventory && i.active);
    const adjRows = workspace.journalEntries
      .filter((e) => inActivePeriod(e) && ["adjustment", "opname", "closing"].includes(e.source))
      .sort((a, b) => b.date.localeCompare(a.date));

    const closeAction = closed
      ? `<span class="status-pill good">Periode ${p.value} Ditutup</span>`
      : currentRole === "owner"
        ? `<button class="button primary" id="closePeriodBtn">Tutup Periode ${p.label}</button>`
        : `<span class="type-pill">Penutupan Periode: Khusus Owner</span>`;

    return `<div class="page-stack">
      <div class="erp-toolbar">
        <div class="erp-toolbar-left"><strong>Proses Akhir Bulan — ${p.label}</strong></div>
        <div class="erp-toolbar-right">${closeAction}</div>
      </div>

      <div class="dash-grid two-col">
        <section class="panel"><div class="panel-head"><h3>Stock Opname Fisik</h3></div><div class="panel-body">
          <form id="opnameForm"><div class="form-grid">
            <div class="form-field full"><label for="opnameItem">Barang Persediaan</label><select id="opnameItem" name="itemId" required ${closed ? "disabled" : ""}>${stockItems.map((i) => `<option value="${i.id}">${escapeHtml(i.name)} · Buku: ${qtyFmt(i.quantityOnHand)} ${escapeHtml(i.unit)} (Avg ${money(i.movingAverageCost)})</option>`).join("")}</select></div>
            <div class="form-field"><label for="opnameDate">Tanggal Opname</label><input id="opnameDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.end}" required ${closed ? "disabled" : ""} /></div>
            <div class="form-field"><label for="opnamePhysical">Kuantitas Fisik</label><input id="opnamePhysical" name="physicalQuantity" type="number" min="0" step="any" required ${closed ? "disabled" : ""} /></div>
            <div class="form-field full"><label for="opnameUnitCost">Harga Pokok Referensi (jika moving avg Rp0)</label><input id="opnameUnitCost" name="unitCostIfZero" type="number" min="0" step="1" placeholder="Opsional" ${closed ? "disabled" : ""} /></div>
            <div class="form-field full"><label for="opnameNotes">Catatan Opname</label><input id="opnameNotes" name="notes" placeholder="Hasil hitung fisik akhir bulan" maxlength="100" ${closed ? "disabled" : ""} /></div>
          </div><div class="form-actions"><button class="button primary" type="submit" ${closed || !stockItems.length ? "disabled" : ""}>Simpan Stock Opname</button></div></form>
        </div></section>

        <section class="panel"><div class="panel-head"><h3>Jurnal Penyesuaian (Penyusutan &amp; Akrual)</h3></div><div class="panel-body">
          <form id="adjustmentForm"><div class="form-grid">
            <div class="form-field"><label for="adjType">Jenis</label><select id="adjType" name="type" ${closed ? "disabled" : ""}><option value="depreciation">Penyusutan Peralatan</option><option value="accrued_expense">Beban Akrual (Belum Dibayar)</option></select></div>
            <div class="form-field"><label for="adjDate">Tanggal</label><input id="adjDate" name="date" type="date" min="${p.start}" max="${p.end}" value="${p.end}" required ${closed ? "disabled" : ""} /></div>
            <div id="adjDynamic" class="form-field full" style="display:contents"></div>
          </div><div class="form-actions"><button class="button secondary" type="submit" ${closed ? "disabled" : ""}>Simpan Penyesuaian</button></div></form>
        </div></section>
      </div>

      <section class="panel"><div class="panel-head"><h3>Riwayat Opname, Penyesuaian &amp; Penutupan (${p.label})</h3></div>
        <div class="table-wrap"><table><thead><tr><th>No. Dokumen</th><th>Tanggal</th><th>Keterangan</th><th>Status</th><th class="num">Nilai</th><th class="num">Aksi</th></tr></thead>
          <tbody>${adjRows.length ? adjRows.map((entry) => `<tr class="${entry.status === "voided" ? "row-voided" : ""}"><td><span class="document-id">${escapeHtml(entry.documentNumber)}</span></td><td>${shortDate(entry.date)}</td><td class="account-name">${escapeHtml(entry.description)}</td><td>${statusBadge(entry)}</td><td class="num">${money(entry.amount)}</td><td class="num"><button class="button secondary small view-journal" data-id="${entry.id}">Jurnal</button> ${voidButtonHtml(entry)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-state">Belum ada penyesuaian pada ${p.label}.</td></tr>`}</tbody>
        </table></div>
      </section>
    </div>`;
  }

  function reportHeading(title, subtitle) {
    return `<div class="report-heading"><strong>${escapeHtml(workspace.profile.businessName).toUpperCase()}</strong><h3>${title}</h3><p>${subtitle}</p></div>`;
  }

  function reportRow(label, value = null, className = "", totalColumn = false) {
    return `<tr class="${className}"><td>${escapeHtml(label)}</td><td class="num">${value !== null && !totalColumn ? money(value) : ""}</td><td class="num">${value !== null && totalColumn ? money(value) : ""}</td></tr>`;
  }

  function renderStatements() {
    const fin = statements;
    const p = activePeriodInfo();
    const isCogsAcc = (a) => {
      if (a.group !== "expense") return false;
      const cat = String(a.category || "").toLowerCase();
      return a.code === "5101" || a.code === "5108" || cat.includes("hpp") || cat.includes("beban pokok");
    };
    const isCurrentAssetAcc = (a) => {
      if (a.group !== "asset") return false;
      const cat = String(a.category || "").toLowerCase();
      return a.code.startsWith("10") || a.code.startsWith("11") || cat.includes("lancar");
    };
    const revAccounts = workspace.accounts.filter((a) => a.group === "revenue");
    const cogsAccounts = workspace.accounts.filter((a) => isCogsAcc(a));
    const opExpAccounts = workspace.accounts.filter((a) => a.group === "expense" && !isCogsAcc(a));
    const currAssets = workspace.accounts.filter((a) => isCurrentAssetAcc(a));
    const fixedAssets = workspace.accounts.filter((a) => a.group === "asset" && !isCurrentAssetAcc(a));
    const contraAssets = workspace.accounts.filter((a) => a.group === "contra_asset");
    const liabAccounts = workspace.accounts.filter((a) => a.group === "liability");

    const showAll = reportFilter === "all";
    return `<div class="page-stack">
      <div class="erp-toolbar">
        <div class="erp-toolbar-left">
          <div class="tabs" role="tablist">
            <button type="button" class="tab ${reportFilter === "all" ? "active" : ""}" data-report-tab="all">Semua Laporan</button>
            <button type="button" class="tab ${reportFilter === "income" ? "active" : ""}" data-report-tab="income">Laba Rugi</button>
            <button type="button" class="tab ${reportFilter === "equity" ? "active" : ""}" data-report-tab="equity">Perubahan Modal</button>
            <button type="button" class="tab ${reportFilter === "balance" ? "active" : ""}" data-report-tab="balance">Neraca</button>
            <button type="button" class="tab ${reportFilter === "summary" ? "active" : ""}" data-report-tab="summary">Ikhtisar Kas &amp; Tagihan</button>
          </div>
        </div>
        <div class="erp-toolbar-right">
          <span class="status-pill ${fin.isBalanced ? "good" : "bad"}">${fin.isBalanced ? "Balance" : "Belum balance"}</span>
          <button class="button secondary" id="exportXlsx">Export XLSX</button>
          <button class="button primary" id="exportPdf">Export PDF</button>
        </div>
      </div>

      <div class="report-stack">
        ${showAll || reportFilter === "income" ? `<section class="report-paper">
          ${reportHeading("LAPORAN LABA RUGI", `Untuk bulan yang berakhir ${p.endLabel}`)}
          <table class="statement-table"><thead><tr><th>Uraian</th><th class="num">Jumlah</th><th class="num">Total</th></tr></thead><tbody>
            ${reportRow("Pendapatan", null, "report-section")}
            ${revAccounts.filter((a) => Math.abs(fin.periodActivityBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, -(fin.periodActivityBalances[a.code] || 0), "report-detail")).join("")}
            ${reportRow("Total Pendapatan", fin.revenue, "report-subtotal", true)}
            ${reportRow("Harga Pokok / Beban Pokok", null, "report-section")}
            ${cogsAccounts.filter((a) => Math.abs(fin.periodActivityBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, fin.periodActivityBalances[a.code] || 0, "report-detail")).join("")}
            ${reportRow("Total Harga Pokok (HPP)", fin.cogs, "report-subtotal", true)}
            ${reportRow("Laba Kotor", fin.grossProfit, "report-subtotal", true)}
            ${reportRow("Beban Operasional", null, "report-section")}
            ${opExpAccounts.filter((a) => Math.abs(fin.periodActivityBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, fin.periodActivityBalances[a.code] || 0, "report-detail")).join("")}
            ${reportRow("Total Beban Operasional", fin.operatingExpenses, "report-subtotal", true)}
            ${reportRow("Laba Bersih", fin.netIncome, "report-final", true)}
          </tbody></table>
        </section>` : ""}

        ${showAll || reportFilter === "equity" ? `<section class="report-paper">
          ${reportHeading("LAPORAN PERUBAHAN MODAL", `Untuk bulan yang berakhir ${p.endLabel}`)}
          <table class="statement-table"><thead><tr><th>Uraian</th><th class="num">Jumlah</th><th class="num">Total</th></tr></thead><tbody>
            ${reportRow("Modal Awal Periode", fin.openingCapital, "report-detail", true)}
            ${fin.capitalAdditions ? reportRow("Tambahan Setoran Modal", fin.capitalAdditions, "report-detail") : ""}
            ${reportRow("Tambah: Laba Bersih", fin.netIncome, "report-detail")}
            ${reportRow("Kurang: Prive", fin.drawings, "report-detail")}
            ${reportRow("Modal Akhir", fin.endingCapital, "report-final", true)}
          </tbody></table>
        </section>` : ""}

        ${showAll || reportFilter === "balance" ? `<section class="report-paper">
          ${reportHeading("LAPORAN POSISI KEUANGAN", `Per ${p.endLabel}`)}
          <table class="statement-table"><thead><tr><th>Uraian</th><th class="num">Jumlah</th><th class="num">Total</th></tr></thead><tbody>
            ${reportRow("ASET", null, "report-section major")}
            ${reportRow("Aset Lancar", null, "report-section")}
            ${currAssets.filter((a) => Math.abs(fin.cumulativeBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, fin.cumulativeBalances[a.code] || 0, "report-detail")).join("")}
            ${reportRow("Total Aset Lancar", fin.currentAssets, "report-subtotal", true)}
            ${reportRow("Aset Tetap", null, "report-section")}
            ${fixedAssets.filter((a) => Math.abs(fin.cumulativeBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, fin.cumulativeBalances[a.code] || 0, "report-detail")).join("")}
            ${contraAssets.filter((a) => Math.abs(fin.cumulativeBalances[a.code] || 0) > 0).map((a) => reportRow(`Kurang: ${a.name}`, Math.abs(fin.cumulativeBalances[a.code] || 0), "report-detail")).join("")}
            ${reportRow("Total Aset Tetap", fin.fixedAssetsNet, "report-subtotal", true)}
            ${reportRow("TOTAL ASET", fin.totalAssets, "report-final", true)}
            ${reportRow("LIABILITAS", null, "report-section major")}
            ${liabAccounts.filter((a) => Math.abs(fin.cumulativeBalances[a.code] || 0) > 0).map((a) => reportRow(a.name, -(fin.cumulativeBalances[a.code] || 0), "report-detail")).join("")}
            ${reportRow("Total Liabilitas", fin.totalLiabilities, "report-subtotal", true)}
            ${reportRow("EKUITAS", null, "report-section major")}
            ${reportRow("Modal Akhir", fin.endingCapital, "report-detail")}
            ${reportRow("Total Ekuitas", fin.totalEquity, "report-subtotal", true)}
            ${reportRow("TOTAL LIABILITAS DAN EKUITAS", fin.totalLiabilities + fin.totalEquity, "report-final", true)}
          </tbody></table>
        </section>` : ""}

        ${showAll || reportFilter === "summary" ? `<section class="report-paper">
          ${reportHeading("IKHTISAR KAS, PERSEDIAAN, PIUTANG & UTANG", `Per ${p.endLabel}`)}
          <table class="statement-table"><thead><tr><th>Uraian</th><th class="num">Jumlah</th><th class="num">Total</th></tr></thead><tbody>
            ${reportRow("Saldo Kas Tunai (1101)", fin.cumulativeBalances["1101"] || 0, "report-detail")}
            ${reportRow("Saldo Bank / Rekening (1102)", fin.cumulativeBalances["1102"] || 0, "report-detail")}
            ${reportRow("Total Kas & Bank", (fin.cumulativeBalances["1101"] || 0) + (fin.cumulativeBalances["1102"] || 0), "report-subtotal", true)}
            ${reportRow("Persediaan Bahan Baku (1104)", fin.cumulativeBalances["1104"] || 0, "report-detail")}
            ${reportRow("Persediaan WIP (1106)", fin.cumulativeBalances["1106"] || 0, "report-detail")}
            ${reportRow("Persediaan Barang Jadi (1105)", fin.cumulativeBalances["1105"] || 0, "report-detail")}
            ${reportRow("Total Persediaan", (fin.cumulativeBalances["1104"] || 0) + (fin.cumulativeBalances["1105"] || 0) + (fin.cumulativeBalances["1106"] || 0), "report-subtotal", true)}
            ${reportRow(`Piutang Usaha Terbuka (${openInvoicesFor("receivable").length} faktur)`, openInvoicesFor("receivable").reduce((s, inv) => s + inv.remainingAmount, 0), "report-detail", true)}
            ${reportRow(`Utang Usaha Terbuka (${openInvoicesFor("payable").length} faktur)`, openInvoicesFor("payable").reduce((s, inv) => s + inv.remainingAmount, 0), "report-detail", true)}
          </tbody></table>
        </section>` : ""}
      </div>
    </div>`;
  }

  function renderSettings() {
    const isOwner = currentRole === "owner";
    const memberRows = businessMembers
      .map((m) => {
        const isSelf = currentUser && m.userId === currentUser.id;
        return `<tr>
          <td><strong>${escapeHtml(m.fullName)}</strong><br><small class="muted">${escapeHtml(m.email)}</small></td>
          <td><span class="type-pill ${m.role === "owner" ? "posted" : "adjustment"}">${m.role === "owner" ? "Owner" : "Staff"}</span></td>
          <td class="num">${isOwner && !isSelf ? `<button type="button" class="button danger small remove-member-btn" data-user-id="${escapeHtml(m.userId)}">Cabut Akses</button>` : `<span class="muted">${isSelf ? "Anda" : "—"}</span>`}</td>
        </tr>`;
      })
      .join("");

    return `<div class="page-stack">
      <section class="panel settings-panel"><div class="panel-head"><div><h3>Akun Aktif</h3><p>${escapeHtml(currentUser?.fullName || "—")} (${escapeHtml(currentUser?.email || "—")}) · Peran: <strong>${isOwner ? "Owner" : "Staff"}</strong></p></div></div></section>
      <section class="panel settings-panel"><div class="panel-head"><div><h3>Profil Usaha &amp; Periode</h3></div></div><div class="panel-body">
        <form id="settingsForm"><div class="form-grid">
          <div class="form-field"><label for="businessName">Nama Usaha</label><input id="businessName" name="businessName" value="${escapeHtml(workspace.profile.businessName)}" maxlength="80" required ${isOwner ? "" : "disabled"} /></div>
          <div class="form-field"><label for="businessSector">Sektor Usaha</label><select id="businessSector" name="businessSector" ${isOwner ? "" : "disabled"}><option value="general" ${(workspace.profile.businessSector || "general") === "general" ? "selected" : ""}>Semua Usaha / Campuran</option><option value="trading" ${workspace.profile.businessSector === "trading" ? "selected" : ""}>Usaha Dagang</option><option value="service" ${workspace.profile.businessSector === "service" ? "selected" : ""}>Usaha Jasa / Layanan</option><option value="manufacturing" ${workspace.profile.businessSector === "manufacturing" ? "selected" : ""}>Manufaktur / Produksi</option></select></div>
          <div class="form-field"><label for="businessCity">Lokasi</label><input id="businessCity" name="city" value="${escapeHtml(workspace.profile.city || "")}" maxlength="80" ${isOwner ? "" : "disabled"} /></div>
          <div class="form-field"><label for="accountingPeriod">Periode Aktif</label><input id="accountingPeriod" name="activePeriod" type="month" value="${workspace.profile.activePeriod}" required ${isOwner ? "" : "disabled"} /></div>
        </div><div class="form-actions"><button class="button primary" type="submit" ${isOwner ? "" : "disabled"}>Simpan Pengaturan</button></div></form>
      </div></section>
      <section class="panel settings-panel"><div class="panel-head"><h3>Buat Bisnis Baru</h3></div><div class="panel-body">
        <form id="createBusinessForm"><div class="form-grid">
          <div class="form-field"><label for="newBusinessName">Nama Bisnis Baru</label><input id="newBusinessName" name="businessName" required maxlength="80" /></div>
          <div class="form-field"><label for="newBusinessCity">Kota</label><input id="newBusinessCity" name="city" value="Indonesia" maxlength="80" /></div>
          <div class="form-field full"><label><input type="checkbox" name="seedDemo" /> Isi dengan contoh transaksi awal</label></div>
        </div><div class="form-actions"><button class="button secondary" type="submit">Buat &amp; Pindah Bisnis</button></div></form>
      </div></section>
      ${isOwner ? `<section class="panel settings-panel"><div class="panel-head"><h3>Anggota &amp; Hak Akses</h3></div><div class="panel-body">
        <form id="addMemberForm"><div class="form-grid">
          <div class="form-field"><label for="memberEmail">Email Pengguna Terdaftar</label><input id="memberEmail" name="email" type="email" required placeholder="staff@umkm.id" /></div>
          <div class="form-field"><label for="memberRole">Peran</label><select id="memberRole" name="role"><option value="staff">Staff (Operasional)</option><option value="owner">Owner (Kontrol Penuh)</option></select></div>
        </div><div class="form-actions"><button class="button primary" type="submit">Simpan Anggota</button></div></form>
        <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Pengguna</th><th>Peran</th><th class="num">Aksi</th></tr></thead><tbody>${memberRows || `<tr><td colspan="3">Memuat daftar anggota...</td></tr>`}</tbody></table></div>
      </div></section>` : ""}
    </div>`;
  }

  function exportPayload() {
    const p = activePeriodInfo();
    return {
      xlsx: { filename: `laporan-${p.value}.xlsx`, period: p.value },
      pdf: { filename: `laporan-${p.value}.pdf`, period: p.value }
    };
  }

  async function downloadExport(format, payload) {
    const button = document.getElementById(format === "xlsx" ? "exportXlsx" : "exportPdf");
    if (button) button.disabled = true;
    try {
      const response = await fetch(`/api/export/${format}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: payload.period })
      });
      if (!response.ok) throw new Error("export_failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payload.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`${format.toUpperCase()} berhasil dibuat.`);
    } catch {
      showToast(`Export ${format.toUpperCase()} gagal.`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindViewEvents() {
    document.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.go)));
    document.querySelectorAll(".view-journal").forEach((btn) => btn.addEventListener("click", () => openJournalDetail(btn.dataset.id)));
    document.querySelectorAll(".void-entry").forEach((btn) => btn.addEventListener("click", () => voidEntry(btn.dataset.id)));
    document.querySelectorAll(".quick-settle-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        pendingCashbankPrefill = {
          type: btn.dataset.kind === "receivable" ? "collect_receivable" : "pay_payable",
          partyId: btn.dataset.party || "",
          invoiceId: btn.dataset.invoice || "",
          amount: btn.dataset.amount || ""
        };
        formOpen.cashbank = true;
        navigate("cashbank");
      })
    );

    if (currentView === "overview") {
      document.getElementById("dashNewSaleBtn")?.addEventListener("click", () => { formOpen.sales = true; navigate("sales"); });
      document.getElementById("dashNewPurchaseBtn")?.addEventListener("click", () => { formOpen.purchases = true; navigate("purchases"); });
      document.getElementById("dashNewJournalBtn")?.addEventListener("click", () => { ledgerSection = "journal"; formOpen.journal = true; navigate("ledger"); });
    }
    if (currentView === "setup") bindSetupWizard();
    if (["sales", "purchases", "cashbank"].includes(currentView)) bindOperationalView(currentView);
    if (currentView === "inventory") bindInventoryEvents();
    if (currentView === "masterdata") bindMasterData();
    if (currentView === "ledger") bindLedgerEvents();
    if (currentView === "monthend") bindMonthEndEvents();
    if (currentView === "statements") {
      document.querySelectorAll("[data-report-tab]").forEach((btn) =>
        btn.addEventListener("click", () => {
          reportFilter = btn.dataset.reportTab;
          render();
        })
      );
      document.getElementById("exportXlsx")?.addEventListener("click", () => downloadExport("xlsx", exportPayload().xlsx));
      document.getElementById("exportPdf")?.addEventListener("click", () => downloadExport("pdf", exportPayload().pdf));
    }
    if (currentView === "settings") {
      document.getElementById("settingsForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await apiRequest("/api/accounting/master", {
            method: "POST",
            body: JSON.stringify({
              action: "update_profile",
              businessName: fd.get("businessName"),
              businessSector: fd.get("businessSector"),
              city: fd.get("city"),
              activePeriod: fd.get("activePeriod")
            })
          });
          showToast("Pengaturan usaha disimpan.");
          navigate("overview");
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      document.getElementById("createBusinessForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await authJsonRequest("/api/auth/businesses", {
            businessName: fd.get("businessName"),
            city: fd.get("city"),
            seedDemo: fd.get("seedDemo") === "on"
          });
          showToast("Bisnis baru dibuat dan diaktifkan.");
          currentView = "overview";
          await loadWorkspace();
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      document.getElementById("addMemberForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          const payload = await authJsonRequest("/api/auth/members", {
            email: fd.get("email"),
            role: fd.get("role")
          });
          businessMembers = Array.isArray(payload.members) ? payload.members : [];
          showToast("Anggota bisnis diperbarui.");
          render();
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      document.querySelectorAll(".remove-member-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!window.confirm("Cabut akses pengguna ini dari bisnis aktif?")) return;
          try {
            const payload = await authJsonRequest("/api/auth/members", {
              action: "remove",
              userId: btn.dataset.userId
            });
            businessMembers = Array.isArray(payload.members) ? payload.members : [];
            showToast("Akses anggota dicabut.");
            render();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    }
  }

  function bindSetupWizard() {
    document.querySelectorAll("[data-wiz-step]").forEach((btn) =>
      btn.addEventListener("click", () => {
        setupStep = Number(btn.dataset.wizStep) || 1;
        render();
      })
    );

    document.getElementById("wizardProfileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "update_profile",
            businessName: fd.get("businessName"),
            businessSector: fd.get("businessSector"),
            city: fd.get("city"),
            activePeriod: fd.get("activePeriod")
          })
        });
        setupStep = 2;
        showToast("Profil & sektor usaha disimpan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("wizardAccountForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_account",
            code: fd.get("code"),
            name: fd.get("name"),
            group: fd.get("group"),
            category: fd.get("category") || undefined
          })
        });
        showToast("Akun COA baru ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("wizardOpeningCashForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/transactions", {
          method: "POST",
          body: JSON.stringify({
            type: "capital",
            date: fd.get("date"),
            cashAccountCode: fd.get("cashAccountCode") || "1101",
            amount: Number(fd.get("amount")),
            description: fd.get("description")
          })
        });
        showToast("Saldo awal kas/bank berhasil diposting.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("wizardPartyForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_party",
            name: fd.get("name"),
            type: fd.get("type"),
            phone: fd.get("phone")
          })
        });
        showToast("Relasi ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("wizardItemForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_item",
            name: fd.get("name"),
            category: fd.get("category"),
            unit: fd.get("unit"),
            defaultSalePrice: Number(fd.get("defaultSalePrice") || 0),
            defaultPurchaseCost: Number(fd.get("defaultPurchaseCost") || 0),
            openingQuantity: Number(fd.get("openingQuantity") || 0),
            openingTotalCost: Number(fd.get("openingTotalCost") || 0)
          })
        });
        showToast("Item barang/jasa ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  function bindOperationalView(moduleKey) {
    document.getElementById("openOpFormBtn")?.addEventListener("click", () => {
      formOpen[moduleKey] = true;
      render();
    });
    document.getElementById("closeOpFormBtn")?.addEventListener("click", () => {
      formOpen[moduleKey] = false;
      render();
    });
    document.getElementById("cancelOpFormBtn")?.addEventListener("click", () => {
      formOpen[moduleKey] = false;
      render();
    });
    document.querySelectorAll("[data-op-tab]").forEach((btn) =>
      btn.addEventListener("click", () => {
        opSubTab[moduleKey] = btn.dataset.opTab;
        render();
      })
    );
    document.getElementById("opSearchInput")?.addEventListener("input", (e) => {
      opSearch[moduleKey] = e.target.value;
      const q = opSearch[moduleKey].trim().toLowerCase();
      document.querySelectorAll("#opTableBody tr[data-search]").forEach((row) => {
        row.style.display = !q || row.dataset.search.includes(q) ? "" : "none";
      });
    });

    if (formOpen[moduleKey]) bindTransactionForm();
  }

  function bindTransactionForm() {
    const form = document.getElementById("transactionForm");
    if (!form) return;
    const moduleKey = form.dataset.module || "";
    const typeSelect = document.getElementById("transactionType");
    const partySelect = document.getElementById("transactionParty");
    const itemSelect = document.getElementById("transactionItem");
    const qtyInput = document.getElementById("transactionQty");
    const amountInput = document.getElementById("transactionAmount");
    const cashAccountSelect = document.getElementById("cashAccount");
    const invoiceWrap = document.getElementById("invoiceWrap");
    const invoiceSelect = document.getElementById("transactionInvoice");
    const expenseWrap = document.getElementById("expenseAccountWrap");
    const assetWrap = document.getElementById("assetAccountWrap");
    const assetSelect = document.getElementById("assetAccount");
    const revSelect = document.getElementById("revenueAccount");
    const descInput = document.getElementById("transactionDescription");
    let autoDesc = true;
    let autoAmount = true;

    function maybeAutoFillAmount(forceItemDefault = false) {
      if (!itemSelect || !amountInput) return;
      const item = workspace.items.find((i) => i.id === itemSelect.value);
      if (!item) return;
      if (forceItemDefault) autoAmount = true;
      if (!autoAmount) return;
      const unitPrice = moduleKey === "sales"
        ? (item.defaultSalePrice || 0)
        : (item.defaultPurchaseCost || item.movingAverageCost || 0);
      if (unitPrice <= 0) return;
      if (item.trackInventory) {
        if (forceItemDefault && (!qtyInput.value || Number(qtyInput.value) <= 0)) {
          qtyInput.value = "1";
        }
        const qty = Number(qtyInput?.value) || 0;
        if (qty > 0) amountInput.value = String(Math.round(qty * unitPrice));
      } else {
        amountInput.value = String(Math.round(unitPrice));
      }
    }

    function refreshInvoices() {
      if (!invoiceWrap || !invoiceSelect) return;
      const t = typeSelect.value;
      const isPayment = t === "collect_receivable" || t === "pay_payable";
      invoiceWrap.style.display = isPayment ? "" : "none";
      if (!isPayment) return;
      const kind = t === "collect_receivable" ? "receivable" : "payable";
      const partyId = partySelect.value;
      const openInvoices = workspace.invoices.filter(
        (inv) => inv.kind === kind && (inv.status === "open" || inv.status === "partial") && (!partyId || inv.partyId === partyId)
      );
      invoiceSelect.innerHTML = openInvoices.length
        ? openInvoices.map((inv) => `<option value="${inv.id}" data-party="${inv.partyId}" data-rem="${inv.remainingAmount}">${escapeHtml(inv.invoiceNumber)} · ${escapeHtml(inv.partyName)} · Sisa ${money(inv.remainingAmount)}</option>`).join("")
        : `<option value="">-- Tidak ada faktur terbuka --</option>`;
      const selected = invoiceSelect.selectedOptions[0];
      if (selected?.dataset?.party && !partySelect.value) partySelect.value = selected.dataset.party;
      if (selected?.dataset?.rem) amountInput.max = selected.dataset.rem;
      else amountInput.removeAttribute("max");
    }

    function refreshDynamicFields() {
      const t = typeSelect.value;
      if (expenseWrap) expenseWrap.style.display = t === "cash_expense" ? "" : "none";
      if (assetWrap) assetWrap.style.display = t.startsWith("equipment_") ? "" : "none";
      const cashWrap = document.getElementById("cashAccountWrap");
      if (cashWrap && moduleKey === "purchases") {
        cashWrap.style.display = t.endsWith("_cash") ? "" : "none";
      }
      const isEquip = t.startsWith("equipment_");
      const item = itemSelect ? workspace.items.find((i) => i.id === itemSelect.value) : null;
      const isNonStockItem = Boolean(item && !item.trackInventory);
      const itemWrap = document.getElementById("itemSelectWrap");
      const qtyWrap = document.getElementById("qtyWrap");
      if (itemWrap) itemWrap.style.display = isEquip ? "none" : "";
      if (qtyWrap) qtyWrap.style.display = isEquip || isNonStockItem ? "none" : "";
      refreshInvoices();
      refreshPreview();
    }

    function refreshPreview() {
      const t = typeSelect.value;
      const amount = Math.round(Number(amountInput.value) || 0);
      const cashCode = cashAccountSelect?.value === "1102" ? "1102" : "1101";
      const item = itemSelect ? workspace.items.find((i) => i.id === itemSelect.value) : null;
      const qty = Number(qtyInput?.value) || 0;
      const hint = document.getElementById("itemStockHint");
      if (hint && item) {
        const refPrice = moduleKey === "sales" ? (item.defaultSalePrice || 0) : (item.defaultPurchaseCost || 0);
        const priceNote = refPrice > 0 ? ` · Harga default: ${money(refPrice)}` : "";
        hint.textContent = item.trackInventory
          ? `Stok: ${qtyFmt(item.quantityOnHand)} ${item.unit} · Moving Avg: ${money(item.movingAverageCost)}${priceNote}`
          : `Item ${CATEGORY_LABELS[item.category]} (non-stok)${priceNote}`;
      }
      const accs = accountMap();
      const previewLines = [];
      if (t === "cash_sale" || t === "bank_sale" || t === "credit_sale") {
        const dr = t === "credit_sale" ? "1103" : t === "bank_sale" ? "1102" : "1101";
        const revCode = revSelect?.value || item?.revenueAccountCode || (item?.category === "service" ? "4102" : "4101");
        previewLines.push({ side: "Dr", code: dr, amount });
        previewLines.push({ side: "Cr", code: revCode, amount });
        if (item?.trackInventory && qty > 0) {
          const estCogs = Math.round(qty * item.movingAverageCost);
          previewLines.push({ side: "Dr", code: item.cogsAccountCode || "5101", amount: estCogs });
          previewLines.push({ side: "Cr", code: item.inventoryAccountCode, amount: estCogs });
        }
      } else if (t === "inventory_cash" || t === "inventory_credit") {
        const dr = item?.category === "service"
          ? (item.cogsAccountCode || "5108")
          : (item?.inventoryAccountCode || "1104");
        previewLines.push({ side: "Dr", code: dr, amount });
        previewLines.push({ side: "Cr", code: t === "inventory_credit" ? "2101" : cashCode, amount });
      } else if (t === "equipment_cash" || t === "equipment_credit") {
        previewLines.push({ side: "Dr", code: assetSelect?.value || "1201", amount });
        previewLines.push({ side: "Cr", code: t === "equipment_credit" ? "2101" : cashCode, amount });
      } else if (t === "collect_receivable") {
        previewLines.push({ side: "Dr", code: cashCode, amount }, { side: "Cr", code: "1103", amount });
      } else if (t === "pay_payable") {
        previewLines.push({ side: "Dr", code: "2101", amount }, { side: "Cr", code: cashCode, amount });
      } else if (t === "cash_expense") {
        const expCode = document.getElementById("expenseAccount")?.value || "5199";
        previewLines.push({ side: "Dr", code: expCode, amount }, { side: "Cr", code: cashCode, amount });
      } else if (t === "capital") {
        previewLines.push({ side: "Dr", code: cashCode, amount }, { side: "Cr", code: "3101", amount });
      } else if (t === "drawing") {
        previewLines.push({ side: "Dr", code: "3102", amount }, { side: "Cr", code: cashCode, amount });
      }
      document.getElementById("transactionPreview").innerHTML = `<div class="entry-preview-head"><strong>Pratinjau Jurnal Double-Entry</strong><span class="status-pill info">Tervalidasi di backend</span></div>
        ${previewLines.map((l) => `<div class="entry-line ${l.side === "Cr" ? "credit" : ""}"><span>${l.side} · ${l.code} ${escapeHtml(accs[l.code]?.name || "")}</span><b>${money(l.amount)}</b></div>`).join("")}`;
    }

    typeSelect.addEventListener("change", () => {
      if (autoDesc) descInput.value = TRANSACTION_LABELS[typeSelect.value].defaultDescription;
      refreshDynamicFields();
    });
    itemSelect?.addEventListener("change", () => {
      maybeAutoFillAmount(true);
      refreshDynamicFields();
    });
    qtyInput?.addEventListener("input", () => {
      maybeAutoFillAmount(false);
      refreshPreview();
    });
    amountInput?.addEventListener("input", () => {
      autoAmount = false;
    });
    partySelect?.addEventListener("change", refreshInvoices);
    invoiceSelect?.addEventListener("change", () => {
      const opt = invoiceSelect.selectedOptions[0];
      if (opt?.dataset?.party) partySelect.value = opt.dataset.party;
      if (opt?.dataset?.rem) amountInput.max = opt.dataset.rem;
    });
    descInput.addEventListener("input", () => { autoDesc = false; });
    form.addEventListener("input", refreshPreview);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiRequest("/api/accounting/transactions", {
          method: "POST",
          body: JSON.stringify({
            type: fd.get("type"),
            date: fd.get("date"),
            partyId: fd.get("partyId") || null,
            itemId: fd.get("itemId") || null,
            quantity: fd.get("quantity") ? Number(fd.get("quantity")) : undefined,
            amount: Number(fd.get("amount")),
            cashAccountCode: fd.get("cashAccountCode") || undefined,
            invoiceId: fd.get("invoiceId") || null,
            expenseAccountCode: fd.get("expenseAccountCode") || null,
            revenueAccountCode: fd.get("revenueAccountCode") || null,
            assetAccountCode: fd.get("assetAccountCode") || null,
            description: fd.get("description")
          })
        });
        formOpen[moduleKey] = false;
        showToast("Transaksi berhasil diposting ke buku besar.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    if (moduleKey === "cashbank" && pendingCashbankPrefill) {
      const prefill = pendingCashbankPrefill;
      pendingCashbankPrefill = null;
      if (prefill.type) {
        typeSelect.value = prefill.type;
        descInput.value = TRANSACTION_LABELS[prefill.type].defaultDescription;
      }
      if (prefill.partyId) partySelect.value = prefill.partyId;
      refreshDynamicFields();
      if (prefill.invoiceId && invoiceSelect) invoiceSelect.value = prefill.invoiceId;
      if (prefill.amount) {
        amountInput.value = prefill.amount;
        autoAmount = false;
      }
      refreshPreview();
    } else {
      refreshDynamicFields();
    }
  }

  function bindInventoryEvents() {
    document.getElementById("openInvFormBtn")?.addEventListener("click", () => {
      formOpen.inventory = true;
      render();
    });
    document.getElementById("closeInvFormBtn")?.addEventListener("click", () => {
      formOpen.inventory = false;
      render();
    });
    document.getElementById("cancelInvFormBtn")?.addEventListener("click", () => {
      formOpen.inventory = false;
      render();
    });
    document.getElementById("inventoryFilter")?.addEventListener("change", (e) => {
      selectedInventoryItemId = e.target.value;
      render();
    });
    const modeSelect = document.getElementById("prodMode");
    const toggleTarget = () => {
      const show = modeSelect?.value === "production_run";
      document.querySelectorAll(".prod-mfg-only").forEach((el) => {
        el.style.display = show ? "" : "none";
      });
    };
    modeSelect?.addEventListener("change", toggleTarget);
    toggleTarget();

    document.getElementById("productionForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const mode = fd.get("type");
      try {
        if (mode === "production_run") {
          const materials = [{ itemId: fd.get("sourceItemId"), quantity: Number(fd.get("sourceQuantity")) }];
          const mat2Id = fd.get("sourceItem2Id");
          const mat2Qty = Number(fd.get("sourceQuantity2") || 0);
          if (mat2Id && mat2Qty > 0) materials.push({ itemId: mat2Id, quantity: mat2Qty });
          await apiRequest("/api/accounting/transactions", {
            method: "POST",
            body: JSON.stringify({
              type: "production_run",
              date: fd.get("date"),
              materials,
              targetItemId: fd.get("targetItemId"),
              targetQuantity: Number(fd.get("targetQuantity")),
              directLaborCost: Number(fd.get("directLaborCost") || 0),
              overheadCost: Number(fd.get("overheadCost") || 0),
              costCreditAccountCode: fd.get("costCreditAccountCode") || "2102",
              description: fd.get("description")
            })
          });
        } else {
          await apiRequest("/api/accounting/transactions", {
            method: "POST",
            body: JSON.stringify({
              type: "material_usage",
              date: fd.get("date"),
              sourceItemId: fd.get("sourceItemId"),
              sourceQuantity: Number(fd.get("sourceQuantity")),
              description: fd.get("description")
            })
          });
        }
        formOpen.inventory = false;
        showToast("Mutasi produksi / bahan berhasil diposting.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  function bindMasterData() {
    document.querySelectorAll("[data-master-section]").forEach((btn) =>
      btn.addEventListener("click", () => {
        masterSection = btn.dataset.masterSection;
        render();
      })
    );
    document.getElementById("openItemFormBtn")?.addEventListener("click", () => { formOpen.item = true; render(); });
    document.getElementById("openPartyFormBtn")?.addEventListener("click", () => { formOpen.party = true; render(); });
    document.getElementById("closeMasterFormBtn")?.addEventListener("click", () => { formOpen.item = false; formOpen.party = false; render(); });
    document.getElementById("cancelMasterFormBtn")?.addEventListener("click", () => { formOpen.item = false; formOpen.party = false; render(); });

    const applyMasterFilter = () => {
      const q = masterSearch.trim().toLowerCase();
      document.querySelectorAll("#masterItemsBody tr[data-search]").forEach((row) => {
        const matchText = !q || row.dataset.search.includes(q);
        const matchCat = masterCategoryFilter === "all" || row.dataset.category === masterCategoryFilter;
        row.style.display = matchText && matchCat ? "" : "none";
      });
    };
    document.getElementById("masterSearchInput")?.addEventListener("input", (e) => {
      masterSearch = e.target.value;
      applyMasterFilter();
    });
    document.getElementById("masterCategoryFilter")?.addEventListener("change", (e) => {
      masterCategoryFilter = e.target.value;
      applyMasterFilter();
    });
    document.getElementById("itemForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_item",
            name: fd.get("name"),
            category: fd.get("category"),
            unit: fd.get("unit"),
            defaultSalePrice: Number(fd.get("defaultSalePrice") || 0),
            defaultPurchaseCost: Number(fd.get("defaultPurchaseCost") || 0),
            revenueAccountCode: fd.get("revenueAccountCode") || null,
            cogsAccountCode: fd.get("cogsAccountCode") || null,
            openingQuantity: Number(fd.get("openingQuantity") || 0),
            openingTotalCost: Number(fd.get("openingTotalCost") || 0)
          })
        });
        formOpen.item = false;
        showToast("Item ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
    document.getElementById("partyForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_party",
            name: fd.get("name"),
            type: fd.get("type"),
            phone: fd.get("phone")
          })
        });
        formOpen.party = false;
        showToast("Pelanggan / Pemasok ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
    document.querySelectorAll(".toggle-item").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await apiRequest("/api/accounting/master", {
            method: "POST",
            body: JSON.stringify({ action: "toggle_item", itemId: btn.dataset.id })
          });
          render();
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
  }

  function bindLedgerEvents() {
    document.querySelectorAll("[data-ledger-section]").forEach((btn) =>
      btn.addEventListener("click", () => {
        ledgerSection = btn.dataset.ledgerSection;
        render();
      })
    );
    document.getElementById("openJournalFormBtn")?.addEventListener("click", () => { formOpen.journal = true; render(); });
    document.getElementById("closeJournalFormBtn")?.addEventListener("click", () => { formOpen.journal = false; render(); });
    document.getElementById("cancelJournalFormBtn")?.addEventListener("click", () => { formOpen.journal = false; render(); });
    document.getElementById("openCoaFormBtn")?.addEventListener("click", () => { formOpen.coa = true; render(); });
    document.getElementById("closeCoaFormBtn")?.addEventListener("click", () => { formOpen.coa = false; render(); });
    document.getElementById("cancelCoaFormBtn")?.addEventListener("click", () => { formOpen.coa = false; render(); });

    document.getElementById("journalSearchInput")?.addEventListener("input", (e) => {
      journalSearch = e.target.value;
      const q = journalSearch.trim().toLowerCase();
      document.querySelectorAll("#journalEntriesBody tr[data-search]").forEach((row) => {
        row.style.display = !q || row.dataset.search.includes(q) ? "" : "none";
      });
    });
    const applyCoaFilter = () => {
      const q = coaSearch.trim().toLowerCase();
      document.querySelectorAll("#coaTableBody tr[data-search]").forEach((row) => {
        const matchText = !q || row.dataset.search.includes(q);
        const matchGrp = coaGroupFilter === "all" || row.dataset.group === coaGroupFilter;
        row.style.display = matchText && matchGrp ? "" : "none";
      });
    };
    document.getElementById("coaSearchInput")?.addEventListener("input", (e) => {
      coaSearch = e.target.value;
      applyCoaFilter();
    });
    document.getElementById("coaGroupFilter")?.addEventListener("change", (e) => {
      coaGroupFilter = e.target.value;
      applyCoaFilter();
    });
    document.getElementById("ledgerAccount")?.addEventListener("change", (e) => {
      selectedLedgerAccount = e.target.value;
      render();
    });
    document.querySelectorAll("[data-trial]").forEach((btn) =>
      btn.addEventListener("click", () => {
        trialMode = btn.dataset.trial;
        render();
      })
    );

    const gjForm = document.getElementById("generalJournalForm");
    const gjBody = document.getElementById("gjLinesBody");
    const gjHint = document.getElementById("gjBalanceHint");
    const updateGjBalance = () => {
      if (!gjBody || !gjHint) return;
      let d = 0;
      let c = 0;
      gjBody.querySelectorAll(".gj-row").forEach((row) => {
        d += Math.round(Number(row.querySelector(".gj-debit")?.value) || 0);
        c += Math.round(Number(row.querySelector(".gj-credit")?.value) || 0);
      });
      const ok = d > 0 && d === c;
      gjHint.className = `status-pill ${ok ? "good" : "bad"}`;
      gjHint.textContent = ok
        ? `Seimbang: ${money(d)}`
        : `Debit ${money(d)} ≠ Kredit ${money(c)}`;
    };
    gjBody?.addEventListener("input", updateGjBalance);
    document.getElementById("gjAddRowBtn")?.addEventListener("click", () => {
      if (!gjBody) return;
      const firstSelect = gjBody.querySelector(".gj-acc");
      if (!firstSelect) return;
      const tr = document.createElement("tr");
      tr.className = "gj-row";
      tr.innerHTML = `<td><select class="gj-acc" required>${firstSelect.innerHTML}</select></td><td class="num"><input class="gj-debit" type="number" min="0" step="1" value="0" /></td><td class="num"><input class="gj-credit" type="number" min="0" step="1" value="0" /></td><td><input class="gj-memo" maxlength="80" placeholder="Opsional" /></td>`;
      gjBody.appendChild(tr);
      updateGjBalance();
    });
    gjForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(gjForm);
      const lines = [];
      gjBody?.querySelectorAll(".gj-row").forEach((row) => {
        const accountCode = row.querySelector(".gj-acc")?.value;
        const debit = Math.round(Number(row.querySelector(".gj-debit")?.value) || 0);
        const credit = Math.round(Number(row.querySelector(".gj-credit")?.value) || 0);
        const memo = row.querySelector(".gj-memo")?.value || "";
        if (accountCode && (debit > 0 || credit > 0)) {
          lines.push({ accountCode, debit, credit, memo });
        }
      });
      try {
        await apiRequest("/api/accounting/transactions", {
          method: "POST",
          body: JSON.stringify({
            type: "general_journal",
            date: fd.get("date"),
            description: fd.get("description"),
            lines
          })
        });
        formOpen.journal = false;
        showToast("Jurnal umum berhasil diposting.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("createAccountForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/master", {
          method: "POST",
          body: JSON.stringify({
            action: "create_account",
            code: fd.get("code"),
            name: fd.get("name"),
            group: fd.get("group"),
            category: fd.get("category") || undefined
          })
        });
        formOpen.coa = false;
        showToast("Akun COA baru berhasil ditambahkan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.querySelectorAll(".toggle-account-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await apiRequest("/api/accounting/master", {
            method: "POST",
            body: JSON.stringify({ action: "toggle_account", code: btn.dataset.code })
          });
          showToast("Status akun COA diperbarui.");
          render();
        } catch (err) {
          showToast(err.message, "error");
        }
      })
    );
  }

  function bindMonthEndEvents() {
    const adjType = document.getElementById("adjType");
    const adjDynamic = document.getElementById("adjDynamic");
    const renderAdjFields = () => {
      if (!adjDynamic || !adjType) return;
      if (adjType.value === "depreciation") {
        adjDynamic.innerHTML = `<div class="form-field"><label>Nilai Peralatan (Rp)</label><input name="assetCost" type="number" min="1" value="3000000" required /></div><div class="form-field"><label>Umur Manfaat (Bulan)</label><input name="lifeMonths" type="number" min="1" value="60" required /></div>`;
      } else {
        adjDynamic.innerHTML = `<div class="form-field"><label>Akun Beban</label><select name="expenseAccountCode">${workspace.accounts.filter((a) => a.group === "expense" && !["5101", "5106", "5107"].includes(a.code)).map((a) => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join("")}</select></div><div class="form-field"><label>Nilai Akrual (Rp)</label><input name="amount" type="number" min="1" value="220000" required /></div>`;
      }
    };
    adjType?.addEventListener("change", renderAdjFields);
    renderAdjFields();

    document.getElementById("opnameForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/opname", {
          method: "POST",
          body: JSON.stringify({
            date: fd.get("date"),
            itemId: fd.get("itemId"),
            physicalQuantity: Number(fd.get("physicalQuantity")),
            unitCostIfZero: fd.get("unitCostIfZero") ? Number(fd.get("unitCostIfZero")) : undefined,
            notes: fd.get("notes")
          })
        });
        showToast("Stock opname berhasil dicatat.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("adjustmentForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await apiRequest("/api/accounting/adjustments", {
          method: "POST",
          body: JSON.stringify({
            type: fd.get("type"),
            date: fd.get("date"),
            assetCost: fd.get("assetCost") ? Number(fd.get("assetCost")) : undefined,
            lifeMonths: fd.get("lifeMonths") ? Number(fd.get("lifeMonths")) : undefined,
            expenseAccountCode: fd.get("expenseAccountCode") || undefined,
            amount: fd.get("amount") ? Number(fd.get("amount")) : undefined
          })
        });
        showToast("Jurnal penyesuaian tersimpan.");
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("closePeriodBtn")?.addEventListener("click", async () => {
      const p = activePeriodInfo();
      if (!window.confirm(`Tutup periode ${p.label}? Akun pendapatan/beban/prive akan ditutup ke Laba Ditahan dan periode dikunci.`)) return;
      try {
        await apiRequest("/api/accounting/periods/close", {
          method: "POST",
          body: JSON.stringify({ period: p.value })
        });
        showToast(`Periode ${p.label} berhasil ditutup.`);
        render();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  async function voidEntry(entryId) {
    const entry = workspace?.journalEntries?.find((item) => item.id === entryId);
    if (!entry) return;
    const reason = window.prompt(`Alasan pembatalan (Void / Reversal) untuk ${entry.documentNumber} — "${entry.description}":`);
    if (!reason || !reason.trim()) return;
    try {
      await apiRequest(`/api/accounting/entries/${encodeURIComponent(entryId)}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() })
      });
      showToast(`Dokumen ${entry.documentNumber} dibatalkan melalui jurnal pembalik.`);
      render();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function openJournalDetail(id) {
    const entry = workspace?.journalEntries?.find((item) => item.id === id);
    if (!entry) return;
    const accMap = accountMap();
    const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);
    const dialog = document.getElementById("journalDialog");
    dialog.innerHTML = `<div class="dialog-head"><div><h3 id="journalDialogTitle">Rincian Jurnal</h3><p>${escapeHtml(entry.description)}</p></div><button class="dialog-close" type="button" aria-label="Tutup">×</button></div>
      <div class="dialog-body">
        <div class="dialog-meta"><div><span>No. Dokumen</span><strong>${escapeHtml(entry.documentNumber)}</strong></div><div><span>Tanggal Posting</span><strong>${shortDate(entry.date)}</strong></div><div><span>Status</span><strong>${escapeHtml(entry.status.toUpperCase())}</strong></div></div>
        ${entry.voidReason ? `<p style="color:#b91c1c"><strong>Alasan Void:</strong> ${escapeHtml(entry.voidReason)}</p>` : ""}
        <div class="table-wrap"><table><thead><tr><th>Akun</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead><tbody>
          ${entry.lines.map((line) => `<tr><td class="${line.credit ? "journal-credit" : ""}"><span class="account-code">${line.accountCode}</span><span class="account-name">${escapeHtml(accMap[line.accountCode]?.name || line.accountCode)}</span></td><td class="num">${money(line.debit, true)}</td><td class="num">${money(line.credit, true)}</td></tr>`).join("")}
          <tr class="total-row"><td>Total</td><td class="num">${money(totalDebit)}</td><td class="num">${money(totalCredit)}</td></tr>
        </tbody></table></div>
      </div>`;
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  document.getElementById("sideNav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    const flyoutKey = button.dataset.flyout;
    if (flyoutKey && window.innerWidth > 860 && authSessionState.authenticated && workspace) {
      openFlyout(flyoutKey);
      return;
    }
    navigate(button.dataset.view);
  });

  openTabsBar?.addEventListener("click", (event) => {
    const closeBtn = event.target.closest("[data-close-tab]");
    if (closeBtn) {
      closeOpenTab(closeBtn.dataset.closeTab);
      return;
    }
    const tab = event.target.closest("[data-tab-view]");
    if (tab) navigate(tab.dataset.tabView);
  });

  document.addEventListener("click", (event) => {
    if (!activeFlyout) return;
    if (event.target.closest("#railFlyout") || event.target.closest("#sideNav")) return;
    closeFlyout();
  });

  menuButton.addEventListener("click", () => (sidebar.classList.contains("open") ? closeMenu() : openMenu()));
  backdrop.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFlyout();
      closeMenu();
    }
  });
  document.getElementById("resetButton").addEventListener("click", async () => {
    if (currentRole !== "owner") {
      showToast("Hanya Owner yang dapat mereset data contoh.", "error");
      return;
    }
    if (!window.confirm("Muat ulang data contoh? Seluruh data pada bisnis aktif ini akan direset ke contoh awal.")) return;
    try {
      await apiRequest("/api/accounting/reset", { method: "POST", body: JSON.stringify({}) });
      showToast("Data contoh berhasil dimuat ulang.");
      navigate("overview");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    try {
      await authJsonRequest("/api/auth/logout", {});
      openTabs = [{ view: "overview", title: "Dashboard", closable: false }];
      showToast("Berhasil keluar.");
      await loadWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("demoRoleBtn")?.addEventListener("click", async () => {
    const nextRole = currentRole === "owner" ? "staff" : "owner";
    try {
      await authJsonRequest("/api/auth/demo-switch-role", { role: nextRole });
      showToast(`Beralih ke akun demo ${nextRole === "owner" ? "Owner" : "Staff"}.`);
      await loadWorkspace();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("businessSwitcher")?.addEventListener("change", async (e) => {
    const tenantId = e.currentTarget.value;
    if (!tenantId || tenantId === activeTenantId) return;
    try {
      await authJsonRequest("/api/auth/switch-business", { tenantId });
      currentView = "overview";
      openTabs = [{ view: "overview", title: "Dashboard", closable: false }];
      showToast("Bisnis aktif berhasil diganti.");
      await loadWorkspace();
    } catch (err) {
      showToast(err.message, "error");
      syncShell();
    }
  });

  loadWorkspace();
})();
