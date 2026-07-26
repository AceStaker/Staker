(function () {
  'use strict';

  const config = window.ACE_SUPABASE_CONFIG;
  const sdk = window.supabase;
  if (!config || !sdk) {
    console.error('Ace Staker backend configuration could not be loaded.');
    return;
  }

  const client = sdk.createClient(config.url, config.publishableKey);
  let currentUser = null;
  let currentProfile = null;
  let currentUserIsAdmin = false;
  let adminBetRows = [];
  let adminTransactionRows = [];
  let adminAuditRows = [];
  let operationsRefreshTimer = null;
  let publicMarketsRefreshTimer = null;
  const marketUiIds = new Map();
  let nextMarketUiId = 1000;
  const operationsPage = document.body.classList.contains('operations-page');

  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  function notify(message, error = false) {
    if (typeof window.showToast === 'function') window.showToast(message, error);
    else window.alert(message);
  }

  function createAccountUi() {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay account-modal" id="accountModal" aria-hidden="true">
        <div class="modal glass auth-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">
          <button class="modal-close" id="closeAccountModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <div class="auth-brand"><i class="fa-solid fa-spade"></i><span>Ace Staker</span></div>
          <h2 id="authTitle">Sign in</h2>
          <p class="auth-subtitle">Use your account to access demo credits and place test bets.</p>
          <form id="authForm">
            <label class="auth-field register-only" hidden>
              <span>Display name</span>
              <input id="authName" type="text" minlength="2" maxlength="40" autocomplete="nickname">
            </label>
            <label class="auth-field">
              <span>Email</span>
              <input id="authEmail" type="email" required autocomplete="email">
            </label>
            <label class="auth-field">
              <span>Password</span>
              <input id="authPassword" type="password" required minlength="8" autocomplete="current-password">
            </label>
            <label class="auth-check register-only" hidden>
              <input id="authAge" type="checkbox">
              <span>I confirm that I am 18 or older.</span>
            </label>
            <button class="btn-primary auth-submit" type="submit" id="authSubmit">Sign in</button>
          </form>
          <button class="auth-switch" type="button" id="authSwitch">New here? Create an account</button>
          <p class="demo-notice"><i class="fa-solid fa-flask"></i> Demo only — no real deposits, withdrawals, or cash prizes.</p>
        </div>
      </div>

      <div class="modal-overlay account-modal" id="walletModal" aria-hidden="true">
        <div class="modal glass account-panel" role="dialog" aria-modal="true" aria-labelledby="walletTitle">
          <button class="modal-close" data-close-panel="walletModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <h2 id="walletTitle"><i class="fa-solid fa-wallet"></i> Demo wallet</h2>
          <div class="wallet-hero">
            <span>Available demo credits</span>
            <strong id="walletPanelBalance">₹0.00</strong>
          </div>
          <p class="panel-note">Payments are not connected. This wallet cannot receive deposits or make withdrawals.</p>
          <h3>Recent activity</h3>
          <div id="walletActivity" class="activity-list"><div class="panel-empty">Sign in to view activity.</div></div>
        </div>
      </div>

      <div class="modal-overlay account-modal" id="responsibleModal" aria-hidden="true">
        <div class="modal glass account-panel" role="dialog" aria-modal="true" aria-labelledby="responsibleTitle">
          <button class="modal-close" data-close-panel="responsibleModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <h2 id="responsibleTitle"><i class="fa-solid fa-shield-heart"></i> Responsible play</h2>
          <form id="responsibleForm">
            <label class="auth-field">
              <span>Daily stake limit (₹)</span>
              <input id="dailyLimit" type="number" min="100" max="1000000" step="100" required>
            </label>
            <label class="auth-field">
              <span>Session reminder</span>
              <select id="sessionReminder">
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every 60 minutes</option>
                <option value="120">Every 2 hours</option>
              </select>
            </label>
            <label class="auth-field">
              <span>Start self-exclusion</span>
              <select id="selfExclusion">
                <option value="">No new exclusion</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
            <p class="panel-note">An active self-exclusion cannot be shortened from this site.</p>
            <button class="btn-primary auth-submit" type="submit">Save controls</button>
          </form>
        </div>
      </div>

      <div class="modal-overlay account-modal" id="notificationsModal" aria-hidden="true">
        <div class="modal glass account-panel wide-panel" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle">
          <button class="modal-close" data-close-panel="notificationsModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <h2 id="notificationsTitle"><i class="fa-solid fa-bell"></i> Notifications</h2>
          <div id="notificationsList" class="activity-list"><div class="panel-empty">No notifications yet.</div></div>
        </div>
      </div>

      <div class="modal-overlay account-modal" id="adminModal" aria-hidden="true">
        <div class="modal glass account-panel admin-panel" role="dialog" aria-modal="true" aria-labelledby="adminTitle">
          <button class="modal-close" data-close-panel="adminModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <h2 id="adminTitle"><i class="fa-solid fa-user-shield"></i> Operations dashboard</h2>
          <p class="panel-note">Manage users, demo wallets, wagers, events, settlement, and the administrator audit trail.</p>
          <div class="admin-stats" id="adminStats"></div>
          <div class="admin-tabs" role="tablist" aria-label="Admin sections">
            <button class="active" type="button" data-admin-tab="overview"><i class="fa-solid fa-chart-pie"></i> Overview</button>
            <button type="button" data-admin-tab="bets"><i class="fa-solid fa-ticket"></i> Bet monitor</button>
            <button type="button" data-admin-tab="wallet"><i class="fa-solid fa-wallet"></i> Wallet ledger</button>
            <button type="button" data-admin-tab="users"><i class="fa-solid fa-users"></i> Users</button>
            <button type="button" data-admin-tab="operations"><i class="fa-solid fa-sliders"></i> Markets</button>
            <button type="button" data-admin-tab="communications"><i class="fa-solid fa-bullhorn"></i> Communications</button>
            <button type="button" data-admin-tab="audit"><i class="fa-solid fa-clipboard-list"></i> Audit log</button>
          </div>

          <section class="admin-tab-panel active" data-admin-panel="overview">
            <div class="ops-panel-head">
              <div><span class="ops-eyebrow">LIVE OPERATIONS</span><h3>Business overview</h3><p>Financial performance, platform activity, and current risk exposure.</p></div>
              <div class="ops-toolbar">
                <select id="opsRange" aria-label="Reporting range">
                  <option value="1">Last 24 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                <button type="button" id="opsRefresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
                <label class="ops-auto"><input type="checkbox" id="opsAutoRefresh"> Auto 60s</label>
              </div>
            </div>
            <div id="opsFinancialStats" class="ops-metric-grid"><div class="panel-empty">Loading operational metrics…</div></div>
            <div class="ops-overview-grid">
              <section class="ops-card"><div class="ops-card-head"><h4><i class="fa-solid fa-triangle-exclamation"></i> Risk alerts</h4><span id="opsRiskCount">0</span></div><div id="opsRiskAlerts" class="ops-feed"></div></section>
              <section class="ops-card"><div class="ops-card-head"><h4><i class="fa-solid fa-clock-rotate-left"></i> Recent admin activity</h4></div><div id="opsRecentActivity" class="ops-feed"></div></section>
            </div>
          </section>

          <section class="admin-tab-panel" data-admin-panel="bets">
            <div class="ops-panel-head"><div><span class="ops-eyebrow">WAGER CONTROL</span><h3>Bet monitor</h3><p>Search every wager, inspect its legs, and void eligible pending bets.</p></div></div>
            <form id="adminBetSearch" class="ops-filter-bar">
              <input id="adminBetQuery" type="search" maxlength="100" placeholder="Bet ID, player name, or email">
              <select id="adminBetStatus"><option value="all">All statuses</option><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="void">Void</option><option value="cashed_out">Cashed out</option></select>
              <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
              <button type="button" data-export="bets"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
            </form>
            <div id="adminBetFeed" class="ops-table-wrap"><div class="panel-empty">Open this section to load wagers.</div></div>
          </section>

          <section class="admin-tab-panel" data-admin-panel="wallet">
            <div class="ops-panel-head"><div><span class="ops-eyebrow">LEDGER</span><h3>Wallet transactions</h3><p>Trace all demo-credit movements and balances after every entry.</p></div></div>
            <form id="adminTransactionSearch" class="ops-filter-bar">
              <input id="adminTransactionQuery" type="search" maxlength="100" placeholder="Transaction ID, player name, or email">
              <select id="adminTransactionKind"><option value="all">All transaction types</option><option value="demo_credit">Demo credit</option><option value="bet_stake">Bet stake</option><option value="bet_payout">Bet payout</option><option value="bet_refund">Bet refund</option><option value="adjustment">Admin adjustment</option></select>
              <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
              <button type="button" data-export="transactions"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
            </form>
            <div id="adminTransactionFeed" class="ops-table-wrap"><div class="panel-empty">Open this section to load transactions.</div></div>
          </section>

          <section class="admin-tab-panel" data-admin-panel="users">
            <form id="adminUserSearch" class="admin-user-toolbar">
              <input id="adminUserQuery" type="search" maxlength="100" placeholder="Search name or email" aria-label="Search users">
              <select id="adminUserStatus" aria-label="Filter users">
                <option value="all">All users</option>
                <option value="active">Active betting</option>
                <option value="suspended">Suspended</option>
                <option value="admin">Administrators</option>
              </select>
              <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Search</button>
            </form>
            <div id="adminUsers" class="admin-users"><div class="panel-empty">Loading users…</div></div>
            <div id="adminUserDetails" class="admin-user-details" hidden></div>
          </section>

          <section class="admin-tab-panel" data-admin-panel="operations">
            <details class="admin-create">
              <summary>Create event</summary>
              <form id="adminEventForm" class="admin-event-form">
                <label class="auth-field"><span>Sport</span><input id="adminSport" required maxlength="60"></label>
                <label class="auth-field"><span>League</span><input id="adminLeague" required maxlength="100"></label>
                <label class="auth-field"><span>Home team</span><input id="adminHome" required maxlength="100"></label>
                <label class="auth-field"><span>Away team</span><input id="adminAway" required maxlength="100"></label>
                <label class="auth-field"><span>Starts at</span><input id="adminStarts" type="datetime-local" required></label>
                <label class="auth-field"><span>Home odds</span><input id="adminHomeOdds" type="number" min="1.01" max="1000" step=".01" value="1.85" required></label>
                <label class="auth-field"><span>Draw odds (optional)</span><input id="adminDrawOdds" type="number" min="1.01" max="1000" step=".01"></label>
                <label class="auth-field"><span>Away odds</span><input id="adminAwayOdds" type="number" min="1.01" max="1000" step=".01" value="2.10" required></label>
                <button class="btn-primary auth-submit" type="submit">Create event</button>
              </form>
            </details>
            <div id="adminEvents" class="admin-events"><div class="panel-empty">Loading operations…</div></div>
          </section>

          <section class="admin-tab-panel" data-admin-panel="communications">
            <div class="ops-panel-head"><div><span class="ops-eyebrow">COMMUNICATIONS</span><h3>Broadcast center</h3><p>Send an in-app operational announcement to every registered profile.</p></div></div>
            <form id="adminBroadcastForm" class="ops-broadcast-form">
              <label class="auth-field"><span>Notification title</span><input id="adminBroadcastTitle" required minlength="3" maxlength="100" placeholder="Scheduled maintenance"></label>
              <label class="auth-field"><span>Message</span><textarea id="adminBroadcastMessage" required minlength="5" maxlength="500" rows="6" placeholder="Write a clear message for all users…"></textarea></label>
              <div class="ops-broadcast-preview"><i class="fa-solid fa-bell"></i><div><strong id="broadcastPreviewTitle">Notification preview</strong><span id="broadcastPreviewMessage">Your message will appear here.</span></div></div>
              <button class="btn-primary" type="submit"><i class="fa-solid fa-paper-plane"></i> Send to all users</button>
            </form>
          </section>

          <section class="admin-tab-panel" data-admin-panel="audit">
            <div class="ops-panel-head"><div><span class="ops-eyebrow">GOVERNANCE</span><h3>Administrator audit trail</h3><p>Filter and export the record of sensitive operations.</p></div></div>
            <div class="ops-filter-bar">
              <input id="adminAuditQuery" type="search" maxlength="100" placeholder="Search action, admin, reason…">
              <select id="adminAuditType"><option value="all">All actions</option><option value="user">User controls</option><option value="wallet">Wallet adjustments</option><option value="bet">Bet actions</option><option value="event">Event and market actions</option><option value="notification">Communications</option></select>
              <button type="button" id="adminAuditFilter"><i class="fa-solid fa-filter"></i> Filter</button>
              <button type="button" data-export="audit"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
            </div>
            <div id="adminAudit" class="admin-audit"><div class="panel-empty">Open this tab to load the audit log.</div></div>
          </section>
        </div>
      </div>`);

    let registerMode = false;
    const modal = document.getElementById('accountModal');
    const form = document.getElementById('authForm');

    function setMode(register) {
      registerMode = register;
      document.getElementById('authTitle').textContent = register ? 'Create account' : 'Sign in';
      document.getElementById('authSubmit').textContent = register ? 'Create account' : 'Sign in';
      document.getElementById('authSwitch').textContent = register
        ? 'Already have an account? Sign in'
        : 'New here? Create an account';
      document.querySelectorAll('.register-only').forEach(el => { el.hidden = !register; });
      document.getElementById('authPassword').autocomplete = register ? 'new-password' : 'current-password';
    }

    window.openAceAuth = register => {
      setMode(Boolean(register));
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      setTimeout(() => document.getElementById(register ? 'authName' : 'authEmail').focus(), 30);
    };

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };
    document.getElementById('closeAccountModal').addEventListener('click', close);
    document.getElementById('authSwitch').addEventListener('click', () => setMode(!registerMode));
    modal.addEventListener('click', event => { if (event.target === modal) close(); });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = document.getElementById('authSubmit');
      submit.disabled = true;
      submit.textContent = 'Please wait…';
      try {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        if (registerMode) {
          const displayName = document.getElementById('authName').value.trim();
          if (!document.getElementById('authAge').checked) throw new Error('You must confirm that you are 18 or older.');
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/home.html`,
              data: { display_name: displayName, age_confirmed: true }
            }
          });
          if (error) throw error;
          close();
          notify(data.session ? 'Account created. Welcome!' : 'Check your email to confirm your account.');
        } else {
          const { error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          close();
          notify('Signed in successfully.');
        }
      } catch (error) {
        notify(error.message || 'Authentication failed.', true);
      } finally {
        submit.disabled = false;
        submit.textContent = registerMode ? 'Create account' : 'Sign in';
      }
    });

    document.querySelectorAll('[data-close-panel]').forEach(button => {
      button.addEventListener('click', () => document.getElementById(button.dataset.closePanel).classList.remove('open'));
    });
    document.querySelectorAll('#walletModal, #responsibleModal, #notificationsModal, #adminModal').forEach(panel => {
      panel.addEventListener('click', event => { if (event.target === panel) panel.classList.remove('open'); });
    });

    document.getElementById('responsibleForm').addEventListener('submit', saveResponsiblePlay);
    document.getElementById('adminEventForm').addEventListener('submit', createAdminEvent);
    document.getElementById('adminUserSearch').addEventListener('submit', event => {
      event.preventDefault();
      loadAdminUsers();
    });
    document.getElementById('adminUserStatus').addEventListener('change', loadAdminUsers);
    document.getElementById('adminBetSearch').addEventListener('submit', event => {
      event.preventDefault();
      loadAdminBets();
    });
    document.getElementById('adminBetStatus').addEventListener('change', loadAdminBets);
    document.getElementById('adminTransactionSearch').addEventListener('submit', event => {
      event.preventDefault();
      loadAdminTransactions();
    });
    document.getElementById('adminTransactionKind').addEventListener('change', loadAdminTransactions);
    document.getElementById('adminBroadcastForm').addEventListener('submit', sendAdminBroadcast);
    document.getElementById('adminBroadcastTitle').addEventListener('input', updateBroadcastPreview);
    document.getElementById('adminBroadcastMessage').addEventListener('input', updateBroadcastPreview);
    document.getElementById('opsRange').addEventListener('change', loadOperationsOverview);
    document.getElementById('opsRefresh').addEventListener('click', loadOperationsOverview);
    document.getElementById('opsAutoRefresh').addEventListener('change', toggleOperationsAutoRefresh);
    document.getElementById('adminAuditFilter').addEventListener('click', renderFilteredAudit);
    document.getElementById('adminAuditQuery').addEventListener('input', renderFilteredAudit);
    document.getElementById('adminAuditType').addEventListener('change', renderFilteredAudit);
    document.querySelectorAll('[data-export]').forEach(button => {
      button.addEventListener('click', () => exportAdminCsv(button.dataset.export));
    });
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => selectAdminTab(button.dataset.adminTab));
    });

    if (operationsPage) mountOperationsDashboard();
  }

  function mountOperationsDashboard() {
    const root = document.getElementById('operationsDashboard');
    const overlay = document.getElementById('adminModal');
    const panel = overlay?.querySelector('.admin-panel');
    if (!root || !overlay || !panel) return;

    panel.querySelector('[data-close-panel="adminModal"]')?.remove();
    panel.classList.add('operations-workspace');
    root.appendChild(panel);
    overlay.remove();

    const tabs = panel.querySelector('.admin-tabs');
    tabs?.insertAdjacentHTML('afterbegin', `
      <div class="operations-nav-label">Workspace</div>
    `);
    panel.querySelector('[data-admin-tab="overview"]').innerHTML =
      '<i class="fa-solid fa-chart-pie"></i><span><b>Overview</b><small>Performance and risk</small></span>';
    panel.querySelector('[data-admin-tab="bets"]').innerHTML =
      '<i class="fa-solid fa-ticket"></i><span><b>Bet monitor</b><small>Search, inspect and void</small></span>';
    panel.querySelector('[data-admin-tab="wallet"]').innerHTML =
      '<i class="fa-solid fa-wallet"></i><span><b>Wallet ledger</b><small>All credit movements</small></span>';
    panel.querySelector('[data-admin-tab="users"]').innerHTML =
      '<i class="fa-solid fa-users"></i><span><b>User controls</b><small>Profiles, limits and notes</small></span>';
    panel.querySelector('[data-admin-tab="operations"]').innerHTML =
      '<i class="fa-solid fa-chart-line"></i><span><b>Markets</b><small>Events, odds and settlement</small></span>';
    panel.querySelector('[data-admin-tab="communications"]').innerHTML =
      '<i class="fa-solid fa-bullhorn"></i><span><b>Communications</b><small>Broadcast notifications</small></span>';
    panel.querySelector('[data-admin-tab="audit"]').innerHTML =
      '<i class="fa-solid fa-clipboard-list"></i><span><b>Audit trail</b><small>Administrator activity</small></span>';
  }

  function updateOperationsAccess() {
    if (!operationsPage) return;
    const workspace = document.querySelector('.operations-workspace');
    const gate = document.getElementById('operationsAccessGate');
    if (!workspace || !gate) return;

    workspace.hidden = !currentUserIsAdmin;
    gate.hidden = currentUserIsAdmin;
    if (!currentUser) {
      gate.innerHTML = `
        <i class="fa-solid fa-lock"></i>
        <h2>Administrator sign-in required</h2>
        <p>Sign in with an administrator account to open the Operations workspace.</p>
        <button class="btn-primary" type="button" data-operations-login>Sign in</button>`;
      gate.querySelector('[data-operations-login]').addEventListener('click', () => window.openAceAuth(false));
    } else if (!currentUserIsAdmin) {
      gate.innerHTML = `
        <i class="fa-solid fa-shield-halved"></i>
        <h2>Administrator access required</h2>
        <p>This account does not have permission to view users, wagers, wallets, or settlement controls.</p>
        <a class="btn-primary operations-home-link" href="home.html">Return to website</a>`;
    }
  }

  function wireDropdown() {
    const dropdown = document.getElementById('userDropdown');
    if (!dropdown) return;
    const links = [...dropdown.querySelectorAll('a')];
    links.forEach(link => {
      const label = link.textContent.trim().toLowerCase();
      if (label.includes('deposit') || label.includes('withdraw')) {
        link.innerHTML = '<i class="fa-solid fa-wallet"></i> Demo Wallet';
        link.addEventListener('click', event => { event.preventDefault(); openWallet(); });
      } else if (label === 'login') {
        link.dataset.authAction = 'login';
        link.addEventListener('click', event => { event.preventDefault(); window.openAceAuth(false); });
      } else if (label === 'register') {
        link.dataset.authAction = 'register';
        link.addEventListener('click', event => { event.preventDefault(); window.openAceAuth(true); });
      }
    });

    const logout = dropdown.querySelector('button');
    if (logout) {
      logout.dataset.authAction = 'logout';
      logout.addEventListener('click', async () => {
        await client.auth.signOut();
        notify('Signed out.');
      });
    }

    const hr = dropdown.querySelector('hr');
    if (hr) {
      const notifications = document.createElement('a');
      notifications.href = '#';
      notifications.dataset.signedInOnly = 'true';
      notifications.innerHTML = '<i class="fa-solid fa-bell"></i> Notifications';
      notifications.addEventListener('click', event => {
        event.preventDefault();
        openNotifications();
      });
      hr.before(notifications);

      const responsible = document.createElement('a');
      responsible.href = '#';
      responsible.dataset.signedInOnly = 'true';
      responsible.innerHTML = '<i class="fa-solid fa-shield-heart"></i> Responsible Play';
      responsible.addEventListener('click', event => {
        event.preventDefault();
        openResponsiblePlay();
      });
      hr.before(responsible);

      const admin = document.createElement('a');
      admin.href = 'operations.html';
      admin.dataset.adminOnly = 'true';
      admin.style.display = 'none';
      admin.innerHTML = '<i class="fa-solid fa-user-shield"></i> Operations';
      admin.addEventListener('click', event => {
        event.preventDefault();
        openAdmin();
      });
      hr.before(admin);
    }
  }

  async function applySession(session) {
    currentUser = session?.user || null;
    currentProfile = null;
    currentUserIsAdmin = false;
    document.querySelectorAll('[data-auth-action="login"], [data-auth-action="register"]').forEach(el => {
      el.style.display = currentUser ? 'none' : '';
    });
    document.querySelectorAll('[data-auth-action="logout"]').forEach(el => {
      el.style.display = currentUser ? '' : 'none';
    });
    document.querySelectorAll('[data-signed-in-only="true"]').forEach(el => {
      el.style.display = currentUser ? '' : 'none';
    });
    document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
      el.style.display = 'none';
    });

    if (!currentUser) {
      window.AceUI.setBalance(0);
      updateAccountChrome(null);
      window.AceUI.updateBalanceDisplay();
      updateOperationsAccess();
      window.dispatchEvent(new CustomEvent('ace:session', {
        detail: { user: null, profile: null, isAdmin: false }
      }));
      return;
    }

    const [{ data: profile }, { data: wallet }, { data: isAdmin, error: adminError }] = await Promise.all([
      client.from('profiles').select('display_name, age_confirmed').single(),
      client.from('wallets').select('balance, currency').single(),
      client.rpc('is_admin')
    ]);
    if (adminError && adminError.code !== 'PGRST202') console.warn('Admin check failed:', adminError.message);
    currentUserIsAdmin = Boolean(isAdmin);
    document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
      el.style.display = currentUserIsAdmin ? '' : 'none';
    });
    currentProfile = profile;
    window.AceUI.setBalance(wallet?.balance || 0);
    updateAccountChrome(profile);
    window.AceUI.updateBalanceDisplay();
    await loadBetHistory();
    updateOperationsAccess();
    if (operationsPage && currentUserIsAdmin) {
      selectAdminTab('overview');
      await Promise.all([loadOperationsOverview(), loadAdminDashboard()]);
    }
    window.dispatchEvent(new CustomEvent('ace:session', {
      detail: { user: currentUser, profile: currentProfile, isAdmin: currentUserIsAdmin }
    }));
  }

  function updateAccountChrome(profile) {
    const avatar = document.getElementById('avatarBtn');
    const rank = document.getElementById('rankPill');
    if (!avatar) return;
    if (!currentUser) {
      avatar.childNodes[0].nodeValue = 'GU';
      avatar.title = 'Sign in';
      if (rank) rank.style.display = 'none';
      return;
    }
    const name = profile?.display_name || currentUser.email || 'User';
    const initials = name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    avatar.childNodes[0].nodeValue = initials;
    avatar.title = name;
    if (rank) rank.style.display = '';
  }

  async function loadMarkets() {
    const { data, error } = await client
      .from('market_selections')
      .select('id,outcome_key,label,odds,market_id,markets!inner(id,status,event_id,events!inner(id,sport,league,home_team,away_team,starts_at,status,live_score,live_clock))')
      .eq('is_active', true)
      .eq('markets.status', 'open');
    if (error || !data?.length) {
      console.warn('Using bundled demo markets:', error?.message);
      return;
    }

    const grouped = new Map();
    for (const selection of data) {
      const market = selection.markets;
      const event = market.events;
      if (!['scheduled', 'live'].includes(event.status)) continue;
      if (!grouped.has(event.id)) {
        if (!marketUiIds.has(event.id)) marketUiIds.set(event.id, nextMarketUiId++);
        grouped.set(event.id, {
          id: marketUiIds.get(event.id),
          eventId: event.id,
          sport: event.sport,
          league: event.league,
          team1: event.home_team,
          team2: event.away_team,
          startsAt: event.starts_at,
          odds: { home: null, draw: null, away: null },
          selectionIds: {},
          live_score: event.live_score || '—',
          live_clock: event.live_clock,
          status: event.status === 'live' ? 'Live' : `Upcoming ${new Date(event.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          trend: { home: 50, draw: 0, away: 50 }
        });
      }
      const match = grouped.get(event.id);
      match.odds[selection.outcome_key] = Number(selection.odds);
      match.selectionIds[selection.outcome_key] = selection.id;
    }

    let nextMatches = [...grouped.values()].sort((left, right) => {
      if (left.status === 'Live' && right.status !== 'Live') return -1;
      if (left.status !== 'Live' && right.status === 'Live') return 1;
      return new Date(left.startsAt) - new Date(right.startsAt);
    });
    if (typeof PAGE_FILTER !== 'undefined' && PAGE_FILTER === 'live') {
      nextMatches = nextMatches.filter(match => match.status === 'Live');
    } else if (typeof PAGE_FILTER !== 'undefined' && PAGE_FILTER === 'esports') {
      nextMatches = nextMatches.filter(match => ['CS:GO', 'League of Legends', 'Valorant'].includes(match.sport));
    }
    const allSports = [...new Set(nextMatches.map(match => match.sport))];
    const icons = { Cricket: 'fa-baseball-bat-ball', Football: 'fa-futbol', Tennis: 'fa-table-tennis-paddle-ball', Basketball: 'fa-basketball', 'CS:GO': 'fa-crosshairs', Valorant: 'fa-gun' };
    const nextSports = [{ key: 'All', icon: 'fa-layer-group' }, ...allSports.map(key => ({ key, icon: icons[key] || 'fa-trophy' }))];
    window.AceUI.replaceMarkets(nextMatches, nextSports);
    window.AceUI.renderAllMarkets();
    const refreshLabel = document.getElementById('refreshLabel');
    if (refreshLabel) {
      refreshLabel.textContent = `Provider prices checked ${new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
    }
  }

  function startPublicMarketsRefresh() {
    if (operationsPage || publicMarketsRefreshTimer) return;
    publicMarketsRefreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadMarkets();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadMarkets();
    });
  }

  async function placeBets() {
    if (!currentUser) {
      window.openAceAuth(false);
      throw new Error('Sign in to place a demo bet.');
    }

    const uiState = window.AceUI.getState();
    const selections = uiState.selections;
    const bets = uiState.slipMode === 'parlay'
      ? [{
          kind: 'parlay',
          stake: Number(document.getElementById('stakeInput').value),
          selection_ids: selections.map(item => item.selectionId)
        }]
      : selections
          .filter(item => Number(item.singleStake) > 0)
          .map(item => ({ kind: 'single', stake: Number(item.singleStake), selection_ids: [item.selectionId] }));

    if (bets.some(bet => bet.selection_ids.some(id => !id))) {
      throw new Error('This bundled market is not connected to the database. Choose one of the newly loaded markets.');
    }
    const { data, error } = await client.rpc('place_bets', { p_bets: bets });
    if (error) throw error;
    window.AceUI.setBalance(data.balance);
    await loadBetHistory();
    return data;
  }

  async function loadBetHistory() {
    if (!currentUser) return;
    const { data, error } = await client
      .from('bets')
      .select('id,kind,status,stake,total_odds,potential_payout,settled_payout,placed_at,bet_legs(selection_label)')
      .order('placed_at', { ascending: false })
      .limit(30);
    if (error) return console.warn(error.message);
    const rows = (data || []).map(bet => {
      const result = bet.status === 'pending'
        ? 'Pending'
        : bet.status.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
      const payout = Number(bet.settled_payout || 0);
      const stake = Number(bet.stake);
      return {
        date: new Date(bet.placed_at).toLocaleDateString('en-IN'),
        event: bet.kind === 'parlay' ? `${bet.bet_legs.length}-Leg Parlay` : (bet.bet_legs[0]?.selection_label || 'Single Bet'),
        stake,
        result,
        pl: ['won', 'cashed_out'].includes(bet.status) ? payout - stake : bet.status === 'lost' ? -stake : 0
      };
    });
    window.AceUI.setHistory(rows);
    window.AceUI.renderHistory();
  }

  async function openWallet() {
    if (!currentUser) return window.openAceAuth(false);
    const modal = document.getElementById('walletModal');
    modal.classList.add('open');
    const [{ data: wallet }, { data: activity }] = await Promise.all([
      client.from('wallets').select('balance').single(),
      client.from('wallet_transactions').select('id,kind,amount,balance_after,description,created_at').order('created_at', { ascending: false }).limit(20)
    ]);
    document.getElementById('walletPanelBalance').textContent = money(wallet?.balance);
    const list = document.getElementById('walletActivity');
    list.innerHTML = activity?.length ? activity.map(item => `
      <div class="activity-row">
        <div><strong>${escapeHtml(item.description)}</strong><span>${new Date(item.created_at).toLocaleString()}</span></div>
        <b class="${Number(item.amount) >= 0 ? 'profit-pos' : 'profit-neg'}">${Number(item.amount) >= 0 ? '+' : ''}${money(item.amount)}</b>
      </div>`).join('') : '<div class="panel-empty">No wallet activity yet.</div>';
  }

  async function loadResponsiblePlay() {
    const { data } = await client.from('responsible_play_settings').select('*').single();
    if (!data) return;
    document.getElementById('dailyLimit').value = Number(data.daily_stake_limit);
    document.getElementById('sessionReminder').value = String(data.session_reminder_minutes);
  }

  async function openResponsiblePlay() {
    if (!currentUser) return window.openAceAuth(false);
    await loadResponsiblePlay();
    document.getElementById('responsibleModal').classList.add('open');
  }

  async function openNotifications() {
    if (!currentUser) return window.openAceAuth(false);
    const modal = document.getElementById('notificationsModal');
    modal.classList.add('open');
    const { data, error } = await client
      .from('user_notifications')
      .select('id,kind,title,message,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(40);
    const list = document.getElementById('notificationsList');
    if (error) {
      list.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    list.innerHTML = data?.length ? data.map(item => `
      <div class="activity-row notification-row">
        <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><span>${new Date(item.created_at).toLocaleString()}</span></div>
        <i class="fa-solid ${item.kind === 'bet_won' ? 'fa-trophy' : item.kind === 'bet_lost' ? 'fa-circle-xmark' : 'fa-circle-info'}"></i>
      </div>`).join('') : '<div class="panel-empty">No notifications yet.</div>';
    const unreadIds = (data || []).filter(item => !item.read_at).map(item => item.id);
    if (unreadIds.length) {
      await client.from('user_notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    }
  }

  async function openAdmin() {
    if (!currentUserIsAdmin) return notify('Administrator access required.', true);
    if (!operationsPage) {
      window.location.href = 'operations.html';
      return;
    }
    selectAdminTab('overview');
    await Promise.all([loadOperationsOverview(), loadAdminDashboard()]);
  }

  function selectAdminTab(tab) {
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminTab === tab);
    });
    document.querySelectorAll('[data-admin-panel]').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.adminPanel === tab);
    });
    if (tab === 'overview') loadOperationsOverview();
    if (tab === 'bets') loadAdminBets();
    if (tab === 'wallet') loadAdminTransactions();
    if (tab === 'users') loadAdminUsers();
    if (tab === 'operations') loadAdminDashboard();
    if (tab === 'audit') loadAdminAudit();
  }

  async function loadOperationsOverview() {
    if (!operationsPage || !currentUserIsAdmin) return;
    const range = Number(document.getElementById('opsRange')?.value || 1);
    const from = new Date(Date.now() - range * 86400000).toISOString();
    const metricsContainer = document.getElementById('opsFinancialStats');
    if (metricsContainer) metricsContainer.innerHTML = '<div class="panel-empty">Refreshing metrics…</div>';
    const { data, error } = await client.rpc('admin_ops_summary', { p_from: from });
    if (error) {
      if (metricsContainer) metricsContainer.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    const metrics = data?.metrics || {};
    const topStats = [
      ['fa-users', 'Total users', metrics.users || 0],
      ['fa-ticket', 'Open bets', metrics.open_bets || 0],
      ['fa-scale-balanced', 'Open liability', money(metrics.open_liability)],
      ['fa-trophy', 'Active events', metrics.active_events || 0]
    ];
    document.getElementById('adminStats').innerHTML = topStats.map(([icon, label, value]) => `
      <div><i class="fa-solid ${icon}"></i><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('');

    const financial = [
      ['Stakes', money(metrics.stakes), 'Total accepted in range', 'fa-arrow-trend-up'],
      ['Payouts', money(metrics.payouts), 'Settled payouts in range', 'fa-money-bill-transfer'],
      ['Net / GGR', money(metrics.ggr), 'Stakes minus settled payouts', 'fa-chart-column'],
      ['Active users', Number(metrics.active_users || 0), 'Signed in during range', 'fa-user-clock'],
      ['New users', Number(metrics.new_users || 0), 'Profiles created in range', 'fa-user-plus'],
      ['Open stake', money(metrics.open_stake), 'Pending wager stakes', 'fa-hourglass-half'],
      ['Suspended', Number(metrics.suspended_users || 0), 'Betting-restricted accounts', 'fa-user-lock'],
      ['Liability', money(metrics.open_liability), 'Maximum pending payout', 'fa-shield-halved']
    ];
    metricsContainer.innerHTML = financial.map(([label, value, note, icon]) => `
      <article class="ops-metric"><i class="fa-solid ${icon}"></i><div><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${note}</small></div></article>`).join('');

    const risks = data?.risk_alerts || [];
    document.getElementById('opsRiskCount').textContent = String(risks.length);
    document.getElementById('opsRiskAlerts').innerHTML = risks.length ? risks.map(item => `
      <button class="ops-feed-row risk-${Number(item.severity || 1)}" type="button" data-risk-bet="${item.target_id}">
        <i class="fa-solid fa-triangle-exclamation"></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.message)} · ${money(item.amount)}</small></span><i class="fa-solid fa-chevron-right"></i>
      </button>`).join('') : '<div class="panel-empty compact">No large pending exposures detected.</div>';
    document.querySelectorAll('[data-risk-bet]').forEach(button => {
      button.addEventListener('click', () => {
        selectAdminTab('bets');
        document.getElementById('adminBetQuery').value = button.dataset.riskBet;
        loadAdminBets();
      });
    });

    const activity = data?.recent_activity || [];
    document.getElementById('opsRecentActivity').innerHTML = activity.length ? activity.map(item => `
      <div class="ops-feed-row"><i class="fa-solid fa-shield"></i><span><strong>${escapeHtml(item.action.replaceAll('.', ' '))}</strong><small>${escapeHtml(item.admin_name)} · ${new Date(item.created_at).toLocaleString()}</small></span></div>`).join('') : '<div class="panel-empty compact">No recent administrator activity.</div>';
  }

  function toggleOperationsAutoRefresh() {
    window.clearInterval(operationsRefreshTimer);
    operationsRefreshTimer = null;
    if (document.getElementById('opsAutoRefresh')?.checked) {
      operationsRefreshTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible' && currentUserIsAdmin) loadOperationsOverview();
      }, 60000);
      notify('Automatic refresh enabled.');
    }
  }

  async function loadAdminBets() {
    const container = document.getElementById('adminBetFeed');
    container.innerHTML = '<div class="panel-empty">Loading wagers…</div>';
    const { data, error } = await client.rpc('admin_bets_feed', {
      p_search: document.getElementById('adminBetQuery').value.trim(),
      p_status: document.getElementById('adminBetStatus').value,
      p_limit: 200,
      p_offset: 0
    });
    if (error) {
      container.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    adminBetRows = data?.bets || [];
    container.innerHTML = adminBetRows.length ? `
      <div class="ops-result-count">${Number(data.total || adminBetRows.length)} wager${Number(data.total) === 1 ? '' : 's'}</div>
      <div class="ops-data-table ops-bet-table">
        <div class="ops-table-head"><span>Player / Bet</span><span>Stake</span><span>Potential</span><span>Status</span><span>Placed</span><span>Action</span></div>
        ${adminBetRows.map(bet => `
          <details class="ops-table-record">
            <summary>
              <span><b>${escapeHtml(bet.display_name || bet.email)}</b><small>${escapeHtml(bet.email)} · ${escapeHtml(bet.id.slice(0, 8))}</small></span>
              <span>${money(bet.stake)}</span><span>${money(bet.potential_payout)}</span>
              <span><b class="ops-status ops-status-${escapeHtml(bet.status)}">${escapeHtml(bet.status)}</b></span>
              <span>${new Date(bet.placed_at).toLocaleString()}</span>
              <span>${bet.status === 'pending' ? `<button type="button" class="ops-danger-btn" data-void-bet="${bet.id}">Void & refund</button>` : '—'}</span>
            </summary>
            <div class="ops-record-detail">
              <div class="ops-record-meta"><span>Type <b>${escapeHtml(bet.kind)}</b></span><span>Total odds <b>${Number(bet.total_odds).toFixed(2)}</b></span><span>Settled payout <b>${money(bet.settled_payout)}</b></span></div>
              ${(bet.legs || []).map(leg => `<div class="admin-bet-leg"><span>${escapeHtml(leg.event)} — ${escapeHtml(leg.selection)}</span><span>${escapeHtml(leg.market)} · ${Number(leg.odds).toFixed(2)} · ${escapeHtml(leg.result)}</span></div>`).join('')}
            </div>
          </details>`).join('')}
      </div>` : '<div class="panel-empty">No wagers match these filters.</div>';
    container.querySelectorAll('[data-void-bet]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        voidAdminBet(button.dataset.voidBet);
      });
    });
  }

  async function voidAdminBet(betId) {
    const reason = window.prompt('Why is this pending bet being voided? The reason is logged and shown to the player.');
    if (reason === null) return;
    if (reason.trim().length < 5) return notify('Enter a reason of at least 5 characters.', true);
    if (!window.confirm('Void this bet and return its stake to the player?')) return;
    const { error } = await client.rpc('admin_void_bet', { p_bet_id: betId, p_reason: reason.trim() });
    if (error) return notify(error.message, true);
    notify('Bet voided and stake refunded.');
    await Promise.all([loadAdminBets(), loadOperationsOverview(), loadAdminAudit()]);
  }

  async function loadAdminTransactions() {
    const container = document.getElementById('adminTransactionFeed');
    container.innerHTML = '<div class="panel-empty">Loading ledger…</div>';
    const { data, error } = await client.rpc('admin_transactions_feed', {
      p_search: document.getElementById('adminTransactionQuery').value.trim(),
      p_kind: document.getElementById('adminTransactionKind').value,
      p_limit: 200,
      p_offset: 0
    });
    if (error) {
      container.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    adminTransactionRows = data?.transactions || [];
    container.innerHTML = adminTransactionRows.length ? `
      <div class="ops-result-count">${Number(data.total || adminTransactionRows.length)} transaction${Number(data.total) === 1 ? '' : 's'}</div>
      <div class="ops-data-table ops-ledger-table">
        <div class="ops-table-head"><span>Player</span><span>Type</span><span>Amount</span><span>Balance after</span><span>Description</span><span>Time</span></div>
        ${adminTransactionRows.map(tx => `<div class="ops-table-row">
          <span><b>${escapeHtml(tx.display_name || tx.email)}</b><small>${escapeHtml(tx.email)}</small></span>
          <span><b class="ops-status">${escapeHtml(String(tx.kind).replaceAll('_', ' '))}</b></span>
          <span class="${Number(tx.amount) >= 0 ? 'credit' : 'debit'}">${Number(tx.amount) >= 0 ? '+' : ''}${money(tx.amount)}</span>
          <span>${money(tx.balance_after)}</span><span>${escapeHtml(tx.description)}</span><span>${new Date(tx.created_at).toLocaleString()}</span>
        </div>`).join('')}
      </div>` : '<div class="panel-empty">No transactions match these filters.</div>';
  }

  function exportAdminCsv(type) {
    const auditFiltered = getFilteredAuditRows();
    const configs = {
      bets: {
        rows: adminBetRows,
        headers: ['Bet ID', 'Player', 'Email', 'Kind', 'Status', 'Stake', 'Odds', 'Potential payout', 'Settled payout', 'Placed'],
        map: row => [row.id, row.display_name, row.email, row.kind, row.status, row.stake, row.total_odds, row.potential_payout, row.settled_payout, row.placed_at]
      },
      transactions: {
        rows: adminTransactionRows,
        headers: ['Transaction ID', 'Player', 'Email', 'Type', 'Amount', 'Balance after', 'Description', 'Created'],
        map: row => [row.id, row.display_name, row.email, row.kind, row.amount, row.balance_after, row.description, row.created_at]
      },
      audit: {
        rows: auditFiltered,
        headers: ['Action', 'Admin', 'Email', 'Target type', 'Target ID', 'Details', 'Created'],
        map: row => [row.action, row.admin_name, row.admin_email, row.target_type, row.target_id, JSON.stringify(row.details || {}), row.created_at]
      }
    };
    const config = configs[type];
    if (!config?.rows?.length) return notify(`Load ${type} data before exporting.`, true);
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [config.headers, ...config.rows.map(config.map)].map(row => row.map(quote).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ace-staker-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateBroadcastPreview() {
    document.getElementById('broadcastPreviewTitle').textContent =
      document.getElementById('adminBroadcastTitle').value.trim() || 'Notification preview';
    document.getElementById('broadcastPreviewMessage').textContent =
      document.getElementById('adminBroadcastMessage').value.trim() || 'Your message will appear here.';
  }

  async function sendAdminBroadcast(event) {
    event.preventDefault();
    const title = document.getElementById('adminBroadcastTitle').value.trim();
    const message = document.getElementById('adminBroadcastMessage').value.trim();
    if (!window.confirm('Send this notification to every registered profile?')) return;
    const submit = event.submitter;
    submit.disabled = true;
    const { data, error } = await client.rpc('admin_broadcast_notification', { p_title: title, p_message: message });
    submit.disabled = false;
    if (error) return notify(error.message, true);
    event.target.reset();
    updateBroadcastPreview();
    notify(`Notification sent to ${Number(data || 0)} user${Number(data) === 1 ? '' : 's'}.`);
    loadAdminAudit();
  }

  async function loadAdminUsers() {
    const container = document.getElementById('adminUsers');
    const details = document.getElementById('adminUserDetails');
    container.hidden = false;
    details.hidden = true;
    container.innerHTML = '<div class="panel-empty">Loading users…</div>';
    const { data, error } = await client.rpc('admin_users_overview', {
      p_search: document.getElementById('adminUserQuery').value.trim(),
      p_limit: 100,
      p_offset: 0,
      p_status: document.getElementById('adminUserStatus').value
    });
    if (error) {
      container.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    const users = data?.users || [];
    container.innerHTML = users.length ? `
      <div class="admin-user-count">${Number(data.total || users.length)} profile${Number(data.total) === 1 ? '' : 's'}</div>
      ${users.map(user => `
        <article class="admin-user-card ${user.betting_suspended_at ? 'suspended' : ''}">
          <div class="admin-user-identity">
            <span class="admin-user-avatar">${escapeHtml((user.display_name || user.email || '?').slice(0, 2).toUpperCase())}</span>
            <div>
              <strong>${escapeHtml(user.display_name)}</strong>
              <span>${escapeHtml(user.email)}</span>
              <small>
                ${user.email_confirmed ? '<i class="fa-solid fa-circle-check"></i> Confirmed' : '<i class="fa-solid fa-circle-exclamation"></i> Unconfirmed'}
                ${user.admin_role ? ` · ${escapeHtml(user.admin_role)}` : ''}
                ${user.betting_suspended_at ? ' · Betting suspended' : ''}
              </small>
            </div>
          </div>
          <div class="admin-user-metrics">
            <span><b>${money(user.balance)}</b>Balance</span>
            <span><b>${Number(user.total_bets || 0)}</b>Total bets</span>
            <span><b>${money(user.total_staked)}</b>Staked</span>
            <span><b>${money(user.open_exposure)}</b>Open exposure</span>
          </div>
          <button type="button" data-admin-user="${user.id}">View & manage</button>
        </article>`).join('')}` : '<div class="panel-empty">No users match this search.</div>';
    container.querySelectorAll('[data-admin-user]').forEach(button => {
      button.addEventListener('click', () => openAdminUser(button.dataset.adminUser));
    });
  }

  async function openAdminUser(userId) {
    const list = document.getElementById('adminUsers');
    const container = document.getElementById('adminUserDetails');
    list.hidden = true;
    container.hidden = false;
    container.innerHTML = '<div class="panel-empty">Loading profile and wagers…</div>';
    const [
      { data, error },
      { data: controls, error: controlsError }
    ] = await Promise.all([
      client.rpc('admin_user_details', { p_user_id: userId }),
      client.rpc('admin_user_controls', { p_user_id: userId })
    ]);
    if (error) {
      container.innerHTML = `<button class="admin-back" type="button">← Back to users</button><div class="panel-empty">${escapeHtml(error.message)}</div>`;
      container.querySelector('.admin-back').addEventListener('click', closeAdminUser);
      return;
    }
    if (controlsError) notify(controlsError.message, true);
    const profile = data.profile;
    const bets = data.bets || [];
    const transactions = data.transactions || [];
    container.innerHTML = `
      <button class="admin-back" type="button"><i class="fa-solid fa-arrow-left"></i> All users</button>
      <div class="admin-profile-head">
        <div>
          <h3>${escapeHtml(profile.display_name)}</h3>
          <span>${escapeHtml(profile.email)} · Joined ${new Date(profile.created_at).toLocaleDateString('en-IN')}</span>
        </div>
        <strong>${money(profile.balance)}</strong>
      </div>
      <div class="admin-profile-badges">
        <span>${profile.email_confirmed ? 'Email confirmed' : 'Email unconfirmed'}</span>
        <span>${profile.age_confirmed ? '18+ confirmed' : 'Age not confirmed'}</span>
        ${profile.admin_role ? `<span>${escapeHtml(profile.admin_role)}</span>` : ''}
        <span class="${profile.betting_suspended_at ? 'danger' : 'success'}">${profile.betting_suspended_at ? 'Betting suspended' : 'Betting active'}</span>
        ${profile.self_excluded_until ? `<span>Self-excluded until ${new Date(profile.self_excluded_until).toLocaleString()}</span>` : ''}
      </div>
      ${profile.betting_suspension_reason ? `<p class="admin-reason"><b>Suspension reason:</b> ${escapeHtml(profile.betting_suspension_reason)}</p>` : ''}

      <div class="admin-user-actions">
        <form id="adminCreditForm">
          <h4>Adjust demo credits</h4>
          <div class="admin-action-grid">
            <select id="adminCreditDirection" aria-label="Adjustment type">
              <option value="1">Add credits</option>
              <option value="-1">Deduct credits</option>
            </select>
            <input id="adminCreditAmount" type="number" min="1" max="1000000" step=".01" placeholder="Amount" required>
            <input id="adminCreditReason" type="text" minlength="5" maxlength="200" placeholder="Required reason" required>
            <button type="submit">Apply adjustment</button>
          </div>
        </form>
        <form id="adminSuspensionForm">
          <h4>${profile.betting_suspended_at ? 'Restore betting' : 'Suspend betting'}</h4>
          <div class="admin-action-grid suspension">
            ${profile.betting_suspended_at
              ? '<p>Allow this user to place new bets again.</p>'
              : '<input id="adminSuspensionReason" type="text" minlength="5" maxlength="200" placeholder="Required suspension reason" required>'}
            <button class="${profile.betting_suspended_at ? 'restore' : 'danger'}" type="submit">${profile.betting_suspended_at ? 'Restore access' : 'Suspend betting'}</button>
          </div>
        </form>
      </div>

      <form id="adminUserControlsForm" class="ops-user-controls">
        <div><h4>Player controls & internal notes</h4><p>Tags and notes are visible only to administrators.</p></div>
        <label class="auth-field"><span>Daily stake limit</span><input id="adminDailyStakeLimit" type="number" min="10" max="10000000" step=".01" value="${Number(controls?.daily_stake_limit || profile.daily_stake_limit || 10000)}" required></label>
        <label class="auth-field"><span>Risk tags (comma separated)</span><input id="adminUserTags" type="text" maxlength="320" value="${escapeHtml((controls?.admin_tags || []).join(', '))}" placeholder="VIP, review, high exposure"></label>
        <label class="auth-field ops-note-field"><span>Internal note</span><textarea id="adminUserNote" maxlength="1000" rows="3" placeholder="Internal context for other administrators">${escapeHtml(controls?.admin_note || '')}</textarea></label>
        <button type="submit">Save player controls</button>
      </form>

      <h3 class="admin-subtitle">Bets (${bets.length})</h3>
      <div class="admin-bet-list">${bets.length ? bets.map(bet => `
        <details class="admin-bet">
          <summary>
            <span><b>${escapeHtml(bet.kind)}</b> · ${new Date(bet.placed_at).toLocaleString()}</span>
            <span>${money(bet.stake)} at ${Number(bet.total_odds).toFixed(2)} · <b class="bet-${escapeHtml(bet.status)}">${escapeHtml(bet.status)}</b></span>
          </summary>
          <div class="admin-bet-finance">
            <span>Potential payout <b>${money(bet.potential_payout)}</b></span>
            <span>Settled payout <b>${money(bet.settled_payout)}</b></span>
          </div>
          ${(bet.legs || []).map(leg => `
            <div class="admin-bet-leg">
              <span>${escapeHtml(leg.event)} — ${escapeHtml(leg.selection_label)}</span>
              <span>${escapeHtml(leg.market_name)} · ${Number(leg.odds).toFixed(2)} · ${escapeHtml(leg.result)}</span>
            </div>`).join('')}
        </details>`).join('') : '<div class="panel-empty">This user has not placed any bets.</div>'}</div>

      <h3 class="admin-subtitle">Wallet activity</h3>
      <div class="admin-wallet-list">${transactions.length ? transactions.map(tx => `
        <div class="admin-wallet-row">
          <div><strong>${escapeHtml(tx.description)}</strong><span>${new Date(tx.created_at).toLocaleString()}</span></div>
          <div><b class="${Number(tx.amount) >= 0 ? 'credit' : 'debit'}">${Number(tx.amount) >= 0 ? '+' : ''}${money(tx.amount)}</b><span>Balance ${money(tx.balance_after)}</span></div>
        </div>`).join('') : '<div class="panel-empty">No wallet activity.</div>'}</div>`;

    container.querySelector('.admin-back').addEventListener('click', closeAdminUser);
    container.querySelector('#adminCreditForm').addEventListener('submit', event => adjustAdminCredits(event, userId));
    container.querySelector('#adminSuspensionForm').addEventListener('submit', event => setAdminSuspension(event, userId, !profile.betting_suspended_at));
    container.querySelector('#adminUserControlsForm').addEventListener('submit', event => updateAdminUserControls(event, userId));
  }

  function closeAdminUser() {
    document.getElementById('adminUserDetails').hidden = true;
    document.getElementById('adminUsers').hidden = false;
  }

  async function adjustAdminCredits(event, userId) {
    event.preventDefault();
    const submit = event.submitter;
    const direction = Number(document.getElementById('adminCreditDirection').value);
    const amount = Number(document.getElementById('adminCreditAmount').value) * direction;
    const reason = document.getElementById('adminCreditReason').value.trim();
    const action = amount > 0 ? 'add' : 'deduct';
    if (!window.confirm(`${action === 'add' ? 'Add' : 'Deduct'} ${money(Math.abs(amount))} ${action === 'add' ? 'to' : 'from'} this demo wallet?`)) return;
    submit.disabled = true;
    const { error } = await client.rpc('admin_adjust_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason
    });
    submit.disabled = false;
    if (error) return notify(error.message, true);
    notify('Demo wallet adjusted and logged.');
    await Promise.all([openAdminUser(userId), loadAdminDashboard()]);
  }

  async function setAdminSuspension(event, userId, suspended) {
    event.preventDefault();
    const reasonInput = document.getElementById('adminSuspensionReason');
    const reason = reasonInput ? reasonInput.value.trim() : 'Betting access restored by administrator';
    if (!window.confirm(suspended ? 'Suspend this user from placing new bets?' : 'Restore betting access for this user?')) return;
    const submit = event.submitter;
    submit.disabled = true;
    const { error } = await client.rpc('admin_set_betting_suspension', {
      p_user_id: userId,
      p_suspended: suspended,
      p_reason: reason
    });
    submit.disabled = false;
    if (error) return notify(error.message, true);
    notify(suspended ? 'Betting suspended.' : 'Betting access restored.');
    await Promise.all([openAdminUser(userId), loadAdminUsers(), loadAdminAudit()]);
    document.getElementById('adminUsers').hidden = true;
    document.getElementById('adminUserDetails').hidden = false;
  }

  async function updateAdminUserControls(event, userId) {
    event.preventDefault();
    const submit = event.submitter;
    const tags = document.getElementById('adminUserTags').value
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
    submit.disabled = true;
    const { error } = await client.rpc('admin_update_user_controls', {
      p_user_id: userId,
      p_daily_stake_limit: Number(document.getElementById('adminDailyStakeLimit').value),
      p_admin_note: document.getElementById('adminUserNote').value.trim(),
      p_tags: tags
    });
    submit.disabled = false;
    if (error) return notify(error.message, true);
    notify('Player controls and internal notes saved.');
    await Promise.all([openAdminUser(userId), loadAdminAudit()]);
  }

  async function loadAdminAudit() {
    const container = document.getElementById('adminAudit');
    container.innerHTML = '<div class="panel-empty">Loading audit trail…</div>';
    const { data, error } = await client.rpc('admin_audit_feed', { p_limit: 200 });
    if (error) {
      container.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    adminAuditRows = data || [];
    renderFilteredAudit();
  }

  function getFilteredAuditRows() {
    const query = document.getElementById('adminAuditQuery')?.value.trim().toLowerCase() || '';
    const type = document.getElementById('adminAuditType')?.value || 'all';
    return adminAuditRows.filter(item => {
      const action = String(item.action || '').toLowerCase();
      const matchesType = type === 'all' || action.includes(`${type}.`) ||
        (type === 'wallet' && action.includes('adjust')) ||
        (type === 'event' && (action.includes('selection') || action.includes('market')));
      const haystack = `${item.action} ${item.admin_name} ${item.admin_email} ${JSON.stringify(item.details || {})}`.toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  }

  function renderFilteredAudit() {
    const container = document.getElementById('adminAudit');
    if (!container) return;
    const rows = getFilteredAuditRows();
    container.innerHTML = rows.length ? `
      <div class="ops-result-count">${rows.length} of ${adminAuditRows.length} audit entries</div>
      ${rows.map(item => `
      <article class="admin-audit-row">
        <i class="fa-solid ${item.action.includes('wallet') ? 'fa-coins' : item.action.includes('user.') ? 'fa-user-lock' : item.action.includes('event') ? 'fa-trophy' : 'fa-pen'}"></i>
        <div>
          <strong>${escapeHtml(item.action.replaceAll('.', ' '))}</strong>
          <span>${escapeHtml(item.admin_name)} (${escapeHtml(item.admin_email)}) · ${new Date(item.created_at).toLocaleString()}</span>
          ${item.details?.reason ? `<small>Reason: ${escapeHtml(item.details.reason)}</small>` : ''}
          ${item.details?.amount ? `<small>Amount: ${money(item.details.amount)} · Balance after: ${money(item.details.balance_after)}</small>` : ''}
        </div>
      </article>`).join('')}` : '<div class="panel-empty">No audit entries match these filters.</div>';
  }

  async function loadAdminDashboard() {
    const eventsContainer = document.getElementById('adminEvents');
    eventsContainer.innerHTML = '<div class="panel-empty">Loading operations…</div>';
    const { data, error } = await client.rpc('admin_dashboard');
    if (error) {
      eventsContainer.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
      return;
    }
    const events = data?.events || [];
    eventsContainer.innerHTML = events.length ? events.map(event => `
      <article class="admin-event" data-event-id="${event.id}">
        <div class="admin-event-head">
          <div><strong>${escapeHtml(event.home_team)} vs ${escapeHtml(event.away_team)}</strong><span>${escapeHtml(event.sport)} · ${escapeHtml(event.league)} · ${new Date(event.starts_at).toLocaleString()}</span></div>
          <b>${escapeHtml(event.status)}</b>
        </div>
        <div class="ops-event-controls">
          <label>Event
            <select data-event-status><option value="scheduled" ${event.status === 'scheduled' ? 'selected' : ''}>Scheduled</option><option value="live" ${event.status === 'live' ? 'selected' : ''}>Live</option></select>
          </label>
          <label>Markets
            <select data-market-status><option value="open" ${event.selections?.some(selection => selection.is_active) ? 'selected' : ''}>Open</option><option value="suspended" ${event.selections?.some(selection => selection.is_active) ? '' : 'selected'}>Suspended</option></select>
          </label>
          <button type="button" data-admin-action="save-state"><i class="fa-solid fa-floppy-disk"></i> Apply state</button>
        </div>
        <div class="admin-selections">
          ${(event.selections || []).map(selection => `
            <div class="admin-selection" data-selection-id="${selection.id}">
              <span>${escapeHtml(selection.label)}</span>
              <input type="number" min="1.01" max="1000" step=".01" value="${Number(selection.odds)}" aria-label="Odds for ${escapeHtml(selection.label)}">
              <label><input type="checkbox" ${selection.is_active ? 'checked' : ''}> Active</label>
              <button type="button" data-admin-action="save-odds">Save</button>
              <button type="button" data-admin-action="settle">Winner</button>
            </div>`).join('')}
        </div>
        <button class="admin-void" type="button" data-admin-action="void">Void event and refund</button>
      </article>`).join('') : '<div class="panel-empty">No scheduled or live events.</div>';

    eventsContainer.querySelectorAll('[data-admin-action]').forEach(button => {
      button.addEventListener('click', handleAdminAction);
    });
  }

  async function createAdminEvent(event) {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    const drawValue = document.getElementById('adminDrawOdds').value;
    const payload = {
      p_sport: document.getElementById('adminSport').value.trim(),
      p_league: document.getElementById('adminLeague').value.trim(),
      p_home_team: document.getElementById('adminHome').value.trim(),
      p_away_team: document.getElementById('adminAway').value.trim(),
      p_starts_at: new Date(document.getElementById('adminStarts').value).toISOString(),
      p_home_odds: Number(document.getElementById('adminHomeOdds').value),
      p_draw_odds: drawValue ? Number(drawValue) : null,
      p_away_odds: Number(document.getElementById('adminAwayOdds').value)
    };
    const { error } = await client.rpc('admin_create_event', payload);
    submit.disabled = false;
    if (error) return notify(error.message, true);
    event.target.reset();
    notify('Event created.');
    await Promise.all([loadAdminDashboard(), loadMarkets()]);
  }

  async function handleAdminAction(event) {
    const button = event.currentTarget;
    const action = button.dataset.adminAction;
    const eventCard = button.closest('.admin-event');
    const eventId = eventCard.dataset.eventId;
    button.disabled = true;
    let error;
    if (action === 'save-odds') {
      const row = button.closest('.admin-selection');
      ({ error } = await client.rpc('admin_update_selection', {
        p_selection_id: row.dataset.selectionId,
        p_odds: Number(row.querySelector('input[type="number"]').value),
        p_is_active: row.querySelector('input[type="checkbox"]').checked
      }));
    } else if (action === 'save-state') {
      ({ error } = await client.rpc('admin_set_event_state', {
        p_event_id: eventId,
        p_event_status: eventCard.querySelector('[data-event-status]').value,
        p_market_status: eventCard.querySelector('[data-market-status]').value
      }));
    } else {
      const selectionId = action === 'settle' ? button.closest('.admin-selection').dataset.selectionId : null;
      const prompt = action === 'void'
        ? 'Void this event and refund eligible bets?'
        : 'Settle this event with this selection as the winner?';
      if (!window.confirm(prompt)) {
        button.disabled = false;
        return;
      }
      ({ error } = await client.rpc('admin_settle_event', {
        p_event_id: eventId,
        p_winning_selection_id: selectionId,
        p_void: action === 'void'
      }));
    }
    button.disabled = false;
    if (error) return notify(error.message, true);
    notify(action === 'save-odds' ? 'Odds updated.' : action === 'save-state' ? 'Event and market state updated.' : 'Event settled.');
    await Promise.all([loadAdminDashboard(), loadMarkets(), loadBetHistory(), loadOperationsOverview()]);
  }

  async function saveResponsiblePlay(event) {
    event.preventDefault();
    const payload = {
      p_daily_stake_limit: Number(document.getElementById('dailyLimit').value),
      p_session_reminder_minutes: Number(document.getElementById('sessionReminder').value),
      p_self_exclusion_days: document.getElementById('selfExclusion').value
        ? Number(document.getElementById('selfExclusion').value)
        : null
    };
    const { error } = await client.rpc('set_responsible_play', payload);
    if (error) return notify(error.message, true);
    document.getElementById('responsibleModal').classList.remove('open');
    notify('Responsible-play controls saved.');
  }

  async function init() {
    createAccountUi();
    wireDropdown();
    const { data: { session } } = await client.auth.getSession();
    await applySession(session);
    client.auth.onAuthStateChange((_event, nextSession) => {
      setTimeout(() => applySession(nextSession), 0);
    });
    if (!operationsPage) {
      await loadMarkets();
      startPublicMarketsRefresh();
    }
    window.dispatchEvent(new CustomEvent('ace:ready'));
  }

  window.AceBackend = {
    client,
    placeBets,
    loadMarkets,
    loadBetHistory,
    openWallet,
    openResponsiblePlay,
    openAdmin,
    getUser: () => currentUser,
    getProfile: () => currentProfile,
    isAdmin: () => currentUserIsAdmin
  };
  document.addEventListener('DOMContentLoaded', init);
})();