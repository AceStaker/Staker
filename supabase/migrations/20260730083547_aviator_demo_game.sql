create extension if not exists pgcrypto with schema extensions;

create table private.aviator_rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  starts_at timestamptz not null,
  crashes_at timestamptz not null,
  crash_multiplier numeric(10,2) not null
    check (crash_multiplier between 1.00 and 1000.00),
  server_seed text not null,
  seed_hash text not null,
  created_at timestamptz not null default now(),
  check (crashes_at > starts_at)
);

alter table private.aviator_rounds enable row level security;
revoke all on table private.aviator_rounds from public, anon, authenticated;

create index aviator_rounds_starts_at_idx
  on private.aviator_rounds (starts_at desc);

create table public.aviator_bets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  round_id uuid not null references private.aviator_rounds(id) on delete restrict,
  stake numeric(14,2) not null check (stake between 10 and 100000),
  auto_cashout numeric(10,2)
    check (auto_cashout is null or auto_cashout between 1.10 and 1000.00),
  status text not null default 'pending'
    check (status in ('pending', 'cashed_out', 'lost', 'void')),
  cashout_multiplier numeric(10,2),
  payout numeric(14,2) not null default 0 check (payout >= 0),
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, round_id)
);

alter table public.aviator_bets enable row level security;

create policy "Users can view their Aviator bets"
  on public.aviator_bets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.aviator_bets to authenticated;
revoke insert, update, delete on table public.aviator_bets
  from public, anon, authenticated;

create index aviator_bets_user_placed_idx
  on public.aviator_bets (user_id, placed_at desc);

create index aviator_bets_pending_round_idx
  on public.aviator_bets (round_id, user_id)
  where status = 'pending';

create or replace function private.aviator_crash_for_seed(p_seed text)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_hash bytea := extensions.digest(p_seed, 'sha256');
  v_value numeric := 0;
  v_unit numeric;
  v_crash numeric;
  v_index integer;
begin
  for v_index in 0..6 loop
    v_value := (v_value * 256) + get_byte(v_hash, v_index);
  end loop;

  v_value := floor(v_value / 16);
  v_unit := v_value / 4503599627370496;
  v_crash := least(1000, greatest(1, 0.97 / greatest(0.0000000001, 1 - v_unit)));
  return floor(v_crash * 100) / 100;
end;
$function$;

create or replace function private.aviator_multiplier(
  p_starts_at timestamptz,
  p_at timestamptz
)
returns numeric
language sql
immutable
strict
set search_path = ''
as $function$
  select greatest(
    1.00,
    floor(
      exp(greatest(0, extract(epoch from (p_at - p_starts_at))) * 0.12)
      * 100
    ) / 100
  );
$function$;

create or replace function private.aviator_create_round(p_starts_at timestamptz)
returns private.aviator_rounds
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_seed text := encode(extensions.gen_random_bytes(32), 'hex');
  v_crash numeric;
  v_duration_seconds numeric;
  v_round private.aviator_rounds%rowtype;
begin
  v_crash := private.aviator_crash_for_seed(v_seed);
  v_duration_seconds := greatest(
    0.70,
    ln(greatest(v_crash, 1.01)) / 0.12
  );

  insert into private.aviator_rounds (
    starts_at,
    crashes_at,
    crash_multiplier,
    server_seed,
    seed_hash
  )
  values (
    p_starts_at,
    p_starts_at + make_interval(secs => v_duration_seconds),
    v_crash,
    v_seed,
    encode(extensions.digest(v_seed, 'sha256'), 'hex')
  )
  returning * into v_round;

  return v_round;
end;
$function$;

create or replace function private.aviator_ensure_round()
returns private.aviator_rounds
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_round private.aviator_rounds%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_start timestamptz;
begin
  select *
  into v_round
  from private.aviator_rounds
  order by starts_at desc
  limit 1;

  if found and v_now < v_round.crashes_at + interval '3 seconds' then
    return v_round;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ace-staker:aviator-round', 0));

  select *
  into v_round
  from private.aviator_rounds
  order by starts_at desc
  limit 1;

  if not found then
    return private.aviator_create_round(v_now + interval '6 seconds');
  end if;

  if v_now >= v_round.crashes_at + interval '3 seconds' then
    v_next_start := greatest(
      v_now + interval '3 seconds',
      v_round.crashes_at + interval '7 seconds'
    );
    return private.aviator_create_round(v_next_start);
  end if;

  return v_round;
end;
$function$;

