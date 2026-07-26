const API_BASE = 'https://api.the-odds-api.com/v4';
const ALLOWED_REGIONS = new Set(['us', 'us2', 'uk', 'eu', 'au']);
const SPORT_KEY = /^[a-z0-9_]{2,80}$/;
const BOOKMAKER_PRIORITY = [
  'pinnacle',
  'betfair_ex_eu',
  'betfair',
  'bet365',
  'williamhill',
  'draftkings',
  'fanduel',
  'betmgm',
  'unibet'
];

function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
}

function chooseBookmaker(bookmakers = []) {
  const withMoneyline = bookmakers.filter(bookmaker =>
    bookmaker.markets?.some(market => market.key === 'h2h' && market.outcomes?.length >= 2)
  );
  if (!withMoneyline.length) return null;
  return withMoneyline.sort((left, right) => {
    const leftRank = BOOKMAKER_PRIORITY.indexOf(left.key);
    const rightRank = BOOKMAKER_PRIORITY.indexOf(right.key);
    const normalizedLeft = leftRank === -1 ? 999 : leftRank;
    const normalizedRight = rightRank === -1 ? 999 : rightRank;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return new Date(right.last_update || 0) - new Date(left.last_update || 0);
  })[0];
}

function normalizeEvent(event) {
  const bookmaker = chooseBookmaker(event.bookmakers);
  const market = bookmaker?.markets?.find(candidate => candidate.key === 'h2h');
  if (!bookmaker || !market) return null;

  const outcomes = market.outcomes
    .filter(outcome => Number(outcome.price) > 1 && Number(outcome.price) <= 1000)
    .map(outcome => ({
      name: String(outcome.name || '').slice(0, 120),
      price: Number(Number(outcome.price).toFixed(3))
    }));
  if (outcomes.length < 2) return null;

  const startsAt = new Date(event.commence_time);
  const ageMs = Date.now() - startsAt.getTime();
  const isLikelyLive = ageMs >= 0 && ageMs <= 8 * 60 * 60 * 1000;

  return {
    provider: 'the_odds_api',
    provider_event_id: event.id,
    sport_key: event.sport_key,
    sport: event.sport_title || event.sport_key,
    league: event.sport_title || event.sport_key,
    home_team: event.home_team,
    away_team: event.away_team,
    starts_at: event.commence_time,
    status: isLikelyLive ? 'live' : 'scheduled',
    bookmaker_key: bookmaker.key,
    bookmaker: bookmaker.title,
    last_update: bookmaker.last_update,
    market_key: market.key,
    outcomes
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return json(res, 503, { error: 'Sports feed is not configured.' });
  }

  const sport = String(req.query?.sport || 'upcoming').toLowerCase();
  const region = String(req.query?.region || 'uk').toLowerCase();
  if (!SPORT_KEY.test(sport) || !ALLOWED_REGIONS.has(region)) {
    return json(res, 400, { error: 'Unsupported sport or bookmaker region.' });
  }

  const url = new URL(`${API_BASE}/sports/${encodeURIComponent(sport)}/odds/`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', region);
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Ace-Staker-Odds-Proxy/1.0' }
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message = payload?.message || payload?.error_code || 'The sports provider rejected the request.';
      return json(res, upstream.status, { error: message });
    }

    const events = (Array.isArray(payload) ? payload : [])
      .map(normalizeEvent)
      .filter(Boolean)
      .slice(0, 50);
    const quota = {
      remaining: Number(upstream.headers.get('x-requests-remaining')),
      used: Number(upstream.headers.get('x-requests-used')),
      last: Number(upstream.headers.get('x-requests-last'))
    };

    return json(res, 200, {
      provider: 'The Odds API',
      sport,
      region,
      fetched_at: new Date().toISOString(),
      quota,
      events
    }, {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
    });
  } catch (error) {
    console.error('Odds provider request failed:', error?.message || error);
    return json(res, 502, { error: 'The sports provider is temporarily unavailable.' });
  }
};