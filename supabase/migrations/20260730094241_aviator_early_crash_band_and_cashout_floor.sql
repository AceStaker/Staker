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

  if v_unit < 0.20 then
    v_crash := 1.02 + ((get_byte(v_hash, 7) % 4)::numeric / 100);
  else
    v_crash := least(1000, greatest(1.06, 0.80 / greatest(0.0000000001, 1 - v_unit)));
  end if;

  return floor(v_crash * 100) / 100;
end;
$function$;

comment on function private.aviator_crash_for_seed(text) is
  'Generates immutable Aviator crash points with a 20 percent target house edge above the 1.10 cash-out floor. The earliest 20 percent are distributed from 1.02x through 1.05x.';

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

comment on function private.aviator_cash_out() is
  'Settles an authenticated user Aviator wager at the server multiplier, with a minimum manual cash-out of 1.10x.';
