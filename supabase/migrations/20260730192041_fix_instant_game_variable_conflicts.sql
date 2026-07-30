create or replace function private.instant_game_start(
  p_game text,
  p_stake numeric,
  p_config jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_amount numeric(14,2) := round(p_stake,2);
  v_wallet public.wallets%rowtype;
  v_settings public.responsible_play_settings%rowtype;
  v_daily numeric(14,2);
  v_bet public.instant_game_bets%rowtype;
  v_hidden jsonb := '{}';
  v_details jsonb := '{}';
  v_session jsonb;
  v_random numeric;
  v_probability numeric;
  v_multiplier numeric(12,2) := 0;
  v_payout numeric(14,2) := 0;
  v_won boolean := false;
  v_difficulty text;
  v_risk text;
  v_mode text;
  v_target numeric;
  v_failure_probability numeric;
  v_fail_step int;
  v_mine_count int;
  v_mines jsonb := '[]';
  v_safe jsonb := '[]';
  v_path jsonb := '[]';
  v_index int;
  v_slot int := 0;
  v_roll numeric;
  v_crash numeric;
  v_tables jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in before playing';
  end if;
  if p_game not in ('crossing','mines','plinko','tower','dice','limbo') then
    raise exception 'Unknown game';
  end if;
  if v_amount is null or v_amount<10 or v_amount>100000 then
    raise exception 'Stake must be between ₹10 and ₹1,00,000';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id=v_user_id
      and age_confirmed
      and betting_suspended_at is null
  ) then
    raise exception 'Your account is not eligible to place demo wagers';
  end if;

  select *
  into v_settings
  from public.responsible_play_settings
  where user_id=v_user_id;
  if not found then
    raise exception 'Responsible-play settings not found';
  end if;
  if v_settings.self_excluded_until is not null
     and v_settings.self_excluded_until>now() then
    raise exception 'Betting is disabled until %',v_settings.self_excluded_until;
  end if;
  if p_game in ('crossing','mines','tower') and exists (
    select 1
    from private.instant_game_sessions
    where user_id=v_user_id
      and game=p_game
      and status='pending'
  ) then
    raise exception 'Finish your current round first';
  end if;

  select *
  into v_wallet
  from public.wallets
  where user_id=v_user_id
  for update;
  if not found then
    raise exception 'Wallet not found';
  end if;

  select
    coalesce((
      select sum(stake)
      from public.bets
      where user_id=v_user_id
        and placed_at>=date_trunc('day',now())
    ),0)
    + coalesce((
      select sum(stake)
      from public.aviator_bets
      where user_id=v_user_id
        and placed_at>=date_trunc('day',now())
    ),0)
    + coalesce((
      select sum(stake)
      from public.instant_game_bets
      where user_id=v_user_id
        and created_at>=date_trunc('day',now())
    ),0)
  into v_daily;

  if v_daily+v_amount>v_settings.daily_stake_limit then
    raise exception 'Daily stake limit exceeded';
  end if;
  if v_amount>v_wallet.balance then
    raise exception 'Insufficient demo balance';
  end if;

  insert into public.instant_game_bets(user_id,game,stake,details)
  values(v_user_id,p_game,v_amount,coalesce(p_config,'{}'))
  returning * into v_bet;

  update public.wallets
  set balance=balance-v_amount,
      updated_at=now()
  where user_id=v_user_id
  returning * into v_wallet;

  insert into public.wallet_transactions(
    user_id,kind,amount,balance_after,reference_id,description,metadata
  ) values (
    v_user_id,'bet_stake',-v_amount,v_wallet.balance,v_bet.id,
    'Ace Originals demo stake',
    jsonb_build_object('game',p_game)
  );

  if p_game='crossing' then
    v_difficulty:=coalesce(p_config->>'difficulty','medium');
    if v_difficulty not in ('easy','medium','hard','extreme') then
      v_difficulty:='medium';
    end if;
    v_failure_probability:=case v_difficulty
      when 'easy' then .18
      when 'medium' then .25
      when 'hard' then .32
      else .40
    end;
    v_random:=private.instant_random();
    v_fail_step:=least(
      30,
      greatest(
        1,
        floor(ln(1-v_random)/ln(1-v_failure_probability))::int+1
      )
    );
    v_hidden:=jsonb_build_object(
      'difficulty',v_difficulty,
      'q',v_failure_probability,
      'fail_step',v_fail_step
    );
  elsif p_game='mines' then
    v_mine_count:=coalesce((p_config->>'mines')::int,5);
    if v_mine_count not in (3,5,8,12) then
      v_mine_count:=5;
    end if;
    while jsonb_array_length(v_mines)<v_mine_count loop
      v_index:=floor(private.instant_random()*25)::int;
      if not (v_mines@>jsonb_build_array(v_index)) then
        v_mines:=v_mines||jsonb_build_array(v_index);
      end if;
    end loop;
    v_hidden:=jsonb_build_object(
      'mine_count',v_mine_count,
      'mines',v_mines,
      'picks','[]'::jsonb
    );
  elsif p_game='tower' then
    for v_index in 1..8 loop
      v_safe:=v_safe||jsonb_build_array(
        floor(private.instant_random()*3)::int
      );
    end loop;
    v_hidden:=jsonb_build_object('safe',v_safe,'picks','[]'::jsonb);
  elsif p_game='plinko' then
    v_risk:=coalesce(p_config->>'risk','medium');
    if v_risk not in ('low','medium','high') then
      v_risk:='medium';
    end if;
    for v_index in 1..8 loop
      v_won:=private.instant_random()>=.5;
      v_path:=v_path||jsonb_build_array(v_won);
      if v_won then
        v_slot:=v_slot+1;
      end if;
    end loop;
    v_tables:=case v_risk
      when 'low' then '[5,2,1.25,.85,.55,.85,1.25,2,5]'::jsonb
      when 'high' then '[20,4,1.5,.4,.15,.4,1.5,4,20]'::jsonb
      else '[12,3,1.5,.6,.3,.6,1.5,3,12]'::jsonb
    end;
    v_multiplier:=(v_tables->>v_slot)::numeric;
    v_payout:=round(v_amount*v_multiplier,2);
    v_won:=v_payout>=v_amount;
    v_details:=jsonb_build_object(
      'risk',v_risk,
      'path',v_path,
      'slot',v_slot,
      'multiplier',v_multiplier
    );
  elsif p_game='dice' then
    v_mode:=coalesce(p_config->>'mode','under');
    if v_mode not in ('under','over') then
      v_mode:='under';
    end if;
    v_target:=round(coalesce((p_config->>'target')::numeric,50),2);
    if v_target<5 or v_target>95 then
      v_target:=50;
    end if;
    v_probability:=case
      when v_mode='under' then v_target/100
      else (100-v_target)/100
    end;
    v_multiplier:=floor((.96/v_probability)*100)/100;
    v_roll:=floor(private.instant_random()*10000)/100;
    v_won:=case
      when v_mode='under' then v_roll<v_target
      else v_roll>v_target
    end;
    if v_won then
      v_payout:=round(v_amount*v_multiplier,2);
    else
      v_multiplier:=0;
    end if;
    v_details:=jsonb_build_object(
      'mode',v_mode,
      'target',v_target,
      'roll',v_roll
    );
  else
    v_target:=round(coalesce((p_config->>'target')::numeric,2),2);
    if v_target<1.10 or v_target>1000 then
      v_target:=2;
    end if;
    v_crash:=least(
      1000,
      greatest(
        1,
        floor((.96/(1-private.instant_random()))*100)/100
      )
    );
    v_won:=v_crash>=v_target;
    if v_won then
      v_multiplier:=v_target;
      v_payout:=round(v_amount*v_target,2);
    else
      v_multiplier:=0;
    end if;
    v_details:=jsonb_build_object(
      'target',v_target,
      'crash',v_crash
    );
  end if;

  if p_game in ('crossing','mines','tower') then
    insert into private.instant_game_sessions(id,user_id,game,state)
    values(v_bet.id,v_user_id,p_game,v_hidden);
    v_session:=private.instant_public_session(v_bet.id)
      ||jsonb_build_object('stake',v_amount);
  else
    update public.instant_game_bets
    set status=case when v_won then 'won' else 'lost' end,
        multiplier=v_multiplier,
        payout=v_payout,
        details=v_details,
        settled_at=now()
    where id=v_bet.id
    returning * into v_bet;

    if v_payout>0 then
      update public.wallets
      set balance=balance+v_payout,
          updated_at=now()
      where user_id=v_user_id
      returning * into v_wallet;
      insert into public.wallet_transactions(
        user_id,kind,amount,balance_after,reference_id,description,metadata
      ) values (
        v_user_id,'bet_payout',v_payout,v_wallet.balance,v_bet.id,
        'Ace Originals demo payout',
        jsonb_build_object('game',p_game,'multiplier',v_multiplier)
      );
    end if;
  end if;

  return jsonb_build_object(
    'session',v_session,
    'bet',to_jsonb(v_bet),
    'balance',v_wallet.balance
  );
