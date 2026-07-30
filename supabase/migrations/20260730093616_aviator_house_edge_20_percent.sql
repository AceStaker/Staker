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
  v_crash := least(1000, greatest(1, 0.80 / greatest(0.0000000001, 1 - v_unit)));
  return floor(v_crash * 100) / 100;
end;
$function$;

comment on function private.aviator_crash_for_seed(text) is
  'Generates the immutable Aviator crash point with a fixed 20 percent target house edge. Only used when creating a new round; committed active rounds are unchanged.';
