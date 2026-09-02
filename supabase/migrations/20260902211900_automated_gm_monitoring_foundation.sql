-- WAR ROOM Automated GM monitoring foundation.
-- Runtime-specific Vault secrets and the pg_cron schedule are configured in the hosted project,
-- not committed here. This migration contains portable schema, RLS and extension requirements.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.monitoring_subscriptions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.fantasy_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  cadence_minutes integer not null default 30 check (cadence_minutes between 15 and 1440),
  market_add_threshold integer not null default 150 check (market_add_threshold between 25 and 10000),
  watch_roster_changes boolean not null default true,
  watch_transactions boolean not null default true,
  watch_market_acceleration boolean not null default true,
  watch_week_advance boolean not null default true,
  last_checked_at timestamptz,
  next_run_at timestamptz not null default now(),
  last_signal_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, league_id)
);

create index if not exists monitoring_subscriptions_due_idx
  on public.monitoring_subscriptions(enabled, next_run_at) where enabled = true;
create index if not exists monitoring_subscriptions_league_idx
  on public.monitoring_subscriptions(league_id);

create table if not exists public.monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.monitoring_subscriptions(id) on delete set null,
  league_id uuid not null references public.fantasy_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('running','succeeded','failed','skipped')),
  signals_checked integer not null default 0,
  alerts_created integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists monitoring_runs_league_time_idx on public.monitoring_runs(league_id, started_at desc);

create table if not exists public.monitoring_alerts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.monitoring_subscriptions(id) on delete set null,
  league_id uuid not null references public.fantasy_leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  alert_type text not null check (alert_type in ('ROSTER_CHANGE','LEAGUE_TRANSACTION','MARKET_ACCELERATION','WEEK_ADVANCED','SYSTEM')),
  severity text not null check (severity in ('info','watch','important','urgent')),
  title text not null,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  recalculation_required boolean not null default true,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, league_id, event_key)
);
create index if not exists monitoring_alerts_open_idx
  on public.monitoring_alerts(user_id, league_id, created_at desc) where resolved_at is null;

create table if not exists public.monitoring_runtime (
  singleton boolean primary key default true check (singleton),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text,
  updated_at timestamptz not null default now()
);
insert into public.monitoring_runtime(singleton) values (true) on conflict (singleton) do nothing;

alter table public.monitoring_subscriptions enable row level security;
alter table public.monitoring_runs enable row level security;
alter table public.monitoring_alerts enable row level security;
alter table public.monitoring_runtime enable row level security;

drop policy if exists monitoring_subscriptions_select_own on public.monitoring_subscriptions;
create policy monitoring_subscriptions_select_own on public.monitoring_subscriptions
for select to authenticated using ((select auth.uid()) = user_id and exists (
  select 1 from public.fantasy_leagues l where l.id = league_id and l.user_id = (select auth.uid())
));
drop policy if exists monitoring_subscriptions_insert_own on public.monitoring_subscriptions;
create policy monitoring_subscriptions_insert_own on public.monitoring_subscriptions
for insert to authenticated with check ((select auth.uid()) = user_id and exists (
  select 1 from public.fantasy_leagues l where l.id = league_id and l.user_id = (select auth.uid())
));
drop policy if exists monitoring_subscriptions_update_own on public.monitoring_subscriptions;
create policy monitoring_subscriptions_update_own on public.monitoring_subscriptions
for update to authenticated using ((select auth.uid()) = user_id and exists (
  select 1 from public.fantasy_leagues l where l.id = league_id and l.user_id = (select auth.uid())
)) with check ((select auth.uid()) = user_id and exists (
  select 1 from public.fantasy_leagues l where l.id = league_id and l.user_id = (select auth.uid())
));
drop policy if exists monitoring_subscriptions_delete_own on public.monitoring_subscriptions;
create policy monitoring_subscriptions_delete_own on public.monitoring_subscriptions
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists monitoring_runs_select_own on public.monitoring_runs;
create policy monitoring_runs_select_own on public.monitoring_runs
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists monitoring_alerts_select_own on public.monitoring_alerts;
create policy monitoring_alerts_select_own on public.monitoring_alerts
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists monitoring_alerts_update_own on public.monitoring_alerts;
create policy monitoring_alerts_update_own on public.monitoring_alerts
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.monitoring_subscriptions to authenticated;
grant select on public.monitoring_runs to authenticated;
grant select, update on public.monitoring_alerts to authenticated;
revoke all on public.monitoring_runtime from anon, authenticated;
