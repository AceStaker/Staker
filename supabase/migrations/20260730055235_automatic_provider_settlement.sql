alter table public.events
  add column if not exists provider_result jsonb,
  add column if not exists provider_settled_at timestamptz,
  add column if not exists settlement_source text;

alter table public.events
  drop constraint if exists events_settlement_source_check;

alter table public.events
  add constraint events_settlement_source_check
  check (settlement_source is null or settlement_source in ('admin', 'the_odds_api'));

create index if not exists events_unsettled_provider_idx
  on public.events (provider_sport_key, starts_at)
  where provider_event_id is not null and provider_settled_at is null;

create schema if not exists private;

create table if not exists private.provider_settlement_log (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text not null,
  event_id uuid references public.events(id),
  outcome_key text,
  home_score numeric,
  away_score numeric,
  bets_settled integer not null default 0,
  total_paid numeric(14,2) not null default 0,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table private.provider_settlement_log enable row level security;
revoke all on table private.provider_settlement_log from public, anon, authenticated;
revoke all on sequence private.provider_settlement_log_id_seq from public, anon, authenticated;

create or replace function public.settle_provider_event(
  p_provider_event_id text,
  p_home_score numeric,
  p_away_score numeric,
  p_provider_last_update timestamptz default null,
  p_raw_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.events%rowtype;
  v_bet record;
  v_outcome_key text;
  v_winning_selection_id uuid;
  v_void boolean := false;
  v_payout numeric(14,2);
  v_settled integer := 0;
  v_paid numeric(14,2) := 0;
  v_all_void boolean;
  v_has_loss boolean;
  v_has_pending boolean;
  v_effective_odds numeric(12,3);
  v_claims jsonb;
begin
  v_claims := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );

  if coalesce(v_claims ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role access required';
  end if;

  if nullif(trim(p_provider_event_id), '') is null then
    raise exception 'Provider event ID is required';
  end if;

  if p_home_score is null or p_away_score is null
     or p_home_score < 0 or p_away_score < 0 then
    raise exception 'Valid non-negative final scores are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('the_odds_api:' || p_provider_event_id, 0)
  );

  select *
  into v_event
  from public.events
  where provider = 'the_odds_api'
    and provider_event_id = p_provider_event_id
  for update;

  if not found then
    raise exception 'Provider event not found';
  end if;

  if v_event.provider_settled_at is not null then
    return jsonb_build_object(
      'already_settled', true,
      'event_id', v_event.id,
      'bets_settled', 0,
      'total_paid', 0
    );
  end if;

  v_outcome_key := case
    when p_home_score > p_away_score then 'home'
    when p_away_score > p_home_score then 'away'
    else 'draw'
  end;

  select ms.id
  into v_winning_selection_id
  from public.market_selections ms
  join public.markets m on m.id = ms.market_id
  where m.event_id = v_event.id
    and ms.outcome_key = v_outcome_key
  order by m.created_at, ms.id
  limit 1;

  if v_winning_selection_id is null then
    if v_outcome_key = 'draw' then
      v_void := true;
    else
      raise exception 'Winning selection is missing for provider event';
    end if;
  end if;

  update public.bet_legs bl
  set result = case
    when v_void then 'void'::public.bet_status
    when bl.selection_id = v_winning_selection_id then 'won'::public.bet_status
    else 'lost'::public.bet_status
  end
  from public.bets b
  where bl.bet_id = b.id
    and bl.event_id = v_event.id
    and bl.result = 'pending'
    and b.status = 'pending';

  update public.events
  set status = 'finished'::public.event_status,
      live_score = p_home_score::text || ' - ' || p_away_score::text,
      provider_last_update = coalesce(p_provider_last_update, provider_last_update),
      provider_result = coalesce(p_raw_result, '{}'::jsonb),
      provider_settled_at = now(),
      settlement_source = 'the_odds_api',
      updated_at = now()
  where id = v_event.id;

  update public.markets
  set status = case
        when v_void then 'void'::public.market_status
        else 'settled'::public.market_status
      end,
      updated_at = now()
  where event_id = v_event.id;

  update public.market_selections ms
  set is_active = false,
      updated_at = now()
  where exists (
    select 1
    from public.markets m
    where m.id = ms.market_id
      and m.event_id = v_event.id
  );

  for v_bet in
    select b.id, b.user_id, b.stake
    from public.bets b
    where b.status = 'pending'
      and exists (
        select 1
        from public.bet_legs bl
        where bl.bet_id = b.id
          and bl.event_id = v_event.id
      )
    order by b.id
    for update of b
  loop
    select
      bool_or(result = 'lost'),
      bool_or(result = 'pending'),
      bool_and(result = 'void'),
      coalesce(
        round(exp(sum(ln(odds_snapshot)) filter (where result = 'won'))::numeric, 3),
        1
      )
    into v_has_loss, v_has_pending, v_all_void, v_effective_odds
    from public.bet_legs
    where bet_id = v_bet.id;

    if v_has_loss then
      update public.bets
      set status = 'lost',
          settled_payout = 0,
          settled_at = now()
      where id = v_bet.id;

      insert into public.user_notifications (user_id, kind, title, message)
      values (
        v_bet.user_id,
        'bet_lost',
        'Bet settled',
        'Your bet was settled as a loss.'
      );

      v_settled := v_settled + 1;
    elsif not v_has_pending then
      if v_all_void then
        v_payout := v_bet.stake;

        update public.bets
        set status = 'void',
            settled_payout = v_payout,
            settled_at = now()
        where id = v_bet.id;

        insert into public.user_notifications (user_id, kind, title, message)
        values (
          v_bet.user_id,
          'bet_void',
          'Bet refunded',
          'Your void bet stake was returned.'
        );
      else
        v_payout := round(v_bet.stake * v_effective_odds, 2);

        update public.bets
        set status = 'won',
            settled_payout = v_payout,
            settled_at = now()
        where id = v_bet.id;

        insert into public.user_notifications (user_id, kind, title, message)
        values (
          v_bet.user_id,
          'bet_won',
          'Bet won',
          'Your demo payout has been credited.'
        );
      end if;

      update public.wallets
      set balance = balance + v_payout,
          updated_at = now()
      where user_id = v_bet.user_id;

      if not found then
        raise exception 'Wallet not found for settled bet';
      end if;

      insert into public.wallet_transactions (
        user_id,
        kind,
        amount,
        balance_after,
        reference_id,
        description
      )
      select
        v_bet.user_id,
        case
          when v_all_void then 'bet_refund'::public.ledger_kind
          else 'bet_payout'::public.ledger_kind
        end,
        v_payout,
        w.balance,
        v_bet.id,
        case when v_all_void then 'Void bet refund' else 'Bet payout' end
      from public.wallets w
      where w.user_id = v_bet.user_id;

      v_settled := v_settled + 1;
      v_paid := v_paid + v_payout;
    end if;
  end loop;

  insert into private.provider_settlement_log (
    provider,
    provider_event_id,
    event_id,
    outcome_key,
    home_score,
    away_score,
    bets_settled,
    total_paid,
    result
  )
  values (
    'the_odds_api',
    p_provider_event_id,
    v_event.id,
    case when v_void then 'void' else v_outcome_key end,
    p_home_score,
    p_away_score,
    v_settled,
    v_paid,
    coalesce(p_raw_result, '{}'::jsonb)
  );

  return jsonb_build_object(
    'already_settled', false,
    'event_id', v_event.id,
    'outcome', case when v_void then 'void' else v_outcome_key end,
    'bets_settled', v_settled,
    'total_paid', v_paid
  );
end;
$function$;

revoke all on function public.settle_provider_event(
  text, numeric, numeric, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.settle_provider_event(
  text, numeric, numeric, timestamptz, jsonb
) to service_role;

comment on function public.settle_provider_event(
  text, numeric, numeric, timestamptz, jsonb
) is 'Idempotently settles a The Odds API event and credits completed bets. Server-side service role only.';

create or replace function public.list_pending_provider_events()
returns table (
  id uuid,
  provider_event_id text,
  provider_sport_key text,
  home_team text,
  away_team text,
  starts_at timestamptz,
  status public.event_status
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select distinct
    e.id,
    e.provider_event_id,
    e.provider_sport_key,
    e.home_team,
    e.away_team,
    e.starts_at,
    e.status
  from public.events e
  join public.bet_legs bl
    on bl.event_id = e.id
   and bl.result = 'pending'::public.bet_status
  join public.bets b
    on b.id = bl.bet_id
   and b.status = 'pending'::public.bet_status
  where e.provider = 'the_odds_api'
    and e.provider_event_id is not null
    and e.provider_sport_key is not null
    and e.provider_settled_at is null
    and e.status in (
      'scheduled'::public.event_status,
      'live'::public.event_status
    )
    and e.starts_at between now() - interval '3 days' and now()
  order by e.starts_at
  limit 200;
$function$;

revoke all on function public.list_pending_provider_events()
  from public, anon, authenticated;
grant execute on function public.list_pending_provider_events()
  to service_role;

comment on function public.list_pending_provider_events()
  is 'Returns only provider events that currently have unresolved pending bet legs. Server-side service role only.';
