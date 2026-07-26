/* =========================================================
   ACE STAKER — APP LOGIC (Vanilla ES6+)
   Sections:
   1. Mock Data (matches, sports, history, leaderboard, promos, faq)
   2. State (incl. gamification: level/xp/rank/streak/achievements)
   3. Render: Ticker / Sport Tabs / Matches / Trending bars
   4. Bet Slip logic (add/remove, single vs parlay, combo boost, payout calc)
   5. Gamification engine: XP, levels, ranks, streaks, achievements, confetti
   6. Simulated live updates (odds, ticker, big-win feed, leaderboard) via setInterval
   7. Extra content: Leaderboard / Promotions / FAQ render
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
let historyData = [
  { date:"2026-07-19", event:"Lakers vs Warriors", stake:100, result:"Win", pl:135 },
  { date:"2026-07-18", event:"Real Madrid vs Sevilla", stake:50, result:"Loss", pl:-50 },
  { date:"2026-07-17", event:"NAVI vs Vitality", stake:75, result:"Win", pl:60 },
  { date:"2026-07-15", event:"Alcaraz vs Djokovic", stake:200, result:"Loss", pl:-200 },
  { date:"2026-07-14", event:"T1 vs JDG (Parlay)", stake:40, result:"Win", pl:112 },
];

// Weekly leaderboard mock — "me" flags the current player's row
let leaderboardData = [
  { name:"VegasVortex", tier:"Ace", profit:8420, streak:6 },
  { name:"ClutchQueen", tier:"Diamond", profit:6110, streak:4 },
  { name:"you (Tafeem S.)", tier:"Gold", profit:3980, streak:0, me:true },
  { name:"BankrollBaron", tier:"Diamond", profit:3350, streak:2 },
  { name:"ParlayPete", tier:"Platinum", profit:2790, streak:1 },
  { name:"OddsWhisperer", tier:"Gold", profit:1980, streak:0 },
];

const promotions = [
  { icon:"fa-hand-holding-dollar", tag:"HOT", title:"100% Deposit Match", desc:"Double your first deposit up to ₹1,00,000 in bonus bets across casino and sports.", cta:"Claim Bonus" },
  { icon:"fa-bolt", tag:"FRIDAY", title:"Parlay Boost Friday", desc:"Every parlay of 3+ legs gets an extra +20% payout boost.", cta:"Activate Boost" },
  { icon:"fa-user-group", tag:"", title:"Refer a Friend", desc:"Invite a friend and earn ₹50 in free bets when they place their first wager.", cta:"Invite Now" },
  { icon:"fa-ticket", tag:"NEW", title:"Free Bet, No Deposit", desc:"Verify your account and get a ₹10 free bet — no deposit required.", cta:"Get Free Bet" },
];

const faqData = [
  { q:"How do I read decimal odds?", a:"Decimal odds show your total return per ₹1 staked, including your original stake. Odds of 2.10 mean a ₹10 bet returns ₹21.00 total if it wins." },
  { q:"How does a parlay payout work?", a:"A parlay multiplies the decimal odds of every leg together into one combined price. All legs must win for the parlay to pay out." },
  { q:"How fast are withdrawals processed?", a:"Most withdrawals to e-wallets are processed within minutes. Bank transfers can take 1–3 business days depending on your provider." },
  { q:"Can I cash out a live bet early?", a:"Yes — eligible live bets show a Cash Out option in your Bet Slip history once a match is underway, letting you lock in profit or cut losses early." },
  { q:"What is Ace Staker's approach to responsible gambling?", a:"We provide deposit limits, self-exclusion tools, and reality checks. If betting stops being fun, please reach out to our support team or a responsible gambling helpline in your region." },
];

/* ---------- 2. STATE ---------- */
let state = {
  activeSport: "All",
  slipMode: "single",           // "single" | "parlay"
  selections: [],               // [{matchId, pick:'home'|'draw'|'away', label, odds}]
  stake: 0,
  balance: 12450.00,

  // ---- Gamification state ----
  level: 12,
  xp: 640,
  streak: 3,                    // current win streak
  betsPlaced: 0,
  wins: 14,
  losses: 8,
  achievements: new Set(),       // ids of unlocked achievements
};