create or replace function private.aviator_settle_user(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bet record;
  v_wallet public.wallets%rowtype;
  v_payout numeric(14,2);
  v_settled integer := 0;
begin
  if p_user is null then
    return 0;
  end if;

  if not exists (
    select 1
    from public.aviator_bets b
    join private.aviator_rounds r on r.id = b.round_id
    where b.user_id = p_user
      and b.status = 'pending'
      and r.crashes_at <= clock_timestamp()
  ) then
    return 0;
  end if;

  select *
  into v_wallet
  from public.wallets
  where user_id = p_user
  for update;

  if not found then
    return 0;
  end if;

  for v_bet in
    select
      b.id,
      b.stake,
      b.auto_cashout,
      r.crash_multiplier
    from public.aviator_bets b
    join private.aviator_rounds r on r.id = b.round_id
    where b.user_id = p_user
      and b.status = 'pending'
      and r.crashes_at <= clock_timestamp()
    order by b.placed_at
    for update of b
  loop
    if v_bet.auto_cashout is not null
       and v_bet.auto_cashout < v_bet.crash_multiplier then
      v_payout := round(v_bet.stake * v_bet.auto_cashout, 2);

      update public.aviator_bets
      set status = 'cashed_out',
          cashout_multiplier = v_bet.auto_cashout,
          payout = v_payout,
          settled_at = now()
      where id = v_bet.id;

      update public.wallets
      set balance = balance + v_payout,
          updated_at = now()
      where user_id = p_user
      returning * into v_wallet;

      insert into public.wallet_transactions (
        user_id,
        kind,
        amount,
        balance_after,
        reference_id,
        description,
        metadata
      )
      values (
        p_user,
        'bet_payout',
        v_payout,
        v_wallet.balance,
        v_bet.id,
        'Aviator automatic cash-out',
        jsonb_build_object(
          'game', 'aviator',
          'multiplier', v_bet.auto_cashout
        )
      );
    else
      update public.aviator_bets
      set status = 'lost',
          payout = 0,
          settled_at = now()
      where id = v_bet.id;
    end if;

    v_settled := v_settled + 1;
  end loop;

  return v_settled;
end;
$function$;

create or replace function private.aviator_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_round private.aviator_rounds%rowtype;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_multiplier numeric(10,2);
  v_round_json jsonb;
  v_history jsonb;
  v_my_bet jsonb;
  v_my_history jsonb;
  v_balance numeric(14,2);
  v_players integer;
  v_total_stake numeric(14,2);
begin
  perform private.aviator_settle_user(v_user);
  v_round := private.aviator_ensure_round();
  v_now := clock_timestamp();

  if v_now < v_round.starts_at then
    v_status := 'waiting';
    v_multiplier := 1.00;
  elsif v_now < v_round.crashes_at then
    v_status := 'flying';
    v_multiplier := least(
      v_round.crash_multiplier,
      private.aviator_multiplier(v_round.starts_at, v_now)
    );
  else
    v_status := 'crashed';
    v_multiplier := v_round.crash_multiplier;
  end if;

  select count(*)::integer, coalesce(sum(stake), 0)
  into v_players, v_total_stake
  from public.aviator_bets
  where round_id = v_round.id;

  v_round_json := jsonb_build_object(
    'id', v_round.id,
    'starts_at', v_round.starts_at,
    'server_now', v_now,
    'status', v_status,
    'multiplier', v_multiplier,
    'seed_hash', v_round.seed_hash,
    'players', v_players,
    'total_stake', v_total_stake
  );

  if v_status = 'crashed' then
    v_round_json := v_round_json || jsonb_build_object(
      'crash_multiplier', v_round.crash_multiplier,
      'seed_reveal', v_round.server_seed
    );
  end if;

  select coalesce(jsonb_agg(item order by crashed_at desc), '[]'::jsonb)
  into v_history
  from (
    select jsonb_build_object(
      'id', id,
      'crash_multiplier', crash_multiplier,
      'seed_hash', seed_hash,
      'seed_reveal', server_seed,
      'crashed_at', crashes_at
    ) as item,
    crashes_at as crashed_at
    from private.aviator_rounds
    where crashes_at <= v_now
    order by crashes_at desc
    limit 12
  ) history_rows;

  if v_user is not null then
    select to_jsonb(b)
    into v_my_bet
    from (
      select id, round_id, stake, auto_cashout, status,
             cashout_multiplier, payout, placed_at, settled_at
      from public.aviator_bets
      where user_id = v_user and round_id = v_round.id
      limit 1
    ) b;

    select coalesce(jsonb_agg(item order by placed_at desc), '[]'::jsonb)
    into v_my_history
    from (
      select jsonb_build_object(
        'id', b.id,
        'stake', b.stake,
        'status', b.status,
        'cashout_multiplier', b.cashout_multiplier,
        'payout', b.payout,
        'placed_at', b.placed_at,
        'crash_multiplier',
          case when r.crashes_at <= v_now then r.crash_multiplier else null end
      ) as item,
      b.placed_at
      from public.aviator_bets b
      join private.aviator_rounds r on r.id = b.round_id
      where b.user_id = v_user
      order by b.placed_at desc
      limit 20
    ) user_history;

    select balance into v_balance
    from public.wallets
    where user_id = v_user;
  else
    v_my_history := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'round', v_round_json,
    'history', v_history,
    'my_bet', v_my_bet,
    'my_history', v_my_history,
    'balance', v_balance
  );
