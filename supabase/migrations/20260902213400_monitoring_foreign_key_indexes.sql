create index if not exists monitoring_alerts_league_idx on public.monitoring_alerts(league_id);
create index if not exists monitoring_alerts_subscription_idx on public.monitoring_alerts(subscription_id);
create index if not exists monitoring_runs_subscription_idx on public.monitoring_runs(subscription_id);
create index if not exists monitoring_runs_user_idx on public.monitoring_runs(user_id);
