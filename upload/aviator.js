(function () {
  'use strict';

  const CURVE_RATE = 0.12;
  const POLL_MS = 650;
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  const els = {};
  const betControls = [];
  let backend;
  let snapshot;
  let serverOffset = 0;
  let pollTimer;
  let frameId;
  let requestPending = false;
  const pendingSlots = new Set();
  let previousStatus = '';
  let previousRoundId = '';
  let impactRoundId = '';
  let soundEnabled = false;
  let audioContext;

  function cacheElements() {
    [
      'flightStage', 'flightCanvas', 'planeWrap', 'roundCode', 'roundStatus',
      'countdownValue', 'multiplierValue', 'flightMessage', 'playerCount',
      'roundPool', 'roundHistory', 'myFlights', 'flightLogStatus', 'soundToggle'
    ].forEach(id => { els[id] = document.getElementById(id); });

    document.querySelectorAll('[data-bet-slot]').forEach(element => {
      const role = name => element.querySelector(`[data-role="${name}"]`);
      betControls.push({
        slot: Number(element.dataset.betSlot),
        activeTicket: role('active-ticket'),
        ticketStake: role('ticket-stake'),
        stake: role('stake'),
        stakeChips: role('stake-chips'),
        action: role('flight-action'),
        actionEyebrow: role('action-eyebrow'),
        actionLabel: role('action-label'),
        potentialMultiplier: role('potential-multiplier'),
        potentialReturn: role('potential-return'),
        note: role('console-note')
      });
    });
  }

  function user() {
    return backend?.getUser?.() || null;
  }

  function now() {
    return Date.now() + serverOffset;
  }

  function parseTime(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function roundMultiplier(round, at = now()) {
    if (!round || round.status === 'waiting') return 1;
    if (round.status === 'crashed') return Number(round.crash_multiplier || round.multiplier || 1);
    const elapsed = Math.max(0, (at - parseTime(round.starts_at)) / 1000);
    return Math.floor(Math.exp(elapsed * CURVE_RATE) * 100) / 100;
  }

  function tone(frequency, duration = .08, volume = .035) {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (_error) {
      soundEnabled = false;
    }
  }

  function notify(message, isError = false) {
    if (typeof window.showToast === 'function') window.showToast(message, isError);
  }

  async function fetchState() {
    if (!backend || requestPending || document.hidden) return;
    requestPending = true;
    try {
      const { data, error } = await backend.client.rpc('aviator_state');
      if (error) throw error;
      if (!data?.round) throw new Error('Flight control is temporarily unavailable.');

      const serverNow = parseTime(data.round.server_now);
      if (serverNow) serverOffset = serverNow - Date.now();
      snapshot = data;
      renderSnapshot();
      renderControls();
    } catch (error) {
      els.roundStatus.className = 'round-status crashed';
      els.roundStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Reconnecting';
      els.flightMessage.textContent = 'Restoring the live flight connection';
      betControls.forEach(control => {
        control.note.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${error.message}`;
      });
    } finally {
      requestPending = false;
    }
  }

  function renderSnapshot() {
    const round = snapshot.round;
    const roundChanged = previousRoundId && previousRoundId !== round.id;
    const statusChanged = previousStatus && previousStatus !== round.status;

    els.roundCode.textContent = String(round.id).slice(0, 8).toUpperCase();
    els.playerCount.textContent = Number(round.players || 0).toLocaleString('en-IN');
    els.roundPool.textContent = money(round.total_stake || 0).replace('.00', '');
    if (Number.isFinite(Number(snapshot.balance))) {
      window.AceUI?.setBalance(Number(snapshot.balance));
      window.AceUI?.updateBalanceDisplay();
    }

    renderRoundHistory(snapshot.history || []);
    renderMyFlights(snapshot.my_history || []);
    betControls.forEach(control => renderTicket(control, betForSlot(control.slot)));

    if (round.status === 'crashed' && impactRoundId !== round.id) {
      impactRoundId = round.id;
      document.body.classList.remove('round-impact');
      void document.body.offsetWidth;
      document.body.classList.add('round-impact');
      setTimeout(() => document.body.classList.remove('round-impact'), 520);
      tone(125, .42, .08);
    } else if (round.status === 'flying' && (statusChanged || roundChanged)) {
      tone(520, .11, .04);
    } else if (round.status === 'waiting' && roundChanged) {
      tone(740, .08, .025);
    }

    previousRoundId = round.id;
    previousStatus = round.status;
  }

  function renderRoundHistory(history) {
    if (!history.length) {
      els.roundHistory.innerHTML = '<span class="history-chip">No flights yet</span>';
      return;
    }
    els.roundHistory.innerHTML = history.map(item => {
      const value = Number(item.crash_multiplier || 1);
      const className = value < 2 ? 'low' : value < 5 ? 'mid' : value < 20 ? 'high' : 'epic';
      return `<span class="history-chip ${className}" title="Seed revealed after crash">${value.toFixed(2)}×</span>`;
    }).join('');
  }

  function currentBets() {
    if (Array.isArray(snapshot?.my_bets)) return snapshot.my_bets;
    return snapshot?.my_bet ? [snapshot.my_bet] : [];
  }

  function betForSlot(slot) {
    return currentBets().find(bet => Number(bet.bet_slot || 1) === slot);
  }

  function renderTicket(control, bet) {
    control.activeTicket.hidden = !bet;
    if (!bet) return;
    control.ticketStake.textContent = money(bet.stake);
  }

  function renderMyFlights(history) {
    els.flightLogStatus.textContent = user() ? `${history.length} recorded` : 'Sign in required';
    if (!user()) {
      els.myFlights.innerHTML = '<div class="flight-empty"><i class="fa-solid fa-lock"></i><span>Sign in to view your flight logbook.</span></div>';
      return;
    }
    if (!history.length) {
      els.myFlights.innerHTML = '<div class="flight-empty"><i class="fa-solid fa-ticket"></i><span>Your completed flights will appear here.</span></div>';
      return;
    }

    els.myFlights.innerHTML = history.map(item => {
      const won = item.status === 'cashed_out';
      const pending = item.status === 'pending';
      const outcomeClass = won ? 'won' : pending ? '' : 'lost';
      const outcome = won
        ? `${Number(item.cashout_multiplier).toFixed(2)}×`
        : pending ? 'IN FLIGHT' : 'FLEW AWAY';
      return `
        <div class="my-flight-row">
          <div><span>BET ${Number(item.bet_slot || 1)} · STAKE</span><b>${money(item.stake)}</b></div>
          <div><span>CRASH</span><b>${item.crash_multiplier ? `${Number(item.crash_multiplier).toFixed(2)}×` : '—'}</b></div>
          <div class="flight-result ${outcomeClass}"><span>${won ? 'PAYOUT' : 'RESULT'}</span><b>${won ? money(item.payout) : outcome}</b></div>
        </div>`;
    }).join('');
  }

  function renderControls() {
    const round = snapshot?.round;
    if (!round) return;
    const signedIn = Boolean(user());
    const waiting = round.status === 'waiting';
    const flying = round.status === 'flying';
    betControls.forEach(control => {
      const bet = betForSlot(control.slot);
      const activeBet = bet?.status === 'pending';
      const stake = validStake(control);
      const pending = pendingSlots.has(control.slot);

      control.stake.disabled = !signedIn || Boolean(bet);
      control.stakeChips.querySelectorAll('button').forEach(button => {
        button.disabled = !signedIn || Boolean(bet);
      });
      control.action.disabled = pending;
      control.action.className = 'flight-action';

      if (!signedIn) {
        control.action.classList.add('board');
        control.actionEyebrow.textContent = 'ACCOUNT REQUIRED';
        control.actionLabel.textContent = 'SIGN IN TO PLAY';
        control.note.innerHTML = '<i class="fa-solid fa-lock"></i> Sign in to unlock this betting option.';
      } else if (activeBet && flying) {
        const multiplier = roundMultiplier(round);
        const payout = Number(bet.stake) * multiplier;
        if (multiplier < 1.10) {
          control.action.classList.add('waiting');
          control.action.disabled = true;
          control.actionEyebrow.textContent = 'FLIGHT JUST STARTED';
          control.actionLabel.textContent = 'OPENS AT 1.10×';
          control.note.innerHTML = '<i class="fa-solid fa-gauge-high"></i> Cash-out unlocks at 1.10×.';
        } else {
          control.action.classList.add('cashout');
          control.actionEyebrow.textContent = `CASH OUT ${multiplier.toFixed(2)}×`;
          control.actionLabel.textContent = `COLLECT ${money(payout)}`;
          control.note.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Server-verified cash-out.';
        }
      } else if (activeBet && waiting) {
        control.action.classList.add('waiting');
        control.action.disabled = true;
        control.actionEyebrow.textContent = 'TICKET CONFIRMED';
        control.actionLabel.textContent = 'READY FOR TAKEOFF';
        control.note.innerHTML = '<i class="fa-solid fa-circle-check"></i> This stake is locked for the flight.';
      } else if (bet) {
        control.action.classList.add('waiting');
        control.action.disabled = true;
        control.actionEyebrow.textContent = bet.status === 'cashed_out' ? 'FLIGHT COMPLETE' : 'ROUND COMPLETE';
        control.actionLabel.textContent = bet.status === 'cashed_out'
          ? `COLLECTED ${money(bet.payout)}`
          : 'WAITING FOR NEXT FLIGHT';
      } else if (waiting) {
        control.action.classList.add('board');
        control.action.disabled = pending || !stake;
        control.actionEyebrow.textContent = `BET ${control.slot} · NEXT FLIGHT`;
        control.actionLabel.textContent = stake ? `BOARD FOR ${money(stake)}` : 'ENTER A VALID STAKE';
        control.note.innerHTML = '<i class="fa-solid fa-ticket"></i> One ticket in this slot per flight.';
      } else {
        control.action.classList.add('waiting');
        control.action.disabled = true;
        control.actionEyebrow.textContent = flying ? 'FLIGHT IN PROGRESS' : 'ROUND COMPLETE';
        control.actionLabel.textContent = 'BOARDING CLOSED';
        control.note.innerHTML = '<i class="fa-solid fa-clock"></i> Opens with the next flight.';
      }
    });
  }

  function renderAnimation() {
    const round = snapshot?.round;
    if (round) {
      const at = now();
      const startsAt = parseTime(round.starts_at);
      const waitingMs = startsAt - at;
      const localStatus = round.status === 'waiting' && waitingMs <= 0 ? 'flying' : round.status;

      els.flightStage.classList.toggle('is-waiting', localStatus === 'waiting');
      els.flightStage.classList.toggle('is-flying', localStatus === 'flying');
      els.flightStage.classList.toggle('is-crashed', localStatus === 'crashed');
      els.roundStatus.className = `round-status ${localStatus}`;

      if (localStatus === 'waiting') {
        els.countdownValue.textContent = Math.max(0, waitingMs / 1000).toFixed(1);
        els.roundStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Boarding';
        els.flightMessage.textContent = 'Place your ticket before takeoff';
      } else if (localStatus === 'flying') {
        const multiplier = roundMultiplier({ ...round, status: 'flying' }, at);
        els.multiplierValue.innerHTML = `${multiplier.toFixed(2)}<span>×</span>`;
        els.roundStatus.innerHTML = '<i class="fa-solid fa-circle"></i> In flight';
        els.flightMessage.textContent = currentBets().some(bet => bet.status === 'pending')
          ? 'Cash out before the plane flies away'
          : 'The multiplier is climbing';
        updatePlane(at - startsAt);
        if (currentBets().some(bet => bet.status === 'pending')) renderControls();
      } else {
        const crash = Number(round.crash_multiplier || round.multiplier || 1);
        els.multiplierValue.innerHTML = `${crash.toFixed(2)}<span>×</span>`;
        els.roundStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Flew away';
        els.flightMessage.textContent = `Crashed at ${crash.toFixed(2)}×`;
      }

      drawFlightPath(localStatus, at - startsAt);
    }

    frameId = requestAnimationFrame(renderAnimation);
  }

  function updatePlane(elapsedMs) {
    const elapsed = Math.max(0, elapsedMs / 1000);
    const progress = Math.min(.985, 1 - Math.exp(-elapsed / 11));
    const compact = window.innerWidth <= 600;
    const x = (compact ? 24 : 12) + ((compact ? 66 : 78) * progress);
    const y = 80 - (61 * Math.pow(progress, .78));
    const bank = -4 + (7 * progress) + (Math.sin(elapsed * 1.15) * .7);
    const scale = .72 + (.32 * progress);
    els.planeWrap.style.setProperty('--plane-x', `${x}%`);
    els.planeWrap.style.setProperty('--plane-y', `${y}%`);
    els.planeWrap.style.setProperty('--plane-bank', `${bank}deg`);
    els.planeWrap.style.setProperty('--plane-scale', scale.toFixed(3));
  }

  function sizeCanvas(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return rect;
  }

  function drawFlightPath(status, elapsedMs) {
    const canvas = els.flightCanvas;
    const context = canvas.getContext('2d');
    const rect = sizeCanvas(canvas, context);
    context.clearRect(0, 0, rect.width, rect.height);
    if (status === 'waiting') return;

    const elapsed = Math.max(0, elapsedMs / 1000);
    const progress = status === 'crashed'
      ? 1
      : Math.min(.985, 1 - Math.exp(-elapsed / 11));
    const startX = rect.width * .10;
    const startY = rect.height * .82;
    const compact = rect.width <= 600;
    const endX = rect.width * ((compact ? .24 : .12) + (compact ? .66 : .78) * progress);
    const endY = rect.height * (.80 - .61 * Math.pow(progress, .78));

    const gradient = context.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, 'rgba(255,49,88,0)');
    gradient.addColorStop(.48, 'rgba(255,49,88,.6)');
    gradient.addColorStop(1, status === 'crashed' ? 'rgba(255,49,88,.12)' : 'rgba(255,149,83,.95)');

    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + (endX - startX) * .38,
      startY - (startY - endY) * .08,
      startX + (endX - startX) * .68,
      startY - (startY - endY) * .72,
      endX,
      endY
    );
    context.strokeStyle = gradient;
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.shadowColor = '#ff3158';
    context.shadowBlur = 15;
    context.stroke();

    context.lineTo(endX, startY);
    context.lineTo(startX, startY);
    context.closePath();
    const fill = context.createLinearGradient(0, endY, 0, startY);
    fill.addColorStop(0, 'rgba(255,49,88,.11)');
    fill.addColorStop(1, 'rgba(255,49,88,0)');
    context.fillStyle = fill;
    context.shadowBlur = 0;
    context.fill();
  }

  function validStake(control) {
    const value = Number(control.stake.value);
    return Number.isFinite(value) && value >= 10 && value <= 100000 ? Math.round(value * 100) / 100 : 0;
  }

  function updatePotential(control) {
    const stake = validStake(control);
    const multiplier = 2;
    control.potentialMultiplier.textContent = `${multiplier.toFixed(2)}×`;
    control.potentialReturn.textContent = money(stake * multiplier);
    renderControls();
  }

  async function handleAction(control) {
    if (pendingSlots.has(control.slot)) return;
    if (!user()) {
      window.openAceAuth?.(false);
      notify('Sign in to unlock Aviator betting.', true);
      return;
    }

    const round = snapshot?.round;
    if (!round) return;
    const bet = betForSlot(control.slot);
    pendingSlots.add(control.slot);
    renderControls();

    try {
      if (bet?.status === 'pending' && round.status === 'flying') {
        const { data, error } = await backend.client.rpc('aviator_cash_out_slot', {
          p_slot: control.slot
        });
        if (error) throw error;
        tone(920, .18, .055);
        notify(`Cashed out at ${Number(data.multiplier).toFixed(2)}× — ${money(data.payout)} credited.`);
      } else if (!bet && round.status === 'waiting') {
        const stake = validStake(control);
        if (!stake) throw new Error('Enter a stake between ₹10 and ₹1,00,000.');
        const { error } = await backend.client.rpc('aviator_place_bet_slot', {
          p_stake: stake,
          p_slot: control.slot,
          p_auto_cashout: null
        });
        if (error) throw error;
        tone(660, .12, .04);
        notify(`Bet ${control.slot} confirmed. Prepare for takeoff.`);
      }
    } catch (error) {
      notify(error.message, true);
    } finally {
      pendingSlots.delete(control.slot);
      await fetchState();
      renderControls();
    }
  }

  function bindEvents() {
    betControls.forEach(control => {
      control.action.addEventListener('click', () => handleAction(control));
      control.stake.addEventListener('input', () => updatePotential(control));
      control.stakeChips.addEventListener('click', event => {
        const button = event.target.closest('[data-stake]');
        if (!button) return;
        control.stake.value = button.dataset.stake;
        updatePotential(control);
      });
    });
    els.soundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      els.soundToggle.setAttribute('aria-pressed', String(soundEnabled));
      els.soundToggle.innerHTML = soundEnabled
        ? '<i class="fa-solid fa-volume-high"></i> Sound'
        : '<i class="fa-solid fa-volume-xmark"></i> Sound';
      tone(760, .08, .03);
    });
    window.addEventListener('ace:session', async () => {
      await fetchState();
      renderControls();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) fetchState();
    });
  }

  async function init() {
    cacheElements();
    backend = window.AceBackend;
    if (!backend) {
      els.flightMessage.textContent = 'Flight control could not initialize';
      return;
    }

    bindEvents();
    betControls.forEach(updatePotential);
    await fetchState();
    pollTimer = window.setInterval(fetchState, POLL_MS);
    frameId = requestAnimationFrame(renderAnimation);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', () => {
    clearInterval(pollTimer);
    cancelAnimationFrame(frameId);
  });
})();
