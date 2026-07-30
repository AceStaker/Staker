# Automatic settlement

The scheduled `/api/settle` function checks The Odds API for completed provider
events and calls a service-role-only Supabase function. Settlement is atomic and
idempotent: bet state, wallet credit, ledger entry, notification, and provider
result are committed together.

The committed Vercel schedule runs daily at 03:17 UTC so it works on Hobby plans.
On a Vercel Pro plan it can be changed to `*/5 * * * *` for five-minute checks.

Before deployment:

1. Apply the migration in `supabase/migrations`.
2. Add `ODDS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `CRON_SECRET`
   as server-only Vercel environment variables.
3. Deploy to production; Vercel Cron does not run for preview deployments.
4. Confirm `/api/settle` returns HTTP 200 when called with
   `Authorization: Bearer <CRON_SECRET>`.

Only imported events with a provider event ID and sport key are eligible.
Legacy manually-created events remain in the admin exception queue. Non-numeric,
unmatched, or otherwise ambiguous final scores are skipped rather than guessed.
Provider score quota is used only for events that currently have pending bets.