const STORAGE_KEY = 'aceStakerStateV1';
const THEME_KEY = 'aceStakerTheme';
const FAVORITES_KEY = 'aceStakerFavoritesV1';

function loadPersistentState(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if(saved && typeof saved === 'object'){
      const numericKeys = ['balance','level','xp','streak','betsPlaced','wins','losses'];
      numericKeys.forEach(key=>{
        if(Number.isFinite(saved[key])) state[key] = saved[key];
      });
      state.achievements = new Set(Array.isArray(saved.achievements) ? saved.achievements : []);
      if(Array.isArray(saved.history)) historyData = saved.history.slice(0, 100);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function savePersistentState(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      balance: state.balance,
      level: state.level,
      xp: state.xp,
      streak: state.streak,
      betsPlaced: state.betsPlaced,
      wins: state.wins,
      losses: state.losses,
      achievements: [...state.achievements],
      history: historyData.slice(0, 100),
    }));
  } catch {
    // The demo remains usable when storage is disabled or full.
  }
}

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
      return `<button class="odds-btn ${isSelected(pick)?'selected':''}" data-match="${m.id}" data-pick="${pick}" data-odds="${value}" data-label="${label==='1'?m.team1:label==='2'?m.team2:'Draw'}">
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
  if(legCount >= 5) return 0.20;
  if(legCount === 4) return 0.12;
  if(legCount === 3) return 0.05;
  return 0;
}

function renderSlip(){
  const body = document.getElementById('slipBody');
  if(!body) return; // the Home page has no bet slip aside
  const stakeSection = document.getElementById('stakeSection');
  const slipCount = document.getElementById('slipCount');
  const badge = document.getElementById('slipCountBadge');

  slipCount.textContent = state.selections.length ? `(${state.selections.length})` : '';
  badge.textContent = state.selections.length;
  badge.style.display = state.selections.length ? 'flex' : 'none';

  if(state.selections.length === 0){
    stakeSection.style.display = 'none';
    body.innerHTML = `
      <div class="slip-empty" id="slipEmptyState">
        <i class="fa-solid fa-receipt"></i>
        <p>Click any odds to add a selection</p>
      </div>`;
    return;
  }

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
  document.getElementById('stakeLabel').textContent = state.slipMode === 'parlay' ? 'Parlay Stake' : 'Total Stake (sum of singles)';

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
  renderSlip();
}

// All of the bet slip's interactive wiring only applies on pages that
// actually include the aside (every page except Home) — guard the whole
// block so it's skipped cleanly where #betslip doesn't exist.
if(document.getElementById('betslip')){
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
  document.getElementById('placeBetBtn').addEventListener('click', ()=>{
    const selections = state.selections.map(selection=>({...selection}));
    const betType = state.slipMode === 'parlay' ? 'parlay' : 'single';
    const stake = betType === 'parlay'
      ? Number(document.getElementById('stakeInput').value)
      : selections.reduce((sum,s)=> sum + (s.singleStake||0), 0);

    if(!Number.isFinite(stake) || stake <= 0){
      showToast("Enter a valid stake before placing the bet.", true);
      return;
    }

    if(stake > state.balance){
      showToast("Insufficient balance for this stake.", true);
      return;
    }

    const settlement = {
      betType,
      selections,
      legCount: selections.length,
      stake,
      combinedOdds: betType === 'parlay'
        ? selections.reduce((total, selection)=> total * selection.odds, 1)
        : null,
    };

    state.balance -= stake;
    state.betsPlaced += betType === 'single'
      ? selections.filter(selection=>selection.singleStake > 0).length
      : 1;
    updateBalanceDisplay();

    showToast(`Bet placed! Stake: ₹${stake.toFixed(2)}`);

    // Award base XP for participating, then resolve the bet after a short
    // "processing" delay to simulate the match settling — this is where the
    // win/loss, streak, and bonus-XP logic all fire.
    awardXP(10, { type: betType, legs: settlement.legCount, stake });

    setTimeout(()=> resolveBet(settlement), 1800);

    // reset slip
    state.selections = [];
    document.getElementById('stakeInput').value = '';
    renderSlip();
    renderMatches();
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
function resolveBet({stake, betType, legCount, combinedOdds, selections}){
  const wagers = betType === 'parlay'
    ? [{
        event: `${legCount}-Leg Parlay`,
        stake,
        odds: Math.max(1.01, combinedOdds),
        boostPct: getComboBoostPct(legCount),
      }]
    : selections
        .filter(selection=>selection.singleStake > 0)
        .map(selection=>{
          const match = matches.find(item=>item.id === selection.matchId);
          return {
            event: match ? `${match.team1} vs ${match.team2} — ${selection.label}` : 'Single Bet',
            stake: selection.singleStake,
            odds: selection.odds,
            boostPct: 0,
          };
        });

  let totalPayout = 0;
  let winningWagers = 0;

  wagers.forEach(wager=>{
    const won = Math.random() < (1 / wager.odds);
    const payout = won ? wager.stake * wager.odds * (1 + wager.boostPct) : 0;
    const profit = won ? payout - wager.stake : -wager.stake;
    totalPayout += payout;

    if(won){
      winningWagers++;
      state.wins++;
      state.streak++;
      awardXP(25 + state.streak * 5, { comeback: lastBetResult === 'loss' });
      if(state.streak % 3 === 0) fireConfetti();
    } else {
      state.losses++;
      state.streak = 0;
    }
    lastBetResult = won ? 'win' : 'loss';

    historyData.unshift({
      date:new Date().toISOString().slice(0,10),
      event:wager.event,
      stake:wager.stake,
      result:won ? 'Win':'Loss',
      pl:Math.round(profit*100)/100,
    });
  });

  state.balance += totalPayout;
  if(winningWagers){
    showToast(`🎉 ${winningWagers === wagers.length ? 'You won' : `${winningWagers} bet${winningWagers>1?'s':''} won`} ₹${totalPayout.toFixed(2)}!`);
    spawnWinFeedItem(`you just won ₹${totalPayout.toFixed(2)}!`);
  } else {
    showToast(`Bet settled: no win this time.`, true);
  }

  updateBalanceDisplay();
  updateProgressUI();
  renderHistory();
  checkAchievements();
  savePersistentState();
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
  savePersistentState();
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
  document.getElementById('rankPillText').textContent = rank.name.replace(' Staker','');

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
try {
  favoriteGames = new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
} catch {
  localStorage.removeItem(FAVORITES_KEY);
}

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

/*
 * LOBBY THUMBNAIL ART — free-to-use licensed stock photos (Pexels License:
 * free for commercial use, no attribution required), embedded as base64 so
 * the page stays a single self-contained file with no external image
 * requests. Each catalog entry gets its own distinct photo (cycled from a
 * per-category pool) rather than sharing one image per game type.
 */
const IMG_ROULETTE_LIST = [
  "photos/1.jpg",
  "photos/2.jpg",
  "photos/3.jpg",
  "photos/4.jpg",
  "photos/5.jpg",
  "photos/6.jpg",
  "photos/7.jpg",
  "photos/8.jpg",
];
const IMG_BLACKJACK_LIST = [
  "photos/9.jpg",
  "photos/10.jpg",
  "photos/11.jpg",
  "photos/12.jpg",
  "photos/13.jpg",
  "photos/14.jpg",
  "photos/15.jpg",
  "photos/16.jpg",
  "photos/17.jpg",
  "photos/18.jpg",
  "photos/19.jpg",
  "photos/20.jpg",
  "photos/21.jpg",
  "photos/22.jpg",
  "photos/23.jpg",
];
const IMG_BACCARAT_LIST = [
  "photos/24.jpg",
  "photos/25.jpg",
  "photos/26.jpg",
  "photos/27.jpg",
  "photos/28.jpg",
  "photos/29.jpg",
  "photos/30.jpg",
];
const IMG_SLOTS_LIST = [
  "photos/31.jpg",
  "photos/32.jpg",
  "photos/33.jpg",
  "photos/34.jpg",
  "photos/35.jpg",
  "photos/36.jpg",
  "photos/37.jpg",
  "photos/38.jpg",
  "photos/39.jpg",
];
const IMG_DICE_SINGLE = "photos/40.jpg";
const IMG_FISHING_SINGLE = "photos/41.jpg";
const IMG_JACKPOT_SINGLE = "photos/42.jpg";
const IMG_OTHER_SINGLE = "photos/43.jpg";

// One-time assignment: walk the catalog, handing out a fresh photo per entry
// from the matching category pool (cycling if a pool runs shorter than the
// number of entries in that category).
const casinoLobbyThumbs = (function(){
  const counters = { roulette:0, blackjack:0, baccarat:0, slots:0 };
  return casinoLobbyCatalog.map(g => {
    const t = g.title.toLowerCase();
    if(t.includes('blackjack')) return IMG_BLACKJACK_LIST[counters.blackjack++ % IMG_BLACKJACK_LIST.length];
    if(t.includes('baccarat')) return IMG_BACCARAT_LIST[counters.baccarat++ % IMG_BACCARAT_LIST.length];
    if(t.includes('roulette')) return IMG_ROULETTE_LIST[counters.roulette++ % IMG_ROULETTE_LIST.length];
    if(t.includes('dice')) return IMG_DICE_SINGLE;
    if(t.includes('fishing')) return IMG_FISHING_SINGLE;
    if(g.cat === 'jackpots') return IMG_JACKPOT_SINGLE;
    if(g.cat === 'slots' || g.cat === 'new') return IMG_SLOTS_LIST[counters.slots++ % IMG_SLOTS_LIST.length];
    return IMG_OTHER_SINGLE;
  });
})();

function getGameThumbSVG(game, idx){
  const src = casinoLobbyThumbs[idx];
  return `<img src="${src}" alt="${game.title}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">`;
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
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteGames]));
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
        d = Math.min(d, 95 - h);
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
  spawnWinFeedItem();
  tickerWinCache.push(`${winFeedNames[Math.floor(Math.random()*winFeedNames.length)]} landed a big win`);
  if(tickerWinCache.length > 6) tickerWinCache.shift();
  renderTicker();
}, 9000);

// Leaderboard gently reshuffles to feel "live"
setInterval(()=>{
  leaderboardData.forEach(p=>{
    if(!p.me) p.profit += Math.floor((Math.random()-0.3)*120);
  });
  leaderboardData.sort((a,b)=> b.profit - a.profit);
  renderLeaderboard();
}, 7000);

/* ---------- 7. EXTRA CONTENT: Leaderboard / Promotions / FAQ ---------- */

function renderLeaderboard(){
  const wrap = document.getElementById('leaderboardList');
  if(!wrap) return; // only present on sports/live/esports pages
  wrap.innerHTML = leaderboardData.map((p, i) => {
    const rankClass = i===0?'top1':i===1?'top2':i===2?'top3':'';
    return `
    <div class="leader-row ${p.me?'me':''}">
      <div class="leader-rank ${rankClass}">${i+1}</div>
      <div class="leader-name">${p.name} <span class="leader-tier">${p.tier}</span></div>
      <div class="leader-streak">${p.streak > 0 ? `<i class="fa-solid fa-fire" style="color:var(--crimson);"></i> ${p.streak}` : ''}</div>
      <div class="leader-profit">+₹${p.profit.toLocaleString('en-IN')}</div>
    </div>`;
  }).join('');
}

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
      showToast(`Bonus claimed: ${btn.dataset.promo}`);
      awardXP(15);
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
avatarBtn.setAttribute('role', 'button');
avatarBtn.setAttribute('tabindex', '0');
avatarBtn.setAttribute('aria-label', 'Open account menu');
avatarBtn.setAttribute('aria-expanded', 'false');
avatarBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  const open = userDropdown.classList.toggle('open');
  avatarBtn.setAttribute('aria-expanded', String(open));
});
avatarBtn.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' || e.key === ' '){
    e.preventDefault();
    avatarBtn.click();
  }
});
document.addEventListener('click', ()=>{
  userDropdown.classList.remove('open');
  avatarBtn.setAttribute('aria-expanded', 'false');
});

// Theme toggle (dark default, light optional)
if(localStorage.getItem(THEME_KEY) === 'light'){
  document.body.classList.add('light-mode');
  document.getElementById('themeIcon').className = 'fa-solid fa-sun';
}
document.getElementById('themeToggle').addEventListener('click', ()=>{
  document.body.classList.toggle('light-mode');
  const icon = document.getElementById('themeIcon');
  icon.className = document.body.classList.contains('light-mode') ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  localStorage.setItem(THEME_KEY, document.body.classList.contains('light-mode') ? 'light' : 'dark');
});

// History / Profile modal (also reachable via the rank pill and avatar dropdown)
const historyModal = document.getElementById('historyModal');
function openProfileModal(e){
  if(e) e.preventDefault();
  userDropdown.classList.remove('open');
  historyModal.classList.add('open');
  document.getElementById('closeModal').focus();
}
document.getElementById('historyBtn').addEventListener('click', openProfileModal);
document.getElementById('profileBtn').addEventListener('click', openProfileModal);
document.getElementById('leaderboardBtn').addEventListener('click', (e)=>{
  e.preventDefault();
  userDropdown.classList.remove('open');
  const leaderboardSection = document.getElementById('leaderboardSection');
  if(leaderboardSection){
    leaderboardSection.scrollIntoView({behavior:'smooth'});
  } else {
    // Leaderboard only lives on the Casino/home page — jump there
    window.location.href = 'home.html#leaderboardSection';
  }
});
const rankPill = document.getElementById('rankPill');
rankPill.setAttribute('role', 'button');
rankPill.setAttribute('tabindex', '0');
rankPill.addEventListener('click', openProfileModal);
rankPill.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' || e.key === ' '){
    e.preventDefault();
    openProfileModal(e);
  }
});
document.getElementById('closeModal').addEventListener('click', ()=> historyModal.classList.remove('open'));
historyModal.addEventListener('click', (e)=>{ if(e.target === historyModal) historyModal.classList.remove('open'); });
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    historyModal.classList.remove('open');
    userDropdown.classList.remove('open');
  }
});

document.querySelectorAll('a[href="#"]').forEach(link=>{
  link.addEventListener('click', (e)=>{
    e.preventDefault();
    showToast(`${link.textContent.trim()} is not available in this demo yet.`, true);
  });
});
const logoutButton = document.querySelector('#userDropdown button');
if(logoutButton){
  logoutButton.addEventListener('click', ()=> showToast('No signed-in demo session to log out.', true));
}

function renderHistory(){
  const wins = historyData.filter(h=>h.result==='Win').length;
  const losses = historyData.filter(h=>h.result==='Loss').length;
  const pct = Math.round((wins/(wins+losses))*100) || 0;
  document.getElementById('modalWins').textContent = state.wins;
  document.getElementById('modalLosses').textContent = state.losses;
  const overallPct = Math.round((state.wins/(state.wins+state.losses))*100) || 0;
  document.getElementById('wlPercent').textContent = overallPct + '%';
  document.getElementById('wlBarFill').style.width = overallPct + '%';

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
}

// Mobile nav (simple slide toggle re-using nav-links display)
const mobileNavToggle = document.querySelector('.mobile-nav-toggle');
mobileNavToggle.setAttribute('aria-label', 'Toggle navigation');
mobileNavToggle.setAttribute('aria-expanded', 'false');
mobileNavToggle.addEventListener('click', (event)=>{
  const nav = document.querySelector('.nav-links');
  const open = nav.classList.toggle('mobile-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

// Nav links are now real page-to-page navigation (casino.html, sports.html,
// live.html, esports.html, promotions.html, help.html) with the "active"
// class baked into each page's markup, so no click-time filtering/scrolling
// logic is needed here anymore — the browser just loads the target page.

/* ---------- INIT ---------- */
function init(){
  loadPersistentState();
  renderSportTabs();
  renderTicker();
  renderMatches();
  renderSlip();
  renderHistory();
  renderAchievements();
  renderLeaderboard();
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
    return 0;
  });

  wrap.innerHTML = sorted.map(m => {
    const isLive = m.status === 'Live';
    const linkTarget = isLive ? 'live.html' : 'sports.html';
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
        <span class="scoreboard-odds">${m.odds.home.toFixed ? `<b>${m.odds.home.toFixed(2)}</b>` : ''}${m.odds.draw !== null ? ` · <b>${m.odds.draw.toFixed(2)}</b>` : ''} · <b>${m.odds.away.toFixed(2)}</b></span>
      </div>
    </a>`;
  }).join('');
}
