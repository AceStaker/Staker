create table public.instant_game_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('crossing','mines','plinko','tower','dice','limbo')),
  stake numeric(14,2) not null check (stake between 10 and 100000),
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  multiplier numeric(12,2) not null default 0 check (multiplier >= 0),
  payout numeric(14,2) not null default 0 check (payout >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index instant_game_bets_user_created_idx on public.instant_game_bets(user_id,created_at desc);
create index instant_game_bets_game_created_idx on public.instant_game_bets(game,created_at desc);
alter table public.instant_game_bets enable row level security;
create policy users_read_own_instant_game_bets
  on public.instant_game_bets for select to authenticated
  using ((select auth.uid())=user_id);
revoke all on table public.instant_game_bets from anon,authenticated;
grant select on table public.instant_game_bets to authenticated;

create table private.instant_game_sessions (
  id uuid primary key references public.instant_game_bets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  state jsonb not null default '{}'::jsonb,
  progress integer not null default 0,
  current_multiplier numeric(12,2) not null default 1,
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index instant_game_sessions_one_pending_idx
  on private.instant_game_sessions(user_id,game) where status='pending';
alter table private.instant_game_sessions enable row level security;

create function private.instant_random()
returns numeric language sql volatile set search_path='' as $$
  select (
    get_byte(bytes,0)::numeric*16777216 +
    get_byte(bytes,1)::numeric*65536 +
    get_byte(bytes,2)::numeric*256 +
    get_byte(bytes,3)::numeric
  )/4294967296::numeric
  from (select extensions.gen_random_bytes(4) bytes) source;
$$;

create function private.instant_public_session(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s private.instant_game_sessions%rowtype;
  public_state jsonb := '{}';
begin
  select * into s
  from private.instant_game_sessions
  where id=p_id and user_id=auth.uid() and status='pending';
  if not found then return null; end if;

  if s.game='crossing' then
    public_state:=jsonb_build_object('difficulty',s.state->>'difficulty');
  elsif s.game='mines' then
    public_state:=jsonb_build_object(
      'mine_count',(s.state->>'mine_count')::int,
      'picks',coalesce(s.state->'picks','[]')
    );
  elsif s.game='tower' then
    public_state:=jsonb_build_object('picks',coalesce(s.state->'picks','[]'));
  end if;

  return jsonb_build_object(
    'id',s.id,'game',s.game,'progress',s.progress,
    'multiplier',s.current_multiplier,'status',s.status,
    'public_state',public_state
  );
end;
$$;

create function private.instant_game_start(
  p_game text,
  p_stake numeric,
  p_config jsonb default '{}'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  amount numeric(14,2):=round(p_stake,2);
  w public.wallets%rowtype;
  settings public.responsible_play_settings%rowtype;
  daily numeric(14,2);
  b public.instant_game_bets%rowtype;
  hidden jsonb:='{}';
  details jsonb:='{}';
  session_json jsonb;
  r numeric;
  probability numeric;
  mult numeric(12,2):=0;
  payout numeric(14,2):=0;
  won boolean:=false;
  difficulty text;
  risk text;
  mode text;
  target numeric;
  q numeric;
  fail_step int;
  mine_count int;
  mines jsonb:='[]';
  safe jsonb:='[]';
  path jsonb:='[]';
  idx int;
  slot int:=0;
  roll numeric;
  crash numeric;
  tables jsonb;
begin
  if u is null then raise exception 'Sign in before playing'; end if;
  if p_game not in ('crossing','mines','plinko','tower','dice','limbo') then
    raise exception 'Unknown game';
  end if;
  if amount is null or amount<10 or amount>100000 then
    raise exception 'Stake must be between ₹10 and ₹1,00,000';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=u and age_confirmed and betting_suspended_at is null
  ) then
    raise exception 'Your account is not eligible to place demo wagers';
  end if;

  select * into settings
  from public.responsible_play_settings
  where user_id=u;
  if not found then raise exception 'Responsible-play settings not found'; end if;
  if settings.self_excluded_until is not null
     and settings.self_excluded_until>now() then
    raise exception 'Betting is disabled until %',settings.self_excluded_until;
  end if;
  if p_game in ('crossing','mines','tower') and exists (
    select 1 from private.instant_game_sessions
    where user_id=u and game=p_game and status='pending'
  ) then
    raise exception 'Finish your current round first';
  end if;

  select * into w
  from public.wallets where user_id=u
  for update;
  if not found then raise exception 'Wallet not found'; end if;

  select
    coalesce((select sum(stake) from public.bets
      where user_id=u and placed_at>=date_trunc('day',now())),0)
    + coalesce((select sum(stake) from public.aviator_bets
      where user_id=u and placed_at>=date_trunc('day',now())),0)
    + coalesce((select sum(stake) from public.instant_game_bets
      where user_id=u and created_at>=date_trunc('day',now())),0)
  into daily;

  if daily+amount>settings.daily_stake_limit then
    raise exception 'Daily stake limit exceeded';
  end if;
  if amount>w.balance then raise exception 'Insufficient demo balance'; end if;

  insert into public.instant_game_bets(user_id,game,stake,details)
  values(u,p_game,amount,coalesce(p_config,'{}'))
  returning * into b;

  update public.wallets
  set balance=balance-amount,updated_at=now()
  where user_id=u
  returning * into w;

  insert into public.wallet_transactions(
    user_id,kind,amount,balance_after,reference_id,description,metadata
  ) values (
    u,'bet_stake',-amount,w.balance,b.id,
    'Ace Originals demo stake',
    jsonb_build_object('game',p_game)
  );

  if p_game='crossing' then
    difficulty:=coalesce(p_config->>'difficulty','medium');
    if difficulty not in ('easy','medium','hard','extreme') then
      difficulty:='medium';
    end if;
    q:=case difficulty
      when 'easy' then .18
      when 'medium' then .25
      when 'hard' then .32
      else .40
    end;
    r:=private.instant_random();
    fail_step:=least(30,greatest(1,floor(ln(1-r)/ln(1-q))::int+1));
    hidden:=jsonb_build_object(
      'difficulty',difficulty,'q',q,'fail_step',fail_step
    );
  elsif p_game='mines' then
    mine_count:=coalesce((p_config->>'mines')::int,5);
    if mine_count not in (3,5,8,12) then mine_count:=5; end if;
    while jsonb_array_length(mines)<mine_count loop
      idx:=floor(private.instant_random()*25)::int;
      if not (mines@>jsonb_build_array(idx)) then
        mines:=mines||jsonb_build_array(idx);
      end if;
    end loop;
    hidden:=jsonb_build_object(
      'mine_count',mine_count,'mines',mines,'picks','[]'::jsonb
    );
  elsif p_game='tower' then
    for idx in 1..8 loop
      safe:=safe||jsonb_build_array(floor(private.instant_random()*3)::int);
    end loop;
    hidden:=jsonb_build_object('safe',safe,'picks','[]'::jsonb);
  elsif p_game='plinko' then
    risk:=coalesce(p_config->>'risk','medium');
    if risk not in ('low','medium','high') then risk:='medium'; end if;
    for idx in 1..8 loop
      won:=private.instant_random()>=.5;
      path:=path||jsonb_build_array(won);
      if won then slot:=slot+1; end if;
    end loop;
    tables:=case risk
      when 'low' then '[5,2,1.25,.85,.55,.85,1.25,2,5]'::jsonb
      when 'high' then '[20,4,1.5,.4,.15,.4,1.5,4,20]'::jsonb
      else '[12,3,1.5,.6,.3,.6,1.5,3,12]'::jsonb
    end;
    mult:=(tables->>slot)::numeric;
    payout:=round(amount*mult,2);
    won:=payout>=amount;
    details:=jsonb_build_object(
      'risk',risk,'path',path,'slot',slot,'multiplier',mult
    );
  elsif p_game='dice' then
    mode:=coalesce(p_config->>'mode','under');
    if mode not in ('under','over') then mode:='under'; end if;
    target:=round(coalesce((p_config->>'target')::numeric,50),2);
    if target<5 or target>95 then target:=50; end if;
    probability:=case
      when mode='under' then target/100
      else (100-target)/100
    end;
    mult:=floor((.96/probability)*100)/100;
    roll:=floor(private.instant_random()*10000)/100;
    won:=case
      when mode='under' then roll<target
      else roll>target
    end;
    if won then payout:=round(amount*mult,2); else mult:=0; end if;
    details:=jsonb_build_object('mode',mode,'target',target,'roll',roll);
  else
    target:=round(coalesce((p_config->>'target')::numeric,2),2);
    if target<1.10 or target>1000 then target:=2; end if;
    crash:=least(
      1000,
      greatest(1,floor((.96/(1-private.instant_random()))*100)/100)
    );
    won:=crash>=target;
    if won then
      mult:=target;
      payout:=round(amount*target,2);
    else
      mult:=0;
    end if;
    details:=jsonb_build_object('target',target,'crash',crash);
  end if;

  if p_game in ('crossing','mines','tower') then
    insert into private.instant_game_sessions(id,user_id,game,state)
    values(b.id,u,p_game,hidden);
    session_json:=private.instant_public_session(b.id)
      ||jsonb_build_object('stake',amount);
  else
    update public.instant_game_bets
    set status=case when won then 'won' else 'lost' end,
        multiplier=mult,
        payout=payout,
        details=details,
        settled_at=now()
    where id=b.id
    returning * into b;

    if payout>0 then
      update public.wallets
      set balance=balance+payout,updated_at=now()
      where user_id=u
      returning * into w;
      insert into public.wallet_transactions(
        user_id,kind,amount,balance_after,reference_id,description,metadata
      ) values (
        u,'bet_payout',payout,w.balance,b.id,
        'Ace Originals demo payout',
        jsonb_build_object('game',p_game,'multiplier',mult)
      );
    end if;
  end if;

  return jsonb_build_object(
    'session',session_json,
    'bet',to_jsonb(b),
    'balance',w.balance
  );
end;
$$;

create function private.instant_game_action(
  p_session_id uuid,
  p_action text,
  p_choice int default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  s private.instant_game_sessions%rowtype;
  b public.instant_game_bets%rowtype;
  w public.wallets%rowtype;
  next_step int;
  choice int:=p_choice;
  mult numeric(12,2);
  payout numeric(14,2):=0;
  probability numeric:=1;
  idx int;
  mine_count int;
  picks jsonb;
  safe_choice int;
  lost boolean:=false;
  details jsonb;
  session_json jsonb;
  action text:=p_action;
begin
  if u is null then raise exception 'Sign in before playing'; end if;
  if action not in ('step','cashout') then raise exception 'Unknown action'; end if;

  select * into s
  from private.instant_game_sessions
  where id=p_session_id and user_id=u and status='pending'
  for update;
  if not found then raise exception 'This round is no longer active'; end if;

  select * into b
  from public.instant_game_bets
  where id=s.id
  for update;

  if action='cashout' then
    if s.progress<1 then
      raise exception 'Make at least one safe move before cashing out';
    end if;
    mult:=s.current_multiplier;
    payout:=round(b.stake*mult,2);
    details:=b.details||jsonb_build_object('progress',s.progress);
  elsif s.game='crossing' then
    next_step:=s.progress+1;
    if next_step>=(s.state->>'fail_step')::int then
      lost:=true;
      details:=jsonb_build_object(
        'difficulty',s.state->>'difficulty','failed_step',next_step
      );
    else
      mult:=round(
        .96/power(1-(s.state->>'q')::numeric,next_step),
        2
      );
    end if;
  elsif s.game='mines' then
    if choice is null or choice<0 or choice>24 then
      raise exception 'Choose a valid tile';
    end if;
    picks:=coalesce(s.state->'picks','[]');
    if picks@>jsonb_build_array(choice) then
      raise exception 'That tile is already open';
    end if;
    if s.state->'mines'@>jsonb_build_array(choice) then
      lost:=true;
      details:=jsonb_build_object(
        'mine_count',(s.state->>'mine_count')::int,
        'mines',s.state->'mines',
        'hit',choice
      );
    else
      next_step:=s.progress+1;
      mine_count:=(s.state->>'mine_count')::int;
      for idx in 0..next_step-1 loop
        probability:=probability*
          ((25-mine_count-idx)::numeric/(25-idx)::numeric);
      end loop;
      mult:=round(.96/probability,2);
      s.state:=jsonb_set(
        s.state,
        '{picks}',
        picks||jsonb_build_array(choice)
      );
      if next_step=25-mine_count then action:='cashout'; end if;
    end if;
  elsif s.game='tower' then
    if choice is null or choice<0 or choice>2 then
      raise exception 'Choose a valid platform';
    end if;
    safe_choice:=(s.state->'safe'->>s.progress)::int;
    if choice<>safe_choice then
      lost:=true;
      details:=jsonb_build_object(
        'failed_row',s.progress,
        'failed_choice',choice,
        'safe_choice',safe_choice
      );
    else
      next_step:=s.progress+1;
      mult:=round(.96*power(3,next_step),2);
      picks:=coalesce(s.state->'picks','[]')||jsonb_build_array(choice);
      s.state:=jsonb_set(s.state,'{picks}',picks);
      if next_step=8 then action:='cashout'; end if;
    end if;
  else
    raise exception 'This game does not use step actions';
  end if;

  if lost then
    update public.instant_game_bets
    set status='lost',multiplier=0,payout=0,details=details,settled_at=now()
    where id=b.id
    returning * into b;
    delete from private.instant_game_sessions where id=s.id;
  elsif action='cashout' then
    if mult is null then mult:=s.current_multiplier; end if;
    if payout=0 then payout:=round(b.stake*mult,2); end if;
    details:=coalesce(
      details,
      b.details||jsonb_build_object('progress',coalesce(next_step,s.progress))
    );
    update public.instant_game_bets
    set status='won',multiplier=mult,payout=payout,details=details,settled_at=now()
    where id=b.id
    returning * into b;
    delete from private.instant_game_sessions where id=s.id;

    update public.wallets
    set balance=balance+payout,updated_at=now()
    where user_id=u
    returning * into w;
    insert into public.wallet_transactions(
      user_id,kind,amount,balance_after,reference_id,description,metadata
    ) values (
      u,'bet_payout',payout,w.balance,b.id,
      'Ace Originals demo payout',
      jsonb_build_object('game',s.game,'multiplier',mult)
    );
  else
    update private.instant_game_sessions
    set state=s.state,
        progress=next_step,
        current_multiplier=mult,
        updated_at=now()
    where id=s.id;
    session_json:=private.instant_public_session(s.id)
      ||jsonb_build_object('stake',b.stake);
  end if;

  if w.user_id is null then
    select * into w from public.wallets where user_id=u;
  end if;
  return jsonb_build_object(
    'session',session_json,
    'bet',to_jsonb(b),
    'balance',w.balance
  );
end;
$$;

create function private.instant_game_state(p_game text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  session_id uuid;
  b public.instant_game_bets%rowtype;
  balance numeric(14,2);
begin
  if u is null then
    return jsonb_build_object('session',null,'bet',null,'balance',null);
  end if;
  select id into session_id
  from private.instant_game_sessions
  where user_id=u and game=p_game and status='pending'
  order by created_at desc
  limit 1;
  if session_id is not null then
    select * into b
    from public.instant_game_bets
    where id=session_id;
  end if;
  select w.balance into balance
  from public.wallets w
  where user_id=u;
  return jsonb_build_object(
    'session',
      case when session_id is null then null
      else private.instant_public_session(session_id)
        ||jsonb_build_object('stake',b.stake)
      end,
    'bet',
      case when session_id is null then null else to_jsonb(b) end,
    'balance',balance
  );
end;
$$;

create function public.instant_game_start(
  p_game text,
  p_stake numeric,
  p_config jsonb default '{}'
)
returns jsonb language sql security definer set search_path='' as $$
  select private.instant_game_start(p_game,p_stake,p_config);
$$;
create function public.instant_game_action(
  p_session_id uuid,
  p_action text,
  p_choice int default null
)
returns jsonb language sql security definer set search_path='' as $$
  select private.instant_game_action(p_session_id,p_action,p_choice);
$$;
create function public.instant_game_state(p_game text)
returns jsonb language sql security definer set search_path='' as $$
  select private.instant_game_state(p_game);
$$;

revoke all on function private.instant_random() from public,anon,authenticated;
revoke all on function private.instant_public_session(uuid) from public,anon,authenticated;
revoke all on function private.instant_game_start(text,numeric,jsonb) from public,anon,authenticated;
revoke all on function private.instant_game_action(uuid,text,int) from public,anon,authenticated;
revoke all on function private.instant_game_state(text) from public,anon,authenticated;
revoke all on function public.instant_game_start(text,numeric,jsonb) from public,anon;
revoke all on function public.instant_game_action(uuid,text,int) from public,anon;
revoke all on function public.instant_game_state(text) from public,anon;
grant execute on function public.instant_game_start(text,numeric,jsonb) to authenticated;
grant execute on function public.instant_game_action(uuid,text,int) to authenticated;
grant execute on function public.instant_game_state(text) to authenticated;
