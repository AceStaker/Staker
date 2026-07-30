do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('private.aviator_state()'::regprocedure)
  into v_definition;

  v_definition := replace(
    v_definition,
    'jsonb_agg(history_rows.item order by history_rows.crashed_at desc)',
    'jsonb_agg(history_rows.item order by history_rows.crashes_at desc)'
  );

  execute v_definition;
end;
$$;
