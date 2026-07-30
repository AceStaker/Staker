do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('private.aviator_state()'::regprocedure)
  into v_definition;

  v_definition := replace(
    v_definition,
    'jsonb_agg(item order by crashed_at desc)',
    'jsonb_agg(history_rows.item order by history_rows.crashed_at desc)'
  );
  v_definition := replace(
    v_definition,
    'jsonb_agg(item order by placed_at desc)',
    'jsonb_agg(user_history.item order by user_history.placed_at desc)'
  );

  execute v_definition;
end;
$$;