end;
$function$;

create or replace function private.aviator_place_bet(
  p_stake numeric,
  p_auto_cashout numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_round private.aviator_rounds%rowtype;
  v_wallet public.wallets%rowtype;
  v_settings public.responsible_play_settings%rowtype;
  v_stake numeric(14,2) := round(p_stake, 2);
  v_auto_cashout numeric(10,2);
  v_today_stake numeric(14,2);
  v_bet public.aviator_bets%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in before joining a flight';
  end if;

  if v_stake is null or v_stake < 10 or v_stake > 100000 then
    raise exception 'Stake must be between ₹10 and ₹1,00,000';
  end if;

  if p_auto_cashout is not null then
    v_auto_cashout := round(p_auto_cashout, 2);
    if v_auto_cashout < 1.10 or v_auto_cashout > 1000 then
      raise exception 'Automatic cash-out must be between 1.10× and 1000×';
    end if;
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_user
      and age_confirmed
      and betting_suspended_at is null
  ) then
    raise exception 'Your account is not eligible to place demo wagers';
  end if;

  select *
  into v_settings
  from public.responsible_play_settings
  where user_id = v_user;

  if not found then
    raise exception 'Responsible-play settings not found';
  end if;

  if v_settings.self_excluded_until is not null
     and v_settings.self_excluded_until > now() then
    raise exception 'Betting is disabled until %', v_settings.self_excluded_until;
  end if;

  v_round := private.aviator_ensure_round();
  if clock_timestamp() >= v_round.starts_at - interval '200 milliseconds' then
    raise exception 'This flight is closed. Join the next round';
  end if;

  perform private.aviator_settle_user(v_user);

  select *
  into v_wallet
  from public.wallets
  where user_id = v_user
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  select
    coalesce((select sum(stake) from public.bets
      where user_id = v_user and placed_at >= date_trunc('day', now())), 0)
    +
    coalesce((select sum(stake) from public.aviator_bets
      where user_id = v_user and placed_at >= date_trunc('day', now())), 0)
  into v_today_stake;

  if v_today_stake + v_stake > v_settings.daily_stake_limit then
    raise exception 'Daily stake limit exceeded';
  end if;

  if v_stake > v_wallet.balance then
    raise exception 'Insufficient demo balance';
  end if;

  insert into public.aviator_bets (
    user_id,
    round_id,
    stake,
    auto_cashout
  )
  values (
    v_user,
    v_round.id,
    v_stake,
    v_auto_cashout
  )
  returning * into v_bet;

  update public.wallets
  set balance = balance - v_stake,
      updated_at = now()
  where user_id = v_user
  returning * into v_wallet;

  insert into public.wallet_transactions (
    user_id,
    kind,
    amount,
    balance_after,
    reference_id,
    description,
    metadata
  )
  values (
    v_user,
    'bet_stake',
    -v_stake,
    v_wallet.balance,
    v_bet.id,
    'Aviator demo stake',
    jsonb_build_object(
      'game', 'aviator',
      'round_id', v_round.id,
      'auto_cashout', v_auto_cashout
    )
  );

  return jsonb_build_object(
    'bet', to_jsonb(v_bet),
    'balance', v_wallet.balance
  );
exception
  when unique_violation then
    raise exception 'You already joined this flight';
end;
$function$;

