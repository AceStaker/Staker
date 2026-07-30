'use strict';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = /^[a-z0-9_]{2,80}$/;
const MAX_EVENTS = 200;
const SCORE_LOOKBACK_DAYS = 3;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function getHeader(req, name) {
  if (typeof req.headers?.get === 'function') return req.headers.get(name);
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requireEnvironment() {
  const values = {
    cronSecret: process.env.CRON_SECRET,
    oddsApiKey: process.env.ODDS_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing server environment: ${missing.join(', ')}`);
  }
  return values;
}

async function readResponse(response, label) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || payload?.hint || response.statusText;
    throw new Error(`${label} failed (${response.status}): ${detail || 'Unknown error'}`);
  }
  return payload;
}

async function loadUnsettledEvents(config) {
  const url = new URL('/rest/v1/rpc/list_pending_provider_events', config.supabaseUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: config.supabaseSecretKey
    },
    body: '{}'
  });
  const payload = await readResponse(response, 'Loading unsettled events');
  return Array.isArray(payload) ? payload : [];
}

async function loadCompletedScores(sportKey, config) {
  if (!SPORT_KEY.test(sportKey)) throw new Error(`Invalid provider sport key: ${sportKey}`);
  const url = new URL(
    `${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/scores/`
  );
  url.searchParams.set('apiKey', config.oddsApiKey);
  url.searchParams.set('daysFrom', String(SCORE_LOOKBACK_DAYS));
  url.searchParams.set('dateFormat', 'iso');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Ace-Staker-Settlement/1.0'
    }
  });
  const payload = await readResponse(response, `Loading scores for ${sportKey}`);
  return {
    games: (Array.isArray(payload) ? payload : []).filter(game => game?.completed === true),
    quota: {
      remaining: Number(response.headers.get('x-requests-remaining')),
      used: Number(response.headers.get('x-requests-used')),
      last: Number(response.headers.get('x-requests-last'))
    }
  };
}

function finalScores(game, event) {
  if (!Array.isArray(game?.scores)) return null;
  const byName = new Map(
    game.scores.map(score => [String(score?.name || ''), String(score?.score ?? '')])
  );
  const homeRaw = byName.get(event.home_team);
  const awayRaw = byName.get(event.away_team);
  if (homeRaw === undefined || awayRaw === undefined) return null;
  if (!/^\d+(?:\.\d+)?$/.test(homeRaw) || !/^\d+(?:\.\d+)?$/.test(awayRaw)) {
    return null;
  }
  const home = Number(homeRaw);
  const away = Number(awayRaw);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home < 0 || away < 0) {
    return null;
  }
  return { home, away };
}

async function settleEvent(event, game, scores, config) {
  const url = new URL('/rest/v1/rpc/settle_provider_event', config.supabaseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: config.supabaseSecretKey
    },
    body: JSON.stringify({
      p_provider_event_id: event.provider_event_id,
      p_home_score: scores.home,
      p_away_score: scores.away,
      p_provider_last_update: game.last_update || null,
      p_raw_result: game
    })
  });
  return readResponse(response, `Settling provider event ${event.provider_event_id}`);
}

async function runSettlement(config) {
  const events = (await loadUnsettledEvents(config)).slice(0, MAX_EVENTS);
  const eventsBySport = new Map();
  const skipped = [];
  const errors = [];
  const settled = [];
  const quota = {};

  for (const event of events) {
    if (!SPORT_KEY.test(String(event.provider_sport_key || ''))) {
      skipped.push({
        provider_event_id: event.provider_event_id,
        reason: 'missing_provider_sport_key'
      });
      continue;
    }
    const sportEvents = eventsBySport.get(event.provider_sport_key) || [];
    sportEvents.push(event);
    eventsBySport.set(event.provider_sport_key, sportEvents);
  }

  for (const [sportKey, candidates] of eventsBySport) {
    let scoreFeed;
    try {
      scoreFeed = await loadCompletedScores(sportKey, config);
      quota[sportKey] = scoreFeed.quota;
    } catch (error) {
      errors.push({ sport_key: sportKey, error: error.message });
      continue;
    }

    const gamesById = new Map(scoreFeed.games.map(game => [game.id, game]));
    for (const event of candidates) {
      const game = gamesById.get(event.provider_event_id);
      if (!game) {
        skipped.push({
          provider_event_id: event.provider_event_id,
          reason: 'result_not_available'
        });
        continue;
      }

      const scores = finalScores(game, event);
      if (!scores) {
        skipped.push({
          provider_event_id: event.provider_event_id,
          reason: 'ambiguous_or_non_numeric_score'
        });
        continue;
      }

      try {
        const result = await settleEvent(event, game, scores, config);
        settled.push({
          provider_event_id: event.provider_event_id,
          event_id: result.event_id,
          outcome: result.outcome,
          bets_settled: result.bets_settled,
          total_paid: result.total_paid,
          already_settled: result.already_settled
        });
      } catch (error) {
        errors.push({
          provider_event_id: event.provider_event_id,
          error: error.message
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    checked_at: new Date().toISOString(),
    candidate_events: events.length,
    settled,
    skipped,
    errors,
    quota
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let config;
  try {
    config = requireEnvironment();
  } catch (error) {
    console.error(error.message);
    return sendJson(res, 503, { error: 'Automatic settlement is not configured.' });
  }

  if (getHeader(req, 'authorization') !== `Bearer ${config.cronSecret}`) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  try {
    const report = await runSettlement(config);
    if (report.errors.length) console.error('Settlement completed with errors:', report.errors);
    return sendJson(res, report.errors.length ? 207 : 200, report);
  } catch (error) {
    console.error('Automatic settlement failed:', error);
    return sendJson(res, 500, { error: 'Automatic settlement failed.' });
  }
}

module.exports = handler;
module.exports._test = {
  finalScores,
  runSettlement,
  loadUnsettledEvents,
  loadCompletedScores
};
