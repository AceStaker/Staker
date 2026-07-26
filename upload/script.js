/* =========================================================
   ACE STAKER — APP LOGIC (Vanilla ES6+)
   Sections:
   1. Mock Data (matches, sports, history, promos, faq)
   2. State (incl. gamification: level/xp/rank/streak/achievements)
   3. Render: Ticker / Sport Tabs / Matches / Trending bars
   4. Bet Slip logic (add/remove, single vs parlay, combo boost, payout calc)
   5. Gamification engine: XP, levels, ranks, streaks, achievements, confetti
   6. Simulated live updates (odds, ticker, big-win feed) via setInterval
   7. Extra content: Promotions / FAQ render
   8. Modals, dropdown, theme toggle, mobile nav, smooth-scroll nav filters
   ========================================================= */

/* ---------- 1. MOCK DATA ---------- */
// Structure mirrors the spec: id, sport, league, teams, odds{home,draw,away}, live_score, status
let matches = [
  { id:1, sport:"Basketball", league:"NBA", team1:"Lakers", team2:"Celtics",
    odds:{ home:2.10, draw:null, away:1.85 }, live_score:"72 - 68", status:"Live", trend:{home:58,draw:0,away:42} },
  { id:2, sport:"Football", league:"UEFA Champions League", team1:"Real Madrid", team2:"Bayern Munich",
    odds:{ home:1.95, draw:3.40, away:2.15 }, live_score:"1 - 1", status:"Half Time", trend:{home:44,draw:20,away:36} },
  { id:3, sport:"Tennis", league:"ATP Masters", team1:"Alcaraz", team2:"Sinner",
    odds:{ home:1.65, draw:null, away:2.30 }, live_score:"2 - 1 (Sets)", status:"Live", trend:{home:63,draw:0,away:37} },
  { id:4, sport:"CS:GO", league:"ESL Pro League", team1:"NAVI", team2:"FaZe",
    odds:{ home:1.80, draw:null, away:2.05 }, live_score:"12 - 9", status:"Live", trend:{home:55,draw:0,away:45} },
  { id:5, sport:"League of Legends", league:"LCS Finals", team1:"T1", team2:"G2",
    odds:{ home:1.55, draw:null, away:2.55 }, live_score:"—", status:"Upcoming 18:30", trend:{home:69,draw:0,away:31} },
  { id:6, sport:"Football", league:"Premier League", team1:"Arsenal", team2:"Man City",
    odds:{ home:2.60, draw:3.20, away:2.50 }, live_score:"—", status:"Upcoming 20:00", trend:{home:35,draw:22,away:43} },
  { id:7, sport:"MMA", league:"UFC 315", team1:"Jones", team2:"Silva",
    odds:{ home:1.40, draw:null, away:2.95 }, live_score:"Round 2", status:"Live", trend:{home:74,draw:0,away:26} },
  { id:8, sport:"Baseball", league:"MLB", team1:"Yankees", team2:"Red Sox",
    odds:{ home:1.90, draw:null, away:1.95 }, live_score:"3 - 2", status:"Live", trend:{home:51,draw:0,away:49} },
  { id:9, sport:"Valorant", league:"VCT Americas", team1:"Sentinels", team2:"Fnatic",
    odds:{ home:2.05, draw:null, away:1.78 }, live_score:"—", status:"Upcoming 21:00", trend:{home:47,draw:0,away:53} },
  { id:10, sport:"Formula 1", league:"F1 Head-to-Head", team1:"Verstappen", team2:"Norris",
    odds:{ home:1.35, draw:null, away:3.20 }, live_score:"—", status:"Upcoming Sun 14:00", trend:{home:81,draw:0,away:19} },
];

let sports = [
  { key:"All", icon:"fa-layer-group" },
  { key:"Football", icon:"fa-futbol" },
  { key:"Basketball", icon:"fa-basketball" },
  { key:"Tennis", icon:"fa-table-tennis-paddle-ball" },
  { key:"CS:GO", icon:"fa-crosshairs" },
  { key:"League of Legends", icon:"fa-chess-rook" },
  { key:"Valorant", icon:"fa-gun" },
  { key:"MMA", icon:"fa-hand-fist" },
  { key:"Baseball", icon:"fa-baseball" },
  { key:"Formula 1", icon:"fa-flag-checkered" },
];

// ---------- MULTI-PAGE FILTERING ----------
// Ace Staker now lives across separate pages (casino.html, sports.html,
// live.html, esports.html, promotions.html, help.html). Each page's <head>
// sets `const PAGE_FILTER = "live" | "esports" | undefined;` before this
// file loads, so the shared mock data can be narrowed to what that page
// should show — without duplicating the render logic per page.
if(typeof PAGE_FILTER !== 'undefined'){
  if(PAGE_FILTER === 'live'){
    matches = matches.filter(m => m.status === 'Live');
  } else if(PAGE_FILTER === 'esports'){
    const esportsKeys = ["CS:GO","League of Legends","Valorant"];
    matches = matches.filter(m => esportsKeys.includes(m.sport));
    sports = sports.filter(s => s.key === 'All' || esportsKeys.includes(s.key));
    // state.activeSport already defaults to "All" below
  }
}

// Mock betting history for the profile modal
let historyData = [];

const promotions = [
  { icon:"fa-flask", tag:"DEMO", title:"₹10,000 Welcome Credits", desc:"Every confirmed demo account receives test credits with no cash value.", cta:"Create Demo Account" },
  { icon:"fa-bolt", tag:"TEST", title:"Parlay Lab", desc:"Combine two or more demo selections and inspect the server-calculated potential return.", cta:"Try Sports Demo" },
  { icon:"fa-shield-heart", tag:"SAFETY", title:"Set a Daily Limit", desc:"Choose a daily demo-stake limit, session reminder, or self-exclusion period.", cta:"Open Controls" },
  { icon:"fa-code", tag:"NEW", title:"Backend Connected", desc:"Authentication, wallet entries, odds snapshots, and bets are stored securely in Supabase.", cta:"Explore Demo" },
];

const faqData = [
  { q:"How do I read decimal odds?", a:"Decimal odds show your total return per ₹1 staked, including your original stake. Odds of 2.10 mean a ₹10 bet returns ₹21.00 total if it wins." },
  { q:"How does a parlay payout work?", a:"A parlay multiplies the decimal odds of every leg together into one combined price. All legs must win for the parlay to pay out." },
  { q:"Can I deposit or withdraw money?", a:"Not in this build. Ace Staker currently uses demo credits only. A licensed payment provider and verified operating setup are required before real-money payments can be added." },
  { q:"Can I cash out a live bet early?", a:"Not yet. Cash-out pricing and settlement require a real odds/provider integration and are intentionally disabled in this demo." },
  { q:"What is Ace Staker's approach to responsible gambling?", a:"The demo provides daily stake limits, self-exclusion, and session reminders. These controls remain important even before real-money features are considered." },
];

/* ---------- 2. STATE ---------- */
let state = {
  activeSport: "All",
  slipMode: "single",           // "single" | "parlay"
  selections: [],               // [{matchId, pick:'home'|'draw'|'away', label, odds}]
  stake: 0,
  balance: 0,

  // ---- Gamification state ----
  level: 12,
  xp: 640,
  streak: 3,                    // current win streak
  betsPlaced: 0,
  wins: 14,
  losses: 8,
  achievements: new Set(),       // ids of unlocked achievements
};
let backendMarketsActive = false;

// XP required to reach the next level scales up each level — simple RPG curve
function xpToNextLevel(level){ return level * 100; }