create or replace function private.aviator_cash_out()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_bet public.aviator_bets%rowtype;
  v_round private.aviator_rounds%rowtype;
  v_multiplier numeric(10,2);
  v_payout numeric(14,2);
  v_wallet public.wallets%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in before cashing out';
  end if;

  select b.*
  into v_bet
  from public.aviator_bets b
  where b.user_id = v_user
    and b.status = 'pending'
  order by b.placed_at desc
  limit 1
  for update of b;

  if not found then
    raise exception 'No active Aviator wager';
  end if;

  select *
  into v_round
  from private.aviator_rounds
  where id = v_bet.round_id;

  if v_now < v_round.starts_at then
    raise exception 'The flight has not started';
  end if;

  if v_now >= v_round.crashes_at then
    perform private.aviator_settle_user(v_user);
    raise exception 'The plane has already flown away';
  end if;

  v_multiplier := least(
    v_round.crash_multiplier,
    private.aviator_multiplier(v_round.starts_at, v_now)
  );
  v_payout := round(v_bet.stake * v_multiplier, 2);

  update public.aviator_bets
  set status = 'cashed_out',
      cashout_multiplier = v_multiplier,
      payout = v_payout,
      settled_at = now()
  where id = v_bet.id;

  update public.wallets
  set balance = balance + v_payout,
      updated_at = now()
  where user_id = v_user
  returning * into v_wallet;

  insert into public.wallet_transactions (
    user_id,
    kind,
    amount,
    balance_after,
    reference_id,
    description,
    metadata
  )
  values (
    v_user,
    'bet_payout',
    v_payout,
    v_wallet.balance,
    v_bet.id,
    'Aviator manual cash-out',
    jsonb_build_object(
      'game', 'aviator',
      'multiplier', v_multiplier
    )
  );

  return jsonb_build_object(
    'multiplier', v_multiplier,
    'payout', v_payout,
    'balance', v_wallet.balance
  );
end;
$function$;

create or replace function private.aviator_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_settled integer;
  v_balance numeric(14,2);
begin
  if v_user is null then
    raise exception 'Sign in before synchronizing Aviator wagers';
  end if;

  v_settled := private.aviator_settle_user(v_user);
  select balance into v_balance
  from public.wallets
  where user_id = v_user;

  return jsonb_build_object(
    'settled', v_settled,
    'balance', v_balance
  );
end;
$function$;

create or replace function public.aviator_state()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.aviator_state();
$function$;

create or replace function public.aviator_place_bet(
  p_stake numeric,
  p_auto_cashout numeric default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.aviator_place_bet(p_stake, p_auto_cashout);
$function$;

create or replace function public.aviator_cash_out()
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.aviator_cash_out();
$function$;

create or replace function public.aviator_sync()
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.aviator_sync();
$function$;

revoke all on function private.aviator_crash_for_seed(text)
  from public, anon, authenticated;
revoke all on function private.aviator_multiplier(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function private.aviator_create_round(timestamptz)
  from public, anon, authenticated;
revoke all on function private.aviator_ensure_round()
  from public, anon, authenticated;
revoke all on function private.aviator_settle_user(uuid)
  from public, anon, authenticated;

revoke all on function private.aviator_state()
  from public, anon, authenticated;
grant execute on function private.aviator_state()
  to anon, authenticated;

revoke all on function private.aviator_place_bet(numeric, numeric)
  from public, anon, authenticated;
grant execute on function private.aviator_place_bet(numeric, numeric)
  to authenticated;

revoke all on function private.aviator_cash_out()
  from public, anon, authenticated;
grant execute on function private.aviator_cash_out()
  to authenticated;

revoke all on function private.aviator_sync()
  from public, anon, authenticated;
grant execute on function private.aviator_sync()
  to authenticated;

revoke all on function public.aviator_state()
  from public, anon, authenticated;
grant execute on function public.aviator_state()
  to anon, authenticated;

revoke all on function public.aviator_place_bet(numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.aviator_place_bet(numeric, numeric)
  to authenticated;

revoke all on function public.aviator_cash_out()
  from public, anon, authenticated;
grant execute on function public.aviator_cash_out()
  to authenticated;

revoke all on function public.aviator_sync()
  from public, anon, authenticated;
grant execute on function public.aviator_sync()
  to authenticated;

comment on table public.aviator_bets is
  'User-owned demo-credit Aviator wagers. Writes are restricted to validated RPC functions.';
comment on function public.aviator_state() is
  'Returns the shared Aviator round without exposing its hidden crash point before settlement.';
comment on function public.aviator_place_bet(numeric, numeric) is
  'Places one server-validated demo-credit Aviator wager for the current waiting round.';
comment on function public.aviator_cash_out() is
  'Settles the caller current Aviator wager at a server-calculated multiplier.';
comment on function public.aviator_sync() is
  'Settles completed automatic Aviator wagers for the signed-in user and returns the current balance.';
