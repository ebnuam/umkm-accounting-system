import Script from "next/script";

export default function Home() {
  return (
    <>
      <div className="app-shell is-unauth" id="appShell">
        <aside className="sidebar" id="sidebar" aria-label="Navigasi utama">
          <div className="brand" title="NeracaKita">
            <div className="brand-mark" aria-hidden="true">NK</div>
            <span className="brand-mobile-name" id="brandNameMobile">NeracaKita</span>
          </div>

          <nav className="side-nav" id="sideNav">
            <button className="nav-item active" data-view="overview" title="Dashboard">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
              <span>Dashboard</span>
            </button>

            <button className="nav-item" data-view="setup" title="Persiapan Usaha">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              <span>Persiapan Usaha</span>
            </button>

            <button className="nav-item" data-flyout="ledger" data-view="ledger" title="Buku Besar">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
              <span>Buku Besar</span>
            </button>

            <button className="nav-item" data-flyout="cashbank" data-view="cashbank" title="Kas & Bank">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              <span>Kas &amp; Bank</span>
            </button>

            <button className="nav-item" data-flyout="sales" data-view="sales" title="Penjualan">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
              <span>Penjualan</span>
            </button>

            <button className="nav-item" data-flyout="purchases" data-view="purchases" title="Pembelian">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
              <span>Pembelian</span>
            </button>

            <button className="nav-item" data-flyout="inventory" data-view="inventory" title="Persediaan">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              <span>Persediaan</span>
            </button>

            <button className="nav-item" data-view="masterdata" title="Master Barang & Relasi">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
              <span>Master Barang</span>
            </button>

            <button className="nav-item" data-view="monthend" title="Akhir Bulan">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>Akhir Bulan</span>
            </button>

            <button className="nav-item" data-view="statements" title="Laporan">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              <span>Laporan</span>
            </button>

            <button className="nav-item" data-view="settings" title="Pengaturan">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              <span>Pengaturan</span>
            </button>
          </nav>

          <div className="sidebar-foot">
            <div className="sync-mini" title="Status Sinkronisasi">
              <span className="local-dot" id="syncDot"></span>
              <span className="sync-mini-text"><strong id="syncTitle">Siap</strong><small id="syncDetail">—</small></span>
            </div>
          </div>
        </aside>

        <div className="rail-flyout" id="railFlyout" aria-hidden="true"></div>
        <div className="mobile-backdrop" id="mobileBackdrop"></div>

        <main className="main-area">
          <header className="topbar">
            <div className="topbar-left">
              <button className="menu-button" id="menuButton" aria-label="Buka menu" aria-expanded="false"><span></span><span></span><span></span></button>
              <div className="company-title-group">
                <strong id="brandName">NeracaKita</strong>
                <span className="topbar-sep">/</span>
                <span className="eyebrow" id="businessEyebrow">Pembukuan</span>
                <span className="topbar-sep">/</span>
                <h1 id="pageTitle">Dashboard</h1>
              </div>
            </div>
            <div className="topbar-right">
              <div className="business-switch-wrap" id="businessSwitchWrap" style={{ display: "none" }}>
                <select id="businessSwitcher" className="business-switcher" aria-label="Pilih bisnis"></select>
                <span id="roleBadge" className="dot-badge good">Owner</span>
                <button type="button" className="button small ghost" id="demoRoleBtn" style={{ display: "none" }}>Uji Staff</button>
              </div>
              <div className="period-chip"><span className="period-dot"></span><strong id="periodLabel">September 2026</strong></div>
              <button className="button small ghost" id="resetButton" style={{ display: "none" }}>Reset</button>
              <button className="button small secondary" id="logoutButton" style={{ display: "none" }}>Keluar</button>
            </div>
          </header>

          <div className="mdi-bar" id="openTabsBar" aria-label="Tab modul terbuka"></div>
          <div id="demoNoticeBanner" className="demo-banner" style={{ display: "none" }}></div>
          <div id="app" className="content" tabIndex={-1}></div>
        </main>
      </div>
      <dialog className="journal-dialog" id="journalDialog" aria-labelledby="journalDialogTitle"></dialog>
      <div className="toast-region" id="toastRegion" aria-live="polite"></div>
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