// Rank tiers derived purely from level — mirrors a game's "seasonal rank" ladder
const RANK_TIERS = [
  { min:1,  name:"Bronze Staker",   icon:"fa-shield-halved" },
  { min:5,  name:"Silver Staker",   icon:"fa-shield" },
  { min:10, name:"Gold Staker",     icon:"fa-crown" },
  { min:20, name:"Platinum Staker", icon:"fa-gem" },
  { min:30, name:"Diamond Staker",  icon:"fa-star" },
  { min:50, name:"Ace",             icon:"fa-spade" },
];
function getRank(level){
  let rank = RANK_TIERS[0];
  for(const tier of RANK_TIERS){ if(level >= tier.min) rank = tier; }
  return rank;
}

// Achievement definitions with a check() run after every relevant action
const ACHIEVEMENTS = [
  { id:"first-blood", name:"First Blood", desc:"Place your first bet", icon:"fa-star",
    check: s => s.betsPlaced >= 1 },
  { id:"parlay-master", name:"Parlay Master", desc:"Place a 3+ leg parlay", icon:"fa-layer-group",
    check: (s, ctx) => ctx && ctx.type === 'parlay' && ctx.legs >= 3 },
  { id:"hot-streak", name:"Hot Streak", desc:"Win 3 bets in a row", icon:"fa-fire",
    check: s => s.streak >= 3 },
  { id:"high-roller", name:"High Roller", desc:"Stake ₹500+ on one bet", icon:"fa-sack-dollar",
    check: (s, ctx) => ctx && ctx.stake >= 500 },
  { id:"comeback-kid", name:"Comeback Kid", desc:"Win right after a loss", icon:"fa-arrow-trend-up",
    check: (s, ctx) => ctx && ctx.comeback === true },
  { id:"ace-of-spades", name:"Ace of Spades", desc:"Reach Level 10", icon:"fa-spade",
    check: s => s.level >= 10 },
];

let lastBetResult = null; // tracks 'win'/'loss' of the previous resolved bet, powers Comeback Kid

/* ---------- 3. RENDER: SPORT TABS ---------- */
function renderSportTabs(){
  const wrap = document.getElementById('sportTabs');
  if(!wrap) return; // this page doesn't have a sport-tabs strip (e.g. Casino/Promotions/Help)
  wrap.innerHTML = sports.map(s => `
    <button class="sport-tab ${s.key === state.activeSport ? 'active':''}" data-sport="${s.key}">
      <i class="fa-solid ${s.icon}"></i> ${s.key}
    </button>
  `).join('');
  wrap.querySelectorAll('.sport-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.activeSport = btn.dataset.sport;
      renderSportTabs();
      renderMatches();
    });
  });
}

/* ---------- 3b. RENDER: TICKER ---------- */
function renderTicker(extraItems){
  const track = document.getElementById('tickerTrack');
  if(!track) return;
  const scoreItems = matches.map(m => `
    <span class="ticker-item" data-ticker-id="${m.id}">
      ${m.status === 'Live' ? '<span class="live-dot"></span>' : ''}
      <b>${m.team1} ${m.live_score} ${m.team2}</b> · ${m.league}
    </span>
  `);
  const winItems = (extraItems || tickerWinCache).map(w => `
    <span class="ticker-item win-item"><i class="fa-solid fa-trophy"></i> ${w}</span>
  `);
  const items = scoreItems.concat(winItems).join('');
  // Duplicate track content so the CSS -50% translate loop is seamless
  track.innerHTML = items + items;
}
let tickerWinCache = [
  "Alex_K won ₹2,140 on a 4-leg parlay",
  "MiaBets landed +₹860 on Lakers ML",
  "DraftKingpin cashed a ₹3,200 UFC underdog",
];

