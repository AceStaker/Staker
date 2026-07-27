(function () {
  'use strict';

  const getBackend = () => window.AceBackend;
  const client = () => getBackend()?.client;
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
  const toast = (message, error = false) => {
    if (window.showToast) window.showToast(message, error);
    else window.alert(message);
  };

  let platform = {};
  let sessionDetail = { user: null, profile: null, isAdmin: false };
  let originalPlaceBets = null;

  async function loadPlatformStatus() {
    if (!client()) return;
    const { data, error } = await client().rpc('platform_status');
    if (error) return console.warn('Platform controls unavailable:', error.message);
    platform = data || {};
    applyPlatformStatus();
  }

  function enabled(key) {
    return platform[key]?.enabled !== false;
  }

  function applyPlatformStatus() {
    const existing = document.getElementById('maintenanceGate');
    if (platform.maintenance_mode?.enabled && !sessionDetail.isAdmin) {
      if (!existing) {
        document.body.insertAdjacentHTML('beforeend', `
          <div class="maintenance-gate" id="maintenanceGate">
            <div class="maintenance-card">
              <i class="fa-solid fa-screwdriver-wrench"></i>
              <h1>Ace Staker is under maintenance</h1>
              <p>${esc(platform.maintenance_mode.message || 'Scheduled maintenance is in progress. Please check back shortly.')}</p>
              <a class="feature-action" href="help.html">Visit support</a>
            </div>
          </div>`);
      }
    } else {
      existing?.remove();
    }

    const placeButton = document.getElementById('placeBetBtn');
    const livePage = typeof window.PAGE_FILTER !== 'undefined' && window.PAGE_FILTER === 'live';
    const bettingAvailable = enabled('sports_betting') && (!livePage || enabled('live_betting'));
    if (placeButton && !bettingAvailable) {
      placeButton.disabled = true;
      placeButton.textContent = livePage ? 'LIVE BETTING PAUSED' : 'SPORTSBOOK PAUSED';
    }

    if (!enabled('casino_lobby') && document.getElementById('casinoLobbyGrid')) {
      document.getElementById('casinoLobbyGrid').innerHTML =
        '<div class="feature-panel"><b>Casino demo lobby is temporarily unavailable.</b></div>';
    }
  }

  function enhanceFooters() {
    document.querySelectorAll('.footer-col').forEach(column => {
      if (column.querySelector('h5')?.textContent.trim().toLowerCase() !== 'support') return;
      if (column.querySelector('[data-policy-links]')) return;
      column.insertAdjacentHTML('beforeend', `
        <span data-policy-links hidden></span>
        <a href="terms.html">Terms of Use</a>
        <a href="privacy.html">Privacy Notice</a>
        <a href="betting-rules.html">Betting Rules</a>
        <a href="responsible-play.html">Responsible Play</a>`);
    });
  }

  function enhanceBetSlip() {
    const stake = document.getElementById('stakeSection');
    if (!stake || document.getElementById('acceptOddsChanges')) return;
    const place = document.getElementById('placeBetBtn');
    place.insertAdjacentHTML('beforebegin', `
      <label class="odds-consent">
        <input id="acceptOddsChanges" type="checkbox">
        <span>Accept updated odds automatically if the market changes before placement.</span>
      </label>
      <div class="odds-change-alert" id="oddsChangeAlert" hidden></div>`);

    originalPlaceBets = getBackend().placeBets;
    getBackend().placeBets = async function () {
      if (!enabled('sports_betting')) throw new Error('Sports betting is currently paused.');
      const state = window.AceUI?.getState();
      const selections = state?.selections || [];
      const ids = selections.map(item => item.selectionId).filter(Boolean);
      if (!ids.length) return originalPlaceBets();

      const { data, error } = await client()
        .from('market_selections')
        .select('id,odds,is_active,markets!inner(status,events!inner(status))')
        .in('id', ids);
      if (error) throw error;
      const current = new Map((data || []).map(item => [item.id, item]));
      const changed = selections.filter(item => {
        const latest = current.get(item.selectionId);
        return !latest || !latest.is_active || latest.markets.status !== 'open' ||
          !['scheduled', 'live'].includes(latest.markets.events.status) ||
          Math.abs(Number(latest.odds) - Number(item.odds)) >= .001;
      });

      if (changed.length) {
        const unavailable = changed.some(item => !current.get(item.selectionId)?.is_active);
        if (unavailable) {
          await getBackend().loadMarkets();
          throw new Error('A selection is no longer available. Your bet slip has been refreshed.');
        }
        changed.forEach(item => { item.odds = Number(current.get(item.selectionId).odds); });
        window.AceUI.renderAllMarkets();
        const alert = document.getElementById('oddsChangeAlert');
        if (alert) {
          alert.hidden = false;
          alert.textContent = 'Odds changed. Review the updated potential return.';
        }
        if (!document.getElementById('acceptOddsChanges')?.checked) {
          throw new Error('Odds changed. Review the new return or enable “Accept updated odds.”');
        }
      }
      return originalPlaceBets();
    };
  }

  function enhanceLivePage() {
    if (!/Ace Staker \| Live/i.test(document.title) || document.getElementById('liveControlStrip')) return;
    const tabs = document.getElementById('sportTabs');
    tabs?.insertAdjacentHTML('afterend', `
      <section class="feature-panel" id="liveControlStrip">
        <div class="feature-panel-head"><div>
          <h2><i class="fa-solid fa-satellite-dish"></i> In-play center</h2>
          <p>Live scores, operator-updated match clocks, active markets, and server-validated demo odds.</p>
        </div><span class="status-chip warning"><i class="fa-solid fa-circle"></i>&nbsp; LIVE</span></div>
      </section>`);
  }

  function installPasswordReset() {
    const authSwitch = document.getElementById('authSwitch');
    if (!authSwitch || document.getElementById('forgotPassword')) return;
    authSwitch.insertAdjacentHTML('afterend',
      '<button class="auth-switch" type="button" id="forgotPassword">Forgot password?</button>');
    document.getElementById('forgotPassword').addEventListener('click', async () => {
      const field = document.getElementById('authEmail');
      const email = field?.value.trim() || window.prompt('Enter your account email');
      if (!email) return;
      const { error } = await client().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/home.html?recovery=1`
      });
      if (error) return toast(error.message, true);
      toast('Password-reset email sent. Check your inbox.');
    });

    if (!document.getElementById('passwordRecoveryModal')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay account-modal" id="passwordRecoveryModal" aria-hidden="true">
          <div class="modal glass auth-card">
            <h2><i class="fa-solid fa-key"></i> Choose a new password</h2>
            <p class="auth-subtitle">Use at least 8 characters.</p>
            <form id="passwordRecoveryForm" class="feature-form">
              <input id="newAccountPassword" type="password" minlength="8" required autocomplete="new-password" placeholder="New password">
              <input id="confirmAccountPassword" type="password" minlength="8" required autocomplete="new-password" placeholder="Confirm password">
              <button type="submit">Update password</button>
            </form>
          </div>
        </div>`);
      document.getElementById('passwordRecoveryForm').addEventListener('submit', async event => {
        event.preventDefault();
        const next = document.getElementById('newAccountPassword').value;
        const confirm = document.getElementById('confirmAccountPassword').value;
        if (next !== confirm) return toast('Passwords do not match.', true);
        const { error } = await client().auth.updateUser({ password: next });
        if (error) return toast(error.message, true);
        document.getElementById('passwordRecoveryModal').classList.remove('open');
        history.replaceState({}, '', 'home.html');
        toast('Password updated successfully.');
      });
    }
    client().auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') document.getElementById('passwordRecoveryModal')?.classList.add('open');
    });
  }

  async function loadExperience() {
    if (!sessionDetail.user) return;
    const { data: experience } = await client().rpc('account_experience');
    if (experience) {
      const rankText = document.getElementById('rankPillText');
      const level = document.getElementById('levelNum');
      const avatarLevel = document.getElementById('avatarLevel');
      const rankName = document.getElementById('rankName');
      const xpCurrent = document.getElementById('xpCurrent');
      const xpNeeded = document.getElementById('xpNeeded');
      const fill = document.getElementById('xpBarFill');
      if (rankText) rankText.textContent = experience.tier;
      if (level) level.textContent = experience.level;
      if (avatarLevel) avatarLevel.textContent = experience.level;
      if (rankName) rankName.textContent = `${experience.tier} Staker`;
      if (xpCurrent) xpCurrent.textContent = experience.points;
      if (xpNeeded) xpNeeded.textContent = experience.next_level_points;
      if (fill) fill.style.width = `${Math.min(100, (experience.points % 500) / 5)}%`;
    }
  }

  async function mountCashOut() {
    if (document.getElementById('cashOutModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay account-modal" id="cashOutModal" aria-hidden="true">
        <div class="modal glass account-panel wide-panel" role="dialog" aria-modal="true" aria-labelledby="cashOutTitle">
          <button class="modal-close" type="button" data-close-cashout aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
          <h2 id="cashOutTitle"><i class="fa-solid fa-money-bill-transfer"></i> Withdraw Balance</h2>
          <section class="feature-panel" id="cashOutPanel">
            <div class="feature-panel-head">
              <div><h3>Request a withdrawal</h3>
              <p>Enter an amount from your available balance. It will be reserved immediately and reviewed by an administrator.</p></div>
              <button class="feature-action" type="button" id="refreshCashOut">Refresh</button>
            </div>
            <form class="feature-form withdrawal-form" id="withdrawalForm">
              <label>Amount to withdraw (₹)
                <input id="withdrawalAmount" type="number" min="1" step="0.01" inputmode="decimal" required placeholder="0.00">
              </label>
              <button type="submit"><i class="fa-solid fa-paper-plane"></i> Request Withdrawal</button>
            </form>
            <div class="withdrawal-balance">Available balance <strong id="withdrawalBalance">₹0.00</strong></div>
            <p class="panel-note">Ace Staker currently uses demo credits. Approval records the request; no bank or payment-provider transfer is connected.</p>
            <h3 class="withdrawal-history-title">Your withdrawal requests</h3>
            <div id="cashOutList"><div class="panel-empty">Loading requests…</div></div>
          </section>
        </div>
      </div>`);
    document.getElementById('refreshCashOut').addEventListener('click', loadCashOuts);
    document.getElementById('withdrawalForm').addEventListener('submit', requestWithdrawal);
    document.querySelector('[data-close-cashout]').addEventListener('click', () => {
      document.getElementById('cashOutModal').classList.remove('open');
    });
    document.getElementById('cashOutModal').addEventListener('click', event => {
      if (event.target.id === 'cashOutModal') event.currentTarget.classList.remove('open');
    });
    await loadCashOuts();
  }

  async function openCashOut() {
    if (!sessionDetail.user) return window.openAceAuth(false);
    await mountCashOut();
    document.getElementById('cashOutModal').classList.add('open');
    await loadCashOuts();
  }

  async function loadCashOuts() {
    const list = document.getElementById('cashOutList');
    if (!list || !sessionDetail.user) return;
    if (!enabled('cash_out')) {
      list.innerHTML = '<div class="panel-empty">Withdrawals are currently disabled.</div>';
      const disabledButton = document.getElementById('withdrawalForm')?.querySelector('button');
      if (disabledButton) disabledButton.disabled = true;
      return;
    }
    const formButton = document.getElementById('withdrawalForm')?.querySelector('button');
    if (formButton) formButton.disabled = false;
    list.innerHTML = '<div class="panel-empty">Loading requests…</div>';
    const [{ data: wallet, error: walletError }, { data, error }] = await Promise.all([
      client().from('wallets').select('balance').single(),
      client().from('withdrawal_requests')
        .select('id,amount,currency,status,requested_at,reviewed_at,admin_note')
        .order('requested_at', { ascending: false }).limit(30)
    ]);
    if (walletError || error) {
      const problem = walletError || error;
      list.innerHTML = `<div class="panel-empty">${esc(problem.message)}</div>`;
      return;
    }
    const available = Number(wallet?.balance || 0);
    const balance = document.getElementById('withdrawalBalance');
    const amount = document.getElementById('withdrawalAmount');
    if (balance) balance.textContent = money(available);
    if (amount) amount.max = String(available);
    list.innerHTML = data?.length ? data.map(request => {
      const reviewed = request.reviewed_at
        ? ` · Reviewed ${new Date(request.reviewed_at).toLocaleString()}`
        : '';
      return `<div class="cashout-row">
        <div><strong>${money(request.amount)}</strong>
          <small>Requested ${new Date(request.requested_at).toLocaleString()}${reviewed}</small>
          ${request.admin_note ? `<small>Admin note: ${esc(request.admin_note)}</small>` : ''}
        </div>
        <div class="cashout-offer"><span class="status-chip ${request.status === 'approved' ? 'healthy' : request.status === 'rejected' ? 'danger' : 'warning'}">${esc(request.status)}</span></div>
      </div>`;
    }).join('') : '<div class="panel-empty">No withdrawal requests yet.</div>';
  }

  async function requestWithdrawal(event) {
    event.preventDefault();
    if (!sessionDetail.user) return window.openAceAuth(false);
    const amount = Number(document.getElementById('withdrawalAmount').value);
    if (!Number.isFinite(amount) || amount < 1) return toast('Enter a valid withdrawal amount.', true);
    if (!window.confirm(`Request a withdrawal of ${money(amount)} from your available balance?`)) return;
    const submit = event.submitter;
    submit.disabled = true;
    const { data: result, error } = await client().rpc('request_withdrawal', { p_amount: amount });
    submit.disabled = false;
    if (error) return toast(error.message, true);
    document.getElementById('withdrawalAmount').value = '';
    window.AceUI?.setBalance(result.balance);
    window.AceUI?.updateBalanceDisplay();
    await loadCashOuts();
    toast(`Withdrawal request for ${money(result.amount)} is awaiting administrator approval.`);
  }

  async function mountPromotions() {
    const grid = document.getElementById('promoGrid');
    if (!grid || document.getElementById('promotionRedeemer')) return;
    grid.insertAdjacentHTML('beforebegin', `
      <section class="feature-panel" id="promotionRedeemer">
        <div class="feature-panel-head"><div><h2><i class="fa-solid fa-ticket"></i> Promo codes</h2>
        <p>Redeem account-backed demo-credit rewards.</p></div></div>
        <form class="feature-form two-column" id="promotionForm">
          <label>Promotion code<input id="promotionCode" maxlength="30" placeholder="WELCOME500" required></label>
          <button type="submit">Redeem demo reward</button>
        </form>
        <div class="feature-grid" id="livePromotionCards"></div>
      </section>`);
    const { data } = await client().from('promotions')
      .select('code,title,description,reward_amount,ends_at').order('reward_amount', { ascending: false });
    document.getElementById('livePromotionCards').innerHTML = (data || []).map(promo => `
      <article class="feature-card">
        <span class="tier-chip">${esc(promo.code)}</span>
        <strong>${esc(promo.title)}</strong><span>${esc(promo.description)}</span>
        <div class="feature-value">${money(promo.reward_amount)}</div>
      </article>`).join('');
    document.getElementById('promotionForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!sessionDetail.user) return window.openAceAuth(false);
      if (!enabled('promotions')) return toast('Promotions are currently paused.', true);
      const submit = event.submitter;
      submit.disabled = true;
      const { data: result, error } = await client().rpc('redeem_promotion', {
        p_code: document.getElementById('promotionCode').value
      });
      submit.disabled = false;
      if (error) return toast(error.message, true);
      window.AceUI?.setBalance(result.balance);
      window.AceUI?.updateBalanceDisplay();
      event.target.reset();
      toast(`${result.title}: ${money(result.reward)} added.`);
    });
  }

  async function mountSupport() {
    const faq = document.getElementById('faqList');
    if (!faq || document.getElementById('supportCenter')) return;
    faq.insertAdjacentHTML('afterend', `
      <section class="feature-panel" id="supportCenter">
        <div class="feature-panel-head"><div><h2><i class="fa-solid fa-headset"></i> Support center</h2>
        <p>Create a tracked support request. Responsible-play cases are prioritized.</p></div></div>
        <form class="feature-form two-column" id="supportTicketForm">
          <label>Category<select id="supportCategory">
            <option value="account">Account</option><option value="bet">Bet</option>
            <option value="wallet">Demo wallet</option><option value="technical">Technical</option>
            <option value="responsible_play">Responsible play</option><option value="other">Other</option>
          </select></label>
          <label>Subject<input id="supportSubject" minlength="4" maxlength="120" required></label>
          <label style="grid-column:1/-1">Message<textarea id="supportMessage" maxlength="2000" required></textarea></label>
          <button type="submit">Create ticket</button>
        </form>
        <div id="mySupportTickets"></div>
      </section>`);
    document.getElementById('supportTicketForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!sessionDetail.user) return window.openAceAuth(false);
      if (!enabled('support')) return toast('Support tickets are temporarily unavailable.', true);
      const submit = event.submitter;
      submit.disabled = true;
      const { error } = await client().rpc('create_support_ticket', {
        p_subject: document.getElementById('supportSubject').value,
        p_category: document.getElementById('supportCategory').value,
        p_message: document.getElementById('supportMessage').value
      });
      submit.disabled = false;
      if (error) return toast(error.message, true);
      event.target.reset();
      toast('Support ticket created.');
      loadMyTickets();
    });
    await loadMyTickets();
  }

  async function loadMyTickets() {
    const list = document.getElementById('mySupportTickets');
    if (!list || !sessionDetail.user) return;
    const { data, error } = await client().from('support_tickets')
      .select('id,subject,category,status,priority,created_at,support_messages(author_kind,message,created_at)')
      .order('updated_at', { ascending: false }).limit(30);
    if (error) return;
    list.innerHTML = data?.length ? `<h3>Your tickets</h3>${data.map(ticket => `
      <article class="ticket-row"><div><strong>${esc(ticket.subject)}</strong>
      <small>${esc(ticket.category.replace('_',' '))} · ${new Date(ticket.created_at).toLocaleString()}</small>
      <small>${ticket.support_messages.length} message(s)</small></div>
      <div><span class="priority-chip ${esc(ticket.priority)}">${esc(ticket.priority)}</span>
      <span class="status-chip">${esc(ticket.status)}</span></div></article>`).join('')}` : '';
  }

  async function loadMatchPage() {
    const root = document.getElementById('matchDetailRoot');
    if (!root) return;
    const eventId = new URLSearchParams(location.search).get('event');
    if (!eventId) {
      root.innerHTML = '<div class="feature-panel">Choose a match from Sports or Live to view its details.</div>';
      return;
    }
    const { data, error } = await client().from('events')
      .select('id,sport,league,home_team,away_team,starts_at,status,live_score,live_clock,markets(id,name,market_type,status,market_selections(id,outcome_key,label,odds,is_active))')
      .eq('id', eventId).single();
    if (error) {
      root.innerHTML = `<div class="feature-panel">${esc(error.message)}</div>`;
      return;
    }
    const openSelections = data.markets.flatMap(market =>
      market.market_selections.filter(selection => market.status === 'open' && selection.is_active));
    const firstMarket = data.markets.find(market => market.status === 'open');
    const match = {
      id: 9001, eventId: data.id, sport: data.sport, league: data.league,
      team1: data.home_team, team2: data.away_team, live_score: data.live_score || '—',
      status: data.status === 'live' ? 'Live' : `Upcoming ${new Date(data.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      trend: { home: 50, draw: 0, away: 50 }, odds: { home: null, draw: null, away: null }, selectionIds: {}
    };
    openSelections.forEach(selection => {
      if (selection.outcome_key in match.odds) {
        match.odds[selection.outcome_key] = Number(selection.odds);
        match.selectionIds[selection.outcome_key] = selection.id;
      }
    });
    window.AceUI?.replaceMarkets([match], [{ key: 'All', icon: 'fa-trophy' }]);
    window.AceUI?.renderAllMarkets();
    root.innerHTML = `
      <section class="match-hero">
        <div class="match-hero-top"><span>${esc(data.sport)} · ${esc(data.league)}</span>
        <span class="status-chip ${data.status === 'live' ? 'warning' : ''}">${esc(data.status)}</span></div>
        <div class="match-hero-teams"><div>${esc(data.home_team)}</div>
          <div class="match-hero-score">${esc(data.live_score || 'VS')}</div><div>${esc(data.away_team)}</div></div>
        <div class="match-stat-strip">
          <div class="match-stat"><b>${data.markets.length}</b><span>Markets</span></div>
          <div class="match-stat"><b>${openSelections.length}</b><span>Selections</span></div>
          <div class="match-stat"><b>${data.status === 'live' ? (data.live_clock !== null ? `${data.live_clock}'` : 'IN PLAY') : new Date(data.starts_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</b><span>Match state</span></div>
          <div class="match-stat"><b>Demo</b><span>Data mode</span></div>
        </div>
      </section>
      ${data.markets.map(market => `<section class="feature-panel market-group">
        <div class="feature-panel-head"><div><h3>${esc(market.name)}</h3>
        <p>${esc(market.market_type)} · ${esc(market.status)}</p></div></div>
        <div class="market-options">${market.market_selections.map(selection => `
          <button class="odds-btn ${!selection.is_active ? 'disabled' : ''}"
            data-match-selection="${selection.id}" data-pick="${esc(selection.outcome_key)}"
            data-label="${esc(selection.label)}" data-odds="${Number(selection.odds)}">
            <span class="odds-label">${esc(selection.label)}</span>
            <span class="odds-val">${Number(selection.odds).toFixed(2)}</span>
          </button>`).join('')}</div>
      </section>`).join('')}
      <div class="feature-panel"><b>Match statistics provider:</b>
        <span> Awaiting a licensed live-data integration. No fabricated team or player statistics are displayed.</span></div>`;
    root.querySelectorAll('[data-match-selection]:not(.disabled)').forEach(button => {
      button.addEventListener('click', () => {
        window.AceUI.addSelection({
          matchId: 9001, pick: button.dataset.pick, label: button.dataset.label,
          odds: Number(button.dataset.odds), selectionId: button.dataset.matchSelection
        });
        toast(`${button.dataset.label} added to the bet slip.`);
      });
    });
  }

  function activateExtendedAdminTab(name) {
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === name));
    document.querySelectorAll('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === name));
  }

  async function mountOperationsExtensions(attempt = 0) {
    if (!document.body.classList.contains('operations-page')) return;
    const workspace = document.querySelector('.operations-workspace');
    if (!workspace) {
      if (attempt < 30) setTimeout(() => mountOperationsExtensions(attempt + 1), 100);
      return;
    }
    if (document.querySelector('[data-admin-tab="platform"]')) return;
    const tabs = workspace.querySelector('.admin-tabs');
    tabs.insertAdjacentHTML('beforeend', `
      <button type="button" data-admin-tab="cashouts"><i class="fa-solid fa-money-bill-transfer"></i><span><b>Withdrawals</b><small>Approve balance requests</small></span></button>
      <button type="button" data-admin-tab="risk"><i class="fa-solid fa-shield-halved"></i><span><b>Risk</b><small>Suspicious activity</small></span></button>
      <button type="button" data-admin-tab="support"><i class="fa-solid fa-headset"></i><span><b>Support</b><small>Tickets and replies</small></span></button>
      <button type="button" data-admin-tab="platform"><i class="fa-solid fa-toggle-on"></i><span><b>Platform</b><small>Features and maintenance</small></span></button>
      <button type="button" data-admin-tab="health"><i class="fa-solid fa-heart-pulse"></i><span><b>System health</b><small>Database and workflows</small></span></button>
      <button type="button" data-admin-tab="odds-feed"><i class="fa-solid fa-cloud-arrow-down"></i><span><b>Odds feed</b><small>The Odds API sync</small></span></button>
      <button type="button" data-admin-tab="live-control"><i class="fa-solid fa-satellite-dish"></i><span><b>Live control</b><small>Scores and event state</small></span></button>`);
    workspace.insertAdjacentHTML('beforeend', `
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="cashouts"><div id="adminCashoutsPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="risk"><div id="adminRiskPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="support"><div id="adminSupportPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="platform"><div id="adminPlatformPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="health"><div id="adminHealthPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="odds-feed"><div id="adminOddsFeedPanel"></div></section>
      <section class="admin-tab-panel admin-extension-panel" data-admin-panel="live-control"><div id="adminLivePanel"></div></section>`);
    tabs.querySelectorAll('[data-admin-tab="cashouts"],[data-admin-tab="risk"],[data-admin-tab="support"],[data-admin-tab="platform"],[data-admin-tab="health"],[data-admin-tab="odds-feed"],[data-admin-tab="live-control"]')
      .forEach(button => button.addEventListener('click', async () => {
        activateExtendedAdminTab(button.dataset.adminTab);
        if (button.dataset.adminTab === 'cashouts') await loadAdminCashouts();
        if (button.dataset.adminTab === 'risk') await loadAdminRisk();
        if (button.dataset.adminTab === 'support') await loadAdminSupport();
        if (button.dataset.adminTab === 'platform') await loadAdminPlatform();
        if (button.dataset.adminTab === 'health') await loadAdminHealth();
        if (button.dataset.adminTab === 'odds-feed') await loadAdminOddsFeed();
        if (button.dataset.adminTab === 'live-control') await loadAdminLive();
      }));
  }

  async function loadAdminCashouts() {
    const root = document.getElementById('adminCashoutsPanel');
    root.innerHTML = '<div class="panel-empty">Loading withdrawal requests…</div>';
    const { data, error } = await client().rpc('admin_list_withdrawals', { p_status: 'pending' });
    if (error) { root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`; return; }
    root.innerHTML = `<section class="feature-panel"><div class="feature-panel-head"><div><h2>Withdrawal approvals</h2><p>Review funds already reserved from each player's available balance. Rejecting restores them automatically.</p></div></div>
      <div>${data?.length ? data.map(row => `<div class="cashout-row"><div><strong>${money(row.amount)}</strong><small>${esc(row.display_name)} · ${esc(row.email)} · ${new Date(row.requested_at).toLocaleString()}</small></div><div class="cashout-offer"><button class="feature-action" data-review="${row.id}" data-approve="true">Approve</button><button class="feature-action danger" data-review="${row.id}" data-approve="false">Reject</button></div></div>`).join('') : '<div class="panel-empty">No pending withdrawal requests.</div>'}</div></section>`;
    root.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', async () => {
      const approved = button.dataset.approve === 'true';
      if (!window.confirm(`${approved ? 'Approve' : 'Reject'} this withdrawal request?`)) return;
      button.disabled = true;
      const { error: reviewError } = await client().rpc('review_withdrawal',{
        p_request_id:button.dataset.review,
        p_approve:approved,
        p_note:null
      });
      if (reviewError) toast(reviewError.message,true); else { toast(`Withdrawal ${approved ? 'approved' : 'rejected'}.`); await loadAdminCashouts(); }
    }));
  }

  function renderOddsPreview(root, feed) {
    const quota = feed.quota || {};
    const quotaValue = Number.isFinite(quota.remaining) ? quota.remaining.toLocaleString() : 'Unavailable';
    root.querySelector('#oddsFeedQuota').textContent = quotaValue;
    root.querySelector('#oddsFeedFetched').textContent = new Date(feed.fetched_at).toLocaleString();
    root.querySelector('#oddsFeedPreview').innerHTML = feed.events.length
      ? feed.events.map(item => `<article class="provider-event-card">
          <div><span class="tier-chip">${esc(item.sport)}</span>
            <strong>${esc(item.home_team)} <span>vs</span> ${esc(item.away_team)}</strong>
            <small>${esc(item.bookmaker)} · ${new Date(item.starts_at).toLocaleString()}</small>
          </div>
          <div class="provider-odds">${item.outcomes.map(outcome =>
            `<span><small>${esc(outcome.name)}</small><b>${Number(outcome.price).toFixed(2)}</b></span>`
          ).join('')}</div>
        </article>`).join('')
      : '<div class="panel-empty">The provider returned no moneyline events for this selection.</div>';
  }

  async function loadAdminOddsFeed() {
    const root = document.getElementById('adminOddsFeedPanel');
    root.innerHTML = `<div class="feature-panel">
      <div class="feature-panel-head"><div>
        <h2>The Odds API</h2>
        <p>Preview and import real moneyline events into the demo sportsbook. One preview refresh costs one provider credit unless served from cache.</p>
      </div><span class="status-chip healthy">SERVER-PROTECTED KEY</span></div>
      <form class="feature-form provider-sync-form" id="oddsFeedForm">
        <label>Feed
          <select id="oddsFeedSport">
            <option value="upcoming">Next 8 events across sports</option>
            <option value="cricket_ipl">Cricket · IPL</option>
            <option value="basketball_nba">Basketball · NBA</option>
            <option value="baseball_mlb">Baseball · MLB</option>
            <option value="americanfootball_nfl">American Football · NFL</option>
            <option value="soccer_epl">Football · Premier League</option>
            <option value="soccer_uefa_champs_league">Football · Champions League</option>
          </select>
        </label>
        <label>Bookmaker region
          <select id="oddsFeedRegion">
            <option value="uk">United Kingdom</option>
            <option value="eu">Europe</option>
            <option value="us">United States</option>
            <option value="au">Australia</option>
          </select>
        </label>
        <button type="submit"><i class="fa-solid fa-rotate"></i> Preview feed</button>
        <button type="button" class="feature-action" id="oddsFeedImport" disabled>
          <i class="fa-solid fa-cloud-arrow-down"></i> Import to sportsbook
        </button>
      </form>
      <div class="provider-feed-stats">
        <div><small>Credits remaining</small><strong id="oddsFeedQuota">—</strong></div>
        <div><small>Feed retrieved</small><strong id="oddsFeedFetched">Not yet</strong></div>
        <div><small>Market</small><strong>Moneyline · Decimal</strong></div>
      </div>
      <div id="oddsFeedMessage" class="panel-note">Choose a feed and preview it before importing.</div>
      <div id="oddsFeedPreview" class="provider-event-list"></div>
    </div>`;

    let currentFeed = null;
    const form = document.getElementById('oddsFeedForm');
    const importButton = document.getElementById('oddsFeedImport');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = event.submitter;
      submit.disabled = true;
      importButton.disabled = true;
      document.getElementById('oddsFeedMessage').textContent = 'Requesting the protected provider feed…';
      document.getElementById('oddsFeedPreview').innerHTML = '<div class="panel-empty">Loading current odds…</div>';
      try {
        const params = new URLSearchParams({
          sport: document.getElementById('oddsFeedSport').value,
          region: document.getElementById('oddsFeedRegion').value
        });
        const response = await fetch(`/api/odds?${params}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load provider odds.');
        currentFeed = payload;
        renderOddsPreview(root, payload);
        importButton.disabled = !payload.events.length;
        document.getElementById('oddsFeedMessage').textContent =
          `${payload.events.length} event(s) ready from ${payload.provider}. Review them before importing.`;
      } catch (error) {
        currentFeed = null;
        document.getElementById('oddsFeedMessage').textContent = error.message;
        document.getElementById('oddsFeedPreview').innerHTML = '';
        toast(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });

    importButton.addEventListener('click', async () => {
      if (!currentFeed?.events?.length) return;
      if (!window.confirm(`Import ${currentFeed.events.length} provider event(s) and update matching odds?`)) return;
      importButton.disabled = true;
      const { data, error } = await client().rpc('admin_sync_odds_feed', {
        p_events: currentFeed.events
      });
      if (error) {
        importButton.disabled = false;
        return toast(error.message, true);
      }
      document.getElementById('oddsFeedMessage').textContent =
        `${data.events} event(s) and ${data.selections} selection(s) synchronized.`;
      await Promise.all([getBackend().loadMarkets(), loadAdminHealth()]);
      toast('The Odds API markets are now available in the demo sportsbook.');
    });
  }

  async function loadAdminPlatform() {
    const root = document.getElementById('adminPlatformPanel');
    root.innerHTML = '<div class="panel-empty">Loading platform controls…</div>';
    const { data, error } = await client().rpc('admin_platform_controls');
    if (error) return root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`;
    root.innerHTML = `<div class="feature-panel"><div class="feature-panel-head"><div>
      <h2>Maintenance &amp; feature switches</h2><p>Changes apply to the public site immediately.</p></div></div>
      ${data.map(control => `<div class="control-row">
        <div><strong>${esc(control.key.replaceAll('_',' '))}</strong><small>${esc(control.description)}</small></div>
        <label><input type="checkbox" data-platform-key="${esc(control.key)}" ${control.value.enabled ? 'checked' : ''}> Enabled</label>
      </div>`).join('')}</div>`;
    root.querySelectorAll('[data-platform-key]').forEach(input => {
      input.addEventListener('change', async () => {
        let message = null;
        if (input.dataset.platformKey === 'maintenance_mode' && input.checked) {
          message = window.prompt('Maintenance message', 'Scheduled maintenance is in progress.');
        }
        input.disabled = true;
        const { error: updateError } = await client().rpc('admin_update_platform_control', {
          p_key: input.dataset.platformKey, p_enabled: input.checked, p_message: message
        });
        input.disabled = false;
        if (updateError) {
          input.checked = !input.checked;
          return toast(updateError.message, true);
        }
        await loadPlatformStatus();
        toast('Platform control updated.');
      });
    });
  }

  async function loadAdminHealth() {
    const root = document.getElementById('adminHealthPanel');
    root.innerHTML = '<div class="panel-empty">Running health checks…</div>';
    const { data, error } = await client().rpc('admin_system_health');
    if (error) return root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`;
    const checks = [
      ['Platform', data.status, data.status === 'healthy' ? 'healthy' : 'warning'],
      ['Open bets', data.open_bets, ''],
      ['Stale live events', data.stale_live_events, data.stale_live_events ? 'warning' : 'healthy'],
      ['Suspended markets', data.suspended_markets, data.suspended_markets ? 'warning' : 'healthy'],
      ['Open support tickets', data.open_support_tickets, data.high_priority_tickets ? 'warning' : ''],
      ['Recent admin actions', data.recent_admin_actions, '']
    ];
    root.innerHTML = `<div class="feature-panel"><div class="feature-panel-head"><div><h2>System health</h2>
      <p>Database-backed workflow checks at ${new Date(data.database_time).toLocaleString()}.</p></div>
      <button class="feature-action" id="refreshAdminHealth">Run again</button></div>
      <div class="feature-grid">${checks.map(([label,value,status]) => `<div class="feature-card">
        <strong>${esc(label)}</strong><span class="status-chip ${status}">${esc(value)}</span>
      </div>`).join('')}</div>
      <div class="feature-card"><strong>Last market update</strong><span>${data.last_market_update ? new Date(data.last_market_update).toLocaleString() : 'No market update recorded'}</span></div>
    </div>`;
    document.getElementById('refreshAdminHealth').addEventListener('click', loadAdminHealth);
  }

  async function loadAdminRisk() {
    const root = document.getElementById('adminRiskPanel');
    root.innerHTML = '<div class="panel-empty">Evaluating account activity…</div>';
    const { data, error } = await client().rpc('admin_risk_feed', { p_limit: 100 });
    if (error) return root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`;
    root.innerHTML = `<div class="feature-panel"><div class="feature-panel-head"><div><h2>Suspicious-activity alerts</h2>
      <p>Rules flag rapid betting, high daily stake, and large wallet adjustments for review.</p></div></div>
      ${data.length ? data.map(alert => `<div class="risk-row"><div><strong>${esc(alert.display_name)} · ${esc(alert.email)}</strong>
      <small>${esc(alert.type.replaceAll('_',' '))}</small></div><div>
      <span class="priority-chip high">${Number(alert.bets_1h)} bets/hr</span>
      <span class="status-chip">${money(alert.stake_24h)} staked</span></div></div>`).join('') :
      '<div class="panel-empty">No accounts currently cross the review thresholds.</div>'}</div>`;
  }

  async function loadAdminSupport() {
    const root = document.getElementById('adminSupportPanel');
    root.innerHTML = '<div class="panel-empty">Loading support queue…</div>';
    const { data, error } = await client().rpc('admin_support_feed', { p_limit: 100 });
    if (error) return root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`;
    root.innerHTML = `<div class="feature-panel"><div class="feature-panel-head"><div><h2>Support queue</h2>
      <p>Review customer requests and send audited replies.</p></div></div>
      ${data.length ? data.map(ticket => `<article class="feature-card" data-admin-ticket="${ticket.id}">
        <div class="feature-panel-head"><div><strong>${esc(ticket.subject)}</strong>
          <small>${esc(ticket.display_name)} · ${esc(ticket.email)} · ${esc(ticket.category)}</small></div>
          <div><span class="priority-chip ${esc(ticket.priority)}">${esc(ticket.priority)}</span>
          <span class="status-chip">${esc(ticket.status)}</span></div></div>
        <div>${ticket.messages.map(message => `<p><b>${esc(message.author_kind)}:</b> ${esc(message.message)}</p>`).join('')}</div>
        <form class="feature-form" data-ticket-reply>
          <textarea maxlength="2000" required placeholder="Reply to this ticket"></textarea>
          <select><option value="waiting">Waiting for user</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="open">Open</option></select>
          <button type="submit">Send reply</button>
        </form></article>`).join('') : '<div class="panel-empty">The support queue is empty.</div>'}</div>`;
    root.querySelectorAll('[data-ticket-reply]').forEach(form => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const card = form.closest('[data-admin-ticket]');
        const submit = event.submitter;
        submit.disabled = true;
        const { error: replyError } = await client().rpc('admin_reply_support_ticket', {
          p_ticket_id: card.dataset.adminTicket,
          p_message: form.querySelector('textarea').value,
          p_status: form.querySelector('select').value
        });
        submit.disabled = false;
        if (replyError) return toast(replyError.message, true);
        toast('Support reply sent and logged.');
        loadAdminSupport();
      });
    });
  }

  async function loadAdminLive() {
    const root = document.getElementById('adminLivePanel');
    root.innerHTML = '<div class="panel-empty">Loading events…</div>';
    const { data, error } = await client().from('events')
      .select('id,sport,league,home_team,away_team,status,live_score,live_clock,updated_at')
      .in('status', ['scheduled','live']).order('starts_at');
    if (error) return root.innerHTML = `<div class="panel-empty">${esc(error.message)}</div>`;
    root.innerHTML = `<div class="feature-panel"><div class="feature-panel-head"><div><h2>In-play event control</h2>
      <p>Update demo scores and live state. A licensed feed should replace this manual control.</p></div></div>
      ${data.map(event => `<form class="feature-form two-column feature-card" data-live-event="${event.id}">
        <div><strong>${esc(event.home_team)} vs ${esc(event.away_team)}</strong><small>${esc(event.sport)} · ${esc(event.league)}</small></div>
        <label>Status<select><option value="scheduled" ${event.status === 'scheduled' ? 'selected':''}>Scheduled</option>
          <option value="live" ${event.status === 'live' ? 'selected':''}>Live</option>
          <option value="finished">Finished</option><option value="cancelled">Cancelled</option></select></label>
        <label>Score<input value="${esc(event.live_score || '')}" maxlength="40" placeholder="0 - 0"></label>
        <label>Match clock<input type="number" value="${event.live_clock ?? ''}" min="0" max="240" placeholder="Minute"></label>
        <button type="submit">Update event</button>
      </form>`).join('')}</div>`;
    root.querySelectorAll('[data-live-event]').forEach(form => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const submit = event.submitter;
        submit.disabled = true;
        const { error: updateError } = await client().rpc('admin_update_live_event', {
          p_event_id: form.dataset.liveEvent,
          p_live_score: form.querySelector('input:not([type=number])').value,
          p_event_status: form.querySelector('select').value,
          p_live_clock: form.querySelector('input[type=number]').value
            ? Number(form.querySelector('input[type=number]').value)
            : null
        });
        submit.disabled = false;
        if (updateError) return toast(updateError.message, true);
        toast('Live event updated.');
        loadAdminLive();
      });
    });
  }

  async function init() {
    if (!getBackend()) return;
    enhanceFooters();
    enhanceLivePage();
    installPasswordReset();
    enhanceBetSlip();
    await Promise.all([
      loadPlatformStatus(),
      mountPromotions(),
      mountSupport(),
      loadMatchPage(),
      mountOperationsExtensions()
    ]);
    sessionDetail = {
      user: getBackend().getUser(),
      profile: getBackend().getProfile(),
      isAdmin: getBackend().isAdmin()
    };
    applyPlatformStatus();
    if (sessionDetail.user) await Promise.all([loadExperience(), mountCashOut(), loadMyTickets()]);
  }

  window.AceCashOut = {
    open: openCashOut,
    refresh: loadCashOuts
  };

  window.addEventListener('ace:session', async event => {
    sessionDetail = event.detail;
    applyPlatformStatus();
    if (sessionDetail.user) await Promise.all([loadExperience(), mountCashOut(), loadMyTickets()]);
  });
  window.addEventListener('ace:ready', init, { once: true });
  if (document.readyState !== 'loading' && getBackend()) init();
})();
