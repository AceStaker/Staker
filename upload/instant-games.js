(function () {
  'use strict';

  const allowedGames = ['crossing', 'mines', 'plinko', 'tower', 'dice', 'limbo'];
  const requestedGame = new URLSearchParams(location.search).get('game');
  const game = allowedGames.includes(requestedGame) ? requestedGame : 'crossing';
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);

  const definitions = {
    crossing: {
      title: 'Lucky Crossing',
      kicker: 'TRAFFIC MULTIPLIER',
      subtitle: 'Every safe lane raises the multiplier. Cash out before traffic catches you.',
      console: 'Start a crossing',
      icon: 'fa-road',
      action: 'CROSS NEXT LANE'
    },
    mines: {
      title: 'Mines',
      kicker: 'NEON GEM VAULT',
      subtitle: 'Reveal gems hidden across the grid and leave before you uncover a mine.',
      console: 'Configure the vault',
      icon: 'fa-gem',
      action: 'SELECT A TILE'
    },
    plinko: {
      title: 'Plinko',
      kicker: 'NEON GRAVITY DROP',
      subtitle: 'Release an energy ball through eight rows of pegs and into a multiplier pocket.',
      console: 'Configure a drop',
      icon: 'fa-circle-dot',
      action: 'DROP BALL'
    },
    tower: {
      title: 'Tower',
      kicker: 'CROWN ASCENT',
      subtitle: 'Find one safe platform on each floor, climb higher, or collect your return.',
      console: 'Begin an ascent',
      icon: 'fa-building',
      action: 'CHOOSE A PLATFORM'
    },
    dice: {
      title: 'Dice',
      kicker: 'PRECISION ROLL',
      subtitle: 'Set the line, choose over or under, and let the verified roll decide.',
      console: 'Set your roll',
      icon: 'fa-dice',
      action: 'ROLL DICE'
    },
    limbo: {
      title: 'Limbo',
      kicker: 'MULTIPLIER PULSE',
      subtitle: 'Set a target and see whether the server pulse climbs high enough to reach it.',
      console: 'Set a target',
      icon: 'fa-wave-square',
      action: 'LAUNCH PULSE'
    }
  };

  const state = {
    backend: null,
    session: null,
    lastBet: null,
    history: [],
    pending: false,
    error: '',
    options: {
      crossing: { difficulty: 'medium' },
      mines: { mines: 5 },
      plinko: { risk: 'medium' },
      tower: {},
      dice: { mode: 'under', target: 50 },
      limbo: { target: 2 }
    }
  };
  const els = {};

  function cacheElements() {
    [
      'gameKicker', 'gameTitle', 'gameSubtitle', 'consoleTitle', 'consoleIcon',
      'gameStage', 'gameScene', 'gameResult', 'resultEyebrow', 'resultValue', 'resultMessage',
      'resultReplay',
      'gameOptions', 'gameStake', 'stakeMinus', 'stakePlus', 'instantChips',
      'sessionMeter', 'sessionMultiplier', 'sessionReturn', 'primaryAction',
      'actionEyebrow', 'actionLabel', 'cashoutAction', 'gameNote',
      'instantHistory', 'historyStatus'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function user() {
    return state.backend?.getUser?.() || null;
  }

  function stake() {
    const value = Number(els.gameStake.value);
    return Number.isFinite(value) && value >= 10 && value <= 100000
      ? Math.round(value * 100) / 100
      : 0;
  }

  function notify(message, isError = false) {
    if (typeof window.showToast === 'function') window.showToast(message, isError);
  }

  function showClientError(error) {
    const message = error?.message || 'The game could not complete that action. Please try again.';
    state.error = message;
    notify(message, true);
    els.gameNote.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(message)}`;
    els.gameNote.classList.add('error');
  }

  function revealStage() {
    if (window.matchMedia('(max-width: 920px)').matches) {
      els.gameStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setBalance(value) {
    if (!Number.isFinite(Number(value))) return;
    window.AceUI?.setBalance(Number(value));
    window.AceUI?.updateBalanceDisplay();
  }

  function setupIdentity() {
    const definition = definitions[game];
    document.body.dataset.game = game;
    document.title = `Ace Staker | ${definition.title}`;
    els.gameKicker.textContent = definition.kicker;
    els.gameTitle.textContent = definition.title;
    els.gameSubtitle.textContent = definition.subtitle;
    els.consoleTitle.textContent = definition.console;
    els.consoleIcon.className = `fa-solid ${definition.icon}`;
  }

  function segmented(name, choices, value) {
    return `<div class="option-label"><span>${name}</span><span>Choose before playing</span></div>
      <div class="segmented-control" style="--segments:${choices.length}">
        ${choices.map(choice => `<button type="button" data-option="${choice.value}" class="${String(value) === String(choice.value) ? 'active' : ''}">${choice.label}</button>`).join('')}
      </div>`;
  }

  function renderOptions() {
    const option = state.options[game];
    if (game === 'crossing') {
      els.gameOptions.innerHTML = segmented('Traffic difficulty', [
        { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' },
        { value: 'hard', label: 'Hard' }, { value: 'extreme', label: 'Extreme' }
      ], option.difficulty);
    } else if (game === 'mines') {
      els.gameOptions.innerHTML = segmented('Hidden mines', [
        { value: 3, label: '3' }, { value: 5, label: '5' },
        { value: 8, label: '8' }, { value: 12, label: '12' }
      ], option.mines);
    } else if (game === 'plinko') {
      els.gameOptions.innerHTML = segmented('Risk profile', [
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }
      ], option.risk);
    } else if (game === 'tower') {
      els.gameOptions.innerHTML = '<div class="option-label"><span>Ascent</span><span>8 floors</span></div><div class="segmented-control" style="--segments:1"><button type="button" class="active">1 safe platform per floor</button></div>';
    } else if (game === 'dice') {
      els.gameOptions.innerHTML = `${segmented('Roll direction', [
        { value: 'under', label: 'Roll under' }, { value: 'over', label: 'Roll over' }
      ], option.mode)}
      <div class="range-option">
        <div class="range-readout"><span>Target line</span><strong id="diceTargetValue">${Number(option.target).toFixed(2)}</strong></div>
        <input id="diceTarget" type="range" min="5" max="95" step="1" value="${option.target}">
      </div>`;
    } else {
      els.gameOptions.innerHTML = `<div class="range-option">
        <div class="range-readout"><span>Target multiplier</span><strong id="limboTargetValue">${Number(option.target).toFixed(2)}×</strong></div>
        <input id="limboTarget" type="range" min="1.1" max="20" step=".1" value="${option.target}">
      </div>
      <div class="option-label"><span>Win chance</span><span id="limboChance">${Math.min(96 / Number(option.target), 87.27).toFixed(2)}%</span></div>`;
    }
    bindOptionEvents();
  }

  function bindOptionEvents() {
    els.gameOptions.querySelectorAll('[data-option]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.session || state.pending) return;
        const raw = button.dataset.option;
        if (game === 'crossing') state.options.crossing.difficulty = raw;
        if (game === 'mines') state.options.mines.mines = Number(raw);
        if (game === 'plinko') state.options.plinko.risk = raw;
        if (game === 'dice') state.options.dice.mode = raw;
        renderOptions();
      });
    });
    document.getElementById('diceTarget')?.addEventListener('input', event => {
      state.options.dice.target = Number(event.target.value);
      document.getElementById('diceTargetValue').textContent = Number(event.target.value).toFixed(2);
    });
    document.getElementById('limboTarget')?.addEventListener('input', event => {
      state.options.limbo.target = Number(event.target.value);
      document.getElementById('limboTargetValue').textContent = `${Number(event.target.value).toFixed(2)}×`;
      document.getElementById('limboChance').textContent = `${Math.min(96 / Number(event.target.value), 87.27).toFixed(2)}%`;
    });
  }

  function crossingScene() {
    const progress = Number(state.session?.progress || 0);
    const visibleStep = Math.min(progress, 6);
    const traffic = Array.from({ length: 6 }, (_, lane) => {
      const direction = lane % 2 === 0 ? 'east' : 'west';
      const vehicleType = lane % 3 === 1 ? 'truck' : 'car';
      return `<div class="crossing-lane lane-${lane + 1}">
        <span class="lane-dash"></span>
        ${Array.from({ length: 2 }, (_, vehicle) => `<span class="traffic-unit ${vehicleType} ${direction} vehicle-${vehicle + 1}" aria-hidden="true">
          <span class="vehicle-body"><i class="vehicle-cabin"></i><i class="vehicle-window"></i><i class="vehicle-light"></i><i class="vehicle-wheel wheel-a"></i><i class="vehicle-wheel wheel-b"></i></span>
        </span>`).join('')}
      </div>`;
    }).join('');
    return `<div class="crossing-scene" style="--crossing-progress:${visibleStep}">
      <div class="crossing-road">${traffic}</div>
      <div class="crossing-hud"><span>RUN <b>#${progress + 1}</b></span><span>${state.options.crossing.difficulty.toUpperCase()} TRAFFIC</span></div>
      <div class="crossing-route">${Array.from({ length: 7 }, (_, index) => `<span class="${index < visibleStep ? 'cleared' : index === visibleStep ? 'current' : ''}"></span>`).join('')}</div>
      <span class="crossing-player" aria-label="Golden chicken">
        <span class="runner-shadow"></span>
        <svg viewBox="0 0 120 118" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="chickenGold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff8a7"/><stop offset=".42" stop-color="#ffd83d"/><stop offset="1" stop-color="#ef8c16"/></linearGradient>
            <linearGradient id="chickenWing" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe866"/><stop offset="1" stop-color="#e99917"/></linearGradient>
            <filter id="chickenGlow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <g class="runner-legs" stroke="#ff9d22" stroke-width="6" stroke-linecap="round"><path d="M50 91v14l-9 7"/><path d="M73 91v14l10 6"/></g>
          <path class="runner-tail" d="M34 71C14 68 9 50 13 39c8 10 18 11 28 10z" fill="#f3a21c"/>
          <ellipse cx="58" cy="68" rx="35" ry="31" fill="url(#chickenGold)" filter="url(#chickenGlow)"/>
          <path class="runner-wing" d="M49 62c-5 15 4 25 19 24 15-2 20-16 15-29-9 10-21 13-34 5z" fill="url(#chickenWing)"/>
          <circle cx="78" cy="39" r="22" fill="url(#chickenGold)"/>
          <path d="M91 39l22 8-21 9z" fill="#ff8b22"/>
          <path d="M65 22c2-12 10-18 15-5 5-11 13-5 12 5z" fill="#ff4563"/>
          <circle cx="84" cy="34" r="4.5" fill="#111827"/><circle cx="85.5" cy="32.5" r="1.4" fill="#fff"/>
          <path d="M73 51c6 9 15 8 19 1-1 13-15 18-19-1z" fill="#f04d55"/>
        </svg>
      </span>
    </div>`;
  }

  function minesScene() {
    const picks = state.session?.public_state?.picks || [];
    const lost = state.lastBet?.status === 'lost';
    const mines = lost ? (state.lastBet?.details?.mines || []) : [];
    return `<div class="mines-scene"><div class="mines-grid">
      ${Array.from({ length: 25 }, (_, index) => {
        const revealed = picks.includes(index);
        const isMine = mines.includes(index);
        const className = isMine ? 'mine' : revealed ? 'revealed' : '';
        const icon = isMine ? '<i class="fa-solid fa-burst"></i>' : revealed ? '<i class="fa-solid fa-gem"></i>' : '<span class="vault-facet"></span>';
        return `<button type="button" class="mine-cell ${className}" data-choice="${index}" aria-label="Vault tile ${index + 1}" ${state.session && !revealed && !state.pending ? '' : 'disabled'}>${icon}<small>${String(index + 1).padStart(2, '0')}</small></button>`;
      }).join('')}
    </div></div>`;
  }

  const plinkoMultipliers = {
    low: [5, 2, 1.25, .85, .55, .85, 1.25, 2, 5],
    medium: [12, 3, 1.5, .6, .3, .6, 1.5, 3, 12],
    high: [20, 4, 1.5, .4, .15, .4, 1.5, 4, 20]
  };

  function plinkoScene() {
    const risk = state.options.plinko.risk;
    return `<div class="plinko-scene"><div class="plinko-board">
      <div class="plinko-reactor"><span></span><b>GRAVITY CORE</b></div>
      <div class="plinko-rail rail-left"></div><div class="plinko-rail rail-right"></div>
      <span class="live-plinko-ball" id="livePlinkoBall"></span>
      <div class="plinko-pegs">${Array.from({ length: 8 }, (_, row) => `<div class="plinko-row">${Array.from({ length: row + 2 }, () => '<span class="plinko-peg"></span>').join('')}</div>`).join('')}</div>
      <div class="plinko-buckets">${plinkoMultipliers[risk].map((value, index) => `<span class="plinko-bucket ${index === 0 || index === 8 ? 'hot' : ''}" data-bucket="${index}">${Number(value).toFixed(value < 1 ? 2 : 1)}×</span>`).join('')}</div>
    </div></div>`;
  }

  function towerScene() {
    const progress = Number(state.session?.progress || 0);
    const picks = state.session?.public_state?.picks || [];
    const failed = state.lastBet?.status === 'lost' ? state.lastBet.details?.failed_choice : null;
    const failedRow = state.lastBet?.details?.failed_row;
    return `<div class="tower-scene"><div class="tower-board">
      ${Array.from({ length: 8 }, (_, row) => {
        const complete = row < progress;
        const active = row === progress && Boolean(state.session);
        return `<div class="tower-row ${complete ? 'completed' : active ? 'active' : ''}" style="--floor:${row}">
          <span class="tower-floor">${String(row + 1).padStart(2, '0')}</span>
          ${Array.from({ length: 3 }, (_, column) => {
            const selected = picks[row] === column;
            const failedCell = Number(failedRow) === row && Number(failed) === column;
            return `<button class="tower-cell ${selected ? 'selected' : ''} ${failedCell ? 'failed' : ''}" data-choice="${column}" aria-label="Floor ${row + 1}, platform ${column + 1}" ${active && !state.pending ? '' : 'disabled'}><span></span><i class="fa-solid ${selected ? 'fa-crown' : failedCell ? 'fa-xmark' : 'fa-diamond'}"></i></button>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div></div>`;
  }

  function diceScene() {
    const roll = state.lastBet?.details?.roll;
    const target = state.options.dice.target;
    const mode = state.options.dice.mode;
    return `<div class="dice-scene">
      <div class="dice-orbit orbit-one"></div><div class="dice-orbit orbit-two"></div>
      <div class="precision-die" id="precisionDie">
        <span class="die-edge edge-one"></span><span class="die-edge edge-two"></span>
        <small>VERIFIED ROLL</small><strong id="diceRollValue">${roll == null ? '—' : Number(roll).toFixed(2)}</strong>
      </div>
      <div class="dice-meter">
        <div class="dice-line" style="--target:${target}%;background:linear-gradient(90deg,#56e7b8 0 ${target}%,#ff5878 ${target}% 100%)"><span style="left:${target}%"></span></div>
        <div class="dice-line-labels"><span>0.00</span><b>${mode.toUpperCase()} ${Number(target).toFixed(2)}</b><span>99.99</span></div>
      </div>
    </div>`;
  }

  function limboScene() {
    const crash = state.lastBet?.details?.crash;
    const target = state.options.limbo.target;
    return `<div class="limbo-scene">
      <div class="limbo-grid"></div>
      <div class="limbo-particles">${Array.from({ length: 18 }, (_, index) => `<i style="--i:${index};--x:${8 + index * 5}%;--y:${16 + (index * 17) % 68}%"></i>`).join('')}</div>
      <div class="limbo-portal" id="limboPortal"><div class="portal-core"></div><small>QUANTUM HEIGHT</small><strong id="limboValue">${crash == null ? '1.00' : Number(crash).toFixed(2)}<span>×</span></strong></div>
      <div class="limbo-target-label">TARGET <b>${Number(target).toFixed(2)}×</b></div>
    </div>`;
  }

  function renderScene() {
    const builders = { crossing: crossingScene, mines: minesScene, plinko: plinkoScene, tower: towerScene, dice: diceScene, limbo: limboScene };
    els.gameScene.innerHTML = builders[game]();
    els.gameScene.querySelectorAll('.mine-cell[data-choice],.tower-cell[data-choice]').forEach(button => {
      button.addEventListener('click', () => playStep(Number(button.dataset.choice)));
    });
  }

  function renderControls() {
    const signedIn = Boolean(user());
    const currentStake = stake();
    const progressive = ['crossing', 'mines', 'tower'].includes(game);
    const active = Boolean(state.session);
    const progress = Number(state.session?.progress || 0);

    els.gameStake.disabled = active || state.pending || !signedIn;
    els.stakeMinus.disabled = active || state.pending || !signedIn;
    els.stakePlus.disabled = active || state.pending || !signedIn;
    els.instantChips.querySelectorAll('button').forEach(button => { button.disabled = active || state.pending || !signedIn; });
    els.gameOptions.querySelectorAll('button,input').forEach(control => { control.disabled = active || state.pending; });

    els.sessionMeter.hidden = !active;
    if (active) {
      els.sessionMultiplier.textContent = `${Number(state.session.multiplier || 1).toFixed(2)}×`;
      els.sessionReturn.textContent = money(Number(state.session.stake || currentStake) * Number(state.session.multiplier || 1));
    }

    els.cashoutAction.hidden = !(active && progressive && progress > 0);
    els.cashoutAction.disabled = state.pending;
    els.primaryAction.disabled = state.pending || (!signedIn ? false : !active && !currentStake);

    if (!signedIn) {
      state.error = '';
      els.gameNote.classList.remove('error');
      els.actionEyebrow.textContent = 'ACCOUNT REQUIRED';
      els.actionLabel.textContent = 'SIGN IN TO PLAY';
      els.gameNote.innerHTML = '<i class="fa-solid fa-lock"></i> The full game stays visible. Sign in to unlock demo-credit play.';
      return;
    }

    if (active) {
      if (game === 'crossing') {
        els.actionEyebrow.textContent = `LANE ${progress + 1}`;
        els.actionLabel.textContent = definitions[game].action;
      } else {
        els.actionEyebrow.textContent = `${progress} SAFE ${game === 'tower' ? 'FLOORS' : 'PICKS'}`;
        els.actionLabel.textContent = definitions[game].action;
      }
      els.primaryAction.disabled = state.pending || game === 'mines' || game === 'tower';
      els.gameNote.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Current round is protected by the server.`;
    } else {
      els.actionEyebrow.textContent = 'NEW ROUND';
      els.actionLabel.textContent = `${definitions[game].action} · ${money(currentStake)}`;
      els.gameNote.innerHTML = '<i class="fa-solid fa-circle-info"></i> Results are server-decided and wallet updates are atomic.';
    }
    if (state.error) {
      els.gameNote.classList.add('error');
      els.gameNote.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(state.error)}`;
    } else {
      els.gameNote.classList.remove('error');
    }
  }

  function showResult(bet) {
    if (!bet || bet.status === 'pending') {
      els.gameResult.hidden = true;
      return;
    }
    const returned = Number(bet.payout || 0) > 0;
    els.gameResult.className = `game-result ${returned ? 'won' : 'lost'}`;
    els.gameResult.hidden = false;
    els.resultEyebrow.textContent = returned ? 'ROUND RETURN' : 'ROUND COMPLETE';
    els.resultValue.textContent = returned ? `${Number(bet.multiplier || 0).toFixed(2)}×` : '0.00×';
    els.resultMessage.textContent = returned
      ? `${money(bet.payout)} credited to your demo balance.`
      : 'The round ended before cash-out.';
    els.resultReplay.focus({ preventScroll: true });
  }

  async function animateInstantResult(bet) {
    els.gameResult.hidden = true;
    if (game === 'plinko') {
      const ball = document.getElementById('livePlinkoBall');
      const path = bet.details?.path || [];
      let position = 50;
      for (let row = 0; row < path.length; row += 1) {
        position += path[row] ? 4.6 : -4.6;
        ball.style.top = `${50 + row * 42}px`;
        ball.style.left = `${position}%`;
        await delay(130);
      }
      document.querySelector(`[data-bucket="${bet.details?.slot}"]`)?.classList.add('landed');
      await delay(420);
    } else if (game === 'dice') {
      const die = document.getElementById('precisionDie');
      die.classList.add('rolling');
      const output = document.getElementById('diceRollValue');
      for (let index = 0; index < 10; index += 1) {
        output.textContent = (Math.random() * 100).toFixed(2);
        await delay(70);
      }
      output.textContent = Number(bet.details?.roll || 0).toFixed(2);
      await delay(260);
    } else if (game === 'limbo') {
      const portal = document.getElementById('limboPortal');
      const output = document.getElementById('limboValue');
      portal.classList.add('running');
      const crash = Number(bet.details?.crash || 1);
      for (let index = 1; index <= 14; index += 1) {
        const value = 1 + ((crash - 1) * index / 14);
        output.innerHTML = `${value.toFixed(2)}<span>×</span>`;
        await delay(55);
      }
      await delay(260);
    }
    showResult(bet);
  }

  async function loadHistory() {
    if (!user()) {
      state.history = [];
      renderHistory();
      return;
    }
    const { data, error } = await state.backend.client
      .from('instant_game_bets')
      .select('id,game,stake,status,multiplier,payout,created_at')
      .eq('game', game)
      .order('created_at', { ascending: false })
      .limit(12);
    if (!error) state.history = data || [];
    renderHistory();
  }

  function renderHistory() {
    els.historyStatus.textContent = user() ? `${state.history.length} recent` : 'Sign in required';
    if (!user()) {
      els.instantHistory.innerHTML = '<div class="instant-empty"><i class="fa-solid fa-lock"></i><span>Sign in to view your activity.</span></div>';
      return;
    }
    if (!state.history.length) {
      els.instantHistory.innerHTML = '<div class="instant-empty"><i class="fa-solid fa-ticket"></i><span>Your rounds will appear here.</span></div>';
      return;
    }
    els.instantHistory.innerHTML = state.history.map(item => {
      const returned = Number(item.payout || 0) > 0;
      return `<div class="instant-history-row ${returned ? 'won' : 'lost'}">
        <div><span>STAKE</span><b>${money(item.stake)}</b></div>
        <div class="history-outcome"><span>${returned ? 'RETURN' : 'RESULT'}</span><b>${returned ? money(item.payout) : item.status === 'pending' ? 'IN PLAY' : 'LOST'}</b></div>
      </div>`;
    }).join('');
  }

  function configForServer() {
    const option = state.options[game];
    if (game === 'crossing') return { difficulty: option.difficulty };
    if (game === 'mines') return { mines: Number(option.mines) };
    if (game === 'plinko') return { risk: option.risk };
    if (game === 'dice') return { mode: option.mode, target: Number(option.target) };
    if (game === 'limbo') return { target: Number(option.target) };
    return {};
  }

  async function startRound() {
    if (state.pending) return;
    if (!user()) {
      window.openAceAuth?.(false);
      notify('Sign in to play Ace Originals.', true);
      return;
    }
    const amount = stake();
    if (!amount) {
      notify('Enter a stake between ₹10 and ₹1,00,000.', true);
      return;
    }
    state.pending = true;
    state.error = '';
    els.gameResult.hidden = true;
    renderControls();
    revealStage();
    try {
      const { data, error } = await state.backend.client.rpc('instant_game_start', {
        p_game: game,
        p_stake: amount,
        p_config: configForServer()
      });
      if (error) throw error;
      setBalance(data.balance);
      state.session = data.session || null;
      state.lastBet = data.bet || null;
      renderScene();
      if (state.lastBet?.status !== 'pending') {
        await animateInstantResult(state.lastBet);
      } else {
        notify(`${definitions[game].title} round started.`);
      }
      await loadHistory();
    } catch (error) {
      showClientError(error);
    } finally {
      state.pending = false;
      renderControls();
    }
  }

  async function playStep(choice = null) {
    if (!state.session || state.pending) return;
    state.pending = true;
    state.error = '';
    renderControls();
    try {
      const { data, error } = await state.backend.client.rpc('instant_game_action', {
        p_session_id: state.session.id,
        p_action: 'step',
        p_choice: choice
      });
      if (error) throw error;
      setBalance(data.balance);
      state.session = data.session || null;
      state.lastBet = data.bet || state.lastBet;
      renderScene();
      if (!state.session) {
        await delay(460);
        showResult(state.lastBet);
        await loadHistory();
      } else if (game === 'crossing') {
        document.querySelector('.crossing-player')?.classList.add('hop');
        setTimeout(() => document.querySelector('.crossing-player')?.classList.remove('hop'), 520);
      }
    } catch (error) {
      showClientError(error);
    } finally {
      state.pending = false;
      renderControls();
    }
  }

  async function cashOut() {
    if (!state.session || state.pending) return;
    state.pending = true;
    state.error = '';
    renderControls();
    try {
      const { data, error } = await state.backend.client.rpc('instant_game_action', {
        p_session_id: state.session.id,
        p_action: 'cashout',
        p_choice: null
      });
      if (error) throw error;
      setBalance(data.balance);
      state.session = null;
      state.lastBet = data.bet;
      renderScene();
      showResult(state.lastBet);
      notify(`${money(data.bet.payout)} credited to your demo balance.`);
      await loadHistory();
    } catch (error) {
      showClientError(error);
    } finally {
      state.pending = false;
      renderControls();
    }
  }

  async function restoreSession() {
    if (!user()) {
      state.session = null;
      state.lastBet = null;
      renderScene();
      renderControls();
      await loadHistory();
      return;
    }
    try {
      const { data, error } = await state.backend.client.rpc('instant_game_state', { p_game: game });
      if (error) throw error;
      state.session = data?.session || null;
      state.lastBet = data?.bet || null;
      setBalance(data?.balance);
    } catch (_error) {
      state.session = null;
    }
    renderScene();
    renderControls();
    await loadHistory();
  }

  function bindEvents() {
    els.primaryAction.addEventListener('click', () => state.session ? playStep() : startRound());
    els.cashoutAction.addEventListener('click', cashOut);
    els.gameStake.addEventListener('input', renderControls);
    els.stakeMinus.addEventListener('click', () => {
      els.gameStake.value = Math.max(10, (stake() || 10) - 10);
      renderControls();
    });
    els.stakePlus.addEventListener('click', () => {
      els.gameStake.value = Math.min(100000, (stake() || 0) + 10);
      renderControls();
    });
    els.instantChips.addEventListener('click', event => {
      const button = event.target.closest('[data-stake]');
      if (!button) return;
      els.gameStake.value = button.dataset.stake;
      renderControls();
    });
    els.resultReplay.addEventListener('click', () => {
      els.gameResult.hidden = true;
      els.primaryAction.focus({ preventScroll: true });
    });
    window.addEventListener('ace:session', restoreSession);
  }

  async function init() {
    cacheElements();
    setupIdentity();
    renderOptions();
    renderScene();
    state.backend = window.AceBackend;
    if (!state.backend) {
      els.gameNote.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Game service could not initialize.';
      return;
    }
    bindEvents();
    renderControls();
    await restoreSession();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
