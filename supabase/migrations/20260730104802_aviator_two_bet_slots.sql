alter table public.aviator_bets
  add column if not exists bet_slot smallint not null default 1;

alter table public.aviator_bets
  drop constraint if exists aviator_bets_user_id_round_id_key,
  drop constraint if exists aviator_bets_bet_slot_check;

alter table public.aviator_bets
  add constraint aviator_bets_bet_slot_check check (bet_slot between 1 and 2),
  add constraint aviator_bets_user_round_slot_key unique (user_id, round_id, bet_slot);

create or replace function private.aviator_place_bet_slot(
  p_stake numeric,
  p_slot smallint,
  p_auto_cashout numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_slot is null or p_slot not between 1 and 2 then
    raise exception 'Bet slot must be 1 or 2';
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
    select 1 from public.profiles
    where id = v_user and age_confirmed and betting_suspended_at is null
  ) then
    raise exception 'Your account is not eligible to place demo wagers';
  end if;

  select * into v_settings
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

  select * into v_wallet
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

  insert into public.aviator_bets (user_id, round_id, bet_slot, stake, auto_cashout)
  values (v_user, v_round.id, p_slot, v_stake, v_auto_cashout)
  returning * into v_bet;

  update public.wallets
  set balance = balance - v_stake, updated_at = now()
  where user_id = v_user
  returning * into v_wallet;

  insert into public.wallet_transactions (
    user_id, kind, amount, balance_after, reference_id, description, metadata
  ) values (
    v_user, 'bet_stake', -v_stake, v_wallet.balance, v_bet.id,
    'Aviator demo stake',
    jsonb_build_object(
      'game', 'aviator',
      'round_id', v_round.id,
      'bet_slot', p_slot,
      'auto_cashout', v_auto_cashout
    )
  );

  return jsonb_build_object('bet', to_jsonb(v_bet), 'balance', v_wallet.balance);
exception
  when unique_violation then
    raise exception 'Bet % is already placed for this flight', p_slot;
end;
$$;

create or replace function public.aviator_place_bet_slot(
  p_stake numeric,
  p_slot smallint,
  p_auto_cashout numeric default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.aviator_place_bet_slot(p_stake, p_slot, p_auto_cashout);
$$;

create or replace function private.aviator_cash_out_slot(p_slot smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_slot is null or p_slot not between 1 and 2 then
    raise exception 'Bet slot must be 1 or 2';
  end if;

  select b.* into v_bet
  from public.aviator_bets b
  where b.user_id = v_user
    and b.bet_slot = p_slot
    and b.status = 'pending'
  order by b.placed_at desc
  limit 1
  for update of b;
  if not found then
    raise exception 'No active wager in bet %', p_slot;
  end if;

  select * into v_round
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
  if v_multiplier < 1.10 then
    raise exception 'Cash-out opens at 1.10x';
  end if;
  v_payout := round(v_bet.stake * v_multiplier, 2);

  update public.aviator_bets
  set status = 'cashed_out',
      cashout_multiplier = v_multiplier,
      payout = v_payout,
      settled_at = now()
  where id = v_bet.id;

  update public.wallets
  set balance = balance + v_payout, updated_at = now()
  where user_id = v_user
  returning * into v_wallet;

  insert into public.wallet_transactions (
    user_id, kind, amount, balance_after, reference_id, description, metadata
  ) values (
    v_user, 'bet_payout', v_payout, v_wallet.balance, v_bet.id,
    'Aviator manual cash-out',
    jsonb_build_object('game', 'aviator', 'bet_slot', p_slot, 'multiplier', v_multiplier)
  );

  return jsonb_build_object(
    'bet_slot', p_slot,
    'multiplier', v_multiplier,
    'payout', v_payout,
    'balance', v_wallet.balance
  );
end;
$$;

create or replace function public.aviator_cash_out_slot(p_slot smallint)
returns jsonb
language sql
set search_path = ''
as $$
  select private.aviator_cash_out_slot(p_slot);
$$;

create or replace function private.aviator_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_round private.aviator_rounds%rowtype;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_multiplier numeric(10,2);
  v_round_json jsonb;
  v_history jsonb;
  v_my_bet jsonb;
  v_my_bets jsonb;
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

  select count(distinct user_id)::integer, coalesce(sum(stake), 0)
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
    ) item, crashes_at
    from private.aviator_rounds
    where crashes_at <= v_now
    order by crashes_at desc
    limit 12
  ) history_rows;

  if v_user is not null then
    select coalesce(jsonb_agg(to_jsonb(b) order by b.bet_slot), '[]'::jsonb)
    into v_my_bets
    from (
      select id, round_id, bet_slot, stake, auto_cashout, status,
        cashout_multiplier, payout, placed_at, settled_at
      from public.aviator_bets
      where user_id = v_user and round_id = v_round.id
      order by bet_slot
    ) b;

    v_my_bet := v_my_bets -> 0;

    select coalesce(jsonb_agg(item order by placed_at desc), '[]'::jsonb)
    into v_my_history
    from (
      select jsonb_build_object(
        'id', b.id,
        'bet_slot', b.bet_slot,
        'stake', b.stake,
        'status', b.status,
        'cashout_multiplier', b.cashout_multiplier,
        'payout', b.payout,
        'placed_at', b.placed_at,
        'crash_multiplier',
          case when r.crashes_at <= v_now then r.crash_multiplier else null end
      ) item, b.placed_at
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
    v_my_bets := '[]'::jsonb;
    v_my_history := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'round', v_round_json,
    'history', v_history,
    'my_bet', v_my_bet,
    'my_bets', v_my_bets,
    'my_history', v_my_history,
    'balance', v_balance
  );
end;
$$;

revoke all on function public.aviator_place_bet_slot(numeric, smallint, numeric) from public;
revoke all on function public.aviator_cash_out_slot(smallint) from public;
grant execute on function public.aviator_place_bet_slot(numeric, smallint, numeric) to authenticated;
grant execute on function public.aviator_cash_out_slot(smallint) to authenticated;