end;
$$;

create or replace function private.instant_game_action(
  p_session_id uuid,
  p_action text,
  p_choice int default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_row private.instant_game_sessions%rowtype;
  v_bet public.instant_game_bets%rowtype;
  v_wallet public.wallets%rowtype;
  v_next_step int;
  v_choice int := p_choice;
  v_multiplier numeric(12,2);
  v_payout numeric(14,2) := 0;
  v_probability numeric := 1;
  v_index int;
  v_mine_count int;
  v_picks jsonb;
  v_safe_choice int;
  v_lost boolean := false;
  v_details jsonb;
  v_public_session jsonb;
  v_action text := p_action;
begin
  if v_user_id is null then
    raise exception 'Sign in before playing';
  end if;
  if v_action not in ('step','cashout') then
    raise exception 'Unknown action';
  end if;

  select *
  into v_session_row
  from private.instant_game_sessions
  where id=p_session_id
    and user_id=v_user_id
    and status='pending'
  for update;
  if not found then
    raise exception 'This round is no longer active';
  end if;

  select *
  into v_bet
  from public.instant_game_bets
  where id=v_session_row.id
  for update;

  if v_action='cashout' then
    if v_session_row.progress<1 then
      raise exception 'Make at least one safe move before cashing out';
    end if;
    v_multiplier:=v_session_row.current_multiplier;
    v_payout:=round(v_bet.stake*v_multiplier,2);
    v_details:=v_bet.details
      ||jsonb_build_object('progress',v_session_row.progress);
  elsif v_session_row.game='crossing' then
    v_next_step:=v_session_row.progress+1;
    if v_next_step>=(v_session_row.state->>'fail_step')::int then
      v_lost:=true;
      v_details:=jsonb_build_object(
        'difficulty',v_session_row.state->>'difficulty',
        'failed_step',v_next_step
      );
    else
      v_multiplier:=round(
        .96/power(
          1-(v_session_row.state->>'q')::numeric,
          v_next_step
        ),
        2
      );
    end if;
  elsif v_session_row.game='mines' then
    if v_choice is null or v_choice<0 or v_choice>24 then
      raise exception 'Choose a valid tile';
    end if;
    v_picks:=coalesce(v_session_row.state->'picks','[]');
    if v_picks@>jsonb_build_array(v_choice) then
      raise exception 'That tile is already open';
    end if;
    if v_session_row.state->'mines'@>jsonb_build_array(v_choice) then
      v_lost:=true;
      v_details:=jsonb_build_object(
        'mine_count',(v_session_row.state->>'mine_count')::int,
        'mines',v_session_row.state->'mines',
        'hit',v_choice
      );
    else
      v_next_step:=v_session_row.progress+1;
      v_mine_count:=(v_session_row.state->>'mine_count')::int;
      for v_index in 0..v_next_step-1 loop
        v_probability:=v_probability*
          ((25-v_mine_count-v_index)::numeric/(25-v_index)::numeric);
      end loop;
      v_multiplier:=round(.96/v_probability,2);
      v_session_row.state:=jsonb_set(
        v_session_row.state,
        '{picks}',
        v_picks||jsonb_build_array(v_choice)
      );
      if v_next_step=25-v_mine_count then
        v_action:='cashout';
      end if;
    end if;
  elsif v_session_row.game='tower' then
    if v_choice is null or v_choice<0 or v_choice>2 then
      raise exception 'Choose a valid platform';
    end if;
    v_safe_choice:=(
      v_session_row.state->'safe'->>v_session_row.progress
    )::int;
    if v_choice<>v_safe_choice then
      v_lost:=true;
      v_details:=jsonb_build_object(
        'failed_row',v_session_row.progress,
        'failed_choice',v_choice,
        'safe_choice',v_safe_choice
      );
    else
      v_next_step:=v_session_row.progress+1;
      v_multiplier:=round(.96*power(3,v_next_step),2);
      v_picks:=coalesce(v_session_row.state->'picks','[]')
        ||jsonb_build_array(v_choice);
      v_session_row.state:=jsonb_set(
        v_session_row.state,
        '{picks}',
        v_picks
      );
      if v_next_step=8 then
        v_action:='cashout';
      end if;
    end if;
  else
    raise exception 'This game does not use step actions';
  end if;

  if v_lost then
    update public.instant_game_bets
    set status='lost',
        multiplier=0,
        payout=0,
        details=v_details,
        settled_at=now()
    where id=v_bet.id
    returning * into v_bet;
    delete from private.instant_game_sessions
    where id=v_session_row.id;
  elsif v_action='cashout' then
    if v_multiplier is null then
      v_multiplier:=v_session_row.current_multiplier;
    end if;
    if v_payout=0 then
      v_payout:=round(v_bet.stake*v_multiplier,2);
    end if;
    v_details:=coalesce(
      v_details,
      v_bet.details||jsonb_build_object(
        'progress',
        coalesce(v_next_step,v_session_row.progress)
      )
    );
    update public.instant_game_bets
    set status='won',
        multiplier=v_multiplier,
        payout=v_payout,
        details=v_details,
        settled_at=now()
    where id=v_bet.id
    returning * into v_bet;
    delete from private.instant_game_sessions
    where id=v_session_row.id;

    update public.wallets
    set balance=balance+v_payout,
        updated_at=now()
    where user_id=v_user_id
    returning * into v_wallet;
    insert into public.wallet_transactions(
      user_id,kind,amount,balance_after,reference_id,description,metadata
    ) values (
      v_user_id,'bet_payout',v_payout,v_wallet.balance,v_bet.id,
      'Ace Originals demo payout',
      jsonb_build_object(
        'game',v_session_row.game,
        'multiplier',v_multiplier
      )
    );
  else
    update private.instant_game_sessions
    set state=v_session_row.state,
        progress=v_next_step,
        current_multiplier=v_multiplier,
        updated_at=now()
    where id=v_session_row.id;
    v_public_session:=private.instant_public_session(v_session_row.id)
      ||jsonb_build_object('stake',v_bet.stake);
  end if;

  if v_wallet.user_id is null then
    select *
    into v_wallet
    from public.wallets
    where user_id=v_user_id;
  end if;
  return jsonb_build_object(
    'session',v_public_session,
    'bet',to_jsonb(v_bet),
    'balance',v_wallet.balance
  );
end;
$$;
