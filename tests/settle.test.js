'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settlement = require('../api/settle.js');

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

test('finalScores matches scores by team name, not response order', () => {
  const scores = settlement._test.finalScores({
    scores: [
      { name: 'Away FC', score: '1' },
      { name: 'Home FC', score: '3' }
    ]
  }, {
    home_team: 'Home FC',
    away_team: 'Away FC'
  });

  assert.deepEqual(scores, { home: 3, away: 1 });
});

test('finalScores rejects non-numeric or unmatched results', () => {
  assert.equal(settlement._test.finalScores({
    scores: [
      { name: 'Home FC', score: '120/4' },
      { name: 'Away FC', score: '118/9' }
    ]
  }, {
    home_team: 'Home FC',
    away_team: 'Away FC'
  }), null);
});

test('runSettlement settles a completed event once through the server RPC', async t => {
  const originalFetch = global.fetch;
  const requests = [];
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/rpc/list_pending_provider_events')) {
      return jsonResponse([{
        id: 'event-1',
        provider_event_id: 'provider-1',
        provider_sport_key: 'basketball_nba',
        home_team: 'Home Team',
        away_team: 'Away Team',
        starts_at: '2026-07-30T01:00:00Z',
        status: 'scheduled'
      }]);
    }
    if (String(url).includes('/scores/')) {
      return jsonResponse([{
        id: 'provider-1',
        completed: true,
        home_team: 'Home Team',
        away_team: 'Away Team',
        scores: [
          { name: 'Home Team', score: '105' },
          { name: 'Away Team', score: '99' }
        ],
        last_update: '2026-07-30T03:00:00Z'
      }], 200, {
        'x-requests-remaining': '90',
        'x-requests-used': '10',
        'x-requests-last': '2'
      });
    }
    if (String(url).includes('/rpc/settle_provider_event')) {
      return jsonResponse({
        event_id: 'event-1',
        outcome: 'home',
        bets_settled: 2,
        total_paid: 500,
        already_settled: false
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const report = await settlement._test.runSettlement({
    oddsApiKey: 'odds-secret',
    supabaseUrl: 'https://example.supabase.co',
    supabaseSecretKey: 'sb_secret_test'
  });

  assert.equal(report.ok, true);
  assert.equal(report.settled.length, 1);
  assert.equal(report.settled[0].outcome, 'home');
  assert.equal(report.settled[0].bets_settled, 2);

  const rpcRequest = requests.find(request =>
    request.url.includes('/rpc/settle_provider_event')
  );
  assert.equal(rpcRequest.options.headers.apikey, 'sb_secret_test');
  assert.equal(
    JSON.parse(rpcRequest.options.body).p_provider_event_id,
    'provider-1'
  );
});

test('runSettlement skips a result that cannot be interpreted safely', async t => {
  const originalFetch = global.fetch;
  let rpcCalled = false;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url) => {
    if (String(url).includes('/rpc/list_pending_provider_events')) {
      return jsonResponse([{
        id: 'event-2',
        provider_event_id: 'provider-2',
        provider_sport_key: 'cricket_ipl',
        home_team: 'Home XI',
        away_team: 'Away XI',
        starts_at: '2026-07-30T01:00:00Z',
        status: 'scheduled'
      }]);
    }
    if (String(url).includes('/scores/')) {
      return jsonResponse([{
        id: 'provider-2',
        completed: true,
        scores: [
          { name: 'Home XI', score: '180/4' },
          { name: 'Away XI', score: '179/8' }
        ]
      }]);
    }
    rpcCalled = true;
    return jsonResponse({});
  };

  const report = await settlement._test.runSettlement({
    oddsApiKey: 'odds-secret',
    supabaseUrl: 'https://example.supabase.co',
    supabaseSecretKey: 'sb_secret_test'
  });

  assert.equal(rpcCalled, false);
  assert.equal(report.settled.length, 0);
  assert.equal(report.skipped[0].reason, 'ambiguous_or_non_numeric_score');
});