/* ---------- 3c. RENDER: MATCH LIST + ODDS + TRENDING BAR ---------- */
function renderMatches(){
  const list = document.getElementById('matchesList');
  if(!list) return; // this page has no matches list (e.g. Casino/Promotions/Help)
  const filtered = state.activeSport === "All" ? matches : matches.filter(m => m.sport === state.activeSport);

  if(filtered.length === 0){
    list.innerHTML = `<div class="slip-empty" style="padding:40px;">No matches for this sport right now.</div>`;
    return;
  }

  list.innerHTML = filtered.map(m => {
    const isSelected = (pick) => state.selections.some(s => s.matchId === m.id && s.pick === pick);
    const oddsBtn = (pick, label, value) => {
      if(value === null || value === undefined){
        return `<div class="odds-btn disabled"><span class="odds-label">${label}</span><span class="odds-val">—</span></div>`;
      }
      const movement = m.priceMovement?.[pick] || '';
      return `<button class="odds-btn ${isSelected(pick)?'selected':''} ${movement ? `price-${movement}` : ''}" data-match="${m.id}" data-pick="${pick}" data-odds="${value}" data-selection="${m.selectionIds?.[pick] || ''}" data-label="${label==='1'?m.team1:label==='2'?m.team2:'Draw'}">
                <span class="odds-label">${label}</span>
                <span class="odds-val" id="odds-${m.id}-${pick}">${value.toFixed(2)}</span>
              </button>`;
    };
    // "Hot" badge — cosmetic gaming touch flagging matches with lopsided crowd trends
    const isHot = m.trend.home >= 70 || m.trend.away >= 70;
    return `
    <div class="match-card glass">
      <div class="match-card-top">
        <div>
          <div class="match-meta">
            ${m.status === 'Live' ? `<span class="badge-live"><span class="live-dot"></span> LIVE</span>` : `<span class="badge-upcoming">${m.status}</span>`}
            ${m.status === 'Live' && m.live_clock !== null && m.live_clock !== undefined ? `<span class="badge-upcoming">${m.live_clock}'</span>` : ''}
            ${isHot ? `<span class="badge-hot"><i class="fa-solid fa-fire"></i> HOT PICK</span>` : ''}
            <span>${m.league}</span>
          </div>
          <div class="match-teams">
            <div class="team"><span class="team-logo">${abbr(m.team1)}</span>${m.team1}</div>
            <span class="vs">${m.status === 'Live' || m.live_score !== '—' ? m.live_score : 'vs'}</span>
            <div class="team">${m.team2}<span class="team-logo">${abbr(m.team2)}</span></div>
          </div>
        </div>
        <div class="odds-row">
          ${oddsBtn('home','1', m.odds.home)}
          ${oddsBtn('draw','X', m.odds.draw)}
          ${oddsBtn('away','2', m.odds.away)}
        </div>
      </div>
      <div class="trend-bar-wrap">
        <div class="trend-bar-labels">
          <span><b>${m.trend.home}%</b> ${m.team1}</span>
          ${m.odds.draw !== null ? `<span>${m.trend.draw}% Draw</span>` : ''}
          <span><b>${m.trend.away}%</b> ${m.team2}</span>
        </div>
        <div class="trend-bar">
          <div class="trend-seg-home" style="width:${m.trend.home}%"></div>
          ${m.odds.draw !== null ? `<div class="trend-seg-draw" style="width:${m.trend.draw}%"></div>` : ''}
          <div class="trend-seg-away" style="width:${m.trend.away}%"></div>
        </div>
      </div>
      ${m.eventId ? `<a class="match-detail-link" href="match.html?event=${encodeURIComponent(m.eventId)}">
        View all markets &amp; match details <i class="fa-solid fa-arrow-right"></i>
      </a>` : ''}
    </div>`;
  }).join('');

  // Wire up click-to-add-to-slip on every enabled odds button
  list.querySelectorAll('.odds-btn:not(.disabled)').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      addSelection({
        matchId: Number(btn.dataset.match),
        pick: btn.dataset.pick,
        label: btn.dataset.label,
        odds: Number(btn.dataset.odds),
        selectionId: btn.dataset.selection || null,
      });
    });
  });
}

function abbr(name){
  return name.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase();
}

/* ---------- 4. BET SLIP LOGIC ---------- */

// Adds or removes a selection. Selecting the same pick again removes it (toggle).
// Selecting a different pick on the same match replaces the old pick (can't bet both sides).
function addSelection(sel){
  const existingIdx = state.selections.findIndex(s => s.matchId === sel.matchId);
  if(existingIdx > -1 && state.selections[existingIdx].pick === sel.pick){
    // toggle off
    state.selections.splice(existingIdx,1);
  } else if(existingIdx > -1){
    // replace pick for that match
    state.selections[existingIdx] = sel;
  } else {
    state.selections.push(sel);
  }
  renderSlip();
  renderMatches(); // refresh highlighted odds buttons
}

function removeSelection(matchId){
  state.selections = state.selections.filter(s => s.matchId !== matchId);
  renderSlip();
  renderMatches();
}

/*
 * COMBO BOOST — "gaming logic" bonus multiplier layered on top of the parlay math.
 * The more legs chained together, the bigger the bonus — same shape as a
 * combo/streak multiplier in an arcade game. Boost is applied AFTER the
 * standard decimal-odds multiplication described below.
 *   2 legs   -> +0%
 *   3 legs   -> +5%
 *   4 legs   -> +12%
 *   5+ legs  -> +20%
 */
function getComboBoostPct(legCount){
  // Promotional boosts remain disabled until they are represented in the
  // server-side pricing and settlement rules.
  return 0;
}

function renderSlip(){
  const body = document.getElementById('slipBody');
  if(!body) return; // the Home page has no bet slip aside
  const empty = document.getElementById('slipEmptyState');
  const stakeSection = document.getElementById('stakeSection');
  const slipCount = document.getElementById('slipCount');
  const badge = document.getElementById('slipCountBadge');

  slipCount.textContent = state.selections.length ? `(${state.selections.length})` : '';
  badge.textContent = state.selections.length;
  badge.style.display = state.selections.length ? 'flex' : 'none';

  if(state.selections.length === 0){
    empty.style.display = 'block';
    stakeSection.style.display = 'none';
    // clear any per-item content
    body.innerHTML = '';
    body.appendChild(empty);
    return;
  }

  empty.style.display = 'none';
  stakeSection.style.display = 'block';

  // In "single" mode each selection gets its own stake input.
  // In "parlay" mode all selections combine into ONE stake with multiplied odds.
  body.innerHTML = state.selections.map(sel => {
    const match = matches.find(m => m.id === sel.matchId);
    return `
    <div class="slip-item">
      <button class="slip-item-remove" data-remove="${sel.matchId}"><i class="fa-solid fa-xmark"></i></button>
      <div class="slip-item-match">${match.team1} vs ${match.team2} · ${match.league}</div>
      <div class="slip-item-pick">${sel.label} <span style="color:var(--text-dim); font-weight:400;">(${sel.pick === 'draw' ? 'Draw' : sel.pick === 'home' ? '1' : '2'})</span></div>
      <div class="slip-item-odds">${sel.odds.toFixed(2)}</div>
      ${state.slipMode === 'single' ? `
        <div class="slip-single-stake">
          <input type="number" placeholder="Stake ₹" min="0" data-single-stake="${sel.matchId}" value="${sel.singleStake || ''}">
        </div>` : ''}
    </div>`;
  }).join('');

  body.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', ()=> removeSelection(Number(btn.dataset.remove)));
  });

  if(state.slipMode === 'single'){
    body.querySelectorAll('[data-single-stake]').forEach(input=>{
      input.addEventListener('input', (e)=>{
        const sel = state.selections.find(s => s.matchId === Number(e.target.dataset.singleStake));
        sel.singleStake = Number(e.target.value) || 0;
        updatePotentialReturn();
      });
    });
  }

  document.getElementById('parlayOddsSummary').style.display = state.slipMode === 'parlay' ? 'flex' : 'none';
  document.getElementById('stakeLabel').textContent = state.slipMode === 'parlay' ? 'Multi Stake' : 'Total Stake';

  updatePotentialReturn();
}

/*
 * CORE PAYOUT MATH
 * -----------------
 * SINGLE MODE: each selection is an independent bet with its own stake.
 *   Potential Return = Σ (stake_i × odds_i)  for every selection with a stake entered.
 *
 * PARLAY MODE: all selections combine into a single accumulator bet.
 *   Combined Odds = odds_1 × odds_2 × odds_3 × ... × odds_n   (decimal odds multiply)
 *   Base Return   = stake × Combined Odds
 *   Boosted Return = Base Return × (1 + comboBoostPct)   — see getComboBoostPct() above
 */
function calcCombinedOdds(){
  return state.selections.reduce((acc, s) => acc * s.odds, 1);
}

function updatePotentialReturn(){
  const stakeInput = document.getElementById('stakeInput');
  if(!stakeInput) return; // the Home page has no bet slip aside
  const returnEl = document.getElementById('potentialReturn');
  const combinedOddsEl = document.getElementById('combinedOdds');
  const placeBtn = document.getElementById('placeBetBtn');
  const comboBanner = document.getElementById('comboBanner');
  const comboBannerText = document.getElementById('comboBannerText');
  const comboBoostSummary = document.getElementById('comboBoostSummary');
  const comboBoostPctEl = document.getElementById('comboBoostPct');

  let potentialReturn = 0;

  if(state.slipMode === 'parlay'){
    const combined = calcCombinedOdds();
    combinedOddsEl.textContent = combined.toFixed(2);
    const stake = Number(stakeInput.value) || 0;
    const boostPct = getComboBoostPct(state.selections.length);
    const baseReturn = stake * combined;
    potentialReturn = baseReturn * (1 + boostPct);

    if(boostPct > 0){
      comboBanner.classList.add('show');
      comboBoostSummary.style.display = 'flex';
      comboBannerText.textContent = `${state.selections.length}-Leg Combo: +${Math.round(boostPct*100)}% Boost!`;
      comboBoostPctEl.textContent = `+${Math.round(boostPct*100)}%`;
    } else {
      comboBanner.classList.remove('show');
      comboBoostSummary.style.display = 'none';
    }
  } else {
    // single mode: sum each leg's own stake × its own odds (no combo boost in single mode)
    potentialReturn = state.selections.reduce((sum, s) => sum + ((s.singleStake||0) * s.odds), 0);
    const totalSingleStake = state.selections.reduce((sum, s) => sum + (s.singleStake || 0), 0);
    document.getElementById('stakeLabel').textContent = `Total Stake: ₹${totalSingleStake.toFixed(2)}`;
    comboBanner.classList.remove('show');
    comboBoostSummary.style.display = 'none';
  }

  returnEl.textContent = `₹${potentialReturn.toFixed(2)}`;

  // Enable Place Bet only when there's something staked
  const hasStake = state.slipMode === 'parlay'
    ? Number(stakeInput.value) > 0
    : state.selections.some(s => (s.singleStake||0) > 0);
  placeBtn.disabled = !(hasStake && state.selections.length > 0);
}

/* Slip mode toggle (Single / Parlay) */
function switchSlipMode(mode){
  state.slipMode = mode;
  const singleBtn = document.getElementById('singleModeBtn');
  const parlayBtn = document.getElementById('parlayModeBtn');
  if(!singleBtn || !parlayBtn) return; // the Home page has no bet slip aside
  singleBtn.classList.toggle('active', mode==='single');
  parlayBtn.classList.toggle('active', mode==='parlay');
  const sharedStake = document.querySelector('.stake-input-wrap');
  const quickBets = document.querySelector('.quick-bets');
  if(sharedStake) sharedStake.style.display = mode === 'parlay' ? 'block' : 'none';
  if(quickBets) quickBets.style.display = mode === 'parlay' ? 'flex' : 'none';
  renderSlip();
}

// All of the bet slip's interactive wiring only applies on pages that
// actually include the aside (every page except Home) — guard the whole
// block so it's skipped cleanly where #betslip doesn't exist.
if(document.getElementById('betslip')){
  const sharedStake = document.querySelector('.stake-input-wrap');
  const quickBets = document.querySelector('.quick-bets');
  if(sharedStake) sharedStake.style.display = 'none';
  if(quickBets) quickBets.style.display = 'none';

  document.getElementById('singleModeBtn').addEventListener('click', ()=> switchSlipMode('single'));
  document.getElementById('parlayModeBtn').addEventListener('click', ()=> switchSlipMode('parlay'));

  /* Stake input + quick bet buttons */
  document.getElementById('stakeInput').addEventListener('input', updatePotentialReturn);
  document.querySelectorAll('.quick-bets [data-add]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const stakeInput = document.getElementById('stakeInput');
      stakeInput.value = (Number(stakeInput.value)||0) + Number(btn.dataset.add);
      updatePotentialReturn();
    });
  });
  document.getElementById('maxBetBtn').addEventListener('click', ()=>{
    document.getElementById('stakeInput').value = state.balance.toFixed(2);
    updatePotentialReturn();
  });

  /* Place Bet button — also drives the gamification loop (XP, streaks, achievements) */
  document.getElementById('placeBetBtn').addEventListener('click', async ()=>{
    const placeButton = document.getElementById('placeBetBtn');
    const stake = state.slipMode === 'parlay'
      ? Number(document.getElementById('stakeInput').value)
      : state.selections.reduce((sum,s)=> sum + (s.singleStake||0), 0);

    if(stake > state.balance){
      showToast("Insufficient balance for this stake.", true);
      return;
    }

    const legCount = state.selections.length;
    const betType = state.slipMode === 'parlay' ? 'parlay' : 'single';
    placeButton.disabled = true;
    placeButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Placing…';
    try {
      if(!window.AceBackend) throw new Error('The secure betting service is still loading. Try again.');
      const result = await window.AceBackend.placeBets();
      state.betsPlaced++;
      state.balance = Number(result.balance);
      updateBalanceDisplay();
      awardXP(10, { type: betType, legs: legCount, stake });
      showToast(`Demo bet placed! Stake: ₹${stake.toFixed(2)}`);
      state.selections = [];
      document.getElementById('stakeInput').value = '';
      renderSlip();
      renderMatches();
    } catch(error) {
      showToast(error.message || 'The bet could not be placed.', true);
    } finally {
      placeButton.innerHTML = '<i class="fa-solid fa-spade"></i> Place Bet';
      updatePotentialReturn();
    }
  });
}

/*
 * BET RESOLUTION SIMULATION
 * --------------------------
 * Implied win probability is derived from the combined decimal odds
 * (1 / combinedOdds), then a weighted coin-flip decides the outcome —
 * mirroring how a real settlement engine would resolve a wager, just
 * compressed into a couple seconds for the demo.
 */
function resolveBet(stake, betType, legCount){
  const combined = betType === 'parlay' ? Math.max(1.01, calcCombinedOdds() || 2) : 1.9;
  const impliedProb = 1 / combined;
  const won = Math.random() < impliedProb;
  const boostPct = betType === 'parlay' ? getComboBoostPct(legCount) : 0;
  const payout = won ? stake * combined * (1 + boostPct) : 0;
  const profit = won ? payout - stake : -stake;

  if(won){
    state.balance += payout;
    state.wins++;
    state.streak++;
    awardXP(25 + state.streak * 5, { comeback: lastBetResult === 'loss' });
    showToast(`🎉 You won ₹${payout.toFixed(2)}!`);
    spawnWinFeedItem(`you just won ₹${payout.toFixed(2)} on a ${legCount>1?legCount+'-leg parlay':'single bet'}!`);
    if(state.streak > 0 && state.streak % 3 === 0) fireConfetti();
  } else {
    state.balance += 0; // stake already deducted at placement
    state.losses++;
    state.streak = 0;
    showToast(`Bet settled: no win this time.`, true);
  }
  lastBetResult = won ? 'win' : 'loss';

  historyData.unshift({
    date:new Date().toISOString().slice(0,10),
    event: legCount>1 ? `${legCount}-Leg Parlay` : 'Single Bet',
    stake, result: won ? 'Win':'Loss', pl: Math.round(profit*100)/100
  });

  updateBalanceDisplay();
  updateProgressUI();
  renderHistory();
  checkAchievements();
}

function updateBalanceDisplay(){
  document.getElementById('balanceText').textContent = `₹${state.balance.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  document.getElementById('modalBalance').textContent = `₹${state.balance.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

function showToast(msg, isError){
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = msg;
  toast.style.background = isError ? 'var(--crimson)' : 'var(--green)';
  toast.classList.add('show');
  setTimeout(()=> toast.classList.remove('show'), 2800);
}

/* ---------- 5. GAMIFICATION ENGINE ---------- */

// Adds XP, rolls levels up as needed, refreshes UI, and re-checks achievements.
// ctx carries extra info (stake size, leg count, bet type) that some achievements need.
function awardXP(amount, ctx){
  state.xp += amount;
  let leveledUp = false;
  while(state.xp >= xpToNextLevel(state.level)){
    state.xp -= xpToNextLevel(state.level);
    state.level++;
    leveledUp = true;
  }
  if(leveledUp){
    showToast(`⭐ Level Up! You're now Level ${state.level} (${getRank(state.level).name})`);
    fireConfetti();
  }
  updateProgressUI();
  checkAchievements(ctx);
}

function updateProgressUI(){
  const rank = getRank(state.level);
  const needed = xpToNextLevel(state.level);

  // The Player Progress card (level/XP/streak) only lives on the
  // sports/live/esports pages — guard each lookup since Casino/
  // Promotions/Help pages don't include that section.
  const levelNum = document.getElementById('levelNum');
  if(levelNum) levelNum.textContent = state.level;
  const nextLevelNum = document.getElementById('nextLevelNum');
  if(nextLevelNum) nextLevelNum.textContent = state.level + 1;
  const rankName = document.getElementById('rankName');
  if(rankName) rankName.textContent = rank.name;
  const rankBadgeIcon = document.getElementById('rankBadgeIcon');
  if(rankBadgeIcon) rankBadgeIcon.className = `fa-solid ${rank.icon}`;
  const xpCurrent = document.getElementById('xpCurrent');
  if(xpCurrent) xpCurrent.textContent = state.xp;
  const xpNeeded = document.getElementById('xpNeeded');
  if(xpNeeded) xpNeeded.textContent = needed;
  const xpBarFill = document.getElementById('xpBarFill');
  if(xpBarFill) xpBarFill.style.width = `${Math.min(100, (state.xp/needed)*100)}%`;

  // avatarLevel + rankPillText live in the header, present on every page
  document.getElementById('avatarLevel').textContent = state.level;
  const rankPillText = document.getElementById('rankPillText');
  if (rankPillText) rankPillText.textContent = rank.name.replace(' Staker','');

  const streakNum = document.getElementById('streakNum');
  if(streakNum) streakNum.textContent = state.streak;
  const flame = document.getElementById('streakFlame');
  if(flame) flame.classList.toggle('cold', state.streak === 0);
}

// Runs every achievement's check() against current state (+ optional ctx from the triggering action)
function checkAchievements(ctx){
  ACHIEVEMENTS.forEach(a=>{
    if(!state.achievements.has(a.id) && a.check(state, ctx)){
      state.achievements.add(a.id);
      showAchievementToast(a);
      fireConfetti();
    }
  });
  renderAchievements();
}

function showAchievementToast(a){
  const el = document.getElementById('achieveToast');
  document.getElementById('achieveName').textContent = a.name;
  document.getElementById('achieveDesc').textContent = a.desc;
  el.querySelector('i.trophy').className = `fa-solid ${a.icon} trophy`;
  el.classList.add('show');
  setTimeout(()=> el.classList.remove('show'), 4200);
}

function renderAchievements(){
  const grid = document.getElementById('achvGrid');
  grid.innerHTML = ACHIEVEMENTS.map(a => `
    <div class="achv-badge ${state.achievements.has(a.id) ? 'unlocked':''}">
      <i class="fa-solid ${a.icon}"></i>
      <div class="achv-name">${a.name}</div>
      <div class="achv-desc">${a.desc}</div>
    </div>
  `).join('');
}

// Lightweight canvas confetti burst — no external library, just physics-lite particles
function fireConfetti(){
  const canvas = document.getElementById('confettiCanvas');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#D4AF37','#F5C518','#C8102E','#9B5DE5','#FFFFFF'];
  const particles = Array.from({length:90}, ()=>({
    x: Math.random()*canvas.width, y:-20 - Math.random()*canvas.height*0.3,
    vx:(Math.random()-0.5)*4, vy:2+Math.random()*4,
    size:4+Math.random()*5, color:colors[Math.floor(Math.random()*colors.length)],
    rot:Math.random()*360, vrot:(Math.random()-0.5)*10,
  }));
  let frame = 0;
  function tick(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI/180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
      ctx.restore();
    });
    frame++;
    if(frame < 110) requestAnimationFrame(tick);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  tick();
}

/* ---- CASINO LOBBY: catalog, rendering, search + category filter ----
 * Mirrors a real casino lobby's browsing pattern (category tabs + search).
 * Tiles are a visual showcase of the game catalog (not wired to a live engine).
 */
const casinoLobbyCatalog = [
  { title:"Mega Fire Blaze Roulette Live", cat:"live",  ribbon:"TOP",  icon:"fa-circle-dot", gradient:"linear-gradient(135deg,#3a0d12,#8B0000)" },
  { title:"Adventures Beyond Wonderland",  cat:"live",  ribbon:"TOP",  icon:"fa-hat-wizard", gradient:"linear-gradient(135deg,#3a1650,#9B5DE5)" },
  { title:"Roulette Live",                 cat:"live",  ribbon:"TOP",  icon:"fa-circle-dot", gradient:"linear-gradient(135deg,#1c1c22,#8B0000)" },
  { title:"Panther Moon",                  cat:"slots", ribbon:"TOP",  icon:"fa-moon",       gradient:"linear-gradient(135deg,#120a24,#3a1650)" },
  { title:"Age of the Gods Norse: King of Asgard", cat:"slots", ribbon:"TOP", icon:"fa-shield-halved", gradient:"linear-gradient(135deg,#2b1d06,#8B6A1E)" },
  { title:"The Khan: Mega Fire Blaze",     cat:"slots", ribbon:"",     icon:"fa-fire",       gradient:"linear-gradient(135deg,#3a1c05,#C8102E)" },
  { title:"Baccarat Live",                 cat:"live",  ribbon:"TOP",  icon:"fa-heart",      gradient:"linear-gradient(135deg,#1c1c22,#333)" },
  { title:"Blackjack Live",                cat:"live",  ribbon:"TOP",  icon:"fa-spade",      gradient:"linear-gradient(135deg,#111,#333)" },
  { title:"Quantum Roulette Live",         cat:"live",  ribbon:"",     icon:"fa-circle-dot", gradient:"linear-gradient(135deg,#04203a,#116)" },
  { title:"Archer",                        cat:"slots", ribbon:"",     icon:"fa-bullseye",   gradient:"linear-gradient(135deg,#0d2b12,#1FA463)" },
  { title:"Highway Kings",                 cat:"new",   ribbon:"NEW",  icon:"fa-truck",      gradient:"linear-gradient(135deg,#3a2405,#D4AF37)" },
  { title:"Captain's Treasure",            cat:"slots", ribbon:"",     icon:"fa-skull-crossbones", gradient:"linear-gradient(135deg,#04283a,#116)" },
  { title:"French Roulette Live",          cat:"live",  ribbon:"",     icon:"fa-circle-dot", gradient:"linear-gradient(135deg,#1c1c22,#8B0000)" },
  { title:"Mega Fire Blaze Lucky Ball Live", cat:"jackpots", ribbon:"TOP", icon:"fa-circle-dot", gradient:"linear-gradient(135deg,#3a0d12,#D4AF37)" },
  { title:"Cash Collect Roulette",         cat:"jackpots", ribbon:"",  icon:"fa-sack-dollar", gradient:"linear-gradient(135deg,#0d2b12,#D4AF37)" },
  { title:"Great Blue",                    cat:"slots", ribbon:"",     icon:"fa-water",      gradient:"linear-gradient(135deg,#021c2b,#1178a4)" },
  { title:"Full Moon",                     cat:"new",   ribbon:"NEW",  icon:"fa-moon",       gradient:"linear-gradient(135deg,#0a0a24,#3a3a7a)" },
  { title:"Golden Reels Slots",            cat:"slots", ribbon:"",     icon:"fa-dice",       gradient:"linear-gradient(135deg,#2b1d06,#D4AF37)" },
  { title:"Provably-Fair Dice",            cat:"new",   ribbon:"NEW",  icon:"fa-dice-six",   gradient:"linear-gradient(135deg,#1c1c22,#9B5DE5)" },

  // Live-dealer table variants — mock stats (players/rtp) stand in for a real feed,
  // and the hexagon "badge" is a stylized card-suit mock in place of a dealer photo.
  { title:"Blackjack Classic 70",              cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:12,  rtp:98.2,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Dynasty VIP Blackjack 2",            cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:4,   rtp:97.1,  gradient:"linear-gradient(135deg,#3a1622,#1c0d12)" },
  { title:"Dynasty VIP Blackjack 1",            cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:6,   rtp:96.8,  gradient:"linear-gradient(135deg,#3a1622,#1c0d12)" },
  { title:"Blackjack Clásico en Español 24",    cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:64,  rtp:97.4,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Blackjack Clásico en Español 23",    cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:1,   rtp:116.5, gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Blackjack Classic 67",               cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:5,   rtp:90.0,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Blackjack Free Bet Français",        cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:9,   rtp:98.6,  gradient:"linear-gradient(135deg,#3a0d12,#1c0606)" },
  { title:"Classic Blackjack A",                cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:5,   rtp:99.8,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Classic Blackjack B",                cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:5,   rtp:98.0,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Speed Blackjack Live",               cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:14,  rtp:97.9,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Classique Blackjack Deux",           cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:7,   rtp:98.9,  gradient:"linear-gradient(135deg,#2b1d06,#1a1206)" },
  { title:"Blackjack Rápido Clásico en Español 4", cat:"live", ribbon:"", icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:7,   rtp:98.9,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Blackjack Rápido Clásico en Español 5", cat:"live", ribbon:"", icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:6,   rtp:97.6,  gradient:"linear-gradient(135deg,#0d2b1c,#0a1a12)" },
  { title:"Classic Ukrainian Blackjack 3",      cat:"live", ribbon:"",    icon:"fa-spade", provider:"Ace Live Studio", badge:"AJ", players:3,   rtp:96.9,  gradient:"linear-gradient(135deg,#111,#333)" },

  { title:"XXXtreme Lightning Roulette",  cat:"live", ribbon:"TOP", icon:"fa-circle-dot", provider:"Ace Live Studio", players:18, rtp:97.3,  gradient:"linear-gradient(135deg,#3a0d12,#1c0606)" },
  { title:"Fortune Roll Roulette",        cat:"live", ribbon:"",    icon:"fa-circle-dot", provider:"Ace Live Studio", players:8,  rtp:119.9, gradient:"linear-gradient(135deg,#04203a,#02101c)" },
  { title:"Champions Cup Roulette",       cat:"live", ribbon:"",    icon:"fa-circle-dot", provider:"Ace Live Studio", players:58, rtp:120.7, gradient:"linear-gradient(135deg,#0d2b12,#06170a)" },

  { title:"Dynasty Speed Baccarat 17", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:7, rtp:98.9, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },
  { title:"Dynasty Speed Baccarat 16", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:5, rtp:99.1, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },
  { title:"Dynasty Speed Baccarat 15", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:6, rtp:98.4, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },
  { title:"Dynasty Speed Baccarat 14", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:4, rtp:97.8, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },
  { title:"Dynasty Speed Baccarat 13", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:5, rtp:98.0, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },
  { title:"Dynasty Speed Baccarat 12", cat:"live", ribbon:"", icon:"fa-heart", provider:"Ace Live Studio", badge:"9♦", players:6, rtp:98.6, gradient:"linear-gradient(135deg,#3a2405,#1c1102)" },

  { title:"Ace Fishing Live", cat:"live", ribbon:"NEW", icon:"fa-fish", provider:"Ace Live Studio", players:22, rtp:96.5, gradient:"linear-gradient(135deg,#021c2b,#010e16)" },
];
const casinoLobbyCategories = [
  { key:"all", label:"All" },
  { key:"top", label:"Top" },
  { key:"new", label:"New" },
  { key:"slots", label:"Slots" },
  { key:"live", label:"Live" },
  { key:"jackpots", label:"Jackpots" },
  { key:"favorites", label:"❤ Favorites" },
];
let activeLobbyCategory = "all";
let lobbySearchTerm = "";
let favoriteGames = new Set(); // indices into casinoLobbyCatalog the player has hearted

function renderCasinoLobbyTabs(){
  const wrap = document.getElementById('casinoLobbyTabs');
  if(!wrap) return; // only present on casino.html
  wrap.innerHTML = casinoLobbyCategories.map(c => `
    <button class="casino-lobby-tab ${c.key === activeLobbyCategory ? 'active':''}" data-lobbycat="${c.key}">${c.label}</button>
  `).join('');
  wrap.querySelectorAll('.casino-lobby-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      activeLobbyCategory = btn.dataset.lobbycat;
      renderCasinoLobbyTabs();
      renderCasinoLobbyGrid();
    });
  });
}

/* Self-contained illustrated cover art. No external photo folder is required. */
function getGameThumbSVG(game, idx){
  const title = game.title.toLowerCase();
  const palettes = [
    ['#ff2f78','#53114f','#ffd84a'],
    ['#0fc49a','#063f4e','#b9ffe8'],
    ['#7a45df','#261050','#ffb6f2'],
    ['#ff8b32','#8e173d','#fff0a8'],
    ['#1676d2','#101c50','#7de4ff']
  ];
  const [c1,c2,accent] = palettes[idx % palettes.length];
  const symbol = title.includes('roulette') ? '●' :
    title.includes('blackjack') ? '♠' :
    title.includes('baccarat') ? '♦' :
    title.includes('dice') ? '⚄' :
    title.includes('fishing') ? '◆' :
    title.includes('slot') || game.cat === 'slots' ? '777' :
    title.includes('moon') ? '☾' : '★';
  const safeTitle = game.title.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  return `
    <svg viewBox="0 0 400 240" role="img" aria-label="${safeTitle}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cover-${idx}" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
        </linearGradient>
        <radialGradient id="shine-${idx}" cx=".25" cy=".15" r=".8">
          <stop stop-color="#fff" stop-opacity=".4"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill="url(#cover-${idx})"/>
      <circle cx="330" cy="35" r="115" fill="url(#shine-${idx})"/>
      <circle cx="78" cy="61" r="55" fill="none" stroke="${accent}" stroke-opacity=".32" stroke-width="12"/>
      <path d="M0 205 C85 150 150 245 238 188 S350 178 420 115 V260 H0Z" fill="#090912" fill-opacity=".25"/>
      <text x="205" y="136" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${symbol === '777' ? '74' : '100'}" fill="${accent}" opacity=".94">${symbol}</text>
      <text x="205" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="4" fill="#fff" opacity=".74">ACE ORIGINAL</text>
    </svg>`;
}

function renderCasinoLobbyGrid(){
  const grid = document.getElementById('casinoLobbyGrid');
  if(!grid) return; // only present on casino.html
  let games;
  if(lobbySearchTerm.trim()){
    const term = lobbySearchTerm.trim().toLowerCase();
    games = casinoLobbyCatalog.filter(g => g.title.toLowerCase().includes(term));
  } else if(activeLobbyCategory === 'all'){
    games = casinoLobbyCatalog;
  } else if(activeLobbyCategory === 'top'){
    games = casinoLobbyCatalog.filter(g => g.ribbon === 'TOP');
  } else if(activeLobbyCategory === 'favorites'){
    games = casinoLobbyCatalog.filter(g => favoriteGames.has(casinoLobbyCatalog.indexOf(g)));
  } else {
    games = casinoLobbyCatalog.filter(g => g.cat === activeLobbyCategory);
  }

  if(games.length === 0){
    const msg = activeLobbyCategory === 'favorites' ? "No favorites yet — click the heart on any game to save it here." : "No games match your search.";
    grid.innerHTML = `<div class="slip-empty" style="padding:30px; grid-column:1/-1;">${msg}</div>`;
    return;
  }

  grid.innerHTML = games.map((g) => {
    const idx = casinoLobbyCatalog.indexOf(g);
    const isFav = favoriteGames.has(idx);
    // Mock stats (players/rtp) replace the plain icon for live-table games;
    // everything else keeps the simple font-awesome icon in the corner.
    const statsOrIcon = (g.players !== undefined) ? `
      <div class="lobby-stats-badge">
        <span class="lobby-stat-pill"><i class="fa-solid fa-user-group"></i> ${g.players}</span>
        <span class="lobby-stat-pill rtp"><i class="fa-solid fa-arrow-trend-up"></i> ${g.rtp}%</span>
      </div>` : `<i class="fa-solid ${g.icon} lobby-icon"></i>`;
    return `
    <div class="lobby-card" style="background:${g.gradient};" data-lobby-index="${idx}">
      <div class="lobby-thumb">${getGameThumbSVG(g, idx)}</div>
      ${g.ribbon ? `<span class="lobby-ribbon ${g.ribbon==='NEW'?'new':g.ribbon==='TOP'?'':'live'}">${g.ribbon}</span>` : ''}
      ${statsOrIcon}
      ${g.badge ? `<div class="lobby-hex-badge">${g.badge}</div>` : ''}
      <div class="lobby-title-row">
        <h4>${g.title}</h4>
        <button class="lobby-fav ${isFav?'active':''}" data-fav-index="${idx}" title="Favorite"><i class="fa-solid fa-heart"></i></button>
      </div>
      <div class="lobby-provider">${g.provider || (g.cat === 'live' ? 'Live Table' : g.cat === 'jackpots' ? 'Jackpot' : 'Slot')}</div>
      <div class="play-overlay"><i class="fa-solid fa-play"></i></div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.lobby-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const game = casinoLobbyCatalog[Number(card.dataset.lobbyIndex)];
      showToast(`${game.title} — coming soon!`);
    });
  });

  grid.querySelectorAll('.lobby-fav').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation(); // don't also trigger the card's "coming soon" toast
      const idx = Number(btn.dataset.favIndex);
      if(favoriteGames.has(idx)) favoriteGames.delete(idx); else favoriteGames.add(idx);
      renderCasinoLobbyGrid();
    });
  });
}

const casinoSearchInputEl = document.getElementById('casinoSearchInput');
if(casinoSearchInputEl){ // only present on casino.html
  casinoSearchInputEl.addEventListener('input', (e)=>{
    lobbySearchTerm = e.target.value;
    renderCasinoLobbyGrid();
  });
}

/* ---------- 6. SIMULATED LIVE UPDATES ---------- */

// Ticker scores update every 5s (simulated "API call")
setInterval(()=>{
  if(backendMarketsActive) return;
  matches.forEach(m=>{
    if(m.status !== 'Live') return;
    if(m.sport === 'Basketball' || m.sport === 'CS:GO' || m.sport === 'Baseball'){
      const parts = m.live_score.split(' - ').map(Number);
      if(parts.length === 2 && !isNaN(parts[0])){
        m.live_score = `${parts[0] + Math.floor(Math.random()*3)} - ${parts[1] + Math.floor(Math.random()*3)}`;
      }
    }
  });
  renderTicker();
  renderMatches();
}, 5000);

// Simulated live odds fluctuation every 4s — mimics a real sportsbook feed
setInterval(()=>{
  if(backendMarketsActive) return;
  const spinner = document.getElementById('oddsSpinner');
  if(spinner) spinner.style.display = 'inline-block'; // only present on sports/live/esports pages
  setTimeout(()=>{ // fake network latency
    matches.forEach(m=>{
      ['home','draw','away'].forEach(key=>{
        if(m.odds[key] === null) return;
        const delta = (Math.random() - 0.5) * 0.1; // small drift
        let newVal = Math.max(1.05, m.odds[key] + delta);
        newVal = Math.round(newVal * 100) / 100;
        const el = document.getElementById(`odds-${m.id}-${key}`);
        if(el && newVal !== m.odds[key]){
          const btn = el.closest('.odds-btn');
          btn.classList.remove('flash-up','flash-down');
          void btn.offsetWidth; // restart animation
          btn.classList.add(newVal > m.odds[key] ? 'flash-up' : 'flash-down');
        }
        m.odds[key] = newVal;
        // Keep any active selections' displayed odds in sync
        const sel = state.selections.find(s => s.matchId === m.id && s.pick === key);
        if(sel) sel.odds = newVal;
      });
      // Trending crowd % also drifts slightly, keeping the "vote meter" alive
      if(m.trend.draw > 0){
        let h = Math.min(90, Math.max(10, m.trend.home + Math.round((Math.random()-0.5)*6)));
        let d = Math.min(40, Math.max(5, m.trend.draw + Math.round((Math.random()-0.5)*3)));
        m.trend.home = h; m.trend.draw = d; m.trend.away = 100 - h - d;
      } else {
        let h = Math.min(92, Math.max(8, m.trend.home + Math.round((Math.random()-0.5)*6)));
        m.trend.home = h; m.trend.away = 100 - h;
      }
    });
    renderMatches();
    renderSlip();
    const refreshLabel = document.getElementById('refreshLabel');
    if(refreshLabel) refreshLabel.textContent = 'Live odds updated just now';
  }, 500);
}, 4000);

// Simulated "Big Win" social-proof feed — other bettors winning around the site
const winFeedNames = ["Alex_K","MiaBets","DraftKingpin","ClutchQueen","VegasVortex","ParlayPete","Nova_88","BankrollBaron"];
function spawnWinFeedItem(customText){
  const stack = document.getElementById('winfeedStack');
  const el = document.createElement('div');
  el.className = 'winfeed-item glass';
  const text = customText || `${winFeedNames[Math.floor(Math.random()*winFeedNames.length)]} just won ₹${(Math.floor(Math.random()*3000)+80).toLocaleString('en-IN')} on ${matches[Math.floor(Math.random()*matches.length)].team1}!`;
  el.innerHTML = `<i class="fa-solid fa-trophy"></i> <span>${text}</span>`;
  stack.appendChild(el);
  setTimeout(()=> el.remove(), 4700);
}
setInterval(()=>{
  if(backendMarketsActive) return;
  spawnWinFeedItem();
  tickerWinCache.push(`${winFeedNames[Math.floor(Math.random()*winFeedNames.length)]} landed a big win`);
  if(tickerWinCache.length > 6) tickerWinCache.shift();
  renderTicker();
}, 9000);

/* ---------- 7. EXTRA CONTENT: Promotions / FAQ ---------- */

function renderPromotions(){
  const grid = document.getElementById('promoGrid');
  if(!grid) return; // only present on promotions.html
  grid.innerHTML = promotions.map(p => `
    <div class="promo-card glass">
      ${p.tag ? `<span class="promo-tag">${p.tag}</span>` : ''}
      <i class="fa-solid ${p.icon} promo-icon"></i>
      <h4>${p.title}</h4>
      <p>${p.desc}</p>
      <button data-promo="${p.title}">${p.cta}</button>
    </div>
  `).join('');
  grid.querySelectorAll('button[data-promo]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const promo = btn.dataset.promo;
      if(promo.includes('Welcome')){
        if(window.openAceAuth) window.openAceAuth(true);
      } else if(promo.includes('Parlay')){
        window.location.href = 'sports.html';
      } else if(promo.includes('Daily')){
        if(window.AceBackend) window.AceBackend.openResponsiblePlay();
      } else {
        window.location.href = 'sports.html';
      }
    });
  });
}

function renderFAQ(){
  const list = document.getElementById('faqList');
  if(!list) return; // only present on help.html
  list.innerHTML = faqData.map((f,i) => `
    <div class="faq-item glass" data-faq="${i}">
      <button class="faq-question">${f.q} <i class="fa-solid fa-chevron-down"></i></button>
      <div class="faq-answer"><p>${f.a}</p></div>
    </div>
  `).join('');
  list.querySelectorAll('.faq-item').forEach(item=>{
    item.querySelector('.faq-question').addEventListener('click', ()=>{
      item.classList.toggle('open');
    });
  });
}

/* ---------- 8. UI CHROME: dropdown, theme, modal, mobile nav, betslip toggle, nav filters ---------- */

// Avatar dropdown
const avatarBtn = document.getElementById('avatarBtn');
const userDropdown = document.getElementById('userDropdown');
avatarBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  userDropdown.classList.toggle('open');
});
document.addEventListener('click', ()=> userDropdown.classList.remove('open'));

document.body.classList.remove('light-mode');

// History / Profile modal (also reachable via the rank pill and avatar dropdown)
const historyModal = document.getElementById('historyModal');
function openProfileModal(e){
  if(e) e.preventDefault();
  userDropdown.classList.remove('open');
  historyModal.classList.add('open');
}
document.getElementById('historyBtn').addEventListener('click', openProfileModal);
document.getElementById('profileBtn').addEventListener('click', openProfileModal);
document.getElementById('balancePill')?.addEventListener('click', openProfileModal);
document.getElementById('closeModal').addEventListener('click', ()=> historyModal.classList.remove('open'));
historyModal.addEventListener('click', (e)=>{ if(e.target === historyModal) historyModal.classList.remove('open'); });

function renderHistory(){
  document.getElementById('historyTableBody').innerHTML = historyData.map(h=>`
    <tr>
      <td>${h.date}</td>
      <td>${h.event}</td>
      <td>₹${h.stake.toFixed(2)}</td>
      <td>${h.result}</td>
      <td class="${h.pl >= 0 ? 'profit-pos':'profit-neg'}">${h.pl >= 0 ? '+':''}₹${h.pl.toFixed(2)}</td>
    </tr>
  `).join('');
}

// Mobile bet slip toggle
const betslip = document.getElementById('betslip');
const slipMobileToggleBtn = document.getElementById('slipMobileToggle');
if(betslip && slipMobileToggleBtn){
  slipMobileToggleBtn.addEventListener('click', ()=> betslip.classList.toggle('open'));
  const slipHeader = betslip.querySelector('.betslip-header');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'betslip-close';
  closeButton.setAttribute('aria-label', 'Close betslip');
  closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  slipHeader.appendChild(closeButton);
  closeButton.addEventListener('click', ()=> betslip.classList.remove('open'));
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') betslip.classList.remove('open');
  });
}

// Mobile nav (simple slide toggle re-using nav-links display)
document.querySelector('.mobile-nav-toggle').addEventListener('click', ()=>{
  const nav = document.querySelector('.nav-links');
  if(!nav.querySelector('.mobile-account-item')){
    const item = document.createElement('li');
    item.className = 'mobile-account-item';
    item.innerHTML = '<button type="button" class="mobile-profile-menu"><i class="fa-solid fa-user"></i> Profile</button>';
    item.appendChild(userDropdown);
    item.querySelector('button').addEventListener('click', event => {
      event.stopPropagation();
      userDropdown.classList.toggle('open');
    });
    nav.appendChild(item);

    const authItem = document.createElement('li');
    authItem.className = 'mobile-auth-item';
    authItem.innerHTML = '<button type="button" class="mobile-auth-button"><i class="fa-solid fa-right-to-bracket"></i> Login</button>';
    const authButton = authItem.querySelector('button');
    authButton.addEventListener('click', () => {
      const action = authButton.dataset.signedIn === 'true' ? 'logout' : 'login';
      document.querySelector(`[data-auth-action="${action}"]`)?.click();
    });
    nav.appendChild(authItem);
    window.addEventListener('ace:session', event => {
      const signedIn = Boolean(event.detail?.user);
      authButton.dataset.signedIn = String(signedIn);
      authButton.innerHTML = signedIn
        ? '<i class="fa-solid fa-arrow-right-from-bracket"></i> Log Out'
        : '<i class="fa-solid fa-right-to-bracket"></i> Login';
    });
  }
  nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
  nav.style.cssText += 'position:absolute; top:64px; left:0; right:0; flex-direction:column; background:rgba(10,10,15,.95); padding:16px; gap:16px; z-index:99;';
});

// Nav links are now real page-to-page navigation (casino.html, sports.html,
// live.html, esports.html, promotions.html, help.html) with the "active"
// class baked into each page's markup, so no click-time filtering/scrolling
// logic is needed here anymore — the browser just loads the target page.

/* ---------- INIT ---------- */
function init(){
  renderSportTabs();
  renderTicker();
  renderMatches();
  renderSlip();
  renderHistory();
  renderAchievements();
  renderPromotions();
  renderFAQ();
  renderCasinoLobbyTabs();
  renderCasinoLobbyGrid();
  renderHomeScoreboard();
  updateBalanceDisplay();
  updateProgressUI();
}
init();

/* =========================================================
   LIVE SCOREBOARD — Home page only. Compact, horizontally
   scrollable strip of score cards pulled from the shared `matches`
   mock data — Live matches surfaced first, then Upcoming. Guarded
   so it's a no-op on every other page (none of them have
   #homeScoreboard). Each card links straight into Live/Sports.
   ========================================================= */
function renderHomeScoreboard(){
  const wrap = document.getElementById('homeScoreboard');
  if(!wrap) return;

  const sorted = [...matches].sort((a,b)=>{
    if(a.status === 'Live' && b.status !== 'Live') return -1;
    if(a.status !== 'Live' && b.status === 'Live') return 1;
    return new Date(a.startsAt || 0) - new Date(b.startsAt || 0);
  });

  const count = document.getElementById('homeScoreboardCount');
  if(count) count.textContent = `${sorted.length} game${sorted.length === 1 ? '' : 's'} available`;

  wrap.innerHTML = sorted.map(m => {
    const isLive = m.status === 'Live';
    const linkTarget = m.eventId ? `match.html?event=${encodeURIComponent(m.eventId)}` : (isLive ? 'live.html' : 'sports.html');
    const price = pick => m.priceMovement?.[pick] ? ` class="price-${m.priceMovement[pick]}"` : '';
    return `
    <a class="scoreboard-card glass" href="${linkTarget}">
      <div class="scoreboard-league">
        ${isLive ? `<span class="badge-live"><span class="live-dot"></span> LIVE</span>` : `<span class="badge-upcoming">${m.status}</span>`}
        <span>${m.league}</span>
      </div>
      <div class="scoreboard-teams">
        <div class="scoreboard-team">
          <span class="scoreboard-team-name"><span class="team-logo">${abbr(m.team1)}</span>${m.team1}</span>
        </div>
        <div class="scoreboard-team">
          <span class="scoreboard-team-name"><span class="team-logo">${abbr(m.team2)}</span>${m.team2}</span>
        </div>
      </div>
      <div class="scoreboard-footer">
        <span class="scoreboard-score">${m.live_score}</span>
        <span class="scoreboard-odds">${m.odds.home?.toFixed ? `<b${price('home')}>${m.odds.home.toFixed(2)}</b>` : ''}${m.odds.draw !== null ? ` · <b${price('draw')}>${m.odds.draw.toFixed(2)}</b>` : ''}${m.odds.away?.toFixed ? ` · <b${price('away')}>${m.odds.away.toFixed(2)}</b>` : ''}</span>
      </div>
    </a>`;
  }).join('');

  const prev = document.getElementById('scoreboardPrev');
  const next = document.getElementById('scoreboardNext');
  const updateButtons = () => {
    if(!prev || !next) return;
    prev.disabled = wrap.scrollLeft <= 4;
    next.disabled = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
  };
  if(prev && next && !wrap.dataset.controlsBound){
    wrap.dataset.controlsBound = 'true';
    prev.addEventListener('click', ()=> wrap.scrollBy({ left:-Math.max(244, wrap.clientWidth * .8), behavior:'smooth' }));
    next.addEventListener('click', ()=> wrap.scrollBy({ left:Math.max(244, wrap.clientWidth * .8), behavior:'smooth' }));
    wrap.addEventListener('scroll', updateButtons, { passive:true });
    window.addEventListener('resize', updateButtons);
  }
  requestAnimationFrame(updateButtons);
}

// Small public bridge used by the Supabase integration without exposing
// mutable internal state directly on window.
window.AceUI = {
  getState: () => state,
  getMatches: () => matches,
  replaceMarkets(nextMatches, nextSports){
    const previous = new Map(matches.filter(match => match.eventId).map(match => [match.eventId, match]));
    nextMatches.forEach(match => {
      const old = previous.get(match.eventId);
      match.priceMovement = {};
      if(!old) return;
      ['home','draw','away'].forEach(pick => {
        const before = Number(old.odds?.[pick]);
        const after = Number(match.odds?.[pick]);
        if(!Number.isFinite(before) || !Number.isFinite(after) || before === after) return;
        match.priceMovement[pick] = after > before ? 'up' : 'down';
      });
    });
    matches = nextMatches;
    sports = nextSports;
    backendMarketsActive = true;
    if(!sports.some(sport => sport.key === state.activeSport)) state.activeSport = 'All';
    state.selections = state.selections.flatMap(selection => {
      const match = matches.find(item => item.selectionIds?.[selection.pick] === selection.selectionId);
      return match ? [{ ...selection, matchId:match.id, odds:match.odds[selection.pick] }] : [];
    });
  },
  setBalance(value){ state.balance = Number(value || 0); },
  setHistory(rows){ historyData = rows; },
  renderAllMarkets(){
    renderSportTabs();
    renderMatches();
    renderTicker();
    renderSlip();
    renderHomeScoreboard();
  },
  updateBalanceDisplay,
  renderHistory
};
