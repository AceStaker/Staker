drop index if exists public.events_provider_identity_idx;

create index if not exists provider_settlement_log_event_idx
  on private.provider_settlement_log (event_id);
